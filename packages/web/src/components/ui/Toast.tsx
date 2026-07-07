'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Toast — transient bottom-center notification.
 *
 * IMPORTANT: Toast is for WORK surfaces only (forms, settings, data entry).
 * NEVER render a Toast on a GLANCE surface (helm, race, autopilot, anchor,
 * mast, chart chrome) — it may cover a live numeral. On glance surfaces,
 * acknowledgements must go to the AppBar MsgLine.
 *
 * Kinds:
 *   ok    — green-tinted (operation succeeded)
 *   alarm — danger-tinted (operation failed / critical notice)
 *   info  — info-tinted (neutral notice)
 *
 * Props:
 *   open         — controls visibility
 *   kind         — 'ok' | 'alarm' | 'info' (default 'info')
 *   message      — primary text
 *   action       — optional action slot (e.g. an undo Button)
 *   duration     — auto-dismiss after this many ms (default 4000; 0 = no auto-dismiss)
 *   onDismiss    — called on auto-dismiss, swipe, or manual close
 *
 * Tokens only — no raw hex, no slate-/rose-/emerald- classes.
 */
export type ToastKind = 'ok' | 'alarm' | 'info';

export interface ToastProps {
  open: boolean;
  kind?: ToastKind;
  message: ReactNode;
  action?: ReactNode;
  duration?: number;
  onDismiss?: () => void;
}

const KIND_CLASSES: Record<ToastKind, string> = {
  ok: 'bg-surface-raised border-ok text-ok',
  alarm: 'bg-danger-surface border-danger text-danger',
  info: 'bg-surface-raised border-info text-info',
};

export function Toast({
  open,
  kind = 'info',
  message,
  action,
  duration = 4000,
  onDismiss,
}: ToastProps): React.ReactElement | null {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || duration === 0) return;
    timerRef.current = setTimeout(() => {
      onDismiss?.();
    }, duration);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [open, duration, onDismiss]);

  if (!open) return null;

  return (
    // Fixed bottom-center, above other content (z-40 — below Dialogs at z-50)
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={[
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-40',
        'flex items-center gap-3',
        'px-4 py-3',
        'border',
        '[border-radius:var(--r-panel)]',
        'shadow-[0_8px_24px_rgb(0_0_0_/_0.55)]',
        'min-w-[240px] max-w-[480px]',
        'text-[0.833rem] font-medium',
        KIND_CLASSES[kind],
      ].join(' ')}
    >
      <span className="flex-1">{message}</span>
      {action && <span className="flex-shrink-0">{action}</span>}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className={[
          'flex-shrink-0 size-[32px] flex items-center justify-center',
          '[border-radius:var(--r-control)]',
          'hover:bg-surface opacity-70 hover:opacity-100 transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]',
        ].join(' ')}
      >
        {/* Lucide X — inline SVG to avoid an extra import */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
