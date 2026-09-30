import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './refinements.css';
import { LearningView, PracticeSettings, ProfileForm } from './LearningView';
import { ConnectionPanel } from './ConnectionPanel';
import { changeScene, Disclosure, Icon, Sheet } from './ui';
import { useDesktop } from './useDesktop';
import type { Page } from './types';

function App() {
  const desktop = useDesktop(), { state, command, busy, connected } = desktop;
  const [tab, setTab] = useState<Page>('Today'), [settings, setSettings] = useState(false), [settingsSection, setSettingsSection] = useState<'you' | 'connection'>('you');
  const [slow, setSlow] = useState(false), main = useRef<HTMLElement>(null);
  const scroll = useRef<Record<Page, number>>({ Today: 0, Practice: 0, Progress: 0 });
  const lastPage = useRef<Page>('Today'), destination = useRef<Page>('Today');
  useEffect(() => { document.documentElement.dataset.motion = state.learning?.settings.motion ?? 'liquid'; }, [state.learning?.settings.motion]);
  useEffect(() => { setSlow(false); if (!busy || desktop.pending === 'learn:prepare') return; const timer = setTimeout(() => setSlow(true), 450); return () => clearTimeout(timer); }, [busy, desktop.pending]);
  useEffect(() => {
    if (lastPage.current !== tab) { window.scrollTo({ top: scroll.current[tab], behavior: 'instant' }); main.current?.focus({ preventScroll: true }); lastPage.current = tab; }
  }, [tab]);
  const navigate = (next: Page) => {
    const previous = destination.current; if (next === previous) return;
    destination.current = next; scroll.current[tab] = window.scrollY;
    changeScene(previous, next, () => setTab(next));
  };
  const start = async (mode = 'short', conceptId = '') => {
    if (busy) return;
    if (state.learning?.session || await command('learn:start', { mode, conceptId })) { scroll.current.Practice = 0; navigate('Practice'); }
  };
  const openConnection = () => { setSettingsSection('connection'); setSettings(true); };
  const statusText = state.busy || ({ 'learn:generate': 'Preparing a question…', 'learn:feedback': 'Reading your answer…', 'learn:answer': 'Checking your answer…', 'learn:start': 'Getting your session ready…', 'learn:export': 'Choose where to save your export.', 'learn:delete': 'Waiting for your confirmation.' } as Record<string, string>)[desktop.pending] || 'Finishing up…';
  const statusContent = desktop.notice ? <div className="notice"><span>{desktop.notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={desktop.dismissNotice}><Icon name="close" size={16}/></button></div> : slow ? <div className="working"><span className="working-dot" aria-hidden="true"/><span>{statusText}</span>{(state.busy || ['signIn', 'learn:generate', 'learn:feedback', 'test'].includes(desktop.pending)) && <button className="text-button" onClick={() => void command('cancel')}>Cancel</button>}</div> : null;
  return <div className="app">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="titlebar"><button className="brand" aria-label="On the Spot home" onClick={() => navigate('Today')}><span className="brand-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i}/>)}</span><span>on the <strong>spot.</strong></span></button><div className="titlebar-right"><span className="local-label"><span className="status-dot"/>{connected ? 'LOCAL FIRST' : 'DESKTOP APP'}</span>{connected && <div className="window-controls"><button aria-label="Minimize window" onClick={() => void command('window:minimize')}><Icon name="minus" size={15}/></button><button aria-label={state.maximized ? 'Restore window' : 'Maximize window'} onClick={() => void command('window:maximize')}><Icon name="window" size={13}/></button><button className="close-window" aria-label="Close window" onClick={() => void command('window:close')}><Icon name="close" size={16}/></button></div>}</div></header>
    <div className="navigation-bar"><nav aria-label="Main">{(['Today', 'Practice', 'Progress'] as Page[]).map((name, i) => <button key={name} className={tab === name ? 'selected' : ''} aria-current={tab === name ? 'page' : undefined} onClick={() => navigate(name)}><span className="nav-index">0{i + 1}</span>{name}<span className="nav-dot" aria-hidden="true"/></button>)}</nav><div className="nav-tools"><button className={`connection-trigger ${state.signedIn && state.planEnabled ? 'is-connected' : ''}`} onClick={openConnection}><span className="status-dot"/><span>ChatGPT</span><span className="connection-trigger-state">{state.signedIn && state.planEnabled ? 'connected' : 'optional'}</span></button><button className="icon-button settings-trigger" aria-label="Settings" onClick={() => { setSettingsSection('you'); setSettings(true); }}><Icon name="settings"/></button></div></div>
    {!settings && !state.welcome && <div className="status-region" aria-live="polite" aria-atomic="true">{statusContent}</div>}
    <main ref={main} id="main" tabIndex={-1} data-page={tab}>
      {desktop.unavailable && <div className="connection-error" role="alert"><span>The local connection dropped. Your draft is kept here.</span><button className="text-button" onClick={() => void desktop.retry()}>Retry connection</button></div>}
      {desktop.loading && !state.learning ? <div className="startup" role="status"><span className="brand-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i}/>)}</span><p>Opening your practice space…</p></div> : state.learning ? <LearningView state={state.learning} command={command} view={tab} busy={busy || desktop.unavailable} start={(mode, topic) => void start(mode, topic)} aiEnabled={state.signedIn && state.planEnabled && !state.blocked} openConnection={openConnection} voiceAvailable={!!state.voice?.available}/> : <section className="browser-state"><span className="eyebrow">ON THE SPOT</span><h1>A little space<br/>to <em>think.</em></h1><p className="lede">{connected ? 'Your local learning record is not available yet.' : 'Your practice lives in the desktop app.'}</p><p className="muted">{connected ? 'Retry the connection to open your saved sessions.' : 'Open On the Spot on your PC to start a session, use local speech and keep your learning encrypted. This browser view does not save or simulate your learning.'}</p>{connected && <button className="secondary" onClick={() => void desktop.retry()}>Retry connection</button>}</section>}
    </main>
    <footer className="app-footer"><span><span className="small-spot"/>No rush. Just practice.</span><span>{connected ? 'ON THIS PC / YOUR SPACE' : 'ON THE SPOT / DESKTOP'}</span></footer>
    <Sheet open={settings} close={() => setSettings(false)} title="Your space">{settings && <div className="sheet-status" aria-live="polite" aria-atomic="true">{statusContent}</div>}<div className="sheet-tabs" role="group" aria-label="Settings section"><button aria-pressed={settingsSection === 'you'} className={settingsSection === 'you' ? 'selected' : ''} onClick={() => setSettingsSection('you')}>You & your practice</button><button aria-pressed={settingsSection === 'connection'} className={settingsSection === 'connection' ? 'selected' : ''} onClick={() => setSettingsSection('connection')}>ChatGPT</button></div>{settingsSection === 'connection' ? <ConnectionPanel state={state} command={command} busy={busy} connected={connected}/> : state.learning ? <><section className="settings-section"><span className="eyebrow">AT YOUR PACE</span><PracticeSettings state={state.learning} busy={busy} command={command}/></section><Disclosure title="Your profile"><ProfileForm key={state.learning.profile ? 'existing' : 'new'} profile={state.learning.profile} busy={busy} command={command}/></Disclosure><Disclosure title="Your data"><p className="muted">Your learning record is encrypted on this PC. Exported JSON is readable, so save it somewhere private.</p><div className="actions"><button className="secondary" disabled={busy} onClick={() => void command('learn:export')}>Export learner data</button><button className="text-button danger" disabled={busy} onClick={() => void command('learn:delete')}>Delete learner data</button></div><p className="micro">Deleting asks for confirmation. Your ChatGPT connection and exported files are kept.</p></Disclosure></> : <p className="muted">Open the desktop app to manage your practice settings.</p>}</Sheet>
    <Sheet open={state.welcome} close={() => void command('welcome')} title="ChatGPT is connected" kind="welcome-sheet"><p className="lede">Your plan. Your choice.</p><p className="muted">Eligible AI requests use your ChatGPT plan. Check this app’s weekly cap and keep credit spending off in ChatGPT settings.</p><button className="primary" onClick={() => void command('welcome')}>Continue<Icon name="check" size={17}/></button></Sheet>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
