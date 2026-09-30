import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningState } from './LearningView';

export type AppState = {
  preview?: boolean;
  maximized?: boolean;
  voice?: { available: boolean; consent: boolean; transcript: { text: string; processingMs: number } | null };
  learning?: LearningState;
  accounts: { clientId: string; email: string; signedIn: boolean }[];
  active: string | null;
  signedIn: boolean;
  planEnabled: boolean;
  busy: string;
  message: string;
  blocked: string;
  welcome: boolean;
  models: { slug: string; name: string }[];
  evidence: { event: string; at: string }[];
  selectedModel: string;
  reasoningEffort: string;
  lastError: { code: string; status: number; requestId: string } | null;
};

declare global {
  interface Window {
    onTheSpot?: { state(): Promise<AppState>; command(action: string, payload?: Record<string, unknown>): Promise<AppState> };
  }
}

export type Command = (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
const empty: AppState = { accounts: [], active: null, signedIn: false, planEnabled: false, busy: '', message: '', blocked: '', welcome: false, models: [], evidence: [], lastError: null, selectedModel: 'gpt-6-luna', reasoningEffort: 'max' };

export function useAppState() {
  const [state, setState] = useState(empty);
  const [loaded, setLoaded] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true), pending = useRef(false), operation = useRef(0), version = useRef(0), polling = useRef(false);
  const snapshot = useRef('');
  const accept = useCallback((next: AppState) => {
    if (!alive.current || !next) return;
    const serialised = JSON.stringify(next);
    if (serialised !== snapshot.current) { snapshot.current = serialised; setState(next); }
    setLoaded(true); setConnectionLost(false);
  }, []);

  const refresh = useCallback(async () => {
    const bridge = window.onTheSpot;
    if (!bridge || polling.current || pending.current) return;
    polling.current = true;
    const atVersion = version.current;
    try {
      const next = await bridge.state();
      // A poll started before an answer must never put the previous question back.
      if (atVersion === version.current && !pending.current) accept(next);
    } catch { if (alive.current && atVersion === version.current) setConnectionLost(true); }
    finally { polling.current = false; }
  }, [accept]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 1000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);

  const command = useCallback<Command>(async (action, payload = {}) => {
    const bridge = window.onTheSpot;
    if (!bridge) { setNotice('Open the desktop app to use this control.'); return false; }
    if (action.startsWith('window:')) {
      try {
        const next = await bridge.command(action, payload);
        if (alive.current && next) setState(current => ({ ...current, maximized: next.maximized }));
        return true;
      } catch { if (alive.current) setNotice('The window control could not finish. Try again.'); return false; }
    }
    // Cancellation has its own path, so a pending request cannot disable its exit.
    if (pending.current && action !== 'cancel') return false;
    const id = ++operation.current;
    version.current++;
    pending.current = true;
    setPendingAction(action); setNotice('');
    try {
      const next = await bridge.command(action, payload);
      if (id !== operation.current) return false;
      accept(next);
      const connectionAction = ['learn:generate', 'learn:feedback', 'signIn', 'signOut', 'models', 'test', 'refresh', 'setModel'].includes(action);
      if (connectionAction && next.lastError) {
        setNotice(next.message || 'The connection could not finish. Please try again.');
        return false;
      }
      return true;
    } catch {
      if (alive.current && id === operation.current && action !== 'learn:prepare') setNotice('That did not finish. Your saved work is kept. Please try again.');
      return false;
    } finally {
      if (id === operation.current) {
        version.current++;
        pending.current = false;
        if (alive.current) setPendingAction('');
      }
    }
  }, [accept]);

  return { state, loaded, connectionLost, pendingAction, notice, setNotice, command, refresh };
}
