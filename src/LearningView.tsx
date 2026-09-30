import React, { useEffect, useRef, useState } from 'react';
import { VoiceInput } from './VoiceInput';

type Result = { id: string; score: number | null; feedback: string; status: string; reference: string; explanation: string; answer: string; disputed: boolean };
export type LearningState = {
  draft?: { id: string; sourceId: string; lesson: string; prompt: string } | null;
  profile: { name: string; interests: string; goal: string; language: string } | null;
  settings: { reviewsFirst: boolean; newItems: number; motion?: string }; dueCount: number;
  session: { id: string; mode: string; index: number; count: number; teaching: boolean; exercise: { id: string; family: string; level: number; prompt: string; lesson: string; hint: string; sequence?: string[]; source: string }; result: Result | null } | null;
  summary: { count: number; checked: number; correct: number; skipped: number; completedAt: string; conversation: string } | null;
  progress: { id: string; title: string; learned: boolean; due: string | null; reason: string }[];
  comparisons: { family: string; level: number; matchedTasks: number; recentCorrect: number; comparableKey: string | null; first: {answer: string; score: number; at: string} | null; latest: {answer: string; score: number; at: string} | null }[];
  attempts: { id: string; family: string; answer: string; score: number | null; explanation: string; disputed: boolean; at: string }[];
};
type Props = { state?: LearningState; command: (action: string, payload?: Record<string, unknown>) => Promise<void>; view: string; busy: boolean; start: (mode?: string, conceptId?: string) => void; aiEnabled?: boolean };
const names: Record<string, string> = { learn: 'Learn & remember', words: 'Find words & speak', reason: 'Reason & plan', attention: 'Attention & working memory' };
export function LearningView({ state, command, view, busy, start, aiEnabled }: Props) {
  const [answer, setAnswer] = useState('');
  const [inputMode, setInputMode] = useState('typing');
  const [speechOnsetMs, setSpeechOnsetMs] = useState<number | null>(null);
  const [processingMs, setProcessingMs] = useState(0);
  const [explanation, setExplanation] = useState('');
  const [support, setSupport] = useState('');
  const [hidden, setHidden] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState('short');
  const [topic, setTopic] = useState('');
  const item = state?.session?.exercise;
  useEffect(() => { setAnswer(''); setExplanation(''); setSupport(''); setHidden(false); setInputMode('typing'); setSpeechOnsetMs(null); setProcessingMs(0); if(item && state?.session && !item.sequence) void command('learn:prepare', {sessionId: state.session.id, exerciseId:item.id}); }, [item?.id]);
  if (!state) return <p className="privacy">Open the desktop app to save sessions and reviews.</p>;
  const s = state.session;
  const context = { sessionId: s?.id, exerciseId: item?.id };
  if (!state.profile) return <section className="exercise"><div className="eyebrow">LET’S BEGIN</div><h2>A little about you.</h2><p className="intro">Choose what you would like to explore. You can change this later.</p><ProfileForm profile={state.profile} busy={busy} command={command}/></section>;
  if (view === 'Today') {
    const nextReview=state.progress.filter(c=>c.learned&&c.due).sort((a,b)=>new Date(a.due!).getTime()-new Date(b.due!).getTime())[0];
    return <section className="today-layout">
      <div className="session-panel">
        <div className="session-panel-top"><span className="eyebrow">YOUR NEXT SESSION</span><span className="session-count">{mode==='short'?'4':'12'} exercises</span></div>
        <h2>{s?'Pick up where you left off.':'Start with one small idea.'}</h2>
        <p className="intro">Learn it. Put it into words. Try it for yourself.</p>
        <div className="session-options">
          <label className="field">Session size<select value={mode} onChange={e=>setMode(e.target.value)} disabled={!!s}><option value="short">A short session · about 3 min</option><option value="daily">A daily session · about 10–15 min</option></select></label>
          <label className="field">Explore<select value={topic} disabled={!!s} onChange={e=>setTopic(e.target.value)}><option value="">Let my reviews guide me</option>{state.progress.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        </div>
        <button className="primary session-start" disabled={busy} onClick={()=>start(mode,topic)}>{s?'Continue session':'Start session'} <span aria-hidden="true">↗</span></button>
        <p className="privacy">No timer. Hints when you need them. Saved as you go.</p>
        <div className="session-families"><span>Learn & remember</span><span>Find words</span><span>Reason & plan</span><span>Focus</span></div>
      </div>
      <aside className="review-panel"><span className="eyebrow">A LITTLE LATER</span><h2>{state.dueCount?'Ready to revisit.':nextReview?'Your next review.':'Something to return to.'}</h2><p className="review-title">{nextReview?.title ?? 'Your first learned idea will appear here.'}</p>{nextReview?.due&&<p className="privacy">{new Date(nextReview.due).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</p>}<p className="privacy">Unfamiliar ideas start with teaching. Reviews follow what you have actually practised.</p>{state.profile.goal&&<div className="personal-goal"><span>Your focus</span><p>{state.profile.goal}</p></div>}</aside>
      <details className="diagnostics ai-variation"><summary>Make a fresh question with AI</summary><p className="privacy">Uses a reviewed passage and your interests, goal and language. You review the question before using it.</p><button className="secondary" disabled={busy||!aiEnabled} onClick={()=>void command('learn:generate',{conceptId:topic||'estimate'})}>Prepare a question</button>{!aiEnabled&&<p className="privacy">Connect your ChatGPT plan below to use this.</p>}{state.draft&&<aside className="lesson"><strong>Review this question</strong><p>{state.draft.lesson}</p><p>{state.draft.prompt}</p><div className="connection-actions"><button className="secondary" disabled={busy} onClick={()=>void command('learn:reviewDraft',{draftId:state.draft!.id,accept:true})}>Keep for future sessions</button><button className="text-button" disabled={busy} onClick={()=>void command('learn:reviewDraft',{draftId:state.draft!.id,accept:false})}>Discard</button></div></aside>}</details>
    </section>;
  }
  if (view === 'Progress') return <section className="exercise"><div className="eyebrow">YOUR LEARNING</div><h2>Ideas worth keeping.</h2><details className="diagnostics"><summary>Your profile</summary><ProfileForm profile={state.profile} busy={busy} command={command}/></details><ol className="checklist">{state.progress.map(c => <li key={c.id}><span className={c.learned ? 'check done' : 'check'} aria-hidden="true">{c.learned ? '✓' : '—'}</span><div><strong>{c.title}</strong><span>{c.learned && c.due ? `Review ${new Date(c.due).toLocaleString('en-GB')}` : 'Teach first'}</span><p className="privacy">{c.reason}</p></div></li>)}</ol>{state.comparisons.map(c => <p className="privacy" key={c.family}>{names[c.family]} · level {c.level + 1} · {c.matchedTasks ? `${c.recentCorrect} correct in the last ${Math.min(c.matchedTasks, 5)} matched tasks` : 'No comparable results yet'}</p>)}<details className="diagnostics"><summary>Matched examples</summary>{state.comparisons.filter(c=>c.first&&c.latest).map(c=><div key={c.family} className="attempt-row"><strong>{names[c.family]} · same task level</strong><p>First: {c.first!.answer} · {Math.round(c.first!.score*100)}%</p><p>Latest: {c.latest!.answer} · {Math.round(c.latest!.score*100)}%</p></div>)}<p className="privacy">These examples describe those tasks. They do not measure general intelligence or health.</p></details><details className="diagnostics"><summary>Review rules and recent answers</summary><label className="field">Motion<select value={state.settings.motion ?? 'liquid'} onChange={e=>void command('learn:settings',{...state.settings,motion:e.target.value})}><option value="liquid">Liquid</option><option value="gentle">Gentle</option></select></label><label className="field">Maximum new concepts per session<select value={state.settings.newItems} disabled={busy} onChange={e=>void command('learn:settings',{...state.settings,newItems:Number(e.target.value)})}>{[1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label><label className="field"><input className="inline-check" type="checkbox" checked={state.settings.reviewsFirst} onChange={e => void command('learn:settings', { ...state.settings, reviewsFirst: e.target.checked })}/> Due reviews first</label><p className="privacy">Unknown material is taught. Missing or unclear answers do not count as forgetting. Three unaided successes increase reasoning or attention difficulty; repeated errors lower it.</p>{state.attempts.slice().reverse().map(a => <div className="attempt-row" key={a.id}><p>{names[a.family]} · {a.score === null ? 'Unscored' : `${Math.round(a.score * 100)}%`} · {a.explanation || 'No explanation selected'}</p><p>{a.answer || 'No answer'}</p><button className="text-button" disabled={busy} onClick={() => void command('learn:correct', { attemptId: a.id, score: null })}>Dispute result</button><button className="text-button" disabled={busy} onClick={() => void command('learn:correct', { attemptId: a.id, score: 1 })}>Correct to successful</button><label className="field">Your explanation<select value={a.explanation} onChange={e => void command('learn:correct', { attemptId: a.id, score: a.score, explanation: e.target.value })}><option value="">No explanation selected</option>{['Never learned it', 'Knew it but could not recall it', 'Question unclear'].map(x => <option key={x}>{x}</option>)}</select></label></div>)}</details><div className="connection-actions"><button className="secondary" disabled={busy} onClick={() => void command('learn:export')}>Export learner data</button><button className="text-button" disabled={busy} onClick={() => void command('learn:delete')}>Delete learner data</button></div><p className="privacy">Records are encrypted on this PC. Exports are readable JSON; keep them somewhere private.</p></section>;
  if (!s || !item) return <section className="exercise"><h2>{state.summary ? 'A useful stopping point.' : 'Ready when you are.'}</h2>{state.summary && <><p className="feedback">{state.summary.count} exercises completed. {state.summary.correct} successful of {state.summary.checked} checked. {state.summary.skipped} skipped.</p><p className="intro">{state.summary.conversation}</p></>}<button className="primary" disabled={busy} onClick={() => start(mode, topic)}>Start session ↗</button></section>;
  return <section className="exercise" aria-labelledby="exercise-title"><div className="eyebrow">{names[item.family].toUpperCase()} · {s.index + 1} OF {s.count}</div><h2 id="exercise-title">{item.prompt}</h2>{s.teaching && <aside className="lesson"><strong>First, let’s learn it.</strong><p>{item.lesson}</p></aside>}{item.sequence && !hidden && !s.result && <div className="sequence"><p>{item.sequence.map(x=>(({circle:'○ circle',square:'□ square',triangle:'△ triangle',diamond:'◇ diamond',star:'☆ star',rectangle:'▭ rectangle'} as Record<string,string>)[x] ?? x)).join(' · ')}</p><button className="secondary" disabled={busy} onClick={async () => { await command('learn:prepare', context); setHidden(true); input.current?.focus(); }}>Hide sequence and answer</button></div>}{!s.result ? <form onSubmit={async e => { e.preventDefault(); if (!answer.trim()) { setSupport('Add an answer when you are ready, or choose Skip.'); return; } await command('learn:answer', { ...context, answer, explanation, inputMode, speechOnsetMs, processingMs }); }}><label className="field" htmlFor="answer">Your answer</label><textarea ref={input} id="answer" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={4000} disabled={busy || !!item.sequence && !hidden} rows={3}/><VoiceInput prompt={item.prompt} disabled={busy || !!item.sequence && !hidden} onTranscript={(text,onset,delay) => {setProcessingMs(x=>x+delay);setAnswer(text);setInputMode('speech');setSpeechOnsetMs(onset);input.current?.focus();}}/><label className="field">How did that feel? (optional)<select value={explanation} onChange={e => setExplanation(e.target.value)}><option value="">Choose if it helps</option>{['Never learned it', 'Knew it but could not recall it', 'Question unclear'].map(x => <option key={x}>{x}</option>)}</select></label><button className="primary" disabled={busy || !!item.sequence && !hidden} type="submit">Check answer</button></form> : <div className="result"><SoftReply key={s.result.id+':'+s.result.feedback} text={s.result.feedback}/><p className="privacy">Reference: {s.result.reference}</p>{['learn','words'].includes(item.family) && <><button className="text-button" disabled={busy || !aiEnabled} onClick={() => void command('learn:feedback', {attemptId:s.result!.id})}>Ask AI for provisional feedback</button><p className="privacy">Sends this prompt, reference and answer to OpenAI. AI feedback stays unscored until you correct or confirm it.</p></>}<div className="connection-actions"><button className="primary" disabled={busy} onClick={() => void command('learn:next', context)}>{s.index + 1 === s.count ? 'Finish session' : 'Next exercise'}</button><button className="text-button" disabled={busy} onClick={() => void command('learn:correct', { attemptId: s.result!.id, score: null })}>Dispute result</button><button className="text-button" disabled={busy} onClick={() => void command('learn:correct', { attemptId: s.result!.id, score: 1 })}>My answer fits</button></div></div>}<div className="support-actions"><button className="text-button" disabled={busy} onClick={() => { setSupport(item.lesson); void command('learn:support', { ...context, kind: 'teach' }); }}>Teach me</button><button className="text-button" disabled={busy} onClick={() => { setSupport(item.hint); void command('learn:support', { ...context, kind: 'hint' }); }}>Give a hint</button><button className="text-button" disabled={busy || !!s.result} onClick={() => void command('learn:answer', { ...context, answer: '', explanation, skip: true })}>Skip</button></div>{support && <p className="feedback" role="status">{support}</p>}<p className="privacy">{item.source}. This exercise runs offline; no answer is sent to OpenAI.</p></section>;
}

function ProfileForm({profile,busy,command}: {profile: LearningState['profile'];busy:boolean;command:Props['command']}) { return <form className="profile-form" onSubmit={async e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    await command('learn:profile', Object.fromEntries(['name', 'interests', 'goal', 'language'].map(key => [key, String(form.get(key) ?? '')])));
  }}><label className="field">What shall we call you?<input defaultValue={profile?.name} name="name" maxLength={80} autoComplete="given-name"/></label><label className="field">What interests you?<input defaultValue={profile?.interests} name="interests" maxLength={300} placeholder="Everyday knowledge, words, languages…"/></label><label className="field">What would you like to get better at?<input defaultValue={profile?.goal} name="goal" maxLength={300} placeholder="Explain ideas, remember words, plan a day…"/></label><label className="field">Preferred language<input name="language" maxLength={80} defaultValue={profile?.language ?? "English"}/></label><p className="privacy">The reviewed starter material is in English. Your preferred language is used for optional AI feedback.</p><button className="primary" disabled={busy} type="submit">Save profile</button></form>; }

// Approved wait-reply 4966ae8af593e55a7639: grapheme arrival and easing.
function SoftReply({text}: {text:string}) {
  const output=useRef<HTMLSpanElement>(null), frame=useRef(0), shown=useRef(0);
  const [revealing,setRevealing]=useState(true), [stopped,setStopped]=useState(false);
  const letters=Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),p=>p.segment);
  useEffect(()=>{
    const target=output.current; if(!target)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    if(reduced.matches){target.textContent=text;setRevealing(false);return;}
    target.replaceChildren();const nodes:HTMLSpanElement[]=[];
    for(const part of text.split(/(\s+)/)) {
      const word=document.createElement('span');word.className='bubble-word'+(part.length>28?' long-word':'');
      for(const {segment} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(part)) {
        const letter=document.createElement('span');letter.className='bubble-letter';letter.textContent=segment;nodes.push(letter);word.append(letter);
      }
      target.append(word);
    }
    shown.current=0;const started=performance.now();
    const finish=()=>{cancelAnimationFrame(frame.current);target.textContent=text;setRevealing(false);};
    reduced.addEventListener('change',finish);
    const tick=(now:number)=>{
      const count=Math.min(nodes.length,1+Math.floor((now-started)/1760*nodes.length));
      for(let i=shown.current;i<count;i++)nodes[i].classList.add('revealed');shown.current=count;
      if(count===nodes.length){frame.current=requestAnimationFrame(()=>{if(performance.now()-started>=2000)finish();else frame.current=requestAnimationFrame(tick);});}
      else frame.current=requestAnimationFrame(tick);
    };
    frame.current=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame.current);reduced.removeEventListener('change',finish);};
  },[text]);
  return <div className="feedback"><span className="sr-only" role="status">{text}</span><span ref={output} aria-hidden="true"/>{stopped&&<strong> — Interrupted</strong>}{revealing&&<button className="text-button reveal-control" onClick={()=>{cancelAnimationFrame(frame.current);if(output.current)output.current.textContent=letters.slice(0,shown.current).join('');setRevealing(false);setStopped(true);}}>Stop reveal</button>}{stopped&&<button className="text-button reveal-control" onClick={()=>{if(output.current)output.current.textContent=text;setStopped(false);}}>Show all</button>}</div>;
}

