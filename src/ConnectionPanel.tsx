import React, { useEffect, useState } from 'react';
import type { AppState, Command } from './app-state';
import { Icon } from './Icon';

const steps = [['registration', 'Account connected'], ['completed_response', 'Completed response'], ['refresh', 'Session renewed'], ['revocation', 'Session revoked'], ['usage_visible_user_confirmed', 'Usage seen in ChatGPT']] as const;

export function ConnectionPanel({ state, busy, pendingAction, command, notice, dismissNotice }: { state: AppState; busy: boolean; pendingAction: string; command: Command; notice: string; dismissNotice: () => void }) {
  const model = state.selectedModel;
  const [slow, setSlow] = useState(false);
  useEffect(() => { setSlow(false); if (!busy) return; const timer = setTimeout(() => setSlow(true), 700); return () => clearTimeout(timer); }, [busy]);
  const native = !!window.onTheSpot && !state.preview;
  const completed = new Set(state.evidence.map(event => event.event));
  const workingMessage = state.busy || ({ models: 'Finding available models', test: 'Testing your connection', refresh: 'Renewing your session', signIn: 'Opening sign-in', signOut: 'Signing out', 'learn:generate': 'Preparing a question', 'learn:feedback': 'Preparing feedback', 'learn:settings': 'Saving your preference', cancel: 'Cancelling request' } as Record<string, string>)[pendingAction];
  const cancellable = pendingAction !== 'cancel' && (!!state.busy || ['models', 'test', 'refresh', 'signIn', 'learn:generate', 'learn:feedback'].includes(pendingAction));
  return <>
    {notice && <div className="inline-notice" role="alert"><p>{notice}</p><button className="icon-button" aria-label="Dismiss message" onClick={dismissNotice}><Icon name="close" size={16}/></button></div>}
    <section className="setting-section" aria-labelledby="motion-title">
      <div className="setting-title"><span className="setting-number">01</span><h3 id="motion-title">Set the pace</h3></div>
      <p className="setting-description">How the interface moves. Practice is always untimed.</p>
      <div className="motion-switch" role="group" aria-label="Interface motion">
        {([['liquid', 'Fluid', 'Connected, expressive motion'], ['gentle', 'Gentle', 'Quiet, quick transitions']] as const).map(([value, label, detail]) => <button key={value} className={(state.learning?.settings.motion ?? 'liquid') === value ? 'selected' : ''} aria-pressed={(state.learning?.settings.motion ?? 'liquid') === value} disabled={!state.learning || busy} onClick={() => void command('learn:settings', { ...state.learning!.settings, motion: value })}><span className={`motion-glyph ${value}`} aria-hidden="true"><i/><i/><i/></span><strong>{label}</strong><small>{detail}</small></button>)}
      </div>
      <p className="privacy">Your system’s reduced motion preference takes priority.</p>
    </section>
    <section className="setting-section connection" aria-labelledby="connection-title">
      <div className="setting-title"><span className="setting-number">02</span><h3 id="connection-title">Your ChatGPT connection</h3><span className={`connection-light ${state.signedIn && state.planEnabled ? 'connected' : ''}`} role="img" aria-label={state.signedIn && state.planEnabled ? 'Connected' : 'Not connected'}/></div>
      <p className="setting-description">Optional questions and feedback, using your plan.</p>
      {state.preview && <p className="preview-notice">Connections and local speech are available in the Windows app. This preview keeps practice data only until its server stops.</p>}
      {state.accounts.length > 0 && <label className="field">ChatGPT account<select disabled={busy} value={state.active ?? ''} onChange={event => void command('select', { clientId: event.target.value })}>{state.accounts.map((account, index) => <option key={account.clientId} value={account.clientId}>{account.email} · Connection {index + 1}{account.signedIn ? '' : ' · Signed out'}</option>)}</select></label>}
      <div className="connection-actions">
        {(!state.signedIn || !state.planEnabled) && <button className="chatgpt" disabled={!native || busy} onClick={() => void command('signIn', { clientId: state.active, ...(state.signedIn ? { enablePlan: true } : {}) })}><img src="./chatgpt.svg" alt="" width="20" height="20"/>Continue with ChatGPT<Icon name="external" size={17}/></button>}
        {state.signedIn && state.planEnabled && <span className="connected-label"><Icon name="check" size={17}/>Your plan is connected</span>}
        {state.signedIn && <button className="text-button" disabled={busy} onClick={() => void command('signOut')}>Sign out</button>}
        {state.accounts.length > 0 && <button className="text-button" disabled={busy} onClick={() => void command('signIn', { clientId: null })}>Add account</button>}
      </div>
      {(workingMessage || (!state.preview && state.message) || state.lastError) && <div className={`connection-status ${state.lastError ? 'has-error' : ''}`} role="status" aria-live="polite">{slow && <span className="loading-dot" aria-hidden="true"/>}<p>{workingMessage || state.message}</p>{cancellable && <button className="text-button" onClick={() => void command('cancel')}>Cancel</button>}</div>}
      {state.lastError && <details className="disclosure diagnostics"><summary>Connection details<Icon name="chevron" size={15}/></summary><p>{state.lastError.code}{state.lastError.status ? ` · HTTP ${state.lastError.status}` : ''}{state.lastError.requestId ? ` · Request ${state.lastError.requestId}` : ''}</p></details>}
      {state.blocked && <button className="secondary resume-connection" disabled={busy} onClick={() => void command('resume')}>I’ve checked permissions. Try again.</button>}
      <div className="usage-row"><button className="text-button" disabled={!native} onClick={() => void command('usage')}>Manage usage<Icon name="external" size={15}/></button><p>Choose a weekly app cap in ChatGPT. Keep credit spending off.</p></div>
      <details className="disclosure connection-advanced"><summary>Model and session<Icon name="chevron" size={15}/></summary><div className="disclosure-content"><p className="privacy">Preferred model: {model} · Reasoning: {state.reasoningEffort}</p>{state.models.length > 0 && <label className="field">Model<select value={model} disabled={busy} onChange={event => void command('setModel', { model: event.target.value })}>{!state.models.some(item => item.slug === model) && <option value={model}>{model} · Not listed</option>}{state.models.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>}<div className="connection-actions"><button className="secondary" disabled={!state.signedIn || !state.planEnabled || busy || !!state.blocked} onClick={() => void command('models')}>{state.models.length ? 'Reload models' : 'Find available models'}</button><button className="text-button" disabled={!state.signedIn || !state.planEnabled || busy || !!state.blocked} onClick={() => void command('test', { model })}>Test connection</button><button className="text-button" disabled={!state.signedIn || busy} onClick={() => void command('refresh')}>Renew session</button></div></div></details>
      <details className="disclosure connection-history"><summary>Connection checks<Icon name="chevron" size={15}/></summary><div className="disclosure-content"><ol className="connection-checks">{steps.map(([event, label]) => <li key={event}><span className={`check ${completed.has(event) ? 'done' : ''}`} aria-hidden="true">{completed.has(event) ? <Icon name="check" size={13}/> : <span/>}</span><div><strong>{label}</strong><span>{completed.has(event) ? new Date(state.evidence.find(item => item.event === event)!.at).toLocaleDateString('en-GB') : 'Not verified yet'}</span></div></li>)}</ol><p className="privacy">Usage visibility needs your check in ChatGPT settings. Revocation is recorded after successful sign-out.</p><button className="text-button" disabled={!native || busy || !completed.has('completed_response')} onClick={() => void command('usageConfirmed')}>I can see On the Spot usage</button></div></details>
    </section>
    <div className="settings-footnote"><Icon name="local" size={17}/><p>Your answers stay on this PC. Optional AI sends only the content described when you request it.</p></div>
  </>;
}
