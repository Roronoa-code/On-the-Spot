import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { attempt, callback, validateIdentity, tokenSet, catalog, requestBody, completedResponse, blockedCodes, failure, AUTH } from '../electron/protocol.mjs';
import { Connection } from '../electron/connection.mjs';

function store(account) {
  return { data: { hostId: 'urn:uuid:test', accounts: account ? [account] : [], active: account?.clientId ?? null }, saves: 0, events: [],
    save() { this.saves++; }, record(event) { this.events.push(event); }, evidence() { return this.events.map(event => ({ event, at: '2026-09-30T10:00:00Z' })); } };
}
const account = () => ({ clientId: 'oaiapp_one', subject: 'user-one', email: 'same@example.test', accessToken: 'secret-access', refreshToken: 'secret-refresh', idToken: 'secret-id', scopes: ['chatgpt.tokens.use.direct'], expiresAt: 0 });
const tokens = { access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct' };
const stream = (frames, width = 7) => {
  const bytes = Buffer.from(frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join(''));
  return (async function* () { for (let n = 0; n < bytes.length; n += width) yield bytes.subarray(n, n + width); })();
};
const complete = { type: 'response.completed', response: { model: 'model', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"message":"Connection confirmed."}' }] }] } };

test('fresh state, nonce and PKCE; callback rejects denial, spoofing and wrong clients', () => {
  const p = attempt(), other = attempt();
  assert.notEqual(p.state, other.state); assert.notEqual(p.nonce, other.nonce); assert.notEqual(p.challenge, other.challenge);
  assert.throws(() => callback(new URLSearchParams('state=wrong&code=c&client_id=oaiapp_one'), p), /invalid_state/);
  assert.throws(() => callback(new URLSearchParams({ state: p.state, error: 'access_denied' }), p), /access_denied/);
  assert.throws(() => callback(new URLSearchParams({ state: p.state, code: 'c' }), p), /invalid_client/);
  assert.throws(() => callback(new URLSearchParams({ state: p.state, code: 'c', client_id: 'oaiapp_two' }), { ...p, clientId: 'oaiapp_one' }), /wrong_account/);
  assert.deepEqual(callback(new URLSearchParams({ state: p.state, code: 'c', client_id: 'oaiapp_one' }), p), { code: 'c', client: 'oaiapp_one' });
  assert.throws(() => validateIdentity({ sub: 'other', nonce: p.nonce }, { nonce: p.nonce, subject: 'user-one' }), /wrong_account/);
  assert.throws(() => validateIdentity({ sub: 'user-one', nonce: 'wrong' }, { nonce: p.nonce }), /invalid_nonce/);
});
test('cryptographic identity checks reject signature, issuer, audience, expiry and nonce', async () => {
  const keys = await generateKeyPair('RS256');
  const jwk = await exportJWK(keys.publicKey); jwk.kid = 'test';
  const connection = new Connection(store(), () => {});
  connection.metadata = {}; connection.jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = async (overrides = {}, privateKey = keys.privateKey) => new SignJWT({ sub: 'user-one', nonce: 'nonce', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(overrides.iss ?? AUTH).setAudience(overrides.aud ?? 'oaiapp_one').setIssuedAt().setExpirationTime(overrides.exp ?? '5m').sign(privateKey);
  assert.equal((await connection.identity(await sign(), 'oaiapp_one', { nonce: 'nonce' })).subject, 'user-one');
  for (const change of [{ iss: 'https://attacker.test' }, { aud: 'wrong' }, { exp: 1 }, { nonce: 'bad' }, { sub: 'other' }]) await assert.rejects(connection.identity(await sign(change), 'oaiapp_one', { nonce: 'nonce', subject: 'user-one' }));
  const wrongKeys = await generateKeyPair('RS256');
  await assert.rejects(connection.identity(await sign({}, wrongKeys.privateKey), 'oaiapp_one', { nonce: 'nonce' }));
});
test('scope, catalog and request contract are strict', () => {
  assert.throws(() => tokenSet({ ...tokens, scope: undefined }), /invalid_scope/);
  assert.throws(() => tokenSet({ ...tokens, expires_in: -1 }), /invalid_tokens/);
  assert.deepEqual(catalog({ models: [{ visibility: 'hidden' }, { visibility: 'list', slug: 'account-model', display_name: 'Available model' }] }), [{ slug: 'account-model', name: 'Available model' }]);
  assert.throws(() => catalog({ data: [] }), /invalid_models/);
  const body = requestBody('account-model');
  assert.equal(body.model, 'account-model'); assert.equal(body.store, false); assert.equal(body.stream, true); assert.ok(Array.isArray(body.input));
  assert.deepEqual(body.reasoning, { effort: 'max' });
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'reasoning', 'store', 'stream']);
});
test('SSE accepts only completed schema-valid JSON across byte boundaries', async () => {
  for (const width of [1, 7, 10000]) assert.equal(await completedResponse(stream([complete], width)), 'Connection confirmed.');
  const itemDone = { type: 'response.output_item.done', output_index: 0, item: complete.response.output[0] };
  const emptyCompleted = { type: 'response.completed', response: { status: 'completed', output: [] } };
  assert.equal(await completedResponse(stream([itemDone, emptyCompleted])), 'Connection confirmed.');
  await assert.rejects(completedResponse(stream([itemDone])), /interrupted_response/);
  await assert.rejects(completedResponse(stream([emptyCompleted])), /invalid_response/);
  await assert.rejects(completedResponse(stream([{ type: 'response.output_text.delta', delta: 'partial' }])), /interrupted_response/);
  await assert.rejects(completedResponse(stream([{ type: 'response.incomplete' }])), /incomplete_response/);
  await assert.rejects(completedResponse(stream([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])), /subscription_sharing_usage_limit_exceeded/);
  const invalid = structuredClone(complete); invalid.response.output[0].content[0].text = '{"message":"anything","score":100}';
  await assert.rejects(completedResponse(stream([invalid])), /invalid_response/);
  await assert.rejects(completedResponse(stream([complete, { type: 'response.failed', response: { error: { code: 'late_error' } } }])), /late_error/);
});
test('expired access refreshes once, rotates atomically and never leaks tokens to UI', async () => {
  const storage = store(account()), connection = new Connection(storage, () => {}); let calls = 0;
  connection.exchange = async fields => { calls++; assert.equal(fields.client_id, 'oaiapp_one'); await new Promise(resolve => setTimeout(resolve, 5)); return tokens; };
  await Promise.all([connection.refresh(), connection.refresh()]);
  assert.equal(calls, 1); assert.equal(storage.saves, 1); assert.equal(connection.account.refreshToken, 'new-refresh');
  assert.deepEqual(storage.events, ['refresh']);
  assert.equal(JSON.stringify(connection.state()).includes('secret-'), false); assert.equal(JSON.stringify(connection.state()).includes('new-access'), false);
});
test('saved model choice persists and missing preferred model never selects a fallback', async () => {
  const storage = store({ ...account(), expiresAt: Date.now() + 100000 });
  const connection = new Connection(storage, () => {});
  assert.equal(connection.state().selectedModel, 'gpt-6-luna');
  connection.json = async () => ({ models: [{ slug: 'gpt-6-astra', display_name: 'GPT 6 Astra', visibility: 'list' }] });
  await connection.loadModels();
  assert.equal(connection.state().selectedModel, 'gpt-6-luna');
  await assert.rejects(connection.test('untrusted-model'), /invalid_model/);
  connection.models.push({ slug: 'gpt-6-luna', name: 'GPT 6.1 Sol' });
  await connection.run('setModel', { model: 'gpt-6-luna' });
  assert.equal(storage.data.selectedModel, 'gpt-6-luna');
  assert.equal(new Connection(storage, () => {}).state().selectedModel, 'gpt-6-luna');
});
test('unusable refresh clears tokens but preserves registration; transient failure preserves tokens', async () => {
  const storage = store(account()), connection = new Connection(storage, () => {});
  connection.exchange = async () => { throw failure({ error: 'invalid_grant' }, 400); };
  await assert.rejects(connection.refresh(), /reauthenticate/);
  assert.equal(connection.account.accessToken, undefined); assert.equal(connection.account.clientId, 'oaiapp_one');
  const other = new Connection(store(account()), () => {});
  other.exchange = async () => { throw failure({}, 503); };
  await assert.rejects(other.refresh(), /http_503/); assert.equal(other.account.refreshToken, 'secret-refresh');
});
test('missing permission prevents inference; exhausted usage pauses future calls', async () => {
  const storage = store({ ...account(), scopes: [], expiresAt: Date.now() + 100000 });
  const connection = new Connection(storage, () => {});
  await assert.rejects(connection.access(), /plan_disabled/);
  const error = failure({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, 429, 'request-one');
  assert.ok(blockedCodes.has(error.code)); connection.report(error);
  await assert.rejects(connection.access(), /subscription_sharing_usage_limit_exceeded/);
  assert.equal(connection.state().lastError.requestId, 'request-one'); assert.equal(storage.events.length, 0);
});
test('failed and interrupted streams never record a completed request', async () => {
  const realFetch = globalThis.fetch;
  try {
    const connection = new Connection(store({ ...account(), expiresAt: Date.now() + 100000 }), () => {});
    connection.models = [{ slug: 'model', name: 'Model' }]; connection.controller = new AbortController();
    globalThis.fetch = async () => new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    await assert.rejects(connection.test('model'), /interrupted_response/);
    assert.deepEqual(connection.store.events, []);
    globalThis.fetch = async () => new Response(`data: ${JSON.stringify(complete)}\n\n`);
    await connection.test('model'); assert.deepEqual(connection.store.events, ['completed_response']);
  } finally { globalThis.fetch = realFetch; }
});
test('loopback listener starts before browser opens; denied consent leaves account unchanged', async () => {
  let opened;
  const storage = store(account());
  const connection = new Connection(storage, async url => { opened = new URL(url); });
  await connection.signIn('oaiapp_one');
  try {
    assert.equal(opened.searchParams.get('client_id'), 'oaiapp_one'); assert.equal(opened.searchParams.has('agent_name_hint'), false);
    const redirect = new URL(opened.searchParams.get('redirect_uri')); assert.equal(redirect.hostname, '127.0.0.1'); assert.equal(redirect.pathname, '/auth/callback');
    const stale = new URL(redirect); stale.search = new URLSearchParams({ state: 'wrong', error: 'access_denied' });
    assert.equal((await fetch(stale)).status, 400); assert.ok(connection.pending);
    redirect.search = new URLSearchParams({ state: opened.searchParams.get('state'), error: 'access_denied' });
    assert.equal((await fetch(redirect)).status, 400); assert.equal(connection.pending, null);
    assert.equal(connection.account.accessToken, 'secret-access'); assert.equal(storage.saves, 0);
  } finally { connection.cancelSignIn(false); }
});
test('new registration exchanges exact callback and issued ID; replays cannot overwrite', async () => {
  let opened;
  const storage = store();
  const connection = new Connection(storage, async url => { opened = new URL(url); });
  connection.identity = async (_token, clientId, expected) => { assert.equal(clientId, 'oaiapp_new'); assert.equal(expected.nonce, opened.searchParams.get('nonce')); return { subject: 'new-user', email: 'same@example.test' }; };
  connection.exchange = async fields => { assert.equal(fields.client_id, 'oaiapp_new'); assert.equal(fields.redirect_uri, opened.searchParams.get('redirect_uri')); assert.equal(fields.code_verifier, connection.pending.verifier); return { ...tokens, id_token: 'verified-in-separate-test' }; };
  await connection.signIn();
  try {
    assert.equal(opened.searchParams.get('agent_name_hint'), 'On the Spot'); assert.equal(opened.searchParams.get('client_id'), 'dynamic_agent_client');
    const redirect = new URL(opened.searchParams.get('redirect_uri')); redirect.search = new URLSearchParams({ state: opened.searchParams.get('state'), code: 'code', client_id: 'oaiapp_new' });
    await fetch(redirect); for (let n = 0; n < 20 && connection.busy; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(storage.data.active, 'oaiapp_new'); assert.equal(storage.saves, 1); assert.deepEqual(storage.events, ['registration']);
  } finally { connection.cancelSignIn(false); }
});
test('sign-out revokes refresh token, clears only selected credentials and retains host', async () => {
  const storage = store(account()); storage.data.accounts.push({ ...account(), clientId: 'oaiapp_two' });
  const connection = new Connection(storage, () => {}); connection.metadata = { revocation_endpoint: `${AUTH}/api/accounts/oauth/revoke` };
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => { assert.equal(options.body.get('token'), 'secret-refresh'); assert.equal(options.body.get('client_id'), 'oaiapp_one'); return new Response(null, { status: 200 }); };
    await connection.signOut(); assert.deepEqual(storage.events, ['revocation']); assert.equal(connection.account.refreshToken, undefined);
    assert.equal(storage.data.accounts[1].refreshToken, 'secret-refresh'); assert.equal(storage.data.hostId, 'urn:uuid:test');
  } finally { globalThis.fetch = realFetch; }
});
