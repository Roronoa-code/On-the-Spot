import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, State } from './types';

export const emptyState: State = { accounts: [], active: null, signedIn: false, planEnabled: false, busy: '', message: '', blocked: '', welcome: false, models: [], evidence: [], lastError: null, selectedModel: 'gpt-6-luna', reasoningEffort: 'max' };
const bridge = window.onTheSpot;
export function useDesktop() {
  const [state, setState] = useState<State>(emptyState), [pending, setPending] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(!!bridge), [unavailable, setUnavailable] = useState(false);
  const revision = useRef(0), inFlight = useRef(0), reading = useRef(false), alive = useRef(true);
  const read = useCallback(async () => {
    if (!bridge || reading.current) return;
    reading.current = true; const version = revision.current;
    try {
      const next = await bridge.state();
      if (alive.current && version === revision.current) { setState(next); setUnavailable(false); }
    } catch { if (alive.current && version === revision.current) setUnavailable(true); }
    finally { reading.current = false; if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true; void read();
    const timer = setInterval(() => { if (!document.hidden) void read(); }, 1200);
    const wake = () => { if (!document.hidden) void read(); };
    document.addEventListener('visibilitychange', wake);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', wake); };
  }, [read]);
  const command: Command = useCallback(async (action, payload = {}) => {
    if (!bridge) return false;
    // Window controls and cancellation must remain usable during a slow request.
    const interrupt = action === 'cancel' || action.startsWith('window:') || action === 'welcome';
    if (inFlight.current && !interrupt) return false;
    inFlight.current++; const version = ++revision.current;
    if (!interrupt) { setPending(action); setNotice(''); }
    try {
      const next = await bridge.command(action, payload);
      // Polls may report live server activity, but may never overwrite this response.
      if (alive.current && next && version === revision.current) { revision.current++; setState(next); setUnavailable(false); }
      return !!next;
    } catch {
      if (alive.current && !action.startsWith('window:')) setNotice(action === 'learn:answer' ? 'That did not finish. Your answer is still here. Try again.' : 'That did not finish. Please try again.');
      return false;
    } finally {
      inFlight.current--;
      if (!inFlight.current && alive.current) { setPending(''); void read(); }
    }
  }, [read]);
  return { state, command, pending, busy: !!pending || !!state.busy, notice, dismissNotice: () => setNotice(''), loading, unavailable, connected: !!bridge, retry: read };
}
