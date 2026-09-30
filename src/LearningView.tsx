import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { VoiceInput } from './VoiceInput';
import './learning.css';

type Result = { id: string; score: number | null; feedback: string; status: string; reference: string; explanation: string; answer: string; disputed: boolean };
export type LearningState = {
  draft?: { id: string; sourceId: string; lesson: string; prompt: string } | null;
  profile: { name: string; interests: string; goal: string; language: string } | null;
  settings: { reviewsFirst: boolean; newItems: number; motion?: string }; dueCount: number;
  session: { id: string; mode: string; index: number; count: number; teaching: boolean; exercise: { id: string; family: string; level: number; prompt: string; lesson: string; hint: string; sequence?: string[]; source: string }; result: Result | null } | null;
  summary: { count: number; checked: number; correct: number; skipped: number; completedAt: string; conversation: string } | null;
  progress: { id: string; title: string; learned: boolean; due: string | null; reason: string }[];
  comparisons: { family: string; level: number; matchedTasks: number; recentCorrect: number; comparableKey: string | null; first: { answer: string; score: number; at: string } | null; latest: { answer: string; score: number; at: string } | null }[];
  attempts: { id: string; family: string; answer: string; score: number | null; explanation: string; disputed: boolean; at: string }[];
};
type Props = {
  state?: LearningState;
  command: (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
  view: string;
  busy: boolean;
  start: (mode?: string, conceptId?: string) => void;
  aiEnabled?: boolean;
  active?: boolean;
  preview?: boolean;
  onOpenSettings?: () => void;
};

const names: Record<string, string> = { learn: 'Learn & remember', words: 'Find words & speak', reason: 'Reason & plan', attention: 'Attention & working memory' };
const families = [['learn', 'Learn', 'Keep an idea'], ['words', 'Speak', 'Find the words'], ['reason', 'Reason', 'Work it out'], ['attention', 'Focus', 'Hold a sequence']];
const explanations = ['Never learned it', 'Knew it but could not recall it', 'Question unclear'];
const shapeNames: Record<string, string> = { circle: '○', square: '□', triangle: '△', diamond: '◇', star: '☆', rectangle: '▭' };

function Arrow({ down = false }: { down?: boolean }) {
  return <svg className="learning-arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={down ? 'm7 10 5 5 5-5' : 'M5 12h14m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function formatDate(value: string, time = false) {
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } as const : {}) });
}

function reviewDate(value: string | null) {
  if (!value) return 'Teach first';
  return new Date(value).getTime() <= Date.now() ? 'Ready to review' : `Review ${formatDate(value)}`;
}

/** Each segment represents one exercise, never a score or a timer. */
function SessionDial({ count, completed = 0, current, value, label, compact = false }: { count: number; completed?: number; current?: number; value: number | string; label: string; compact?: boolean }) {
  const point = (angle: number) => ({ x: 140 + 120 * Math.cos((angle - 90) * Math.PI / 180), y: 140 + 120 * Math.sin((angle - 90) * Math.PI / 180) });
  const gap = count > 4 ? 6 : 11;
  return <div className={`session-dial${compact ? ' session-dial-compact' : ''}`} role="img" aria-label={`${completed} of ${count} exercises complete${current !== undefined ? `, exercise ${current + 1} next` : ''}`}>
    <svg viewBox="0 0 280 280" fill="none" aria-hidden="true">{Array.from({ length: count }, (_, index) => {
      const from = point(index * 360 / count + gap / 2), to = point((index + 1) * 360 / count - gap / 2);
      return <path key={index} className="dial-segment" data-state={index < completed ? 'complete' : index === current ? 'current' : 'waiting'} d={`M${from.x} ${from.y} A120 120 0 0 1 ${to.x} ${to.y}`} strokeWidth={compact ? 10 : 8} strokeLinecap="round" />;
    })}</svg>
    <div className="dial-centre" aria-hidden="true"><span className="dial-number">{compact ? value : String(value).padStart(2, '0')}</span>{!compact && <span className="dial-label">{label}</span>}</div>
  </div>;
}

function Disclosure({ title, meta, children, defaultOpen = false, className = '' }: { title: string; meta?: string; children: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <section className={`learning-disclosure ${className}`} data-open={open}>
    <button type="button" className="disclosure-summary" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><span className="disclosure-title">{title}</span>{meta && <span className="disclosure-meta">{meta}</span>}<Arrow down /></button>
    <div className="disclosure-reveal" id={id} aria-hidden={!open} inert={!open}><div className="disclosure-content">{children}</div></div>
  </section>;
}

function SequenceExercise({ sequence, hidden, busy, onHide }: { sequence: string[]; hidden: boolean; busy: boolean; onHide: () => void }) {
  return <div className="sequence" data-hidden={hidden}>
    <div className="sequence-heading"><span className="eyebrow">{hidden ? 'SEQUENCE HIDDEN' : 'READ LEFT TO RIGHT'}</span><span>{sequence.length} items</span></div>
    <div className="sequence-visible" aria-hidden={hidden} inert={hidden}><div><ol className="sequence-items">{sequence.map((value, index) => <li key={`${index}:${value}`}><span className="sequence-symbol" data-colour={shapeNames[value] ? undefined : value} aria-hidden="true">{shapeNames[value] ?? ''}</span><span>{value}</span><small>{index + 1}</small></li>)}</ol><button type="button" className="secondary" disabled={busy || hidden} onClick={onHide}>Hide sequence and answer<Arrow /></button></div></div>
    <div className="sequence-recall" aria-hidden={!hidden} inert={!hidden}><div><p className="sequence-hidden-note"><span className="hidden-sequence-dots" aria-hidden="true">{sequence.map((_, index) => <i key={index} />)}</span>Recall the names in the same order.</p></div></div>
  </div>;
}

export function LearningView({ state, command, view, busy, start, aiEnabled, active = true, preview = false, onOpenSettings }: Props) {
  const [answer, setAnswer] = useState('');
  const [inputMode, setInputMode] = useState('typing');
  const [speechOnsetMs, setSpeechOnsetMs] = useState<number | null>(null);
  const [processingMs, setProcessingMs] = useState(0);
  const [explanation, setExplanation] = useState('');
  const [validation, setValidation] = useState('');
  const [help, setHelp] = useState<'teach' | 'hint'>('teach');
  const [helpOpen, setHelpOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [mode, setMode] = useState('short');
  const [topic, setTopic] = useState('');
  const [pending, setPending] = useState('');
  const [failedPreparation, setFailedPreparation] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const resultTitle = useRef<HTMLDivElement>(null);
  const summaryTitle = useRef<HTMLHeadingElement>(null);
  const teachTrigger = useRef<HTMLButtonElement>(null);
  const hintTrigger = useRef<HTMLButtonElement>(null);
  const actionLock = useRef(false);
  const prepared = useRef(new Set<string>());
  const focusedExercise = useRef('');
  const s = state?.session;
  const item = s?.exercise;
  const exerciseKey = s && item ? `${s.id}:${item.id}` : '';
  const currentKey = useRef(exerciseKey);
  const isActive = useRef(active);
  currentKey.current = exerciseKey;
  isActive.current = active;
  const locked = busy || !!pending;
  const context = { sessionId: s?.id, exerciseId: item?.id };

  const run = async (action: string, payload?: Record<string, unknown>) => {
    if (busy || actionLock.current) return false;
    actionLock.current = true; setPending(action);
    try { return await command(action, payload); }
    finally { actionLock.current = false; setPending(''); }
  };

  // Navigating away preserves the draft. Only a different exercise resets it.
  useLayoutEffect(() => {
    setAnswer(''); setExplanation(''); setValidation(''); setHidden(false);
    setInputMode('typing'); setSpeechOnsetMs(null); setProcessingMs(0); setVoiceBusy(false);
    setHelp('teach'); setHelpOpen(!!s?.teaching); setFailedPreparation('');
  }, [exerciseKey]);

  useEffect(() => {
    if (!active || view !== 'Practice' || !item || !s || item.sequence || s.result || busy || !exerciseKey || prepared.current.has(exerciseKey) || failedPreparation === exerciseKey) return;
    prepared.current.add(exerciseKey);
    void command('learn:prepare', { sessionId: s.id, exerciseId: item.id }).then(ok => {
      if (!ok) { prepared.current.delete(exerciseKey); if (currentKey.current === exerciseKey) setFailedPreparation(exerciseKey); }
    });
  }, [active, view, exerciseKey, busy, failedPreparation]);

  useEffect(() => {
    if (active && view === 'Practice' && item && focusedExercise.current !== exerciseKey) { focusedExercise.current = exerciseKey; title.current?.focus({ preventScroll: true }); }
  }, [active, view, exerciseKey]);

  useEffect(() => { if (s?.result) { setHelpOpen(false); setValidation(''); } }, [s?.result?.id]);
  useEffect(() => { if (s?.mode) setMode(s.mode); }, [s?.mode]);
  useEffect(() => { if (active && view === 'Practice' && s?.result) resultTitle.current?.focus({ preventScroll: true }); }, [s?.result?.id]);
  useEffect(() => { if (active && view === 'Practice' && !s && state?.summary) summaryTitle.current?.focus({ preventScroll: true }); }, [state?.summary?.completedAt]);

  if (!state) return <section className="learning-view learning-unavailable"><span className="small-spot" aria-hidden="true" /><h2>Your practice lives here.</h2><p>Open the desktop app to save sessions and reviews.</p></section>;

  if (!state.profile) {
    if (view !== 'Today') return null;
    return <section className="learning-view onboarding-view" data-motion={state.settings.motion ?? 'liquid'}><div className="onboarding-intro"><div className="identity-spot" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none"><circle cx="40" cy="28" r="10" stroke="currentColor" strokeWidth="2.4" /><path d="M21 60c0-12 8-19 19-19s19 7 19 19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg></div><span className="eyebrow">A QUICK INTRODUCTION</span><h1>A little about you.</h1><p>Add a name and a few interests. You can change these any time.</p></div><ProfileForm profile={state.profile} busy={locked} command={run} /></section>;
  }

  if (view === 'Today') {
    const currentMode = s?.mode ?? mode;
    const count = s?.count ?? (mode === 'short' ? 4 : 12);
    const completed = s ? s.index + (s.result ? 1 : 0) : 0;
    const reviews = state.progress.filter(idea => idea.learned && idea.due).sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime());
    return <section className="learning-view today-layout" data-motion={state.settings.motion ?? 'liquid'}>
      <div className="session-panel"><div className="session-dial-area"><div className="session-panel-top"><span className="eyebrow">{s ? 'YOUR SESSION IS SAVED' : 'YOUR NEXT SESSION'}</span><span className="session-index">{currentMode === 'short' ? 'QUICK' : 'DAILY'}</span></div><SessionDial count={count} completed={completed} current={completed < count ? completed : undefined} value={s ? completed : count} label={s ? `OF ${String(count).padStart(2, '0')} COMPLETE` : 'EXERCISES'} /><span className="dial-caption"><span className="pace-mark" aria-hidden="true" />Untimed. Room to think.</span></div>
        <div className="session-controls"><h2>{s ? 'Keep your place.' : currentMode === 'short' ? 'A quick round.' : 'The daily round.'}</h2><p className="session-description">{s ? s.result ? 'Your last answer is saved. Continue when you are ready.' : `Next up: ${names[s.exercise.family].toLowerCase()}.` : 'Ideas, words and everyday problems.'}</p>
          <div className="session-options"><fieldset className="session-size"><legend>Find your pace</legend><div className="size-switch" role="radiogroup" aria-label="Session size" onKeyDown={event => { if (locked || s || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const next = currentMode === 'short' ? 'daily' : 'short'; setMode(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus(); }}>{[['short', 'Quick', '4 exercises'], ['daily', 'Daily', '12 exercises']].map(([id, label, detail]) => <button key={id} type="button" role="radio" data-mode={id} aria-checked={currentMode === id} tabIndex={currentMode === id ? 0 : -1} disabled={locked || !!s} className={currentMode === id ? 'chosen' : ''} onClick={() => setMode(id)}><span>{label}</span><small>{detail}</small><i aria-hidden="true" /></button>)}</div></fieldset><label className="field">Start with<select value={topic} disabled={locked || !!s} onChange={event => setTopic(event.target.value)}><option value="">Choose for me</option>{state.progress.map(idea => <option key={idea.id} value={idea.id}>{idea.title}</option>)}</select></label></div>
          <button className="primary session-start" disabled={locked} onClick={() => start(mode, topic)}>{s ? 'Continue session' : 'Start session'}<Arrow /></button><p className="save-note">Saved after each answer. Hints whenever you need them.</p>
        </div><ol className="session-families" aria-label="Each round includes">{families.map(([id, name, description], index) => <li key={id}><span className="family-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{name}</strong><small>{description}</small></span></li>)}</ol>
      </div>
      <section className="review-panel" aria-labelledby="review-heading"><div className="review-ledger"><div className="section-label"><h2 id="review-heading">{state.dueCount ? 'Ready to revisit' : 'Your review queue'}</h2><span>{state.dueCount ? `${state.dueCount} ready` : reviews.length ? `${reviews.length} scheduled` : 'Nothing due'}</span></div>{reviews.length ? <ul className="review-rows">{reviews.slice(0, 3).map(idea => <li key={idea.id}><button type="button" disabled={locked || !!s} onClick={() => start('short', idea.id)}><span className="review-dot" aria-hidden="true" /><strong>{idea.title}</strong><span>{reviewDate(idea.due)}</span><Arrow /></button></li>)}</ul> : <div className="review-empty"><span className="empty-ring" aria-hidden="true" /><p>Your first learned idea will appear here.<small>Reviews follow what you actually practise.</small></p></div>}{s && reviews.length > 0 && <p className="privacy">Finish your current session to start a review.</p>}</div>{state.profile.goal && <div className="personal-goal"><span className="eyebrow">WORKING ON</span><p>{state.profile.goal}</p></div>}</section>
      <Disclosure title="Make a fresh question with AI" meta="Optional" className="ai-variation" defaultOpen={!!state.draft}><p className="privacy">Uses a reviewed passage and your interests, goal and language. Review the question before keeping it.</p><div className="ai-prepare-row"><button className="secondary" disabled={locked || !aiEnabled} onClick={() => void run('learn:generate', { conceptId: topic || 'estimate' })}>{pending === 'learn:generate' ? 'Preparing question…' : 'Prepare a question'}</button>{!aiEnabled && <button className="text-button" type="button" onClick={onOpenSettings}>Connect your ChatGPT plan<Arrow /></button>}</div>{state.draft && <aside className="draft-review"><span className="eyebrow">REVIEW THIS QUESTION</span><p>{state.draft.lesson}</p><h3>{state.draft.prompt}</h3><div className="learning-actions"><button className="secondary" disabled={locked} onClick={() => void run('learn:reviewDraft', { draftId: state.draft!.id, accept: true })}>Keep for future sessions</button><button className="text-button" disabled={locked} onClick={() => void run('learn:reviewDraft', { draftId: state.draft!.id, accept: false })}>Discard</button></div></aside>}</Disclosure>
    </section>;
  }

  if (view === 'Progress') {
    const learned = state.progress.filter(idea => idea.learned).length;
    return <section className="learning-view progress-view" data-motion={state.settings.motion ?? 'liquid'}><div className="ledger-heading"><span className="eyebrow">YOUR IDEAS</span><p><strong>{String(learned).padStart(2, '0')}</strong><span> / {String(state.progress.length).padStart(2, '0')} learned</span></p></div>
      <ol className="idea-ledger">{state.progress.map((idea, index) => <li key={idea.id} data-learned={idea.learned}><span className="idea-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><Disclosure title={idea.title} meta={idea.learned ? reviewDate(idea.due) : 'Teach first'} className="idea-disclosure"><p className="idea-reason">{idea.reason}</p>{idea.learned && idea.due && <p className="privacy">Next review: {formatDate(idea.due, true)}</p>}<button className="secondary" disabled={locked} onClick={() => start('short', idea.id)}>{s ? 'Continue current session' : idea.learned ? 'Practise this idea' : 'Learn this idea'}<Arrow /></button></Disclosure></li>)}</ol>
      <div className="progress-sections"><Disclosure title="Matched examples" meta="Same task, same level"><p className="privacy comparison-note">Compare like with like. These results describe the tasks you tried; they do not measure general intelligence or health.</p>{state.comparisons.map(comparison => <div className="comparison-row" key={comparison.family}><div className="comparison-heading"><h3>{names[comparison.family]}</h3><span>Current level {comparison.level + 1}</span></div><p className="privacy">{comparison.matchedTasks ? `${comparison.recentCorrect} correct in the last ${Math.min(comparison.matchedTasks, 5)} matched tasks.` : 'Complete a few exercises to see comparable results here.'}</p>{comparison.first && comparison.latest && <div className={`matched-pair${comparison.matchedTasks < 2 ? ' single' : ''}`}><div><span className="eyebrow">FIRST · {formatDate(comparison.first.at)}</span><p>{comparison.first.answer}</p><span className="task-score">{Math.round(comparison.first.score * 100)}% on this task</span></div>{comparison.matchedTasks > 1 && <div><span className="eyebrow">LATEST · {formatDate(comparison.latest.at)}</span><p>{comparison.latest.answer}</p><span className="task-score">{Math.round(comparison.latest.score * 100)}% on this task</span></div>}</div>}</div>)}</Disclosure>
        <Disclosure title="Recent answers" meta={`${state.attempts.length} saved`}><p className="privacy">Your most recent 20 answers. You can explain or correct a result.</p>{state.attempts.length ? state.attempts.slice().reverse().map(attempt => <div className="attempt-row" key={attempt.id}><div className="attempt-heading"><strong>{names[attempt.family]}</strong><span>{formatDate(attempt.at, true)}</span></div><p className="attempt-answer">{attempt.answer || 'Skipped without an answer.'}</p><div className="attempt-status"><span className="result-dot" data-success={!attempt.disputed && attempt.score === 1} aria-hidden="true" />{attempt.disputed ? 'Disputed · unscored' : attempt.score === null ? 'Unscored' : `${Math.round(attempt.score * 100)}% on this task`}{attempt.explanation && <span> · {attempt.explanation}</span>}</div><div className="learning-actions"><button className="text-button" disabled={locked || attempt.disputed} onClick={() => void run('learn:correct', { attemptId: attempt.id, score: null })}>Dispute result</button><button className="text-button" disabled={locked} onClick={() => void run('learn:correct', { attemptId: attempt.id, score: 1 })}>Correct to successful</button></div><label className="field">Your explanation<select value={attempt.explanation} disabled={locked} onChange={event => void run('learn:correct', { attemptId: attempt.id, score: attempt.score, explanation: event.target.value })}><option value="">No explanation selected</option>{explanations.map(value => <option key={value}>{value}</option>)}</select></label></div>) : <p className="empty-detail">Your answers will appear after your first exercise.</p>}</Disclosure>
        <Disclosure title="Your profile" meta={state.profile.name || 'Interests & language'}><ProfileForm profile={state.profile} busy={locked} command={run} /></Disclosure>
        <Disclosure title="Practice preferences" meta="Review rules"><div className="preference-grid"><label className="field">Maximum new concepts per session<select value={state.settings.newItems} disabled={locked} onChange={event => void run('learn:settings', { ...state.settings, newItems: Number(event.target.value) })}>{[1, 2, 3, 4].map(number => <option key={number} value={number}>{number}</option>)}</select></label></div><label className="check-field"><input type="checkbox" className="inline-check" checked={state.settings.reviewsFirst} disabled={locked} onChange={event => void run('learn:settings', { ...state.settings, reviewsFirst: event.target.checked })} /><span><strong>Due reviews first</strong><small>Revisit a familiar idea before learning something new.</small></span></label><p className="privacy">Unknown material is taught first. Missing or unclear answers do not count as forgetting. Three unaided successes increase reasoning or attention difficulty; repeated errors lower it.</p></Disclosure>
        <Disclosure title="Your data" meta={preview ? 'Temporary preview' : 'Stored on this PC'}><p className="privacy">{preview ? 'This browser preview uses temporary practice data, cleared when the preview server stops.' : 'Records are encrypted on this PC. Exports are readable JSON; keep them somewhere private.'}</p><div className="learning-actions"><button className="secondary" disabled={locked} onClick={() => void run('learn:export')}>Export learner data</button><button className="text-button danger-action" disabled={locked} onClick={() => void run('learn:delete')}>Delete learner data</button></div></Disclosure>
      </div>
    </section>;
  }

  if (!s || !item) {
    const summary = state.summary, count = summary?.count ?? (mode === 'short' ? 4 : 12);
    return <section className="learning-view session-finish" data-motion={state.settings.motion ?? 'liquid'}><div className="finish-main"><SessionDial count={count} completed={summary ? count : 0} current={summary ? undefined : 0} value={count} label={summary ? 'EXERCISES COMPLETE' : 'EXERCISES'} /><div className="finish-copy"><span className="eyebrow">{summary ? `SESSION SAVED · ${formatDate(summary.completedAt)}` : 'READY WHEN YOU ARE'}</span><h2 ref={summaryTitle} tabIndex={-1}>{summary ? 'Round complete.' : 'Give yourself a little practice.'}</h2><p className="finish-description">{summary ? `${summary.count} exercises completed. Pick it up again whenever you like.` : 'Learn an idea, find a word, solve a problem and try a sequence.'}</p>{summary && <dl className="session-totals"><div><dt>Successful</dt><dd>{summary.correct}<span> / {summary.checked} checked</span></dd></div><div><dt>Skipped</dt><dd>{summary.skipped}</dd></div></dl>}<button className="primary" disabled={locked} onClick={() => start(mode, topic)}>{summary ? 'Start another round' : 'Start session'}<Arrow /></button></div></div>{summary?.conversation && <Disclosure title="Take it into conversation" meta="If you feel like it" className="conversation-prompt"><p>{summary.conversation}</p></Disclosure>}</section>;
  }

  const answerLocked = locked || voiceBusy || !!item.sequence && !hidden || failedPreparation === exerciseKey;
  const toggleHelp = async (kind: 'teach' | 'hint') => {
    if (help === kind && helpOpen) { setHelpOpen(false); return; }
    if (await run('learn:support', { ...context, kind })) { setHelp(kind); setHelpOpen(true); }
  };
  const checkAnswer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (answerLocked || s.result) return;
    if (!answer.trim()) { setValidation('Add an answer when you are ready, or choose Skip.'); input.current?.focus(); return; }
    setValidation('');
    await run('learn:answer', { ...context, answer, explanation, inputMode, speechOnsetMs, processingMs });
  };
  const resultLabel = s.result ? s.result.status === 'ai_provisional' ? 'AI feedback · unscored' : s.result.disputed ? 'Result disputed' : s.result.status === 'skipped' ? 'Skipped' : s.result.status === 'provisional' ? 'Provisional check' : s.result.status === 'self_review' ? 'Your own review' : s.result.status === 'corrected' ? 'Correction saved' : s.result.score === null ? 'Unscored' : s.result.score === 1 ? 'That fits.' : 'Let’s look again.' : '';
  return <section className="learning-view exercise practice-view" data-motion={state.settings.motion ?? 'liquid'} aria-labelledby="exercise-title">
    <div className="practice-stage-track"><SessionDial count={s.count} completed={s.index + (s.result ? 1 : 0)} current={s.result ? undefined : s.index} value={s.index + 1} label="" compact /><div className="stage-track-copy"><span className="eyebrow">{names[item.family]}</span><p>Exercise {String(s.index + 1).padStart(2, '0')}<span> / {String(s.count).padStart(2, '0')}</span></p></div><span className="stage-pace"><span className="pace-mark" aria-hidden="true" />Untimed</span></div>
    <div className="practice-workframe" key={exerciseKey}><h2 id="exercise-title" ref={title} tabIndex={-1}>{item.prompt}</h2><div className="prompt-support support-actions"><button ref={teachTrigger} type="button" className="help-button" aria-pressed={helpOpen && help === 'teach'} disabled={locked} onClick={() => void toggleHelp('teach')}><span aria-hidden="true">Aa</span>Teach me</button><button ref={hintTrigger} type="button" className="help-button" aria-pressed={helpOpen && help === 'hint'} disabled={locked} onClick={() => void toggleHelp('hint')}><span aria-hidden="true">?</span>Give a hint</button>{helpOpen && <button type="button" className="hide-help" onClick={() => { setHelpOpen(false); (help === 'teach' ? teachTrigger : hintTrigger).current?.focus({ preventScroll: true }); }} aria-label="Hide help"><Arrow down /></button>}</div><div className="help-reveal" data-open={helpOpen} aria-hidden={!helpOpen} inert={!helpOpen}><div><aside className="lesson"><strong>{help === 'teach' ? s.teaching ? 'First, let’s learn it.' : 'The explanation' : 'A hint'}</strong><p>{help === 'teach' ? item.lesson : item.hint}</p></aside></div></div>
      {item.sequence && !s.result && <SequenceExercise sequence={item.sequence} hidden={hidden} busy={locked || voiceBusy} onHide={() => { void (async () => { const okay = await run('learn:prepare', context); if (okay && currentKey.current === exerciseKey) { setHidden(true); prepared.current.add(exerciseKey); if (isActive.current) requestAnimationFrame(() => input.current?.focus()); } })(); }} />}
      {!s.result ? <form className="answer-form" onSubmit={checkAnswer}><div className="answer-workspace"><div className="answer-label"><label className="field" htmlFor="answer">Your answer</label>{answer.length > 3600 && <span>{answer.length} / 4000</span>}</div><textarea ref={input} id="answer" value={answer} onChange={event => { setAnswer(event.target.value); if (validation) setValidation(''); }} maxLength={4000} disabled={locked || !!item.sequence && !hidden || failedPreparation === exerciseKey} rows={3} placeholder={item.sequence && !hidden ? 'Hide the sequence when you are ready.' : 'Type your answer…'} aria-invalid={!!validation} aria-describedby={validation ? 'answer-validation' : undefined} /><VoiceInput key={exerciseKey} prompt={item.prompt} active={active} answer={answer} disabled={locked || !!item.sequence && !hidden || failedPreparation === exerciseKey} onBusyChange={setVoiceBusy} onTranscript={(text, onset, delay) => { setProcessingMs(value => value + delay); setAnswer(text.slice(0, 4000)); setInputMode('speech'); setSpeechOnsetMs(onset); setValidation(''); if (isActive.current) input.current?.focus(); }} /></div>
        {validation && <p className="answer-validation" id="answer-validation" role="status">{validation}</p>}{failedPreparation === exerciseKey && <p className="answer-validation" role="status">Couldn’t ready this exercise. <button type="button" className="text-button" disabled={locked} onClick={async () => { if (await run('learn:prepare', context)) { prepared.current.add(exerciseKey); setFailedPreparation(''); } }}>Try again</button></p>}
        <Disclosure title="How did that feel?" meta={explanation || 'Optional'} className="answer-reflection"><label className="field">Your explanation<select value={explanation} disabled={locked || voiceBusy} onChange={event => setExplanation(event.target.value)}><option value="">Choose if it helps</option>{explanations.map(value => <option key={value}>{value}</option>)}</select></label></Disclosure><div className="answer-actions"><button className="primary" disabled={answerLocked} type="submit">{pending === 'learn:answer' ? 'Checking answer…' : 'Check answer'}<Arrow /></button><button type="button" className="text-button skip-action" disabled={locked || voiceBusy} onClick={() => void run('learn:answer', { ...context, answer: '', explanation, skip: true })}>Skip</button></div>
      </form> : <div className="result" key={s.result.id}><div className="result-heading" ref={resultTitle} tabIndex={-1}><span className="result-dot" data-success={!s.result.disputed && s.result.score === 1} aria-hidden="true" /><span>{resultLabel}</span><span className="result-saved">Saved</span></div>{s.result.answer && <div className="submitted-answer"><span className="eyebrow">YOUR ANSWER</span><p>{s.result.answer}</p></div>}<SoftReply key={`${s.result.id}:${s.result.feedback}`} text={s.result.feedback} gentle={state.settings.motion === 'gentle'} active={active} /><Disclosure title="Reference answer" className="result-reference"><p>{s.result.reference}</p></Disclosure><div className="result-actions"><button className="primary" disabled={locked} onClick={() => void run('learn:next', context)}>{s.index + 1 === s.count ? 'Finish session' : 'Next exercise'}<Arrow /></button><div className="result-corrections"><button className="text-button" disabled={locked || s.result.disputed} onClick={() => void run('learn:correct', { attemptId: s.result!.id, score: null })}>Dispute result</button><button className="text-button" disabled={locked} onClick={() => void run('learn:correct', { attemptId: s.result!.id, score: 1 })}>My answer fits</button></div></div>{['learn', 'words'].includes(item.family) && <Disclosure title="Get a second look with AI" meta="Optional" className="feedback-ai"><p className="privacy">Sends this prompt, reference and answer to OpenAI. Feedback stays unscored until you correct or confirm it.</p><div className="learning-actions"><button className="secondary" disabled={locked || !aiEnabled || !s.result.answer.trim()} onClick={() => void run('learn:feedback', { attemptId: s.result!.id })}>Ask AI for provisional feedback</button>{!aiEnabled && <button className="text-button" onClick={onOpenSettings}>Connect ChatGPT<Arrow /></button>}</div></Disclosure>}</div>}
      <p className="exercise-source"><span className="source-mark" aria-hidden="true" />{item.source.endsWith('.') ? item.source : `${item.source}.`}</p>
    </div>
  </section>;
}

function ProfileForm({ profile, busy, command }: { profile: LearningState['profile']; busy: boolean; command: Props['command'] }) {
  const saving = useRef(false);
  const [message, setMessage] = useState('');
  return <form className="profile-form" onSubmit={async event => { event.preventDefault(); if (busy || saving.current) return; saving.current = true; const form = new FormData(event.currentTarget); try { if (await command('learn:profile', Object.fromEntries(['name', 'interests', 'goal', 'language'].map(key => [key, String(form.get(key) ?? '')])))) setMessage('Profile saved.'); } finally { saving.current = false; } }}><label className="field">What shall we call you?<input defaultValue={profile?.name} name="name" maxLength={80} autoComplete="given-name" placeholder="Your name" disabled={busy} /></label><label className="field">What interests you?<input defaultValue={profile?.interests} name="interests" maxLength={300} placeholder="Everyday knowledge, words, languages…" disabled={busy} /></label><label className="field">What would you like to get better at?<input defaultValue={profile?.goal} name="goal" maxLength={300} placeholder="Explain ideas, remember words, plan a day…" disabled={busy} /></label><label className="field">Preferred language<input name="language" maxLength={80} defaultValue={profile?.language ?? 'English'} disabled={busy} /></label><p className="privacy">Starter material is in English. Your preferred language is used for optional AI feedback.</p><div className="profile-save"><button className="primary" disabled={busy} type="submit">Save profile<Arrow /></button>{message && <span role="status">{message}</span>}</div></form>;
}

/** Text occupies its final layout throughout arrival, pause and completion. */
function SoftReply({ text, gentle, active }: { text: string; gentle: boolean; active: boolean }) {
  const output = useRef<HTMLSpanElement>(null), frame = useRef(0), shown = useRef(0);
  const isRevealing = useRef(false), finishRef = useRef<() => void>(() => {});
  const [revealing, setRevealing] = useState(false), [stopped, setStopped] = useState(false);
  useEffect(() => {
    const target = output.current; if (!target) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => { cancelAnimationFrame(frame.current); target.textContent = text; isRevealing.current = false; setRevealing(false); setStopped(false); };
    finishRef.current = finish;
    if (reduced.matches || gentle || !active) { finish(); return; }
    target.replaceChildren();
    const nodes: HTMLSpanElement[] = [];
    for (const part of text.split(/(\s+)/)) { const word = document.createElement('span'); word.className = 'bubble-word' + (part.length > 28 ? ' long-word' : ''); for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(part)) { const letter = document.createElement('span'); letter.className = 'bubble-letter'; letter.textContent = segment; nodes.push(letter); word.append(letter); } target.append(word); }
    shown.current = 0; isRevealing.current = true; setRevealing(true);
    const started = performance.now(), duration = Math.min(1700, Math.max(700, nodes.length * 13));
    const tick = (now: number) => { const count = Math.min(nodes.length, 1 + Math.floor((now - started) / duration * nodes.length)); for (let index = shown.current; index < count; index++) nodes[index].classList.add('revealed'); shown.current = count; if (now - started >= duration + 200) finish(); else frame.current = requestAnimationFrame(tick); };
    const reducedChanged = () => { if (reduced.matches) finish(); };
    reduced.addEventListener('change', reducedChanged); frame.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame.current); reduced.removeEventListener('change', reducedChanged); };
  }, [text, gentle]);
  useEffect(() => { if (!active && isRevealing.current) finishRef.current(); }, [active]);
  return <div className="feedback"><span className="sr-only" role="status">{text}</span><span ref={output} aria-hidden="true" /><div className="reveal-controls">{stopped && <span className="reveal-stopped">Interrupted</span>}{revealing && <button type="button" className="text-button reveal-control" onClick={() => { cancelAnimationFrame(frame.current); output.current?.querySelectorAll<HTMLElement>('.bubble-letter').forEach((letter, index) => { letter.style.animation = 'none'; letter.style.opacity = index < shown.current ? '1' : '0'; letter.style.transform = 'none'; }); isRevealing.current = false; setRevealing(false); setStopped(true); }}>Stop reveal</button>}{stopped && <button type="button" className="text-button reveal-control" onClick={() => { if (output.current) output.current.textContent = text; setStopped(false); }}>Show all</button>}</div></div>;
}
