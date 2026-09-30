import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Page } from './types';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    play: <path d="m9 5 11 7-11 7Z"/>, next: <><path d="m8 5 7 7-7 7"/><path d="M20 5v14"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, minus: <path d="M5 12h14"/>, window: <rect x="5" y="5" width="14" height="14" rx="1"/>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>, check: <path d="m5 12 4 4L19 6"/>, back: <path d="m14 5-7 7 7 7"/>,
    learn: <><circle cx="10" cy="10" r="6"/><path d="M14 4a7 7 0 0 1 6 7 7 7 0 0 1-7 7M8 20h8"/></>,
    words: <><path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9h8M8 12h5"/></>,
    reason: <><path d="M4 17h5V7h6v10h5"/><circle cx="4" cy="17" r="2"/><circle cx="20" cy="17" r="2"/></>,
    attention: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 17h6m-3-3v6"/></>,
    external: <><path d="M13 4h7v7m0-7L10 14M9 5H4v15h15v-5"/></>,
    archive: <><path d="M5 8v12h14V8M3 4h18v4H3Z"/><path d="M9 12h6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.learn}</svg>;
}

/** A disclosure has one control, one expanding surface, and no hidden tab stops. */
export function Disclosure({ title, children, className = '', initial = false }: { title: React.ReactNode; children: React.ReactNode; className?: string; initial?: boolean }) {
  const [open, setOpen] = useState(initial), id = useId();
  return <section className={`disclosure ${className}`} data-open={open}>
    <button className="disclosure-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><span>{title}</span><Icon name="chevron" size={16}/></button>
    <div className="disclosure-fold" id={id} inert={!open} aria-hidden={!open}><div><div className="disclosure-content">{children}</div></div></div>
  </section>;
}

/** Native modal semantics, interrupted animation cleanup, Escape and focus return. */
export function Sheet({ open, close, title, children, kind = '' }: { open: boolean; close: () => void; title: string; children: React.ReactNode; kind?: string }) {
  const ref = useRef<HTMLDialogElement>(null), restore = useRef<HTMLElement | null>(null), id = useId();
  const lock = useRef<string | null>(null), dismiss = useRef(close); dismiss.current = close;
  const finishClose = () => {
    const node = ref.current;
    if (node?.open) node.close();
    if (lock.current !== null) { document.documentElement.style.overflow = lock.current; lock.current = null; }
    if (restore.current?.isConnected) restore.current.focus({ preventScroll: true });
  };
  useEffect(() => {
    const node = ref.current; if (!node) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'gentle';
    const currentOpacity = getComputedStyle(node).opacity;
    node.getAnimations().forEach(a => a.cancel());
    if (open) {
      const wasOpen = node.open;
      if (!wasOpen) {
        restore.current = document.activeElement as HTMLElement;
        lock.current = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        node.showModal();
        node.scrollTop = 0;
      }
      const base = kind === 'welcome-sheet' ? 'translate(-50%, -50%)' : 'translateX(0)';
      if (!reduce) {
        const animation = node.animate([{ opacity: wasOpen ? currentOpacity : 0, transform: `${base} translateX(${wasOpen ? 0 : 24}px)` }, { opacity: 1, transform: base }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
        return () => animation.cancel();
      }
    } else if (node.open) {
      if (reduce) { finishClose(); return; }
      const base = kind === 'welcome-sheet' ? 'translate(-50%, -50%)' : 'translateX(0)';
      const animation = node.animate([{ opacity: currentOpacity, transform: base }, { opacity: 0, transform: `${base} translateX(18px)` }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      void animation.finished.then(finishClose).catch(() => {});
      return () => animation.cancel();
    }
  }, [open]);
  useEffect(() => () => { ref.current?.getAnimations().forEach(a => a.cancel()); finishClose(); }, []);
  return <dialog ref={ref} className={`sheet ${kind}`} aria-labelledby={id} onKeyDown={e => {
    if (e.key !== 'Tab') return;
    const targets = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter(node => !node.matches(':disabled') && !node.closest('[inert], [aria-hidden="true"]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
    const first = targets[0], last = targets.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }} onCancel={e => { e.preventDefault(); dismiss.current(); }} onClick={e => {
    if (e.target !== e.currentTarget) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) dismiss.current();
  }}><div className="sheet-header"><h2 id={id}>{title}</h2><button type="button" className="icon-button" onClick={close} aria-label={`Close ${title.toLowerCase()}`} autoFocus><Icon name="close"/></button></div><div className="sheet-body">{children}</div></dialog>;
}

/** Stable outer geometry during answer/feedback and help expansion. */
export function Flow({ children, identity }: { children: React.ReactNode; identity: string }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = outer.current, content = inner.current; if (!box || !content) return;
    const update = () => { box.style.height = `${content.getBoundingClientRect().height}px`; };
    update(); const observer = new ResizeObserver(update); observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = inner.current; if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'gentle') return;
    node.getAnimations().forEach(a => a.cancel());
    const animation = node.animate([{ opacity: .45, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    return () => animation.cancel();
  }, [identity]);
  return <div ref={outer} className="flow"><div ref={inner} className="flow-inner">{children}</div></div>;
}

export function Spot({ count, current = 0, compact = false, onClick, disabled, label }: { count: number; current?: number; compact?: boolean; onClick?: () => void; disabled?: boolean; label?: string }) {
  const visual = <><svg className="spot-ring" viewBox="0 0 300 300" aria-hidden="true"><circle className="spot-guide" cx="150" cy="150" r="132"/>{Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 360 - 90, r = angle * Math.PI / 180;
    return <g key={i} className={i < current ? 'spot-tick done' : i === current ? 'spot-tick current' : 'spot-tick'}><circle cx={150 + 132 * Math.cos(r)} cy={150 + 132 * Math.sin(r)} r={i === current ? 5 : 3}/></g>;
  })}<circle className="spot-inner-ring" cx="150" cy="150" r="109"/></svg><span className="spot-core"><span className="spot-number">{String(compact ? current + 1 : count).padStart(2, '0')}</span><span className="spot-caption">{compact ? `of ${count}` : 'exercises'}</span></span>{!compact && <span className="spot-action"><Icon name="play" size={15}/>{label}</span>}</>;
  return onClick ? <button type="button" className="spot launch-spot" aria-label={label} disabled={disabled} onClick={onClick}>{visual}</button> : <div className={`spot ${compact ? 'compact-spot' : ''}`} aria-label={`Exercise ${current + 1} of ${count}`}>{visual}</div>;
}

// Animate real content, not a document snapshot: navigation remains interactive.
// Two pointer-transparent copies crossfade while the one real spot moves home.
type SceneFlight = { cancel: () => void; target: HTMLElement | null; ghost: HTMLElement | null };
let flight: SceneFlight | undefined;
function flightCopy(source: HTMLElement, rect: DOMRect) {
  const copy = source.cloneNode(true) as HTMLElement;
  const scale = rect.width / (source.offsetWidth || rect.width);
  const originals = [source, ...Array.from(source.querySelectorAll<HTMLElement>('*'))];
  const copies = [copy, ...Array.from(copy.querySelectorAll<HTMLElement>('*'))];
  originals.forEach((node, i) => {
    const style = getComputedStyle(node);
    for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'margin-top', 'margin-left', 'background-color', 'border-color', 'border-width', 'border-style']) {
      const value = style.getPropertyValue(property);
      const scalable = ['font-size', 'line-height', 'letter-spacing', 'margin-top', 'margin-left'].includes(property);
      copies[i].style.setProperty(property, scalable && value.endsWith('px') ? `${parseFloat(value) * scale}px` : value);
    }
  });
  copy.classList.add('spot-flight'); copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
  Object.assign(copy.style, { position: 'fixed', left: '0', top: '0', width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', pointerEvents: 'none', zIndex: '25', transformOrigin: 'top left', opacity: '1', transition: 'none' });
  return copy;
}
export function changeScene(from: Page, to: Page, update: () => void) {
  const oldCore = document.querySelector<HTMLElement>('main .spot-core');
  // An interrupted flight starts at the on-screen position, not its old home.
  const oldRect = flight?.ghost?.getBoundingClientRect() ?? oldCore?.getBoundingClientRect();
  const oldCopy = oldCore && oldRect ? flightCopy(oldCore, oldRect) : null;
  flight?.cancel(); flight = undefined;
  const forward = ['Today', 'Practice', 'Progress'].indexOf(to) >= ['Today', 'Practice', 'Progress'].indexOf(from);
  flushSync(update);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'gentle') return;
  const page = document.querySelector<HTMLElement>('main');
  const newCore = document.querySelector<HTMLElement>('main .spot-core'), newRect = newCore?.getBoundingClientRect();
  const animations: Animation[] = [], ghosts: HTMLElement[] = [];
  let finished = false;
  const current: SceneFlight = {
    target: newCore, ghost: null,
    cancel: () => {
      if (finished) return; finished = true;
      animations.forEach(a => a.cancel()); ghosts.forEach(node => node.remove());
      window.removeEventListener('resize', current.cancel); window.removeEventListener('scroll', current.cancel, true);
      if (newCore) newCore.style.opacity = '';
      if (flight === current) flight = undefined;
    },
  };
  flight = current;
  window.addEventListener('resize', current.cancel, { once: true }); window.addEventListener('scroll', current.cancel, { once: true, capture: true });
  if (page) animations.push(page.animate([{ opacity: .55, transform: `translateX(${forward ? 8 : -8}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' }));
  if (oldCopy && oldRect && newCore && newRect && oldRect.width && newRect.width) {
    const newCopy = flightCopy(newCore, newRect), sx = newRect.width / oldRect.width, sy = newRect.height / oldRect.height;
    ghosts.push(oldCopy, newCopy); document.body.append(oldCopy, newCopy);
    newCore.style.opacity = '0'; current.ghost = newCopy;
    const timing = { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' as const };
    animations.push(oldCopy.animate([
      { transform: `translate(${oldRect.x}px, ${oldRect.y}px) scale(1, 1)`, opacity: 1 },
      { transform: `translate(${newRect.x}px, ${newRect.y}px) scale(${sx}, ${sy})`, opacity: 0 },
    ], timing));
    animations.push(newCopy.animate([
      { transform: `translate(${oldRect.x}px, ${oldRect.y}px) scale(${1 / sx}, ${1 / sy})`, opacity: 0 },
      { transform: `translate(${newRect.x}px, ${newRect.y}px) scale(1, 1)`, opacity: 1 },
    ], timing));
  }
  void Promise.all(animations.map(a => a.finished)).then(current.cancel).catch(() => {});
}
