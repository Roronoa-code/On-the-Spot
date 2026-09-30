import { app, BrowserWindow, ipcMain, safeStorage, shell, session, dialog, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Storage } from './storage.mjs';
import { Connection } from './connection.mjs';
import { Learning } from './learning.mjs';
import { ask } from './ai.mjs';
import { Voice } from './voice.mjs';
import { prompt } from './prompt.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const page = join(root, 'dist', 'index.html');
let window, storage, connection, learning, voice, microphoneConsent = false, transcript = null;
app.setName('On the Spot');
if (process.argv.includes('--headless-check') && process.env.OTS_CHECK_DATA) app.setPath('userData', process.env.OTS_CHECK_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
  storage = new Storage(app.getPath('userData'), safeStorage);
  connection = new Connection(storage, url => shell.openExternal(url));
  learning = new Learning(storage);
  voice = new Voice(app.isPackaged ? join(process.resourcesPath, 'voice-runtime') : join(root, 'voice-runtime'));
  const state = () => ({ ...connection.state(), maximized: window?.isMaximized() ?? false, learning: learning.state(), voice: { available: voice.available, consent: microphoneConsent, transcript } });
  session.defaultSession.setPermissionRequestHandler((web, permission, callback, details) => callback(web === window?.webContents && microphoneConsent && permission === 'media' && !!details.mediaTypes?.length && details.mediaTypes.every(type => type === 'audio')));
  session.defaultSession.setPermissionCheckHandler((web, permission, _origin, details) => web === window?.webContents && microphoneConsent && permission === 'media' && details.mediaType !== 'video');
  const secondDisplay = screen.getAllDisplays()[1]?.workArea;
  window = new BrowserWindow({ width: 1080, height: 800, minWidth: 360, minHeight: 560, backgroundColor: '#141716',
    ...(secondDisplay ? { x: secondDisplay.x + 30, y: secondDisplay.y + 30 } : {}),
    show: false, frame: false, autoHideMenuBar: true,
    webPreferences: { preload: join(root, 'electron', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      backgroundThrottling: !process.argv.includes('--headless-check') } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => { if (!process.argv.includes('--headless-check')) window.show(); });
  const trusted = event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== new URL(`file:///${page.replace(/\\/g, '/')}`).href) throw new Error('Untrusted sender');
  };
  ipcMain.handle('spot:state', event => { trusted(event); return state(); });
  ipcMain.handle('spot:command', async (event, action, payload) => {
    trusted(event);
    if (typeof action !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid message');
    if (action.startsWith('window:')) {
      if (Object.keys(payload).length || !['window:minimize','window:maximize','window:close'].includes(action)) throw new Error('Invalid message');
      if (action === 'window:minimize') window.minimize();
      else if (action === 'window:maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
      else window.close();
      return window?.isDestroyed() ? null : state();
    }
    if (action.startsWith('voice:')) {
      const name = action.slice(6), fields = { consent: [], transcribe: ['wav', 'language'], cancel: [] };
      if (!Object.hasOwn(fields, name) || Object.keys(payload).some(key => !fields[name].includes(key))) throw new Error('Invalid message');
      if (name === 'consent') {
        if (!microphoneConsent) microphoneConsent = await prompt(window, root, { title: 'Use your microphone?', message: 'Speak an answer and turn it into editable text, on this PC.', detail: 'The recording is discarded. Nothing is graded until you check the transcript. You can always type instead.', confirm: 'Allow microphone' });
      } else if (name === 'transcribe') {
        if (!microphoneConsent) throw new Error('microphone_not_allowed');
        transcript = null; transcript = await voice.transcribe(payload.wav, payload.language);
      } else { voice.cancel(); transcript = null; }
      return state();
    }
    const learningFields = { profile: ['name', 'interests', 'goal', 'language'], start: ['mode', 'conceptId'], prepare: ['sessionId', 'exerciseId'], support: ['sessionId', 'exerciseId', 'kind'], answer: ['sessionId', 'exerciseId', 'answer', 'explanation', 'inputMode', 'speechOnsetMs', 'processingMs', 'skip'], next: ['sessionId', 'exerciseId'], correct: ['attemptId', 'score', 'explanation'], settings: ['reviewsFirst', 'newItems', 'motion'], generate: ['conceptId'], feedback: ['attemptId'], reviewDraft: ['draftId', 'accept'], export: [], delete: [] };
    if (action.startsWith('learn:')) {
      const name = action.slice(6);
      if (!Object.hasOwn(learningFields, name) || Object.keys(payload).some(key => !learningFields[name].includes(key))) throw new Error('Invalid message');
      if (['generate', 'feedback'].includes(name)) await ask(connection, name, payload, learning);
      else if (name === 'export') {
        const file = await dialog.showSaveDialog(window, { title: 'Export learner data (unencrypted JSON)', defaultPath: 'On-the-Spot-learning.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!file.canceled && file.filePath) writeFileSync(file.filePath, learning.export(), { encoding: 'utf8', flush: true });
      } else if (name === 'delete') {
        const confirmed = await prompt(window, root, { title: 'Delete your learning data?', message: 'Your profile, sessions, answers and review dates will be removed.', detail: 'This cannot be undone. Your ChatGPT connection and exported files are kept.', confirm: 'Delete learner data' });
        if (confirmed) learning.clear();
      } else learning.run(name, payload);
      return state();
    }
    const fields = { signIn: ['clientId', 'enablePlan'], select: ['clientId'], test: ['model'], setModel: ['model'], models: [], refresh: [], signOut: [], cancel: [], welcome: [], usage: [], usageConfirmed: [], resume: [] };
    if (!Object.hasOwn(fields, action) || Object.keys(payload).some(key => !fields[action].includes(key))) throw new Error('Invalid message');
    for (const key of ['clientId', 'model']) if (payload[key] != null && (typeof payload[key] !== 'string' || payload[key].length > 200)) throw new Error('Invalid message');
    if (payload.enablePlan != null && typeof payload.enablePlan !== 'boolean') throw new Error('Invalid message');
    if (action === 'usage') { await shell.openExternal('https://chatgpt.com/settings/usage'); return state(); }
    await connection.run(action, payload); return state();
  });
  await window.loadFile(page);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { voice.cancel(); connection.cancelSignIn(false); storage.close(); });
  if (process.argv.includes('--verify-connection') || process.argv.includes('--verify-luna')) {
    const checks = [];
    for (const action of process.argv.includes('--verify-luna') ? ['models', 'test'] : ['models', 'test', 'refresh', 'signOut']) {
      await connection.run(action, { model: connection.state().selectedModel });
      const passed = !connection.lastError && (action !== 'signOut' || connection.message === 'Signed out. The renewable session was revoked.');
      checks.push({ action, passed, error: connection.lastError ?? (passed ? null : { code: 'revocation_unconfirmed' }) });
      mkdirSync(join(root, 'artifacts'), { recursive: true });
      writeFileSync(join(root, 'artifacts', process.argv.includes('--verify-luna') ? 'luna-gate.json' : 'live-gate.json'), JSON.stringify({ model: connection.state().selectedModel, effort: connection.state().reasoningEffort, availableModels: connection.models, checks, evidence: storage.evidence(), at: new Date().toISOString() }, null, 2));
      if (!passed) break;
    }
    if (process.argv.includes('--verify-luna')) app.quit();
  }
  }).catch(() => {
    dialog.showErrorBox('On the Spot could not start', 'Protected local data could not be opened. Your existing files were left intact. Check Windows encryption and the app data folder before trying again.');
    app.quit();
  });
}

