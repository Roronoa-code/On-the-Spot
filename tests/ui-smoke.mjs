// Starts an isolated Vite preview. Install Playwright and its Chromium browser first:
// npm install --no-save playwright && npx playwright install chromium
// OTS_PREVIEW_URL and OTS_BROWSER_EXECUTABLE optionally override the defaults.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install Playwright to run the UI smoke test: npm install --no-save playwright');
  playwright = require(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
}

const output = resolve('artifacts/ui');
await mkdir(output, { recursive: true });
const axeSource = process.env.OTS_AXE_SOURCE ? await readFile(process.env.OTS_AXE_SOURCE, 'utf8') : null;
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.OTS_BROWSER_EXECUTABLE ? { executablePath: process.env.OTS_BROWSER_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference', acceptDownloads: true });
// Observe actual browser transitions without changing their timing or outcome.
await context.addInitScript(() => {
  window.__spotTransitionStats = { active: 0, started: 0, interrupted: 0 };
  if (typeof document.startViewTransition !== 'function') return;
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (...args) => {
    const stats = window.__spotTransitionStats;
    if (stats.active) stats.interrupted++;
    stats.active++; stats.started++;
    const transition = start(...args);
    const finished = () => { stats.active--; };
    void transition.finished.then(finished, finished);
    return transition;
  };
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [];
const externalRequests = [];
const checks = [];
const accessibility = [];
const pendingCommands = new Set();
let previewServer;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => {
  if (request.url().includes('/__ots_preview/command')) pendingCommands.add(request);
  if (!/^(?:blob:)?http:\/\/(?:127\.0\.0\.1|localhost):/.test(request.url()) && !request.url().startsWith('data:')) externalRequests.push(request.url());
});
page.on('requestfinished', request => pendingCommands.delete(request));
page.on('requestfailed', request => pendingCommands.delete(request));
const readState = () => page.evaluate(() => window.onTheSpot.state());
async function waitState(predicate, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const state = await readState();
    if (predicate(state)) return state;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function settleUi() {
  const deadline = Date.now() + 8000;
  while (pendingCommands.size && Date.now() < deadline) await page.waitForTimeout(25);
  assert.equal(pendingCommands.size, 0, 'The bridge must finish commands before capturing a stable screen.');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !window.__spotTransitionStats?.active);
  await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.allSettled(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(() => !window.__spotTransitionStats?.active && !document.documentElement.dataset.transition);
}
async function capture(name) {
  await settleUi();
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  console.log(`Captured ${name}`);
  if (axeSource && ['01-onboarding-desktop', '02-today-desktop', '02-settings-desktop', '03-practice-desktop', '04-feedback-desktop', '07-progress-desktop', '10-active-practice-390'].includes(name)) {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(violation => ({ id: violation.id, impact: violation.impact, description: violation.description, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })));
    accessibility.push({ screen: name, violations });
  }
}
async function navigate(name) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
  await page.waitForFunction(name => [...document.querySelectorAll('nav[aria-label="Main"] button')].some(button => button.getAttribute('aria-current') === 'page' && button.textContent.trim().startsWith(name)), name);
}
async function noOverflow(label) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth, main: document.querySelector('main')?.scrollWidth }));
  assert.ok(overflow.body <= overflow.width + 1, `${label}: horizontal overflow ${JSON.stringify(overflow)}`);
}
async function openDisclosure(name) {
  const toggle = page.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`) });
  if (await toggle.count()) {
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  } else {
    const summary = page.locator('summary:visible').filter({ hasText: name }).first();
    if (!(await summary.evaluate(element => element.parentElement.open))) await summary.click();
  }
}

try {
  let previewUrl = process.env.OTS_PREVIEW_URL;
  if (!previewUrl) {
    const { createServer } = await import('vite');
    previewServer = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
    await previewServer.listen();
    previewUrl = `http://127.0.0.1:${previewServer.httpServer.address().port}`;
  }
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await page.locator('.profile-form:visible').waitFor();
  assert.equal((await readState()).preview, true, 'UI tests must use isolated preview storage.');
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await capture('01-onboarding-desktop');
  await page.locator('.profile-form:visible input[name="name"]').fill('Mani');
  await page.locator('.profile-form:visible input[name="interests"]').fill('Photography, languages and programming');
  await page.locator('.profile-form:visible input[name="goal"]').fill('Find the words when I need them');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await waitState(state => state.learning.profile?.name === 'Mani', 'saved profile');
  await page.getByRole('button', { name: /^Start session/ }).waitFor();
  await capture('02-today-desktop');
  await noOverflow('Desktop home');
  const size = page.getByRole('radiogroup', { name: 'Session size' });
  await size.getByRole('radio', { name: /^Quick/ }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await size.getByRole('radio', { name: /^Daily/ }).getAttribute('aria-checked'), 'true');
  await page.getByRole('img', { name: /^0 of 12 exercises complete/ }).waitFor();
  await capture('02-today-daily-desktop');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await size.getByRole('radio', { name: /^Quick/ }).getAttribute('aria-checked'), 'true');
  checks.push('Onboarding saves a real preview profile and shows the session control.');
  checks.push('Session-size radio keys update the four- and twelve-exercise dial.');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Your setup.' });
  await settings.waitFor();
  assert.equal(await settings.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).isDisabled(), true);
  await page.keyboard.press('Tab');
  assert.equal(await settings.evaluate(element => element.contains(document.activeElement)), true);
  await capture('02-settings-desktop');
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Settings', exact: true }).evaluate(element => element === document.activeElement), true);
  checks.push('Settings uses modal focus, Escape dismisses it and restores focus; native-only connection controls stay disabled in preview.');

  await page.getByRole('button', { name: /^Start session/ }).click();
  await page.locator('#answer:visible').waitFor();
  const draft = 'A rough answer helps plan shopping.';
  await page.locator('#answer:visible').fill(draft);
  await settleUi();
  assert.equal(await page.locator('.app').getAttribute('data-motion'), 'liquid');
  const beforeInterruptions = await page.evaluate(() => window.__spotTransitionStats.interrupted);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Practice', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.__spotTransitionStats.active > 0 && document.querySelector('main')?.dataset.page === 'Progress');
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await settleUi();
  assert.equal(await page.locator('main').getAttribute('data-page'), 'Practice');
  assert.equal(await page.locator('.app-page:visible').count(), 1);
  assert.ok(await page.evaluate(before => window.__spotTransitionStats.interrupted > before, beforeInterruptions), 'The test must interrupt an actual Fluid View Transition.');
  const markerError = await page.evaluate(() => {
    const marker = document.querySelector('.nav-marker').getBoundingClientRect();
    const selected = document.querySelector('.nav-track .selected').getBoundingClientRect();
    return Math.max(...['x', 'y', 'width', 'height'].map(key => Math.abs(marker[key] - selected[key])));
  });
  assert.ok(markerError < 1, `The interrupted navigation marker must finish at the selected page (${markerError}px).`);
  assert.equal(await page.locator('#answer:visible').inputValue(), draft);
  checks.push('Repeated keyboard navigation interrupts real Fluid View Transitions, retains the draft and settles one page with an aligned navigation marker.');
  await navigate('Today');
  await navigate('Progress');
  await navigate('Practice');
  assert.equal(await page.locator('#answer:visible').inputValue(), draft);
  await capture('03-practice-desktop');
  await page.getByRole('button', { name: 'Give a hint', exact: true }).click();
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  const firstResult = await waitState(state => state.learning.session?.result?.score === 1, 'first answer result');
  assert.equal(firstResult.learning.attempts.length, 1);
  await page.locator('.result:visible').waitFor();
  const stopReveal = page.getByRole('button', { name: 'Stop reveal', exact: true });
  if (await stopReveal.isVisible()) {
    await stopReveal.click();
    await page.getByRole('button', { name: 'Show all', exact: true }).click();
  }
  await capture('04-feedback-desktop');
  await page.locator('.result:visible').getByRole('button', { name: 'Dispute result', exact: true }).click();
  await waitState(state => state.learning.session?.result?.disputed, 'disputed result');
  await page.locator('.result:visible').getByRole('button', { name: 'My answer fits', exact: true }).click();
  await waitState(state => state.learning.session?.result?.score === 1, 'corrected result');
  checks.push('Drafts survive tab changes; real hints, grading, dispute and correction work.');

  await page.getByRole('button', { name: 'Next exercise', exact: true }).click();
  await waitState(state => state.learning.session?.index === 1, 'word round');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  const skipped = await waitState(state => state.learning.session?.result?.status === 'skipped', 'skipped answer');
  assert.equal(skipped.learning.session.result.score, null);
  await page.getByRole('button', { name: 'Next exercise', exact: true }).click();
  await waitState(state => state.learning.session?.index === 2, 'reasoning round');
  await page.locator('#answer:visible').fill('11');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await waitState(state => state.learning.session?.result?.score === 1, 'arithmetic answer');
  await page.getByRole('button', { name: 'Next exercise', exact: true }).click();
  const sequenceState = await waitState(state => state.learning.session?.index === 3, 'sequence round');
  assert.equal(await page.locator('#answer:visible').isDisabled(), true);
  await capture('05-sequence-desktop');
  await page.getByRole('button', { name: 'Hide sequence and answer', exact: true }).click();
  await navigate('Today');
  await navigate('Practice');
  assert.equal(await page.locator('#answer:visible').isEnabled(), true, 'The sequence remains hidden after a tab change.');
  await page.locator('#answer:visible').fill(sequenceState.learning.session.exercise.sequence.join(' '));
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await waitState(state => state.learning.session?.result?.score === 1, 'sequence answer');
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  const completed = await waitState(state => !state.learning.session && state.learning.summary, 'session completion');
  assert.deepEqual({ count: completed.learning.summary.count, checked: completed.learning.summary.checked, correct: completed.learning.summary.correct, skipped: completed.learning.summary.skipped }, { count: 4, checked: 3, correct: 3, skipped: 1 });
  await capture('06-session-complete');
  checks.push('All four exercise families complete; skips remain unscored and sequence recall is gated.');

  await navigate('Progress');
  await capture('07-progress-desktop');
  await openDisclosure('Practice preferences');
  await page.getByRole('combobox', { name: /^Maximum new concepts per session/ }).selectOption('3');
  await waitState(state => state.learning.settings.newItems === 3, 'learning preference');
  await capture('08-preferences-desktop');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('group', { name: 'Interface motion' }).getByRole('button', { name: /^Gentle/ }).click();
  await waitState(state => state.learning.settings.motion === 'gentle', 'motion preference');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Your setup.' }).waitFor({ state: 'hidden' });
  await navigate('Today');
  await page.reload({ waitUntil: 'networkidle' });
  const restored = await waitState(state => state.learning.profile?.name === 'Mani', 'preview reload');
  assert.equal(restored.learning.attempts.length, 4);
  assert.equal(restored.learning.settings.motion, 'gentle');
  assert.equal(restored.learning.settings.newItems, 3);
  checks.push('Completed history and preferences survive renderer reload in the preview.');

  for (const [width, height] of [[1080, 800], [390, 844], [360, 640]]) {
    await page.setViewportSize({ width, height });
    for (const tab of ['Today', 'Progress', 'Practice']) {
      await navigate(tab);
      await noOverflow(`${width}px ${tab}`);
      if (width === 390 || width === 1080 && tab === 'Today') await capture(`09-${tab.toLowerCase()}-${width}`);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const tab of ['Today', 'Practice', 'Progress', 'Today']) await navigate(tab);
  await noOverflow('Reduced motion');
  checks.push('Today, Practice and Progress render without page overflow at 1080, 390 and 360 pixels; rapid navigation and reduced motion remain usable.');

  // Delay a real local response to make the navigation race deterministic.
  // This changes neither the saved record nor the renderer's state management.
  await page.evaluate(() => {
    window.__originalSpotCommand = window.onTheSpot.command;
    window.onTheSpot.command = async (action, payload) => {
      const result = await window.__originalSpotCommand(action, payload);
      if (action === 'learn:start') await new Promise(resolve => setTimeout(resolve, 350));
      return result;
    };
  });
  await navigate('Today');
  await page.getByRole('button', { name: /^Start session/ }).click();
  await navigate('Progress');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('main').getAttribute('data-page'), 'Progress', 'A late start response must respect a later navigation choice.');
  await page.evaluate(() => { window.onTheSpot.command = window.__originalSpotCommand; delete window.__originalSpotCommand; });
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate('Practice');
  await page.locator('#answer:visible').waitFor();
  await noOverflow('Active practice at 390 pixels');
  await capture('10-active-practice-390');
  checks.push('A delayed real session start respects a newer navigation choice; the active exercise remains usable at 390 pixels.');

  await page.setViewportSize({ width: 1080, height: 800 });
  await navigate('Progress');
  await openDisclosure('Your data');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export learner data', exact: true }).click();
  const download = await downloadPromise;
  const exportData = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exportData.profile.name, 'Mani');
  assert.equal(exportData.attempts.length, 4);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete learner data', exact: true }).click();
  assert.equal((await readState()).learning.profile.name, 'Mani');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete learner data', exact: true }).click();
  await waitState(state => state.learning.profile === null, 'confirmed preview deletion');
  await page.locator('.profile-form:visible').waitFor();
  checks.push('JSON export contains the actual attempts; cancel preserves data and confirmed deletion resets only preview data.');

  assert.deepEqual(errors, [], 'No browser errors or CSP violations are allowed.');
  assert.deepEqual(externalRequests, [], 'Offline practice must not issue external requests.');
  assert.ok(accessibility.every(result => result.violations.length === 0), 'Accessibility violations are recorded in artifacts/ui/verification.json.');
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ passed: true, checks, browser: await browser.version(), testedAt: new Date().toISOString(), limitations: ['Browser verification uses the real learning engine with in-memory preview storage.', 'Windows encryption, native window controls, live ChatGPT authentication and microphone transcription require desktop verification.'], errors, externalRequests, accessibility }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, screenshots: output, accessibility }, null, 2));
} catch (error) {
  await capture('failure').catch(() => {});
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ passed: false, completedChecks: checks, error: String(error), errors, externalRequests, accessibility }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
  await previewServer?.close();
}
