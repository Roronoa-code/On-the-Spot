import React from 'react';

type Name = 'today' | 'practice' | 'progress' | 'settings' | 'arrow' | 'external' | 'close' | 'minus' | 'maximize' | 'restore' | 'check' | 'chevron' | 'local';

export function Icon({ name, size = 20, className = '' }: { name: Name; size?: number; className?: string }) {
  const paths: Record<Name, React.ReactNode> = {
    today: <><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><path d="M12 1.5v2M22.5 12h-2M12 22.5v-2M1.5 12h2"/></>,
    practice: <><path d="M8.5 5.5 18 12l-9.5 6.5z"/><path d="M3.5 5.5v13"/></>,
    progress: <><path d="M4 19.5h16M5.5 15V9M12 15V4.5M18.5 15v-4"/><circle cx="5.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="18.5" cy="7.5" r="1" fill="currentColor" stroke="none"/></>,
    settings: <><path d="M4 7h7M16 7h4M4 17h4M13 17h7"/><circle cx="13.5" cy="7" r="2.5"/><circle cx="10.5" cy="17" r="2.5"/></>,
    arrow: <><path d="M4.5 12h14M13 5.5l6.5 6.5-6.5 6.5"/></>,
    external: <path d="M7 17 18 6M7 6h11v11"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    minus: <path d="M5 12h14"/>,
    maximize: <rect x="5.5" y="5.5" width="13" height="13" rx="1"/>,
    restore: <><path d="M8.5 5.5v-2h12v12h-2"/><rect x="3.5" y="8.5" width="12" height="12" rx="1"/></>,
    check: <path d="m5 12 4.5 4.5L19 7"/>,
    chevron: <path d="m8 5 7 7-7 7"/>,
    local: <><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4.5" y="10" width="15" height="11" rx="3"/><path d="M12 14v3"/></>,
  };
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function SpotMark({ className = '' }: { className?: string }) {
  return <svg className={`spot-mark ${className}`} viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="1.5"/><path d="M24 3a21 21 0 0 1 21 21" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/><circle cx="24" cy="24" r="8" fill="currentColor"/><circle cx="24" cy="24" r="2" fill="var(--bg, #141716)"/></svg>;
}
