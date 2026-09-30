// Windows-only check of the actual trusted Electron prompts and Settings modal.
// Run after npm run build; no account sign-in or external service calls are performed.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spot-dialog-')), root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root,'artifacts'), { recursive: true });
  const app = await _electron.launch({ executablePath: process.env.OTS_EXECUTABLE || require('electron'), args: process.env.OTS_EXECUTABLE ? ['--headless-check','--disable-gpu'] : [root,'--headless-check','--disable-gpu'], env: {...process.env, OTS_CHECK_DATA: directory} });
  try {
    const page = await app.firstWindow();
    const profile = page.locator('.profile-form:visible');
    await profile.waitFor();
    await page.getByRole('heading',{name:'A little about you.',level:1,exact:true}).waitFor();
    const capture=async name=>{await page.evaluate(()=>document.fonts.ready);const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));fs.writeFileSync(path.join(root,'artifacts',name+'.png'),Buffer.from(png,'base64'));};
    for(const width of [1080,650,390]) {await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,860),width);await page.waitForTimeout(100);await capture('onboarding-'+width);}
    await assert.rejects(page.evaluate(()=>window.onTheSpot.command('window:maximize',{unexpected:true})),/Invalid message/);
    await profile.locator('input[name=name]').fill('Dialog check');
    await profile.evaluate(form=>form.requestSubmit());
    await page.locator('.today-layout:visible').waitFor();
    // Session size is now a radio group. Exercise topic remains a native select.
    const topic = page.getByRole('combobox',{name:'Start with',exact:true});
    const choice = await topic.locator('option').nth(1).getAttribute('value');
    assert.ok(choice, 'The topic chooser must offer an actual learning topic.');
    await topic.selectOption(choice);
    assert.equal(await topic.inputValue(),choice);
    await capture('session-topic-390');
    await topic.selectOption('');
    assert.equal(await topic.inputValue(),'');
    const settingsButton = page.getByRole('button',{name:'Settings',exact:true});
    await settingsButton.focus();
    await settingsButton.evaluate(button=>button.click());
    const settings = page.getByRole('dialog',{name:'Your setup.',exact:true});
    await settings.waitFor();
    assert.equal(await settings.evaluate(dialog=>dialog.open && dialog.matches(':modal')),true);
    await page.keyboard.press('Tab');
    assert.equal(await settings.evaluate(dialog=>dialog.contains(document.activeElement)),true);
    for(const width of [1080,650,390]) {
      await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setContentSize(width,860),width);
      await settings.locator('#connection-title').scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.ok(await settings.evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth));
      await capture('connection-'+width);
    }
    await page.keyboard.press('Escape');
    await settings.waitFor({state:'hidden'});
    assert.equal(await settingsButton.evaluate(button=>button===document.activeElement),true);
    for (const [action, accept] of [['voice:consent',false],['voice:consent',true],['learn:delete',false],['learn:delete',true]]) {
      const pendingWindow = app.waitForEvent('window');
      await page.evaluate(action=>{window.promptResult=null;window.onTheSpot.command(action).then(value=>window.promptResult=value);},action);
      const child = await pendingWindow; await child.waitForFunction(()=>document.body.classList.contains('ready'));
      await child.evaluate(()=>document.fonts.ready);
      assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())),false);
      assert.equal(await child.evaluate(()=>typeof window.require),'undefined');
      assert.ok(await child.evaluate(()=>document.body.scrollHeight<=innerHeight));
      assert.equal(await child.locator('#cancel').evaluate(button=>button===document.activeElement),true);
      const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("/prompt.html")).webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));
      fs.writeFileSync(path.join(root,'artifacts',`${action.replace(':','-')}-${accept?'accept':'cancel'}.png`),Buffer.from(png,'base64'));
      await child.locator('#cancel').focus();await child.keyboard.press('Shift+Tab');
      assert.equal(await child.locator('#confirm').evaluate(e=>e===document.activeElement),true);
      if(action==='voice:consent' && !accept) await child.keyboard.press('Escape');
      else await child.locator(accept?'#confirm':'#cancel').evaluate(b=>b.click());
      await page.waitForFunction(()=>window.promptResult!==null);
      const state=await page.evaluate(()=>window.promptResult);
      if(action==='voice:consent')assert.equal(state.voice.consent,accept);
      else assert.equal(!!state.learning.profile,!accept);
    }
    console.log('Native dialogs passed: responsive Settings modal, native topic selection, hidden trusted windows, isolated renderer, keyboard focus, consent, Escape, cancellation and scoped deletion.');
  } finally {await app.close();fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});


