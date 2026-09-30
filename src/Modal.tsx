import React, { useLayoutEffect, useRef } from 'react';
import { Icon } from './Icon';

type Props = { open: boolean; onClose: () => void; title: string; id: string; motion: string; kind?: 'sheet' | 'dialog'; children: React.ReactNode };

/** Native focus/inert semantics, with a cancellable entrance and exit. */
export function Modal({ open, onClose, title, id, motion, kind = 'sheet', children }: Props) {
  const ref = useRef<HTMLDialogElement>(null), generation = useRef(0), returnFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const token = ++generation.current;
    const previous = { opacity: getComputedStyle(dialog).opacity, transform: getComputedStyle(dialog).transform };
    dialog.getAnimations().forEach(animation => animation.cancel());
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fullMotion = motion !== 'gentle' && !reduced;
    if (open) {
      const alreadyOpen = dialog.open;
      if (!alreadyOpen) { returnFocus.current = document.activeElement as HTMLElement; dialog.showModal(); }
      delete dialog.dataset.closing;
      if (!reduced) dialog.animate([
        alreadyOpen ? previous : { opacity: 0, transform: fullMotion ? `translate${kind === 'sheet' ? 'X' : 'Y'}(${kind === 'sheet' ? '28' : '10'}px)` : 'none' },
        { opacity: 1, transform: 'none' },
      ], { duration: fullMotion ? 280 : 120, easing: 'cubic-bezier(.22,1,.36,1)' });
    } else if (dialog.open) {
      dialog.dataset.closing = 'true';
      const finish = () => {
        if (generation.current !== token) return;
        dialog.close(); delete dialog.dataset.closing;
        const previousFocus = returnFocus.current;
        if (previousFocus?.isConnected && !previousFocus.closest('[hidden]') && !document.querySelector('dialog[open]')) previousFocus.focus({ preventScroll: true });
      };
      if (reduced) finish();
      else {
        const exit = dialog.animate([previous, { opacity: 0, transform: fullMotion ? `translate${kind === 'sheet' ? 'X' : 'Y'}(${kind === 'sheet' ? '20' : '8'}px)` : 'none' }], { duration: fullMotion ? 180 : 100, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
        void exit.finished.then(finish, () => {});
      }
    }
  }, [open, motion, kind]);

  // Do not cancel in the dependency cleanup: the next transition must read the
  // in-flight pixels first. Only disposal cancels without a replacement.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => { generation.current++; dialog?.getAnimations().forEach(animation => animation.cancel()); };
  }, []);

  return <dialog ref={ref} className={`modal ${kind}`} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className="modal-heading"><div><p className="eyebrow">ON THE SPOT</p><h2 id={`${id}-title`}>{title}</h2></div><button className="icon-button" aria-label={`Close ${kind === 'sheet' ? 'settings' : 'dialog'}`} onClick={onClose} autoFocus><Icon name="close"/></button></div>
    <div className="modal-body">{children}</div>
  </dialog>;
}
