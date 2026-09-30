import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { LearningView, type LearningState } from './LearningView';

type State = {
  maximized?: boolean;
  voice?: { available: boolean; consent: boolean; transcript: { text: string; processingMs: number } | null };
  learning?: LearningState;
  accounts: { clientId: string; email: string; signedIn: boolean }[]; active: string | null;
  signedIn: boolean; planEnabled: boolean; busy: string; message: string; blocked: string; welcome: boolean;
  models: { slug: string; name: string }[]; evidence: { event: string; at: string }[];
  selectedModel: string; reasoningEffort: string;
  lastError: { code: string; status: number; requestId: string } | null;
};
declare global { interface Window { onTheSpot?: { state(): Promise<State>; command(action: string, payload?: Record<string, unknown>): Promise<State> } } }
const bridge = window.onTheSpot;
const empty: State = { accounts: [], active: null, signedIn: false, planEnabled: false, busy: '', message: 'Open the desktop app to connect your ChatGPT plan. Offline practice is available here.', blocked: '', welcome: false, models: [], evidence: [], lastError: null, selectedModel: 'gpt-6-luna', reasoningEffort: 'max' };
const steps = [['registration', 'Account connected'], ['completed_response', 'Completed response'], ['refresh', 'Session renewed'], ['revocation', 'Session revoked'], ['usage_visible_user_confirmed', 'Usage seen in ChatGPT']] as const;

function App() {
  const [state, setState] = useState<State>(empty);
  const [tab, setTab] = useState('Today');
  const model = state.selectedModel;
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [slow, setSlow] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const nav = useRef<HTMLDivElement>(null), pill = useRef<HTMLSpanElement>(null);
  const motion = state.learning?.settings.motion ?? 'liquid';
  useLayoutEffect(() => {
    const move = (animate = true) => {
      const target = nav.current?.querySelector<HTMLButtonElement>('.selected'), highlight = pill.current;
      if (!target || !highlight) return;
      const style = getComputedStyle(highlight), left = parseFloat(style.left) || 4, width = parseFloat(style.width) || target.offsetWidth;
      const to = { left: `${target.offsetLeft}px`, width: `${target.offsetWidth}px` };
      highlight.getAnimations().forEach(a => a.cancel()); Object.assign(highlight.style, to, { opacity: '1' });
      if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const forward = target.offsetLeft > left, right = left + width, newRight = target.offsetLeft + target.offsetWidth;
      const midLeft = left + (target.offsetLeft - left) * (forward ? .32 : .82), midRight = right + (newRight - right) * (forward ? .82 : .32);
      highlight.animate(motion === 'liquid' ? [{left: `${left}px`,width: `${width}px`},{left: `${midLeft}px`,width: `${Math.max(1,midRight-midLeft)}px`,offset:.55},to] : [{left: `${left}px`,width: `${width}px`},to], {duration:motion === 'liquid' ? 400 : 180,easing:'cubic-bezier(.2,.8,.2,1)'});
    };
    move(); let observedWidth = nav.current?.clientWidth;
    const resize = new ResizeObserver(() => { if (observedWidth !== nav.current?.clientWidth) { observedWidth = nav.current?.clientWidth; move(false); } }); if (nav.current) resize.observe(nav.current);
    return () => resize.disconnect();
  }, [tab, motion]);
  const busy = requesting || !!state.busy;
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const refresh = async () => { try { const next = await bridge.state(); if (alive) setState(next); } catch { if (alive) setState(s => ({ ...s, message: 'Local app connection unavailable. Offline practice is available.' })); } };
    void refresh(); const timer = setInterval(refresh, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  useEffect(() => { if (state.welcome) dialog.current?.showModal(); else dialog.current?.close(); }, [state.welcome]);
  useEffect(() => { setSlow(false); if (!busy) return; const timer = setTimeout(() => setSlow(true), 2000); return () => clearTimeout(timer); }, [busy]);
  const command = async (action: string, payload = {}) => {
    if (!bridge) return;
    setRequesting(true); setNotice('');
    try { setState(await bridge.command(action, payload)); }
    catch { setNotice('This action could not finish. Your saved answers are kept. Please try again.'); }
    finally { setRequesting(false); }
  };
  const start = (mode = 'short', conceptId = '') => { setTab('Practice'); if (!state.learning?.session) void command('learn:start', { mode, conceptId }); };
  const completed = new Set(state.evidence.map(e => e.event));
  return <div className="app">
    <header><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('Today'); }} aria-label="On the Spot home"><span className="mark" aria-hidden="true">●</span> On the Spot</a><div className="titlebar-right"><span className="local"><span/> On this PC</span><div className="window-controls"><button aria-label="Minimize window" onClick={()=>void command('window:minimize')}><span aria-hidden="true">−</span></button><button aria-label={state.maximized?'Restore window':'Maximize window'} onClick={()=>void command('window:maximize')}><span aria-hidden="true">{state.maximized?'❐':'□'}</span></button><button className="close-window" aria-label="Close window" onClick={()=>void command('window:close')}><span aria-hidden="true">×</span></button></div></div></header>
    <nav aria-label="Main"><div className="nav-track" ref={nav}><span className="nav-pill" ref={pill} aria-hidden="true"/>{['Today', 'Practice', 'Progress'].map(name => <button key={name} className={tab === name ? 'selected' : ''} aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>{name}</button>)}</div></nav>
    <main data-page={tab}>
      {notice && <p className="feedback" role="alert">{notice}</p>}
      {tab !== 'Today' && (state.busy || state.lastError) && <div className="status" role="status">{slow && <span className="loading-dot" aria-hidden="true"/>}<span>{state.busy || state.message}</span>{state.busy && <button className="text-button" onClick={()=>void command('cancel')}>Cancel</button>}</div>}
      {tab === 'Today' && <>
        <div className="page-heading"><div><p className="eyebrow">TODAY</p><h1>{state.learning?.profile?.name ? `A fresh little start, ${state.learning.profile.name.split(' ')[0]}.` : 'Make a little room for learning.'}</h1><p className="intro">One idea. A few good questions. Your pace.</p></div><span className="today-date">{new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</span></div>
        <LearningView state={state.learning} command={command} view="Today" busy={busy} start={start} aiEnabled={state.signedIn && state.planEnabled && !state.blocked}/>
        <details className="connection-disclosure"><summary><span className="connection-summary-title"><span className="connection-dot"/>ChatGPT connection</span><span>{state.signedIn ? `${model.replace('gpt-','GPT ')} · ${state.reasoningEffort}` : 'Optional · connect your plan'}</span></summary><section className="connection" aria-labelledby="connection-title">
          <div className="section-top"><span className="eyebrow">YOUR CONNECTION</span><span className="connection-badge">{state.signedIn ? state.planEnabled ? 'Connected' : 'Permission needed' : 'Optional'}</span></div>
          <h2 id="connection-title">Bring your ChatGPT plan.</h2><p>Connect for personal explanations. Your existing plan covers eligible requests. Offline practice is always here.</p>
          {state.accounts.length > 0 && <label className="field">ChatGPT account<select disabled={busy} value={state.active ?? ''} onChange={e => void command('select', { clientId: e.target.value })}>{state.accounts.map((a, i) => <option key={a.clientId} value={a.clientId}>{a.email} · Connection {i + 1}{a.signedIn ? '' : ' · Signed out'}</option>)}</select></label>}
          <div className="connection-actions">
            {!state.signedIn && <button className="chatgpt" disabled={!bridge || busy} onClick={() => void command('signIn', { clientId: state.active })}><img src="./chatgpt.svg" alt="" width="20" height="20"/>Continue with ChatGPT <span aria-hidden="true">↗</span></button>}
            {state.signedIn && !state.planEnabled && <button className="chatgpt" disabled={busy} onClick={() => void command('signIn', { clientId: state.active, enablePlan: true })}><img src="./chatgpt.svg" alt="" width="20" height="20"/>Continue with ChatGPT</button>}
            {state.signedIn && state.planEnabled && <><button className="secondary" disabled={busy || !!state.blocked} onClick={() => void command('models')}>{state.models.length ? 'Reload models' : 'Find available models'}</button><button className="text-button" disabled={busy} onClick={() => void command('refresh')}>Renew session</button></>}
            {state.signedIn && <button className="text-button" disabled={busy} onClick={() => void command('signOut')}>Sign out</button>}
            {state.accounts.length > 0 && <button className="text-button" disabled={busy} onClick={() => void command('signIn', { clientId: null })}>Add account</button>}
          </div>
          <p className="privacy">Preferred model: {model} · Reasoning: {state.reasoningEffort}</p>
          {state.models.length > 0 && <div className="model-row"><label className="field">Using ChatGPT plan<select value={model} disabled={busy} onChange={e => void command('setModel', { model: e.target.value })}>{!state.models.some(m => m.slug === model) && <option value={model}>{model} · Not listed</option>}{state.models.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}</select></label><button className="secondary" disabled={busy || !!state.blocked} onClick={() => void command('test', { model })}>Test connection</button></div>}
          <div className="status" role="status" aria-live="polite">{slow && <span className="loading-dot" aria-hidden="true"/>}<span>{state.busy || state.message}</span>{state.busy && <button className="text-button" onClick={() => void command('cancel')}>Cancel</button>}</div>
          {state.lastError && <details className="diagnostics"><summary>Connection details</summary><p>{state.lastError.code}{state.lastError.status ? ` · HTTP ${state.lastError.status}` : ''}{state.lastError.requestId ? ` · Request ${state.lastError.requestId}` : ''}</p></details>}
          <div className="usage-row"><button className="text-button" disabled={!bridge} onClick={() => void command('usage')}>Manage usage <span aria-hidden="true">↗</span></button><span>Set a weekly app cap and keep credit spending off.</span></div>
          {state.blocked && <button className="text-button" disabled={busy} onClick={() => void command('resume')}>I’ve checked usage and permissions — resume requests</button>}
        </section></details><p className="privacy page-note">Your learning stays on this PC. Optional AI runs only when you ask.</p>
      </>}
      {tab === 'Practice' && <><div className="practice-heading"><span>Practice</span><span>No rush. Take your time.</span></div><LearningView state={state.learning} command={command} view="Practice" busy={busy} start={start} aiEnabled={state.signedIn && state.planEnabled && !state.blocked}/></>}
      {tab === 'Progress' && <>
        <div className="page-heading"><div><p className="eyebrow">PROGRESS</p><h1>Your practice, taking shape.</h1><p className="intro">What you have learned, and where to go next.</p></div></div><LearningView state={state.learning} command={command} view="Progress" busy={busy} start={start} aiEnabled={state.signedIn && state.planEnabled && !state.blocked}/><details className="connection-disclosure connection-history"><summary>Connection checks</summary><h2 className="connection-heading">Your connection history</h2>
        <ol className="checklist">{steps.map(([event, label]) => <li key={event}><span className={completed.has(event) ? 'check done' : 'check'} aria-hidden="true">{completed.has(event) ? '✓' : '—'}</span><div><strong>{label}</strong><span>{completed.has(event) ? `Verified ${new Date(state.evidence.find(e => e.event === event)!.at).toLocaleDateString('en-GB')}` : 'Not verified yet'}</span></div></li>)}</ol>
        <p className="privacy">Usage visibility needs your check in ChatGPT settings. Revocation is recorded only after a successful sign-out.</p><div className="connection-actions"><button className="secondary" disabled={!bridge} onClick={() => void command('usage')}>Open ChatGPT usage ↗</button><button className="text-button" disabled={!bridge || busy || !completed.has('completed_response')} onClick={() => void command('usageConfirmed')}>I can see On the Spot usage</button></div></details>
      </>}
    </main><footer><span>Small steps. Your pace.</span><span>Your learning · on this PC</span></footer>
    <dialog ref={dialog} onCancel={e => { e.preventDefault(); void command('welcome'); }}><h2>You’re using your ChatGPT plan</h2><p>Eligible AI requests in On the Spot use your ChatGPT plan. Manage this app’s weekly cap in ChatGPT settings and keep credit spending off.</p><button className="primary" onClick={() => void command('welcome')}>Got it</button></dialog>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
