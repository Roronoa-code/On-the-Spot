import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { LearningView } from './LearningView';
import { useAppState } from './app-state';
import { ConnectionPanel } from './ConnectionPanel';
import { Modal } from './Modal';
import { Icon, SpotMark } from './Icon';

const pages = ['Today', 'Practice', 'Progress'] as const;
type Page = typeof pages[number];
const pageIcons = { Today: 'today', Practice: 'practice', Progress: 'progress' } as const;
const headings = { Today: 'A place to practise', Practice: 'One thing at a time', Progress: 'Your learning, kept close' };

export function App() {
  const { state, loaded, connectionLost, pendingAction, notice, setNotice, command, refresh } = useAppState();
  const [tab, setTab] = useState<Page>('Today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [today, setToday] = useState(() => new Date());
  const [slow, setSlow] = useState(false);
  const nav = useRef<HTMLDivElement>(null), marker = useRef<HTMLSpanElement>(null);
  const scrollPositions = useRef<Record<Page, number>>({ Today: 0, Practice: 0, Progress: 0 });
  const currentTab = useRef<Page>(tab), paintedTab = useRef<Page>(tab), navigation = useRef(0), starting = useRef(false);
  const transition = useRef<ViewTransition | null>(null);
  const motion = state.learning?.settings.motion ?? 'liquid';
  const native = !!window.onTheSpot && !state.preview;
  const busy = !!pendingAction || !!state.busy;
  const practiceBusy = !!pendingAction;
  const session = state.learning?.session;
  const firstName = state.learning?.profile?.name.trim().split(/\s+/)[0];
  const aiEnabled = state.signedIn && state.planEnabled && !state.blocked && !state.preview;

  useEffect(() => { const timer = setInterval(() => setToday(new Date()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { setSlow(false); if (!busy) return; const timer = setTimeout(() => setSlow(true), 700); return () => clearTimeout(timer); }, [busy]);
  useLayoutEffect(() => {
    if (loaded && !state.learning?.profile && tab !== 'Today') {
      navigation.current++; transition.current?.skipTransition(); currentTab.current = 'Today';
      scrollPositions.current = { Today: 0, Practice: 0, Progress: 0 }; setTab('Today');
    }
  }, [loaded, state.learning?.profile, tab]);

  const navigate = useCallback((next: Page) => {
    if (next === currentTab.current || (next !== 'Today' && !state.learning?.profile)) return;
    scrollPositions.current[paintedTab.current] = window.scrollY;
    currentTab.current = next;
    const id = ++navigation.current;
    transition.current?.skipTransition();
    const update = () => { if (id === navigation.current) flushSync(() => setTab(next)); };
    if (typeof document.startViewTransition === 'function' && motion === 'liquid' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Only carry the instrument between the two places where it exists.
      // Notes change as a page; an old dial must not float over the new ledger.
      document.documentElement.dataset.transition = paintedTab.current !== 'Progress' && next !== 'Progress' ? 'spot' : 'page';
      const animation = document.startViewTransition(update);
      transition.current = animation;
      void animation.ready.catch(() => {});
      void animation.finished.then(() => { if (transition.current === animation) { transition.current = null; delete document.documentElement.dataset.transition; } });
    } else { delete document.documentElement.dataset.transition; update(); }
  }, [motion, state.learning?.profile]);

  useLayoutEffect(() => { paintedTab.current = tab; window.scrollTo({ top: scrollPositions.current[tab], behavior: 'instant' }); }, [tab]);

  // Move from the currently painted position, including a mid-flight interruption.
  useLayoutEffect(() => {
    const track = nav.current, highlight = marker.current;
    if (!track || !highlight) return;
    const move = (animate: boolean) => {
      const target = track.querySelector<HTMLButtonElement>('.selected');
      if (!target) return;
      const painted = getComputedStyle(highlight);
      const from = { transform: painted.transform, width: painted.width, height: painted.height, opacity: painted.opacity };
      const to = { transform: `translate(${target.offsetLeft}px, ${target.offsetTop}px)`, width: `${target.offsetWidth}px`, height: `${target.offsetHeight}px`, opacity: '1' };
      highlight.getAnimations().forEach(item => item.cancel());
      Object.assign(highlight.style, to);
      if (animate && from.opacity !== '0' && !matchMedia('(prefers-reduced-motion: reduce)').matches) highlight.animate([from, to], { duration: motion === 'liquid' ? 330 : 140, easing: 'cubic-bezier(.22,1,.36,1)' });
    };
    move(true);
    let size = `${track.clientWidth}:${track.clientHeight}`;
    const observer = new ResizeObserver(() => { const next = `${track.clientWidth}:${track.clientHeight}`; if (next !== size) { size = next; move(false); } });
    observer.observe(track);
    return () => observer.disconnect();
  }, [tab, motion]);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => { if (preference.matches) { transition.current?.skipTransition(); marker.current?.getAnimations().forEach(animation => animation.cancel()); } };
    preference.addEventListener('change', stop);
    return () => { preference.removeEventListener('change', stop); transition.current?.skipTransition(); };
  }, []);

  const start = useCallback((mode = 'short', conceptId = '') => {
    if (starting.current || practiceBusy) return;
    if (state.learning?.session) { navigate('Practice'); return; }
    starting.current = true;
    const initiatedAt = navigation.current;
    void command('learn:start', { mode, conceptId }).then(success => { if (success && navigation.current === initiatedAt) { scrollPositions.current.Practice = 0; navigate('Practice'); } }).finally(() => { starting.current = false; });
  }, [command, navigate, practiceBusy, state.learning?.session]);

  const pageHeading = (page: Page) => {
    if (!state.learning?.profile) return null;
    if (page === 'Practice') return <h1 className="sr-only" id="heading-Practice">Practice</h1>;
    return <div className="page-heading"><div><p className="eyebrow">{page === 'Today' ? 'YOUR DAILY PRACTICE' : 'YOUR FIELD NOTES'}</p><h1 id={`heading-${page}`}>{page === 'Today' ? (firstName ? <>Ready, <span className="name">{firstName}</span>?</> : 'Ready when you are.') : 'Keep what clicks.'}</h1><p className="intro">{page === 'Today' ? 'A few good questions. All the time you need.' : 'Ideas you have met. Answers you can return to.'}</p></div>{page === 'Today' && <div className="date-stamp" aria-label={today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}><span>{today.toLocaleDateString('en-GB', { weekday: 'short' })}</span><strong>{today.getDate().toString().padStart(2, '0')}</strong><span>{today.toLocaleDateString('en-GB', { month: 'short' })}</span></div>}</div>;
  };

  return <div className="app" data-motion={motion} data-native={native ? 'true' : 'false'}>
    <a className="skip-link" href="#current-view">Skip to practice space</a>
    <aside className="side-rail">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('Today'); }} aria-label="On the Spot home"><SpotMark/><span>on the<br/><strong>spot.</strong></span></a>
      <nav aria-label="Main"><p className="nav-caption">YOUR SPACE</p><div className="nav-track" ref={nav}><span className="nav-marker" ref={marker} aria-hidden="true"/>{pages.map((page, index) => <button key={page} disabled={page !== 'Today' && (!loaded || !state.learning?.profile)} className={tab === page ? 'selected' : ''} aria-current={tab === page ? 'page' : undefined} onClick={() => navigate(page)} onKeyDown={event => {
        const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
        if (!step && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const toIndex = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : (index + step + pages.length) % pages.length;
        navigate(pages[toIndex]); nav.current?.querySelectorAll<HTMLButtonElement>('button')[toIndex]?.focus();
      }}><Icon name={pageIcons[page]}/><span>{page}</span><small aria-hidden="true">{String(index + 1).padStart(2, '0')}</small></button>)}</div></nav>
      <div className="rail-bottom">{session && <button className="resume-shortcut" onClick={() => navigate('Practice')} aria-label={`Continue session, exercise ${session.index + 1} of ${session.count}`}><span className="resume-count">{String(session.index + 1).padStart(2, '0')}<small>/{session.count}</small></span><span>Your round<br/><small>Saved in progress</small></span></button>}<button className="settings-button" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}><Icon name="settings"/><span>Settings</span><span className={`connection-light ${aiEnabled ? 'connected' : ''}`}/></button><span className="rail-caption">LEARN. TRY. KEEP GOING.</span></div>
    </aside>
    <div className="workspace">
      <header className="titlebar"><span className="room-label"><span className="quiet-dot"/>{headings[tab]}</span><div className="titlebar-right">{state.preview ? <span className="preview-label">BROWSER PREVIEW</span> : <span className="local"><Icon name="local" size={13}/>On this PC</span>}{native && <div className="window-controls"><button aria-label="Minimize window" onClick={() => void command('window:minimize')}><Icon name="minus" size={15}/></button><button aria-label={state.maximized ? 'Restore window' : 'Maximize window'} onClick={() => void command('window:maximize')}><Icon name={state.maximized ? 'restore' : 'maximize'} size={14}/></button><button className="close-window" aria-label="Close window" onClick={() => void command('window:close')}><Icon name="close" size={17}/></button></div>}</div></header>
      <main id="current-view" tabIndex={-1} data-page={tab} aria-busy={!loaded && !!window.onTheSpot}>
        {notice && !settingsOpen && <div className="inline-notice" role="alert"><p>{notice}</p><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}
        {connectionLost && <div className="inline-notice" role="alert"><p>The local connection is unavailable. Your saved work is kept.</p><button className="text-button" onClick={() => void refresh()}>Try again</button></div>}
        {busy && slow && !settingsOpen && <div className="global-status" role="status"><span className="loading-dot" aria-hidden="true"/><span>{state.busy || (pendingAction.startsWith('learn:') ? 'Saving your progress' : 'Connecting')}</span>{(state.busy || ['learn:generate', 'learn:feedback', 'test', 'models', 'refresh', 'signIn'].includes(pendingAction)) && <button className="text-button" onClick={() => void command('cancel')}>Cancel</button>}</div>}
        {!window.onTheSpot ? <section className="unavailable"><SpotMark/><p className="eyebrow">YOUR DESKTOP PRACTICE SPACE</p><h1>Meet you on your PC.</h1><p>On the Spot uses the Windows app to keep your learning and speech on your computer.</p><p className="privacy">Run the desktop app, or use the project’s local browser preview to explore the interface.</p></section> : !loaded ? <section className="boot-state" role="status"><SpotMark/><p>{connectionLost ? 'Waiting for your local connection.' : 'Opening your practice space…'}</p></section> : <>{pages.map(page => <section key={page} className="app-page" data-view={page} hidden={tab !== page} aria-labelledby={state.learning?.profile ? `heading-${page}` : undefined}>{pageHeading(page)}<LearningView state={state.learning} command={command} view={page} busy={practiceBusy} start={start} aiEnabled={!!aiEnabled} preview={state.preview} active={tab === page && !settingsOpen && !state.welcome} onOpenSettings={() => setSettingsOpen(true)}/></section>)}</>}
      </main>
      <footer className="app-footer"><span><span className="quiet-dot"/>{state.preview ? 'Preview data lasts until the server stops' : 'Local by default'}</span><span>Nothing to race. Just practise.</span></footer>
    </div>
    <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Your setup." id="settings" motion={motion}><ConnectionPanel state={state} busy={busy} pendingAction={pendingAction} command={command} notice={notice} dismissNotice={() => setNotice('')}/></Modal>
    <Modal open={state.welcome} onClose={() => void command('welcome')} title="Your plan, connected." id="welcome" motion={motion} kind="dialog"><p className="dialog-copy">Eligible AI requests in On the Spot use your ChatGPT plan. Choose a weekly app cap in ChatGPT settings and keep credit spending off.</p><button className="primary" disabled={busy} onClick={() => void command('welcome')}>Got it<Icon name="check" size={17}/></button></Modal>
  </div>;
}
