import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Learning } from '../electron/learning.mjs';

// Development only. The renderer talks to the real learning engine, using a
// separate in-memory record per preview session. Reloads retain that session;
// duplicated tabs can inherit it. No desktop files or credentials are read,
// and no connection or speech request is sent to a provider.
const prefix = '/__ots_preview/';
const learningFields = {
  profile: ['name', 'interests', 'goal', 'language'],
  start: ['mode', 'conceptId'],
  prepare: ['sessionId', 'exerciseId'],
  support: ['sessionId', 'exerciseId', 'kind'],
  answer: ['sessionId', 'exerciseId', 'answer', 'explanation', 'inputMode', 'speechOnsetMs', 'processingMs', 'skip'],
  next: ['sessionId', 'exerciseId'],
  correct: ['attemptId', 'score', 'explanation'],
  settings: ['reviewsFirst', 'newItems', 'motion'],
  reviewDraft: ['draftId', 'accept'],
  export: [],
  delete: [],
};

function createPreview() {
  const db = new DatabaseSync(':memory:');
  const learning = new Learning({
    db,
    crypto: { encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
  });
  let message = 'Browser preview. Learning runs locally in temporary memory. ChatGPT, Windows encryption and microphone transcription require the desktop app.';
  const state = () => ({
    preview: true,
    maximized: false,
    accounts: [], active: null, signedIn: false, planEnabled: false,
    busy: '', message, blocked: '', welcome: false,
    models: [], evidence: [], lastError: null,
    selectedModel: 'gpt-6-luna', reasoningEffort: 'max',
    voice: { available: false, consent: false, transcript: null },
    learning: learning.state(),
  });
  return {
    state,
    close: () => db.close(),
    command(action, payload) {
      if (typeof action !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid preview command.');
      if (action.startsWith('learn:')) {
        const name = action.slice(6);
        if (['generate', 'feedback'].includes(name)) {
          message = 'AI questions and feedback require the desktop app. This preview makes no AI requests.';
          return state();
        }
        if (!Object.hasOwn(learningFields, name) || Object.keys(payload).some(key => !learningFields[name].includes(key))) throw new Error('Invalid learning command.');
        if (name === 'delete') learning.clear();
        else if (name === 'export') return { ...state(), previewExport: learning.export() };
        else learning.run(name, payload);
        return state();
      }
      if (action === 'voice:cancel' || action === 'cancel' || action === 'welcome') return state();
      if (action === 'voice:consent' || action === 'voice:transcribe') message = 'Local speech transcription is available in the desktop app. You can type your answer in this preview.';
      else if (action.startsWith('window:')) message = 'Window controls are available in the desktop app.';
      else if (['signIn', 'select', 'test', 'setModel', 'models', 'refresh', 'signOut', 'usage', 'usageConfirmed', 'resume'].includes(action)) message = 'ChatGPT connection and account management are available in the desktop app. This preview makes no account or AI requests.';
      else throw new Error('Unknown preview command.');
      return state();
    },
  };
}

function clientScript(secret) {
  return `(() => {
  if (window.onTheSpot) return;
  const key = 'on-the-spot-preview-tab';
  let sessionId;
  try { sessionId = sessionStorage.getItem(key); } catch {}
  if (!sessionId || !/^[a-f0-9-]{36}$/.test(sessionId)) {
    sessionId = crypto.randomUUID();
    try { sessionStorage.setItem(key, sessionId); } catch {}
  }
  const request = async (path, body = {}) => {
    const response = await fetch('${prefix}' + path, {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-OTS-Preview': ${JSON.stringify(secret)} },
      body: JSON.stringify({ sessionId, ...body }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Preview request failed.');
    return result;
  };
  window.onTheSpot = {
    state: () => request('state'),
    command: async (action, payload = {}) => {
      if (action === 'learn:delete' && !window.confirm('Delete this preview’s temporary learning data? Duplicated tabs share this data. Your desktop data is not affected.')) return request('state');
      const result = await request('command', { action, payload });
      if (result.previewExport) {
        const link = document.createElement('a');
        const url = URL.createObjectURL(new Blob([result.previewExport], { type: 'application/json' }));
        link.href = url; link.download = 'On-the-Spot-preview-learning.json';
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        delete result.previewExport;
      }
      return result;
    },
  };
})();`;
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw new Error('Preview request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function previewBridge() {
  const secret = randomBytes(24).toString('hex');
  const sessions = new Map();
  return {
    name: 'on-the-spot-local-preview',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // Vite needs its style injection and local fetch/HMR connections. This
        // transform never runs during `vite build`; packaged CSP stays strict.
        return {
          html: html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'").replace("connect-src 'none'", "connect-src 'self' ws://127.0.0.1:* ws://localhost:*"),
          tags: [{ tag: 'script', attrs: { src: `${prefix}bridge.js` }, injectTo: 'head-prepend' }],
        };
      },
    },
    configureServer(server) {
      const close = () => { for (const preview of sessions.values()) preview.close(); sessions.clear(); };
      server.httpServer?.once('close', close);
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path?.startsWith(prefix)) return next();
        const send = (code, value) => {
          response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(JSON.stringify(value));
        };
        const host = request.headers.host ?? '';
        const address = request.socket.remoteAddress;
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return send(403, { error: 'Preview is limited to this computer.' });
        if (request.headers.origin && request.headers.origin !== `http://${host}`) return send(403, { error: 'Preview origin was rejected.' });
        if (path === `${prefix}bridge.js` && request.method === 'GET') {
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
          response.end(clientScript(secret));
          return;
        }
        if (request.method !== 'POST' || request.headers['x-ots-preview'] !== secret || !request.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'Preview request was rejected.' });
        if (![`${prefix}state`, `${prefix}command`].includes(path)) return send(404, { error: 'Unknown preview endpoint.' });
        try {
          const body = await readBody(request);
          if (!body || !/^[a-f0-9-]{36}$/.test(body.sessionId)) throw new Error('Invalid preview session.');
          if (!sessions.has(body.sessionId)) {
            if (sessions.size >= 64) throw new Error('Restart the preview server to open more preview sessions.');
            sessions.set(body.sessionId, createPreview());
          }
          const preview = sessions.get(body.sessionId);
          const result = path.endsWith('/state') ? preview.state() : preview.command(body.action, body.payload);
          send(200, result);
        } catch (error) {
          send(400, { error: error instanceof Error ? error.message : 'Preview action failed.' });
        }
      });
    },
  };
}
