import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const RESOURCE = 'https://api.openai.com/v1';
export const AUTH = 'https://auth.openai.com';
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const random = () => randomBytes(32).toString('base64url');
export function attempt() {
  const verifier = random();
  return { state: random(), nonce: random(), verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
export function callback(params, pending) {
  const states = params.getAll('state');
  if (states.length !== 1 || states[0].length !== pending.state.length || !timingSafeEqual(Buffer.from(states[0]), Buffer.from(pending.state))) throw new Error('invalid_state');
  if (params.has('error')) throw new Error(params.get('error') === 'access_denied' ? 'access_denied' : 'authorization_failed');
  const code = params.get('code');
  const client = params.get('client_id') || pending.clientId;
  if (!code || code.length > 4096 || params.getAll('code').length !== 1 || params.getAll('client_id').length > 1) throw new Error('invalid_callback');
  if (!client || client === 'dynamic_agent_client' || !/^[A-Za-z0-9_-]{1,200}$/.test(client)) throw new Error('invalid_client');
  if (pending.clientId && client !== pending.clientId) throw new Error('wrong_account');
  return { code, client };
}
export function validateIdentity(payload, { nonce, subject }) {
  if (nonce && payload.nonce !== nonce) throw new Error('invalid_nonce');
  if (typeof payload.sub !== 'string' || !payload.sub || (subject && payload.sub !== subject)) throw new Error('wrong_account');
  return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : 'ChatGPT account' };
}
export function tokenSet(body, previous = {}) {
  if (typeof body.access_token !== 'string' || !body.access_token || body.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new Error('invalid_tokens');
  const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/) : previous.scopes;
  if (!Array.isArray(scopes)) throw new Error('invalid_scope');
  const refreshToken = body.refresh_token ?? previous.refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) throw new Error('invalid_refresh_token');
  return { accessToken: body.access_token, refreshToken, idToken: body.id_token ?? previous.idToken, expiresAt: Date.now() + body.expires_in * 1000, scopes };
}
export function catalog(body) {
  if (!Array.isArray(body.models)) throw new Error('invalid_models');
  return body.models.filter(m => m.visibility === 'list').map(m => {
    if (typeof m.slug !== 'string' || !m.slug || m.slug.length > 200 || typeof m.display_name !== 'string' || m.display_name.length > 200) throw new Error('invalid_models');
    return { slug: m.slug, name: m.display_name };
  });
}
export function requestBody(model) {
  return { model, reasoning: { effort: 'max' }, store: false, stream: true,
    instructions: 'Return only JSON with exactly one field: {"message":"Connection confirmed."}. This is a connection test, not a lesson or assessment.',
    input: [{ role: 'user', content: 'Confirm this connection using the requested JSON.' }] };
}
export class ConnectionError extends Error {
  constructor(code, status = 0, requestId = '') { super(code); this.code = code; this.status = status; this.requestId = requestId; }
}
export const blockedCodes = new Set(['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_user_not_eligible', 'chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context']);
export function failure(body, status, requestId = '') {
  const code = typeof body?.error?.code === 'string' ? body.error.code : typeof body?.error === 'string' ? body.error : `http_${status}`;
  return new ConnectionError(code, status, requestId);
}

// Read SSE frames across arbitrary UTF-8/network boundaries; publish no partial result.
export async function completedResponse(body, expectedModel, validate) {
  const decoder = new TextDecoder();
  let buffer = '', size = 0, completed;
  const output = new Map();
  const event = frame => {
    const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const item = JSON.parse(data);
    if (item.type === 'response.failed' || item.type === 'error') throw failure({ error: item.response?.error ?? item.error ?? item }, 200);
    if (item.type === 'response.incomplete') throw new ConnectionError('incomplete_response');
    if (item.type === 'response.output_item.done') output.set(item.output_index, item.item);
    if (item.type === 'response.completed') {
      if (item.response?.status !== 'completed') throw new ConnectionError('incomplete_response');
      completed = item.response;
    }
  };
  for await (const chunk of body) {
    size += chunk.length;
    if (size > 2_000_000) throw new ConnectionError('response_too_large');
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    // Normalize again because CR and LF can arrive in different chunks.
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) { event(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
  }
  buffer += decoder.decode();
  if (buffer.trim()) event(buffer);
  if (!completed) throw new ConnectionError('interrupted_response');
  if (expectedModel && completed.model !== expectedModel) throw new ConnectionError('unexpected_response_model');
  // Plan streams can omit output from the terminal event; completed items carry it.
  const items = completed.output?.length ? completed.output : [...output.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
  const text = items.filter(o => o?.type === 'message' && o.role === 'assistant').flatMap(o => o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text).join('');
  let value;
  try { value = JSON.parse(text); } catch { throw new ConnectionError('invalid_response'); }
  if (validate) return validate(value);
  if (!value || Object.keys(value).length !== 1 || value.message !== 'Connection confirmed.') throw new ConnectionError('invalid_response');
  return value.message;
}
