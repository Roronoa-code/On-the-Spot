import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AUTH, RESOURCE, SCOPES, attempt, callback, validateIdentity, tokenSet, catalog, requestBody, completedResponse, failure, blockedCodes, ConnectionError } from './protocol.mjs';

const messages = {
  access_denied: 'Sign-in was declined. Offline practice is still available.',
  wrong_account: 'The returned account does not match the account selected. Nothing was replaced.',
  invalid_state: 'The sign-in callback could not be verified. Start a fresh sign-in.',
  invalid_nonce: 'The sign-in identity could not be verified. Start a fresh sign-in.',
  authorization_failed: 'Sign-in could not finish. You can try again or practise offline.',
  sign_in_timeout: 'Sign-in timed out. You can start it again.',
  subscription_sharing_usage_limit_exceeded: 'Usage limit reached. Manage usage in ChatGPT, or practise offline.',
  subscription_sharing_user_not_eligible: 'This account or workspace cannot use its ChatGPT plan here. Offline practice is available.',
  plan_disabled: 'Signed in, but permission to use your ChatGPT plan is off.',
  interrupted_response: 'The connection test was interrupted. No partial result was saved.',
  invalid_response: 'The response did not pass validation. No result was saved.',
  http_401: 'ChatGPT did not accept this credential. Check the account and its permissions.',
  http_403: 'ChatGPT blocked access. Check this account, region and app permissions.',
  http_503: 'ChatGPT is temporarily unavailable. Try again later or practise offline.',
  reauthenticate: 'This session has expired. Continue with ChatGPT to sign in again.',
  requested_model_unavailable: 'Your selected model is not available for this account. No other model was substituted.',
};
const terminalRefresh = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Connection {
  constructor(storage, openBrowser) {
    this.store = storage; this.openBrowser = openBrowser;
    this.message = 'Connect your ChatGPT plan, or try a short exercise offline.';
    this.models = []; this.busy = ''; this.blocked = ''; this.lastError = null;
    this.refreshing = null; this.pending = null; this.controller = null;
  }
  get account() { return this.store.data.accounts.find(a => a.clientId === this.store.data.active); }
  state() {
    const a = this.account;
    return { accounts: this.store.data.accounts.map(a => ({ clientId: a.clientId, email: a.email, signedIn: !!a.accessToken })),
      active: this.store.data.active, signedIn: !!a?.accessToken, planEnabled: a?.scopes?.includes('chatgpt.tokens.use.direct') ?? false,
      busy: this.busy, message: this.message, models: this.models, blocked: this.blocked, lastError: this.lastError,
      selectedModel: this.store.data.selectedModel ?? 'gpt-6-luna', reasoningEffort: 'max',
      welcome: !!a?.accessToken && a.scopes.includes('chatgpt.tokens.use.direct') && !this.store.data.welcomed,
      evidence: this.store.evidence() };
  }
  report(error) {
    const code = error.code ?? error.message;
    this.message = messages[code] ?? 'The connection could not finish. Try again later or practise offline.';
    // Allow-list diagnostics: provider text may contain credentials or arbitrary content.
    this.lastError = { code: /^[a-z0-9_]{1,100}$/.test(code) ? code : 'connection_failed', status: error.status ?? 0, requestId: /^[a-zA-Z0-9_-]{0,200}$/.test(error.requestId ?? '') ? error.requestId ?? '' : '' };
    if (blockedCodes.has(code) || error.status === 403) this.blocked = code;
  }
  async discovery() {
    if (!this.metadata) {
      const response = await fetch(`${AUTH}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error('discovery_failed');
      const metadata = await response.json();
      if (metadata.issuer !== AUTH || metadata.token_endpoint !== `${AUTH}/api/accounts/oauth/token` || metadata.revocation_endpoint !== `${AUTH}/api/accounts/oauth/revoke` || metadata.jwks_uri !== `${AUTH}/.well-known/jwks.json`) throw new Error('invalid_discovery');
      this.metadata = metadata;
      this.jwks = createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: 15000 });
    }
    return this.metadata;
  }
  async identity(token, clientId, expected) {
    await this.discovery();
    const { payload } = await jwtVerify(token, this.jwks, { issuer: AUTH, audience: clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'] });
    return validateIdentity(payload, expected);
  }
  async json(url, options, retries = 2) {
    for (let n = 0; ; n++) {
      const signal = this.controller ? AbortSignal.any([this.controller.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
      let response;
      try { response = await fetch(url, { ...options, signal, redirect: 'error' }); }
      catch (error) {
        if (n >= retries || signal.aborted) throw error;
        await wait(300 * 2 ** n); continue;
      }
      const body = await response.json().catch(() => ({}));
      if (response.ok) return body;
      const error = failure(body, response.status, response.headers.get('x-request-id') ?? '');
      if (n >= retries || response.status < 500 || blockedCodes.has(error.code)) throw error;
      await wait(300 * 2 ** n);
    }
  }
  async exchange(fields) {
    const metadata = await this.discovery();
    // Authorization codes and rotating refresh tokens are single-use: never replay on transport uncertainty.
    return this.json(metadata.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...fields, resource: RESOURCE }) }, 0);
  }
  async signIn(clientId = null, enablePlan = false) {
    if (this.busy) throw new Error('busy');
    const selected = clientId ? this.store.data.accounts.find(a => a.clientId === clientId) : null;
    if (clientId && !selected) throw new Error('wrong_account');
    this.lastError = null;
    const pending = { ...attempt(), clientId: selected?.clientId ?? this.retryRegistration, selected, claimed: false };
    const server = createServer(async (req, res) => {
      if (req.method !== 'GET' || !req.url || req.url.length > 12000) { res.writeHead(400).end(); return; }
      const url = new URL(req.url, pending.redirect);
      if (url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
      if (pending.claimed || this.pending !== pending) { res.writeHead(409).end(); return; }
      let result;
      try { result = callback(url.searchParams, pending); }
      catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Sign-in could not be verified. Return to On the Spot.');
        // Ignore unsolicited invalid-state callbacks; they cannot consume a legitimate attempt.
        if (error.message !== 'invalid_state') { this.report(error); this.cancelSignIn(false); }
        return;
      }
      pending.claimed = true;
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" }).end('You can return to On the Spot. Your connection is being checked.');
      clearTimeout(pending.timer); server.close(); this.busy = 'Checking your connection';
      this.controller = new AbortController();
      try {
        const body = await this.exchange({ grant_type: 'authorization_code', client_id: result.client, code: result.code, code_verifier: pending.verifier, redirect_uri: pending.redirect });
        const identity = await this.identity(body.id_token, result.client, { nonce: pending.nonce, subject: selected?.subject });
        const tokens = tokenSet(body);
        if (this.pending !== pending) return;
        const existing = this.store.data.accounts.find(a => a.clientId === result.client);
        if (existing && existing.subject !== identity.subject) throw new Error('wrong_account');
        const record = { ...identity, clientId: result.client, ...tokens };
        if (existing) Object.assign(existing, record); else this.store.data.accounts.push(record);
        this.store.data.active = result.client; this.store.save(); this.store.record('registration');
        this.retryRegistration = null;
        this.models = []; this.blocked = '';
        this.message = tokens.scopes.includes('chatgpt.tokens.use.direct') ? 'Connected. Choose a model and run the connection test.' : messages.plan_disabled;
      } catch (error) {
        if (this.pending === pending) {
          if (error.code === 'invalid_grant' && !selected) this.retryRegistration = result.client;
          this.report(error);
        }
      }
      finally { if (this.pending === pending) { this.pending = null; this.busy = ''; this.controller = null; } }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    pending.server = server;
    pending.redirect = `http://127.0.0.1:${server.address().port}/auth/callback`;
    this.pending = pending; this.busy = 'Waiting for browser sign-in';
    pending.timer = setTimeout(() => { this.report(new Error('sign_in_timeout')); this.cancelSignIn(false); }, 180000);
    const url = new URL(`${AUTH}/api/accounts/authorize`);
    url.search = new URLSearchParams({ client_id: pending.clientId ?? 'dynamic_agent_client', ext_agent_host_id: this.store.data.hostId,
      response_type: 'code', redirect_uri: pending.redirect, scope: SCOPES, resource: RESOURCE, state: pending.state, nonce: pending.nonce,
      code_challenge_method: 'S256', code_challenge: pending.challenge }).toString();
    if (!pending.clientId) url.searchParams.set('agent_name_hint', 'On the Spot');
    if (selected?.idToken) url.searchParams.set('id_token_hint', selected.idToken);
    if (selected?.email) url.searchParams.set('login_hint', selected.email);
    if (enablePlan) url.searchParams.set('prompt', 'consent');
    try { await this.openBrowser(url.toString()); }
    catch (error) { this.cancelSignIn(); throw error; }
  }
  cancelSignIn(notify = true) {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.server.close(); this.pending = null; }
    this.controller?.abort(); this.busy = '';
    if (notify) this.message = 'Sign-in cancelled. Offline practice is available.';
  }
  async refresh(force = false) {
    const account = this.account;
    if (!account?.accessToken) throw new Error('reauthenticate');
    if (!force && account.expiresAt > Date.now() + 60000) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const body = await this.exchange({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken });
        if (body.id_token) await this.identity(body.id_token, account.clientId, { subject: account.subject });
        const tokens = tokenSet(body, account);
        Object.assign(account, tokens); this.store.save(); this.store.record('refresh');
      } catch (error) {
        if (terminalRefresh.has(error.code)) { this.clearTokens(account); this.store.save(); throw new Error('reauthenticate'); }
        throw error;
      }
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async access() {
    if (this.blocked) throw new ConnectionError(this.blocked);
    await this.refresh();
    if (!this.account.scopes.includes('chatgpt.tokens.use.direct')) throw new Error('plan_disabled');
    return { Authorization: `Bearer ${this.account.accessToken}` };
  }
  async loadModels() {
    this.models = catalog(await this.json(`${RESOURCE}/models`, { headers: await this.access() }));
  }
  async test(model) {
    // The user's saved choice can work even when the plan catalog omits it.
    if (model !== this.state().selectedModel && !this.models.some(m => m.slug === model)) throw new Error('invalid_model');
    this.message = await this.request(requestBody(model));
    this.store.record('completed_response');
  }
  async request(body, validate) {
    const headers = { ...await this.access(), 'Content-Type': 'application/json' };
    let response;
    // Retry only before a successful stream opens; never resend an interrupted response.
    for (let n = 0; ; n++) {
      response = await fetch(`${RESOURCE}/responses`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000)]), redirect: 'error' });
      if (response.ok) break;
      const error = failure(await response.json().catch(() => ({})), response.status, response.headers.get('x-request-id') ?? '');
      if (n === 2 || response.status < 500 || blockedCodes.has(error.code)) throw error;
      await wait(300 * 2 ** n);
    }
    try { return await completedResponse(response.body, body.model, validate); }
    catch (error) { if (error instanceof ConnectionError) error.requestId = response.headers.get('x-request-id') ?? ''; throw error; }
  }
  clearTokens(account) { for (const field of ['accessToken', 'refreshToken', 'idToken', 'expiresAt', 'scopes']) delete account[field]; }
  async signOut() {
    const account = this.account;
    if (!account) return;
    let confirmed = false;
    try {
      if (account.refreshToken) {
        const metadata = await this.discovery();
        for (let n = 0; n < 3; n++) {
          try {
            const response = await fetch(metadata.revocation_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }), signal: AbortSignal.timeout(15000), redirect: 'error' });
            if (response.status === 200) { confirmed = true; break; }
            if (response.status < 500) break;
          } catch { /* Retry while the refresh token is still available. */ }
          if (n < 2) await wait(300 * 2 ** n);
        }
      }
    } finally {
      this.clearTokens(account); this.store.save(); this.models = []; this.blocked = ''; this.lastError = null;
      if (confirmed) this.store.record('revocation');
      this.message = confirmed ? 'Signed out. The renewable session was revoked.' : 'Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT settings.';
    }
  }
  async run(action, payload) {
    if (action === 'cancel') { this.controller?.abort(); if (this.pending) this.cancelSignIn(); return this.state(); }
    if (this.busy) throw new Error('busy');
    if (action === 'signIn') { await this.signIn(payload.clientId, payload.enablePlan); return this.state(); }
    this.busy = ({ models: 'Finding available models', test: 'Testing your connection', refresh: 'Renewing your session', signOut: 'Signing out' })[action] ?? 'Working';
    this.controller = new AbortController(); this.lastError = null;
    try {
      if (action === 'models') await this.loadModels();
      else if (action === 'test') {
        try { await this.test(payload.model); }
        catch (error) {
          const unavailable = ['model_not_found', 'model_not_available', 'unsupported_model', 'unsupported_reasoning_effort'].includes(error.code);
          if (payload.model !== 'gpt-6-luna' || !unavailable) throw error;
          this.store.data.selectedModel = 'gpt-5.6-luna'; this.store.save();
          await this.test('gpt-5.6-luna');
          this.message = 'Connection confirmed. GPT 6 Luna was unavailable; using your requested fallback, GPT 5.6 Luna at max.';
        }
      }
      else if (action === 'refresh') { await this.refresh(true); this.message = 'Session renewed and saved securely.'; }
      else if (action === 'setModel') {
        if (!this.models.some(m => m.slug === payload.model)) throw new Error('invalid_model');
        this.store.data.selectedModel = payload.model; this.store.save();
      }
      else if (action === 'signOut') await this.signOut();
      else if (action === 'select') {
        if (!this.store.data.accounts.some(a => a.clientId === payload.clientId)) throw new Error('wrong_account');
        this.store.data.active = payload.clientId; this.store.save(); this.models = []; this.blocked = ''; this.message = 'Account selected.';
      } else if (action === 'welcome') { this.store.data.welcomed = true; this.store.save(); }
      else if (action === 'usageConfirmed') { this.store.record('usage_visible_user_confirmed'); this.message = 'Usage visibility recorded from your confirmation.'; }
      else if (action === 'resume') { this.blocked = ''; this.message = 'Requests resumed. Run the connection test when ready.'; }
      else throw new Error('invalid_action');
    } catch (error) { this.report(error); }
    finally { this.busy = ''; this.controller = null; }
    return this.state();
  }
}
