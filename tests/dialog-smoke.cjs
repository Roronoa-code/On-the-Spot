const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spot-dialog-')), root = path.resolve(__dirname, '..');
  const app = await _electron.launch({ executablePath: process.env.OTS_EXECUTABLE || require('electron'), args: process.env.OTS_EXECUTABLE ? ['--headless-check','--disable-gpu'] : [root,'--headless-check','--disable-gpu'], env: {...process.env, OTS_CHECK_DATA: directory} });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('input[name=name]');
    const capture=async name=>{const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));fs.writeFileSync(path.join(root,'artifacts',name+'.png'),Buffer.from(png,'base64'));};
    for(const width of [1080,650,390]) {await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,860),width);await page.waitForTimeout(100);await capture('onboarding-'+width);}
    assert.ok(await page.evaluate(()=>CSS.supports('appearance','base-select')));
    await assert.rejects(page.evaluate(()=>window.onTheSpot.command('window:maximize',{unexpected:true})),/Invalid message/);
    await page.locator('input[name=name]').fill('Dialog check');
    await page.locator('form').evaluate(f=>f.requestSubmit()); await page.waitForSelector('.today-layout');
    await page.locator('.session-options select').first().focus();await page.keyboard.press('Space');await page.evaluate(()=>document.querySelector('.session-options select').showPicker());assert.ok(await page.locator('.session-options select').first().evaluate(e=>e.matches(':open')));await capture('session-picker-prime');await page.waitForTimeout(150);await capture('session-picker-390');await page.keyboard.press('Escape');
    await page.locator('.connection-disclosure').evaluate(e=>e.open=true);
    for(const width of [1080,650,390]) {await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,860),width);await page.locator('#connection-title').scrollIntoViewIfNeeded();await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await capture('connection-'+width);}
    for (const [action, accept] of [['voice:consent',false],['voice:consent',true],['learn:delete',false],['learn:delete',true]]) {
      const pendingWindow = app.waitForEvent('window');
      await page.evaluate(action=>{window.promptResult=null;window.onTheSpot.command(action).then(value=>window.promptResult=value);},action);
      const child = await pendingWindow; await child.waitForFunction(()=>document.body.classList.contains('ready'));
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
      assert.equal(await child.evaluate(()=>typeof window.require),'undefined');
      assert.ok(await child.evaluate(()=>document.body.scrollHeight<=innerHeight));
      const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/prompt.html")).webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
      fs.writeFileSync(path.join(root,'artifacts',action.replace(':','-')+'.png'),Buffer.from(png,'base64'));
      await child.locator('#cancel').focus();await child.keyboard.press('Shift+Tab');
      assert.equal(await child.locator('#confirm').evaluate(e=>e===document.activeElement),true);
      await child.locator(accept?'#confirm':'#cancel').evaluate(b=>b.click());
      await page.waitForFunction(()=>window.promptResult!==null);
      const state=await page.evaluate(()=>window.promptResult);
      if(action==='voice:consent')assert.equal(state.voice.consent,accept);
      else assert.equal(!!state.learning.profile,!accept);
    }
    console.log('Custom dialogs passed: hidden, isolated, keyboard focus, consent, cancellation and scoped deletion.');
  } finally {await app.close();fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});



