// Optional focused renderer regression check. All microphone, speech and IPC access is mocked.
// No audio is captured, spoken, or sent to any service. This does not audition Windows speech.
// Run: node tests/voice-smoke.mjs
// Requires Playwright + Chromium; OTS_BROWSER_EXECUTABLE may point to an installed Chromium.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install Playwright to run the voice renderer check: npm install --no-save playwright');
  playwright = require(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
}
const { chromium } = playwright;
const working = await mkdtemp(resolve(tmpdir(), 'spot-voice-check-'));
const output = resolve(root, 'artifacts/voice');
await mkdir(output, { recursive: true });
const fixture = "import React, { useState } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { VoiceInput } from __VOICE_IMPORT__;\nfunction Fixture() {\n  const [answer, setAnswer] = useState('');\n  const [active, setActive] = useState(true);\n  const [prompt, setPrompt] = useState('How would you explain a useful estimate?');\n  const [disabled, setDisabled] = useState(false);\n  const [busy, setBusy] = useState(false);\n  (window as any).fixture = { setAnswer, setActive, setPrompt, setDisabled };\n  return <div style={{maxWidth:740,margin:'auto',padding:20}}>\n    <h1>Answer workspace</h1>\n    <div hidden={!active}>\n      <label htmlFor=\"answer\">Your answer</label>\n      <textarea id=\"answer\" value={answer} onChange={event => setAnswer(event.target.value)} rows={3} maxLength={4000}/>\n      <VoiceInput prompt={prompt} active={active} disabled={disabled} answer={answer} onBusyChange={setBusy} onTranscript={(text,onset,processing)=>{ (window as any).__voice.deliveries.push({text,onset,processing});setAnswer(text); }}/>\n      <button id=\"grade\" disabled={disabled||busy}>Check answer</button>\n    </div>\n  </div>;\n}\ncreateRoot(document.getElementById('root')!).render(<Fixture/>);\n".replace("__VOICE_IMPORT__", JSON.stringify(resolve(root, "src/VoiceInput.tsx")));
await writeFile(resolve(working, 'fixture.tsx'), fixture);
await build({ root, configFile:false, publicDir:false, logLevel:'error', define:{'process.env.NODE_ENV':'"production"'}, resolve:{alias:[
  {find:/^react$/,replacement:root+'/node_modules/react/index.js'},
  {find:/^react-dom\/client$/,replacement:root+'/node_modules/react-dom/client.js'},
  {find:/^react\/jsx-runtime$/,replacement:root+'/node_modules/react/jsx-runtime.js'}
]},build:{outDir:working+'/dist',emptyOutDir:true,lib:{entry:working+'/fixture.tsx',name:'VoiceFixture',formats:['iife'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}});
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>@font-face{font-family:Manrope;src:url(/fonts/manrope-latin-variable.woff2)}*{box-sizing:border-box}body{font-family:Manrope,sans-serif;background:#141716;color:#f0efdf;margin:0;font-size:14px}h1{font-size:25px;margin:0 0 30px}textarea{display:block;width:100%;margin:10px 0 12px;border:1px solid #343a34;border-radius:10px;padding:14px;background:#1c201e;color:#f0efdf;font:inherit}#grade{margin-top:24px;background:#ee967e;color:#141716;min-height:44px;border:0;border-radius:10px;padding:0 20px}button:disabled{opacity:.45}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server = createServer(async(req,res)=>{
 try{
   const pathname = new URL(req.url,'http://localhost').pathname;
   if(pathname==='/favicon.ico'){res.statusCode=204;res.end();return;}
   if(pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
   const location = ['/prompt.html','/prompt.js','/prompt.css'].includes(pathname)||pathname.startsWith('/fonts/') ? root+'/public'+pathname : working+'/dist'+pathname;
   res.setHeader('content-type',pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':pathname.endsWith('.html')?'text/html':pathname.endsWith('.woff2')?'font/woff2':'application/octet-stream');res.end(await readFile(location));
 }catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser = await chromium.launch({...(process.env.OTS_BROWSER_EXECUTABLE ? {executablePath:process.env.OTS_BROWSER_EXECUTABLE} : {}),headless:true,args:['--no-sandbox','--no-zygote','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[];
function pass(label){results.push(label);console.log('PASS '+label);}
function installVoiceMocks(){
  const test = window.__voice={calls:[],getMediaCalls:0,tracks:[],contexts:[],deliveries:[],transcriptionWaiters:[],consentWaiters:[],mediaWaiters:[],manualConsent:false,manualMedia:false,cancelCount:0,spoken:[],cancelSpeech:0,voiceCancel:0};
  test.track=()=>{const track=new EventTarget();track.stopped=false;track.stop=()=>{track.stopped=true;};test.tracks.push(track);return track;};
  test.stream=()=>{const track=test.track();return {getTracks:()=>[track]};};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{test.getMediaCalls++;if(test.manualMedia)return new Promise((resolve,reject)=>test.mediaWaiters.push({resolve:()=>resolve(test.stream()),reject}));return test.stream();}}});
  window.AudioContext=class {
    constructor(options){this.sampleRate=options.sampleRate;this.state='running';test.contexts.push(this);}
    createMediaStreamSource(){return this.source={connect(){},disconnect(){this.disconnected=true;}};}
    createScriptProcessor(){return this.processor={onaudioprocess:null,connect(){},disconnect(){this.disconnected=true;}};}
    resume(){this.state='running';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
  };
  test.audio=(n=1)=>{const context=test.contexts.at(-1);for(let i=0;i<n;i++){const input=new Float32Array(4096).fill(.1),output=new Float32Array(4096);context.processor.onaudioprocess?.({inputBuffer:{getChannelData:()=>input},outputBuffer:{getChannelData:()=>output}});}};
  window.onTheSpot={command:async(action,payload={})=>{
    test.calls.push({action,language:payload.language,wav:payload.wav});
    if(action==='voice:consent'){if(test.manualConsent)return new Promise(resolve=>test.consentWaiters.push(resolve));return {voice:{consent:true,available:true}};}
    if(action==='voice:transcribe')return new Promise((resolve,reject)=>test.transcriptionWaiters.push({resolve:text=>resolve({voice:{transcript:{text}}}),reject}));
    if(action==='voice:cancel'){test.voiceCancel++;return {};}
    return {};
  }};
  window.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
    getVoices:()=>[{name:'Remote English',lang:'en-GB',default:true,localService:false},{name:'Local English',lang:'en-GB',default:true,localService:true},{name:'Local Italian',lang:'it-IT',default:false,localService:true}],
    speak:utterance=>test.spoken.push(utterance),cancel:()=>test.cancelSpeech++
  }});
}
const page=await browser.newPage({viewport:{width:800,height:700}});
page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.addInitScript(installVoiceMocks);
const reload=async()=>{await page.goto(origin);await page.waitForSelector('.voice-record');};
const phase=async value=>page.waitForFunction(value=>document.querySelector('.voice-input').dataset.phase===value,value);
const start=async()=>{await page.getByRole('button',{name:'Speak answer',exact:true}).click();await phase('recording');await page.evaluate(()=>window.__voice.audio());};
const stop=async()=>{await page.getByRole('button',{name:'Stop and transcribe',exact:true}).click();await phase('processing');};
try {
 await reload();
 assert.equal(await page.evaluate(()=>window.__voice.getMediaCalls+window.__voice.spoken.length),0);
 await page.getByRole('button',{name:'Speech settings',exact:true}).click();
 assert.equal(await page.locator('.voice-language option').count(),10);
 await page.getByRole('button',{name:'Speech settings',exact:true}).click();
 assert.equal(await page.locator('.voice-settings-fold').getAttribute('inert'),'');
 pass('No automatic mic or audio; nine speech languages plus detection; collapsed settings are inert');
 await page.evaluate(()=>window.__voice.manualConsent=true);
 await page.getByRole('button',{name:'Speak answer',exact:true}).click();
 await page.waitForFunction(()=>window.__voice.consentWaiters.length===1);
 assert.equal(await page.locator('#grade').isDisabled(),true);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await phase('idle');
 await page.evaluate(()=>window.__voice.consentWaiters[0]({voice:{consent:true,available:true}}));
 await page.waitForTimeout(50);
 assert.equal(await page.evaluate(()=>window.__voice.getMediaCalls),0);
 assert.equal(await page.locator('#grade').isDisabled(),false);
 pass('Cancelling pending consent prevents late microphone start and releases grading lock');
 await page.evaluate(()=>{window.__voice.manualConsent=false;window.__voice.manualMedia=true;});
 await page.getByRole('button',{name:'Speak answer',exact:true}).click();
 await page.waitForFunction(()=>window.__voice.mediaWaiters.length===1);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Speak answer',exact:true}).click();
 await page.waitForFunction(()=>window.__voice.mediaWaiters.length===2);
 await page.evaluate(()=>window.__voice.mediaWaiters[0].resolve());
 await page.waitForFunction(()=>window.__voice.tracks[0]?.stopped);
 await phase('requesting');
 await page.evaluate(()=>window.__voice.mediaWaiters[1].resolve());
 await phase('recording');
 assert.equal(await page.evaluate(()=>window.__voice.tracks[1].stopped),false);
 pass('Late permission stream is stopped without clobbering the newer capture');
 await page.evaluate(()=>{window.__voice.audio();const b=document.querySelector('.voice-record');b.dispatchEvent(new MouseEvent('click',{bubbles:true}));b.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 await phase('processing');
 assert.equal(await page.evaluate(()=>window.__voice.calls.filter(c=>c.action==='voice:transcribe').length),1);
 assert.equal(await page.evaluate(()=>window.__voice.tracks.every(t=>t.stopped)),true);
 assert.equal(await page.evaluate(()=>{const v=new DataView(window.__voice.calls.find(c=>c.wav).wav.buffer);return v.getUint32(24,true);}),16000);
 await page.locator('#answer').fill('A draft typed while speech was processing.');
 await page.evaluate(()=>window.__voice.transcriptionWaiters[0].resolve('A spoken example.'));
 await page.getByText('Speech ready',{exact:true}).waitFor();
 assert.equal(await page.locator('#answer').inputValue(),'A draft typed while speech was processing.');
 await page.getByRole('button',{name:'Add to answer',exact:true}).click();
 assert.equal(await page.locator('#answer').inputValue(),'A draft typed while speech was processing.\nA spoken example.');
 pass('Only one transcription per capture; real 16 kHz WAV; typed changes preserved until explicit append');
 await page.evaluate(()=>window.__voice.manualMedia=false);
 await start();await stop();
 await page.evaluate(()=>window.__voice.transcriptionWaiters[1].resolve('Replacement spoken answer.'));
 await page.getByText('Speech ready',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Replace answer',exact:true}).click();
 assert.equal(await page.locator('#answer').inputValue(),'Replacement spoken answer.');
 pass('Existing typed answer requires explicit replacement');
 await start();
 await page.evaluate(()=>window.fixture.setActive(false));
 await page.waitForFunction(()=>document.querySelector('.voice-input').dataset.phase==='idle');
 assert.equal(await page.evaluate(()=>window.__voice.tracks.at(-1).stopped),true);
 await page.evaluate(()=>window.fixture.setActive(true));
 await page.waitForSelector('.voice-record');
 await phase('idle');
 pass('Hiding the retained Practice pane releases mic and does not restart it on return');
 await page.locator('#answer').fill('Keep this draft.');
 await start();await stop();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Speak answer',exact:true}).click();
 await phase('requesting');
 const mediaBefore=await page.evaluate(()=>window.__voice.getMediaCalls);
 await page.waitForTimeout(40);
 assert.equal(await page.evaluate(()=>window.__voice.getMediaCalls),mediaBefore);
 await page.evaluate(()=>window.__voice.transcriptionWaiters[2].resolve('Late stale speech.'));
 await phase('recording');
 assert.equal(await page.locator('#answer').inputValue(),'Keep this draft.');
 assert.equal(await page.locator('.voice-transcript').count(),0);
 await page.evaluate(()=>window.fixture.setPrompt('A new question.'));
 await phase('idle');
 assert.equal(await page.evaluate(()=>window.__voice.tracks.at(-1).stopped),true);
 pass('Cancellation ignores stale transcription and waits for process cleanup before a new capture');
 await page.getByRole('button',{name:'Read prompt aloud',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__voice.spoken.at(-1).voice.name),'Local English');
 await page.getByRole('button',{name:'Stop reading',exact:true}).click();
 await page.getByRole('button',{name:'Speech settings',exact:true}).click();
 await page.locator('.voice-language select').selectOption('it');
 await page.getByRole('button',{name:'Read prompt aloud',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__voice.spoken.at(-1).voice.name),'Local Italian');
 const cancelBefore=await page.evaluate(()=>window.__voice.cancelSpeech);
 await page.evaluate(()=>window.fixture.setActive(false));
 await page.waitForFunction(n=>window.__voice.cancelSpeech>n,cancelBefore);
 await page.evaluate(()=>window.fixture.setActive(true));
 await page.getByRole('button',{name:'Read prompt aloud',exact:true}).waitFor();
 pass('Read-aloud selects only local voices, stops on demand, and cancels on navigation');
 await start();
 await page.evaluate(()=>window.__voice.audio(240));
 await phase('processing');
 assert.equal(await page.evaluate(()=>window.__voice.calls.filter(c=>c.wav).at(-1).wav.byteLength),44+59*16000*2);
 await page.evaluate(()=>window.__voice.transcriptionWaiters[3].reject(new Error('recording_silent')));
 await phase('idle');
 await page.getByText('No speech was heard. Check your microphone and try again.',{exact:true}).waitFor();
 pass('59-second sample limit auto-transcribes once; silent input returns a useful retry state');
 await page.setViewportSize({width:390,height:750});
 await page.locator('.voice-input').evaluate(async element => { await Promise.allSettled(element.getAnimations({subtree:true}).map(animation => animation.finished)); });
 await page.screenshot({path:output+'/voice-390.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const sizes=await page.locator('.voice-control').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height>0).map(n=>n.getBoundingClientRect().height));
 assert.ok(sizes.every(h=>h>=44));
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.voice-fold').first().evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>document.body.dataset.motion='gentle');
 assert.equal(await page.locator('.voice-fold').first().evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
 pass('390px layout fits, voice controls retain 44px targets, and system/gentle motion settings are honoured');
 assert.deepEqual(errors,[]);
 const promptVariants=[{title:'Use your microphone?',message:'Speak an answer and turn it into editable text, on this PC.',detail:'The recording is discarded. Nothing is graded until you check the transcript. You can always type instead.',confirm:'Allow microphone'}, {title:'Delete your learning data?',message:'Your profile, sessions, answers and review dates will be removed.',detail:'This cannot be undone. Your ChatGPT connection and exported files are kept.',confirm:'Delete learner data'}];
 for(let i=0;i<promptVariants.length;i++){
   const modal=await browser.newPage({viewport:{width:480,height:350}});
   const modalErrors=[];modal.on('pageerror',e=>modalErrors.push(String(e)));modal.on('console',m=>{if(m.type()==='error')modalErrors.push(m.text());});
   await modal.addInitScript(value=>{window.replies=[];window.spotPrompt={content:callback=>queueMicrotask(()=>callback(value)),reply:value=>window.replies.push(value)};},promptVariants[i]);
   await modal.goto(origin+'/prompt.html');await modal.waitForSelector('body.ready');await modal.evaluate(()=>document.fonts.ready);
   assert.equal(await modal.evaluate(()=>document.activeElement.id),'cancel');
   assert.equal(await modal.evaluate(()=>document.body.scrollHeight<=innerHeight),true);
   assert.equal(await modal.evaluate(()=>document.getElementById('copy').scrollHeight<=document.getElementById('copy').clientHeight),true);
   await modal.keyboard.press('Shift+Tab');assert.equal(await modal.evaluate(()=>document.activeElement.id),'confirm');
   await modal.keyboard.press('Tab');assert.equal(await modal.evaluate(()=>document.activeElement.id),'cancel');
   await modal.screenshot({path:output+`/prompt-${i}.png`});
   await modal.keyboard.press('Escape');await modal.keyboard.press('Escape');
   assert.deepEqual(await modal.evaluate(()=>window.replies),[false]);
   assert.deepEqual(modalErrors,[]);
   await modal.close();
 }
 pass('Both 480×350 native-dialog pages fit with bundled typography, cancel autofocus, focus wrap, and one Escape cancellation');
 const small=await browser.newPage({viewport:{width:360,height:280}});
 await small.addInitScript(value=>{window.replies=[];window.spotPrompt={content:callback=>queueMicrotask(()=>callback(value)),reply:value=>window.replies.push(value)};},promptVariants[0]);
 await small.goto(origin+'/prompt.html');await small.waitForSelector('body.ready');
 await small.waitForFunction(()=>document.getElementById('copy').tabIndex===0);
 assert.equal(await small.evaluate(()=>document.body.scrollHeight<=innerHeight),true);
 await small.keyboard.press('Shift+Tab');assert.equal(await small.evaluate(()=>document.activeElement.id),'copy');
 await small.keyboard.press('PageDown');await small.waitForFunction(()=>document.getElementById('copy').scrollTop>0);
 await small.getByRole('button',{name:'Allow microphone',exact:true}).click();
 assert.deepEqual(await small.evaluate(()=>window.replies),[true]);
 await small.close();
 pass('Constrained dialog keeps actions visible and overflowing text keyboard-scrollable; confirmation still works');
 await writeFile(output+'/results.json',JSON.stringify({passed:results,errors},null,2));
 console.log('All '+results.length+' targeted checks passed.');
} catch(error) { console.error('Browser errors:',errors); await page.screenshot({path:output+'/failed.png',fullPage:true}); throw error; } finally { await browser.close();await new Promise(resolve=>server.close(resolve));await rm(working,{recursive:true,force:true}); }
