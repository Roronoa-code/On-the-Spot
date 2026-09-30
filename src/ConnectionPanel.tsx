import React from 'react';
import { Disclosure, Icon } from './ui';
import type { Command, State } from './types';
import { dateLabel } from './types';
const checks = [['registration', 'Account connected'], ['completed_response', 'Completed response'], ['refresh', 'Session renewed'], ['revocation', 'Session revoked'], ['usage_visible_user_confirmed', 'Usage seen in ChatGPT']] as const;
export function ConnectionPanel({ state, command, busy, connected }: { state: State; command: Command; busy: boolean; connected: boolean }) {
  const model = state.selectedModel, completed = new Set(state.evidence.map(e => e.event));
  return <section className="connection-panel" aria-labelledby="connection-title">
    <div className="section-label"><span className={`status-dot ${state.signedIn && state.planEnabled ? 'online' : ''}`}/><span>{state.signedIn ? state.planEnabled ? 'Connected' : 'Permission needed' : 'Not connected'}</span></div>
    <h3 id="connection-title">A little help, when you ask.</h3>
    <p className="muted">Your exercises work offline. Connect ChatGPT for a fresh question or feedback on your answer.</p>
    {state.accounts.length > 0 && <label className="field">Account<select disabled={busy} value={state.active ?? ''} onChange={e => void command('select', { clientId: e.target.value })}>{state.accounts.map((a, i) => <option key={a.clientId} value={a.clientId}>{a.email || `Connection ${i + 1}`}{a.signedIn ? '' : ' · Signed out'}</option>)}</select></label>}
    <div className="actions">
      {(!state.signedIn || !state.planEnabled) && <button className="primary chatgpt" disabled={!connected || busy} onClick={() => void command('signIn', { clientId: state.active, ...(state.signedIn ? { enablePlan: true } : {}) })}><img src="./chatgpt.svg" width="19" height="19" alt=""/>Continue with ChatGPT<Icon name="external" size={15}/></button>}
      {state.signedIn && state.planEnabled && <button className="secondary" disabled={busy || !!state.blocked} onClick={() => void command('models')}>{state.models.length ? 'Reload models' : 'Find available models'}</button>}
    </div>
    {state.models.length > 0 && <div className="model-row"><label className="field">Model<select value={model} disabled={busy} onChange={e => void command('setModel', { model: e.target.value })}>{!state.models.some(m => m.slug === model) && <option value={model}>{model} · Not listed</option>}{state.models.map(m => <option key={m.slug} value={m.slug}>{m.name}</option>)}</select></label><button className="secondary" disabled={busy || !!state.blocked} onClick={() => void command('test', { model })}>Test connection</button></div>}
    <p className="micro">Preferred: {model} · Reasoning: {state.reasoningEffort}</p>
    {!state.busy && state.message && <p className="inline-message" role="status">{state.message}</p>}
    {state.blocked && <div className="inline-message"><p>Requests are paused. Check your usage and permissions before resuming.</p><button className="text-button" disabled={busy} onClick={() => void command('resume')}>I have checked. Resume requests.</button></div>}
    <div className="usage-note"><button className="text-button" disabled={!connected} onClick={() => void command('usage')}>Manage ChatGPT usage<Icon name="external" size={14}/></button><p className="micro">Check your weekly app cap and credit-spending setting in ChatGPT.</p></div>
    <Disclosure title="Account tools & connection checks">
      <div className="actions">{state.signedIn && <><button className="secondary" disabled={busy} onClick={() => void command('refresh')}>Renew session</button><button className="text-button" disabled={busy} onClick={() => void command('signOut')}>Sign out</button></>}{state.accounts.length > 0 && <button className="text-button" disabled={busy} onClick={() => void command('signIn', { clientId: null })}>Add account</button>}</div>
      <ol className="checklist">{checks.map(([event, label]) => <li key={event}><span className={`check ${completed.has(event) ? 'done' : ''}`} aria-hidden="true">{completed.has(event) ? <Icon name="check" size={14}/> : '·'}</span><div><strong>{label}</strong><span className="micro">{completed.has(event) ? `Verified ${dateLabel(state.evidence.find(e => e.event === event)!.at)}` : 'Not verified yet'}</span></div></li>)}</ol>
      <p className="micro">Usage visibility needs your check in ChatGPT. Revocation is recorded only after successful sign-out.</p><button className="text-button" disabled={!connected || busy || !completed.has('completed_response')} onClick={() => void command('usageConfirmed')}>I can see On the Spot usage</button>
      {state.lastError && <p className="diagnostic-code">{state.lastError.code}{state.lastError.status ? ` · HTTP ${state.lastError.status}` : ''}{state.lastError.requestId ? ` · Request ${state.lastError.requestId}` : ''}</p>}
    </Disclosure>
  </section>;
}
