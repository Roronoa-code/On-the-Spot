// Windows-only native check; requires the complete offline speech runtime.
// Run after npm run build, with PLAYWRIGHT_MODULE pointing to an available Playwright install.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'on-the-spot-check-'));
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  let electron = await _electron.launch({ executablePath: process.env.OTS_EXECUTABLE || require('electron'), args: process.env.OTS_EXECUTABLE ? ['--headless-check','--disable-gpu'] : [root, '--headless-check','--disable-gpu'], env: { ...process.env, OTS_CHECK_DATA: directory }, timeout: 30000 });
  try {
    const page = await electron.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.onTheSpot && document.querySelector('h1'));
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    const state = await page.evaluate(() => window.onTheSpot.state()); assert.equal(state.signedIn, false);
    assert.equal(state.voice.available,true);
    assert.equal(JSON.stringify(state).includes('hostId'), false);
    await assert.rejects(page.evaluate(()=>window.onTheSpot.command('voice:transcribe',{wav:new Uint8Array(48),language:'en'})),/microphone_not_allowed/);
    const protection = await electron.evaluate(({ safeStorage, BrowserWindow }) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { encrypted: safeStorage.isEncryptionAvailable(), sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration };
    });
    assert.deepEqual(protection, { encrypted: true, sandbox: true, contextIsolation: true, nodeIntegration: false });
    const encrypted = fs.readFileSync(path.join(directory, 'accounts.enc')); assert.equal(encrypted.includes(Buffer.from('hostId')), false);
    const profile = page.locator('.profile-form:visible');
    await profile.waitFor();
    await profile.locator('input[name="name"]').fill('Quiet test');
    await profile.locator('input[name="interests"]').fill('Words and planning');
    await profile.locator('input[name="goal"]').fill('Explain ideas clearly');
    await profile.evaluate(form => form.requestSubmit());
    await page.locator('.today-layout:visible').waitFor();
    await page.getByRole('button', {name: 'Start session', exact:true}).evaluate(button => button.click());
    await page.locator('#answer:visible').waitFor();
    for (let i=0;i<4;i++) {
      const state=await page.evaluate(() => window.onTheSpot.state());
      const item=state.learning.session.exercise;
      for(const width of [1080,650,390]) {
        await electron.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,860),width);
        await page.emulateMedia({reducedMotion:'reduce'}); await page.waitForTimeout(100);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        const image=await electron.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
        fs.writeFileSync(path.join(root,'artifacts',item.family+'-'+width+'.png'),Buffer.from(image,'base64'));
      }
      let answer;
      if(item.family==='learn') answer='A rough answer helps plan shopping.';
      if(item.family==='words') answer='umbrella';
      if(item.family==='reason') { const numbers=item.prompt.match(/£(\d+)/g).map(x=>Number(x.slice(1))); answer=String(numbers[0]-numbers[1]); }
      if(item.family==='attention') { answer=item.sequence.join(' '); await page.getByRole('button',{name:'Hide sequence and answer'}).evaluate(b=>b.click()); }
      await page.locator('#answer:visible').fill(answer);
      if(i===0)await page.emulateMedia({reducedMotion:'no-preference'});
      // Progress retains a hidden profile form; submit only the active answer form.
      await page.locator('form.answer-form:visible').evaluate(form=>form.requestSubmit());
      const result = page.locator('.result:visible');
      await result.waitFor();
      if(i===0){
        const feedback = result.locator('.feedback');
        await electron.evaluate(async({BrowserWindow})=>{await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});});
        await page.waitForTimeout(250);
        const partial=await feedback.locator('.bubble-letter.revealed').count();assert.ok(partial>0);
        assert.ok(partial<await feedback.locator('.bubble-letter').count());
        const soft=await electron.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
        assert.ok(await feedback.locator('.bubble-letter.revealed').first().evaluate(e=>Number(getComputedStyle(e).opacity)>0));
        fs.writeFileSync(path.join(root,'artifacts','feedback-soft-mid.png'),Buffer.from(soft,'base64'));
        await result.getByRole('button',{name:'Stop reveal',exact:true}).evaluate(b=>b.click());
        await feedback.locator('.reveal-stopped').waitFor();
        assert.equal(await feedback.locator('.reveal-stopped').textContent(),'Interrupted');
        const visibleLetters = node => [...node.querySelectorAll('.bubble-letter')].filter(letter=>Number(getComputedStyle(letter).opacity)>0).map(letter=>letter.textContent).join('');
        const stopped=await feedback.evaluate(visibleLetters);
        await page.waitForTimeout(150);
        assert.equal(await feedback.evaluate(visibleLetters),stopped, 'Stopping feedback must freeze the visible characters.');
        await result.getByRole('button',{name:'Show all',exact:true}).evaluate(b=>b.click());
        assert.equal(await feedback.locator(':scope > span[aria-hidden="true"]').textContent(),(await page.evaluate(()=>window.onTheSpot.state())).learning.session.result.feedback);
        await page.emulateMedia({reducedMotion:'reduce'});
      }
      await result.getByRole('button',{name:i===3?'Finish session':'Next exercise',exact:true}).evaluate(b=>b.click());
      await page.waitForFunction(async index => {
        const value = await window.onTheSpot.state();
        return index === 3 ? !value.learning.session && value.learning.summary?.count === 4 : value.learning.session?.index === index + 1 && !value.learning.session.result;
      }, i);
      if (i < 3) await page.locator('#answer:visible').waitFor();
    }
    await page.locator('.session-finish:visible').getByRole('heading',{name:'Round complete.',exact:true}).waitFor();
    assert.match(await page.locator('.session-finish:visible .finish-description').textContent(),/4 exercises completed/);
    const learnerState=await page.evaluate(() => window.onTheSpot.state());
    assert.equal(learnerState.learning.summary.correct,4);
    assert.equal(learnerState.learning.progress[0].learned,true);
    const {DatabaseSync}=require('node:sqlite');
    const learnerDB=new DatabaseSync(path.join(directory,'checkpoint.sqlite'));
    const protectedLearner=Buffer.from(learnerDB.prepare('SELECT protected FROM learner').get().protected); learnerDB.close();
    assert.equal(protectedLearner.includes(Buffer.from('Quiet test')),false);
    assert.equal(protectedLearner.includes(Buffer.from('rough answer')),false);
    // Freeze interface transitions for captures of a hidden compositor.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [1080, 650, 390]) {
      await electron.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 860), width);
      for (const tab of ['Today', 'Practice', 'Progress']) {
        await page.getByRole('navigation',{name:'Main'}).getByRole('button',{name:tab,exact:true}).evaluate(button => button.click());
        await page.waitForFunction(tab=>document.querySelector('main').dataset.page===tab,tab);
        await page.waitForTimeout(350);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${tab} overflows at ${width}`);
        const png = await electron.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
        fs.writeFileSync(path.join(root, 'artifacts', `${tab.toLowerCase()}-${width}.png`), Buffer.from(png, 'base64'));
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(100);
        const bottom = await electron.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
        fs.writeFileSync(path.join(root, 'artifacts', `${tab.toLowerCase()}-${width}-bottom.png`), Buffer.from(bottom, 'base64'));
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.deepEqual(errors, []);
    await electron.close();
    electron=await _electron.launch({executablePath:process.env.OTS_EXECUTABLE || require('electron'),args:process.env.OTS_EXECUTABLE ? ['--headless-check','--disable-gpu'] : [root,'--headless-check','--disable-gpu'],env:{...process.env,OTS_CHECK_DATA:directory},timeout:30000});
    const reopened=await electron.firstWindow();await reopened.waitForFunction(()=>window.onTheSpot);
    const saved=await reopened.evaluate(()=>window.onTheSpot.state());
    assert.equal(saved.learning.profile.name,'Quiet test');assert.equal(saved.learning.summary.count,4);assert.equal(saved.learning.progress[0].learned,true);
    console.log('Desktop smoke passed: hidden Electron runtime, protected storage, isolated IPC, complete encrypted offline session, 3 screens at 3 widths, reduced motion.');
  } finally { await electron.close(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
