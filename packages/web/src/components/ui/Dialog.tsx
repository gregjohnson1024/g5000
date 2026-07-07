'use client';
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { HoldButton } from './HoldButton';

/**
 * Dialog — focus-trapped modal dialog.
 *
 * Contract:
 *   - role=dialog + aria-modal=true + aria-labelledby pointing at the title.
 *   - Focus trap: Tab cycles only within the dialog; Shift+Tab reverses.
 *   - Escape closes (calls onClose).
 *   - Background scrim (--scrim) dismisses on click.
 *   - Restores focus to the previously-focused element on close.
 *   - Elevation: e3 (--surface-raised + --hairline-strong + shadow + scrim).
 *   - Radius: --r-panel.
 *   - Tokens only — no raw hex.
 *
 * Props:
 *   open     — controls visibility
 *   onClose  — called on Escape / scrim click
 *   title    — dialog heading (required; used as aria-labelledby target)
 *   children — dialog body
 *   actions  — footer action buttons (rendered in a flex row, end-aligned)
 *   maxWidth — optional extra max-width class (default 'max-w-md')
 */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  maxWidth?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  maxWidth = 'max-w-md',
}: DialogProps): React.ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`dialog-title-${Math.random().toString(36).slice(2)}`);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Save previously-focused element and restore on close
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement | null;
      // Move focus into the dialog on the next paint
      const frame = requestAnimationFrame(() => {
        const el = dialogRef.current;
        if (!el) return;
        const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length > 0) {
          focusable[0]!.focus();
        } else {
          el.focus();
        }
      });
      return () => cancelAnimationFrame(frame);
    } else {
      previousFocus.current?.focus();
    }
  }, [open]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;

    const el = dialogRef.current;
    if (!el) return;
    const focusable = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const handleScrimClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!open) return null;

  return (
    // Scrim — e3 backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--scrim)' }}
      onClick={handleScrimClick}
    >
      {/* Dialog panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={[
          // e3: surface-raised bg + hairline-strong border + shadow
          'bg-surface-raised border border-hairline-strong',
          'shadow-[0_8px_24px_rgb(0_0_0_/_0.55)]',
          '[border-radius:var(--r-panel)]',
          'w-full',
          maxWidth,
          'flex flex-col gap-0',
          'focus:outline-none',
        ].join(' ')}
      >
        {/* Title bar */}
        <div className="px-4 pt-4 pb-3 border-b border-hairline">
          <h2
            id={titleId.current}
            className="text-[1.111rem] font-semibold leading-snug text-ink-value"
          >
            {title}
          </h2>
        </div>

        {/* Body */}
        {children && (
          <div className="px-4 py-4 text-[1rem] text-ink leading-relaxed">{children}</div>
        )}

        {/* Actions footer */}
        {actions && (
          <div className="px-4 pb-4 pt-2 flex items-center justify-end gap-3">{actions}</div>
        )}
      </div>
    </div>
  );
}

/**
 * ConfirmDialog — a Dialog pre-wired for destructive-action confirmation.
 *
 * Contract:
 *   - Always names the record in the message ("Delete waypoint BR-4?" — never by id).
 *   - danger variant colors the confirm button red.
 *   - When hold=true, the Confirm button is a HoldButton (for truly irreversible actions).
 *   - Cancel is always a secondary Button and always calls onClose.
 *   - Escape / scrim click → onClose (no confirmation).
 *
 * Props:
 *   open          — controls visibility
 *   onClose       — called on cancel / Escape / scrim
 *   onConfirm     — fired on confirmation (must close the dialog itself if needed)
 *   title         — dialog title, e.g. "Delete waypoint?"
 *   message       — body text — MUST name the record, e.g. "Delete waypoint BR-4? …"
 *   confirmLabel  — confirm button text (default "Confirm")
 *   hold          — when true, Confirm is a HoldButton (800 ms default)
 *   holdMs        — override hold duration (600–1500 ms)
 */
export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  hold?: boolean;
  holdMs?: number;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  hold = false,
  holdMs = 800,
}: ConfirmDialogProps): React.ReactElement | null {
  const actions = (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      {hold ? (
        <HoldButton
          holdMs={holdMs}
          onHold={onConfirm}
          confirmedLabel={`${confirmLabel} ✓`}
          fillColor="bg-danger-strong"
          className="min-h-[44px] px-4 py-2 text-[0.833rem] font-semibold bg-danger-surface border border-danger-strong text-danger hover:opacity-90"
        >
          {confirmLabel}
        </HoldButton>
      ) : (
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      )}
    </>
  );

  return (
    <Dialog open={open} onClose={onClose} title={title} actions={actions}>
      <p className="text-ink">{message}</p>
    </Dialog>
  );
}
