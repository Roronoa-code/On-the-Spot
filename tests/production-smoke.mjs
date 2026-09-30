// Build first with `npm run build`. This checks the bundled renderer's strict
// CSP and real offline learning flow; it does not emulate Windows encryption,
// microphone capture, OAuth, or native window controls.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { Learning } from '../electron/learning.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? '', 'playwright')); }
const html = await readFile('dist/index.html', 'utf8');
assert.ok(html.includes("connect-src 'none'"), 'The packaged renderer must retain its strict connection policy.');
assert.ok(html.includes("style-src 'self'"));
assert.ok(!html.includes('unsafe-inline') && !html.includes('__ots_preview/bridge.js'));

const db = new DatabaseSync(':memory:');
const learning = new Learning({ db, crypto: { encryptString: value => Buffer.from(value), decryptString: value => value.toString() } });
learning.run('profile', { name: 'Renderer check', interests: 'Words', goal: 'Recall an idea', language: 'English' });
let connectionFixture = false, fixtureError = false, finishModelRequest;
const state = () => ({
  preview: !connectionFixture, accounts: [], active: null, signedIn: connectionFixture, planEnabled: connectionFixture,
  busy: '', message: fixtureError ? 'ChatGPT is temporarily unavailable. Try again later or practise offline.' : 'Isolated renderer verification.', blocked: '', welcome: false,
  models: [], evidence: [], lastError: fixtureError ? { code: 'http_503', status: 503, requestId: '' } : null, selectedModel: 'gpt-6-luna', reasoningEffort: 'max',
  voice: { available: false, consent: false, transcript: null }, learning: learning.state(),
});
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } });
const browser = await playwright.chromium.launch({ headless: true,
  ...(process.env.OTS_BROWSER_EXECUTABLE ? { executablePath: process.env.OTS_BROWSER_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1080, height: 800 } });
const errors = [], requests = [];
try {
  await context.exposeBinding('__rendererState', () => state());
  await context.exposeBinding('__rendererCommand', (_source, action, payload = {}) => {
    if (connectionFixture && action === 'models') return new Promise(resolve => { finishModelRequest = () => resolve(state()); });
    if (connectionFixture && action === 'cancel') { finishModelRequest?.(); finishModelRequest = undefined; return state(); }
    if (connectionFixture && action === 'learn:generate') fixtureError = true;
    else if (action.startsWith('learn:')) learning.run(action.slice(6), payload);
    else assert.equal(action, 'voice:cancel', 'Unexpected native action in renderer test.');
    return state();
  });
  await context.addInitScript(() => {
    window.onTheSpot = { state: () => window.__rendererState(), command: (action, payload) => window.__rendererCommand(action, payload) };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.locator('#answer:visible').fill('A rough answer helps plan shopping.');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await page.locator('.result:visible').waitFor();
  assert.equal(learning.state().session.result.score, 1);
  assert.equal(learning.state().attempts.length, 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Your setup.' }).waitFor();
  await page.getByRole('group', { name: 'Interface motion' }).getByRole('button', { name: /^Gentle/ }).click();
  await page.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-motion') === 'gentle');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Your setup.' }).waitFor({ state: 'hidden' });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...document.fonts].map(font => ({ family: font.family, status: font.status })));
  assert.ok(fonts.some(font => font.family === 'Manrope' && font.status === 'loaded'));
  assert.ok(fonts.some(font => font.family.replaceAll('"', '') === 'IBM Plex Mono' && font.status === 'loaded'));
  assert.deepEqual(errors, [], 'The built renderer must not produce runtime or CSP errors.');
  assert.ok(requests.every(url => url.startsWith(`${origin}/`)), 'The bundled renderer must not fetch external resources.');
  assert.ok(!requests.some(url => url.includes('__ots_preview')), 'The built renderer must not include the development bridge.');
  await mkdir('artifacts/ui', { recursive: true });
  await page.screenshot({ path: 'artifacts/ui/production-renderer.png', fullPage: true });

  // Explicit UI fixtures below. These simulate connection outcomes, with no
  // credentials, provider requests, or evidence that a real plan is connected.
  connectionFixture = true;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Your setup.' });
  await settings.locator('summary').filter({ hasText: 'Model and session' }).click();
  const models = settings.getByRole('button', { name: 'Find available models', exact: true });
  await models.click();
  await settings.getByText('Finding available models', { exact: true }).waitFor();
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Find available models')?.disabled);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: /^Make a fresh question with AI/ }).click();
  await page.getByRole('button', { name: 'Prepare a question', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'ChatGPT is temporarily unavailable.' }).waitFor();
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url.startsWith(`${origin}/`)));
  const report = { passed: true, strictCsp: true, realLearningAttempts: learning.state().attempts.length, fonts, errors, resourceCount: requests.length, mockedUiChecks: ['Pending models status and cancellation remain usable in Settings.', 'Resolved AI failures appear on the learning page.'], limitations: 'Native storage, speech, live connection and operating-system controls are outside this renderer check. Connection UI outcomes are explicitly simulated.' };
  await writeFile('artifacts/ui/production-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
  db.close();
}
