/** Actual built React renderer + real Learning engine. No user files or live AI calls. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { Learning } from '../electron/learning.mjs';

const output = resolve('artifacts/ui');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve('dist', pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!path.startsWith(`${resolve('dist')}/`)) { res.writeHead(403).end(); return; }
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); res.end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(4178, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true });
const errors = [], results = [];
let context, db;
async function fixture({ profile = true, viewport = { width: 1280, height: 900 }, reducedMotion = 'no-preference' } = {}) {
  if (context) await context.close(); if (db) db.close();
  db = new DatabaseSync(':memory:');
  const learner = new Learning({ db, crypto: { encryptString: s => Buffer.from(s), decryptString: b => b.toString() } }, () => new Date('2026-09-30T12:00:00Z'));
  if (profile) learner.run('profile', { name: 'Mani', interests: 'Languages, films and technology', goal: 'Find the words when I need them.', language: 'English' });
  let fail = '', delay = 0;
  const calls = [], connection = { accounts: [], active: null, signedIn: false, planEnabled: false, busy: '', message: '', blocked: '', welcome: false, models: [], evidence: [], lastError: null, selectedModel: 'gpt-6-luna', reasoningEffort: 'max' };
  const state = () => ({ ...connection, learning: learner.state(), voice: { available: false, consent: false, transcript: null } });
  context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  await page.exposeFunction('__read', state);
  await page.exposeFunction('__command', async (action, payload = {}) => {
    calls.push({ action, payload }); if (delay) await new Promise(done => setTimeout(done, delay));
    if (action === fail) { fail = ''; throw new Error('Deliberate test failure'); }
    if (action.startsWith('learn:')) {
      const name = action.slice(6);
      if (name === 'generate') learner.data.draft = { id: 'draft-test', sourceId: 'estimate', lesson: 'An estimate is a rough, useful answer.', prompt: 'When could a rough answer help you plan?' };
      else if (!['delete', 'export', 'feedback'].includes(name)) learner.run(name, payload);
    } else if (action === 'signIn') Object.assign(connection, { signedIn: true, planEnabled: true, welcome: true, message: 'Connected in this isolated UI test.' });
    else if (action === 'welcome') connection.welcome = false;
    else if (action === 'models') connection.models = [{ slug: 'gpt-6-luna', name: 'Test model' }];
    else if (action === 'setModel') connection.selectedModel = payload.model;
    else if (action === 'signOut') Object.assign(connection, { signedIn: false, planEnabled: false });
    return state();
  });
  await page.addInitScript(() => { window.onTheSpot = { state: () => window.__read(), command: (action, payload) => window.__command(action, payload) }; });
  await page.goto('http://127.0.0.1:4178');
  await page.locator(profile ? '.launch-spot' : '.profile-form').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { page, learner, calls, fail: action => { fail = action; }, delay: ms => { delay = ms; } };
}
async function nav(page, index) { await page.locator('nav[aria-label="Main"] button').nth(index).click(); await page.waitForTimeout(450); }
async function shot(page, name) { await page.waitForTimeout(500); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); }
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No horizontal page overflow'); }
async function record(name, fn) { try { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); if (context) await context.pages()[0]?.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true }); } }
try {
  await record('Onboarding uses the real learning profile command', async () => {
    const { page, learner } = await fixture({ profile: false });
    await shot(page, 'onboarding-desktop');
    await page.locator('input[name="name"]').fill('Mani');
    await page.locator('input[name="goal"]').fill('Find the words when I need them.');
    await page.getByRole('button', { name: 'Make it mine' }).click();
    await page.locator('.launch-spot').waitFor();
    assert.equal(learner.state().profile.name, 'Mani'); await noOverflow(page);
  });
  await record('Desktop home, session controls and interrupted navigation', async () => {
    const { page, learner } = await fixture();
    await shot(page, 'today-desktop');
    await page.getByRole('radio', { name: /A little longer/ }).check();
    assert.match(await page.locator('.spot-number').innerText(), /12/);
    await page.getByRole('radio', { name: /A quick go/ }).check();
    await page.locator('.family-strip button').nth(2).click();
    assert.match(await page.locator('#family-description').innerText(), /Reason through/);
    for (const i of [1, 2, 0, 2, 1, 0]) await page.locator('nav[aria-label="Main"] button').nth(i).click({ force: true });
    await page.waitForTimeout(650); assert.equal(await page.locator('main').getAttribute('data-page'), 'Today');
    await page.locator('.launch-spot').click(); await page.locator('#answer').waitFor();
    assert.equal(learner.state().session.count, 4); await noOverflow(page);
  });
  await record('Answer, note and hint survive leaving Practice', async () => {
    const { page } = await fixture(); await page.locator('.launch-spot').click(); await page.locator('#answer').fill('A rough answer helps plan shopping.');
    await page.getByRole('button', { name: 'Anything worth noting?' }).click();
    await page.getByLabel('How did this feel? (optional)').selectOption('Knew it but could not recall it');
    await page.getByRole('button', { name: 'A small hint' }).click(); await shot(page, 'practice-desktop');
    await nav(page, 2); await nav(page, 0); await page.locator('.launch-spot').click();
    assert.equal(await page.locator('#answer').inputValue(), 'A rough answer helps plan shopping.');
    await page.getByRole('button', { name: 'Anything worth noting?' }).click();
    assert.equal(await page.getByLabel('How did this feel? (optional)').inputValue(), 'Knew it but could not recall it');
    assert.equal(await page.getByRole('button', { name: 'A small hint' }).getAttribute('aria-pressed'), 'true');
  });
  await record('Empty answer, failed request, duplicate submit and full session', async () => {
    const { page, learner, calls, fail, delay } = await fixture();
    await page.locator('.launch-spot').click(); await page.locator('#answer').waitFor();
    await page.getByRole('button', { name: 'Check answer' }).click(); assert.ok(await page.locator('#answer-error').isVisible());
    await page.locator('#answer').fill('A rough answer helps plan shopping.');
    fail('learn:answer'); await page.getByRole('button', { name: 'Check answer' }).click();
    await page.locator('.notice').waitFor(); assert.equal(await page.locator('#answer').inputValue(), 'A rough answer helps plan shopping.');
    delay(250);
    await page.getByRole('button', { name: 'Check answer' }).evaluate(button => { button.click(); button.click(); });
    await page.locator('.result').waitFor(); delay(0);
    assert.equal(learner.data.attempts.length, 1); assert.equal(calls.filter(c => c.action === 'learn:answer').length, 2);
    await shot(page, 'feedback-desktop');
    await page.getByRole('button', { name: 'Next exercise' }).click(); await page.locator('#answer').waitFor();
    assert.equal(await page.locator('#answer').inputValue(), '');
    await page.getByRole('button', { name: 'Skip this one' }).click(); await page.getByRole('button', { name: 'Next exercise' }).click();
    await page.locator('#answer').fill(String(learner.session.items[2].answer)); await page.getByRole('button', { name: 'Check answer' }).click(); await page.getByRole('button', { name: 'Next exercise' }).click();
    await page.locator('.sequence').waitFor(); assert.ok(await page.locator('#answer').isDisabled());
    await shot(page, 'sequence-desktop'); await page.getByRole('button', { name: 'Hide sequence and answer' }).click();
    assert.ok(await page.locator('#answer').isEnabled()); await page.locator('#answer').fill(learner.session.items[3].answer);
    await nav(page, 0); await nav(page, 1); assert.equal(await page.locator('.sequence').count(), 0);
    await page.getByRole('button', { name: 'Check answer' }).click(); await page.getByRole('button', { name: 'Finish session' }).click();
    await page.locator('.session-end').waitFor(); assert.equal(learner.state().summary.count, 4); await shot(page, 'complete-desktop');
    await nav(page, 2); await shot(page, 'progress-desktop');
    await page.getByRole('button', { name: /Recent answers/ }).click(); await page.getByRole('button', { name: 'Adjust this result' }).first().click();
    await page.getByRole('button', { name: 'Dispute result' }).first().click(); assert.ok(learner.data.attempts.at(-1).disputed);
  });
  await record('Settings traps and restores focus; motion setting and cancelled deletion', async () => {
    const { page, learner, calls } = await fixture(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Your space' }); await dialog.waitFor(); await shot(page, 'settings-desktop');
    await page.getByLabel('Motion', { exact: true }).selectOption('gentle'); assert.equal(learner.state().settings.motion, 'gentle');
    for (let i = 0; i < 18; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => !!document.activeElement.closest('dialog'))); }
    await page.getByRole('button', { name: 'Your data', exact: true }).click(); await page.getByRole('button', { name: 'Delete learner data' }).click();
    assert.ok(calls.some(c => c.action === 'learn:delete')); assert.ok(learner.state().profile, 'Mocked native cancellation preserves data');
    await page.keyboard.press('Escape'); await page.waitForTimeout(250); assert.ok(!await dialog.isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Settings');
  });
  await record('Connection, welcome, model loading and reviewed AI draft', async () => {
    const { page, learner, calls } = await fixture(); await page.locator('.connection-trigger').click();
    await page.getByRole('button', { name: 'Continue with ChatGPT' }).click();
    const welcome = page.getByRole('dialog', { name: 'ChatGPT is connected', exact: true }); await welcome.waitFor();
    await welcome.getByRole('button', { name: 'Continue', exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Find available models' }).click(); await page.getByLabel('Model', { exact: true }).waitFor();
    await shot(page, 'connection-desktop'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.getByRole('button', { name: /A fresh question, with ChatGPT/ }).click(); await page.getByRole('button', { name: 'Prepare a question' }).click();
    await page.getByRole('button', { name: 'Keep for future sessions' }).click(); assert.equal(learner.state().draft, null);
    assert.ok(calls.some(c => c.action === 'learn:reviewDraft' && c.payload.accept));
  });
  await record('320 / 390 / 768 widths and reduced-motion surfaces', async () => {
    for (const width of [320, 390, 768]) {
      const { page } = await fixture({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
      await noOverflow(page); if (width === 390) await shot(page, 'today-mobile');
      await page.locator('.launch-spot').click(); await page.locator('#answer').fill('My answer is still here.'); await noOverflow(page);
      if (width === 390) await shot(page, 'practice-mobile');
      await nav(page, 2); await noOverflow(page);
      await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.waitForTimeout(50); await noOverflow(page);
      assert.ok(await page.evaluate(() => document.querySelector('dialog[open]').getBoundingClientRect().right <= window.innerWidth + 1));
    }
  });
  await record('Long profile content and enlarged page layout', async () => {
    const { page } = await fixture({ viewport: { width: 768, height: 900 } });
    await page.evaluate(() => window.onTheSpot.command('learn:profile', { name: 'A very long name that should wrap without breaking the instrument', interests: '', goal: 'An unusually long personal goal that still needs to remain readable and inside its own portion of the layout.', language: 'English' }));
    await page.waitForTimeout(1450); await noOverflow(page); await shot(page, 'long-content');
    // CSS zoom is a layout stress test, not a claim of native Electron zoom verification.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addStyleTag({ content: 'html { zoom: 2 }' });
    await page.waitForTimeout(300); await shot(page, 'enlarged-layout');
    assert.ok(await page.locator('.launch-spot').isVisible());
  });
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, browserErrors: errors, engine: 'Real Learning with memory-only SQLite; actual built React UI. Auth, AI and native OS prompts mocked.' }, null, 2));
  if (context) await context.close(); if (db) db.close(); await browser.close(); server.close();
}
assert.ok(results.every(r => r.passed), 'All UI checks must pass');
