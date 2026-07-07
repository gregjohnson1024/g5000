/**
 * SaveBar — Tier-1 primitive.
 *
 * Sticky dirty-count bar. Appears when isDirty, sticks to the bottom of the
 * viewport. Shows the count of dirty fields, a Save button, and a Discard button.
 * Transport-agnostic: calls the supplied onSave callback.
 *
 * Paired with use-dirty-save; use them together for all staged config forms.
 *
 * Keep-list: /damping dirty-tracked save — this generalises that UX verbatim.
 * Token-only. No raw hex.
 */

'use client';

export interface SaveBarProps {
  /** Number of dirty (changed) fields */
  dirtyCount: number;
  /** Whether a save is in progress */
  busy: boolean;
  /** Whether the bar is visible (isDirty from use-dirty-save) */
  visible: boolean;
  /** Error message from the last save, or null */
  err: string | null;
  /** Whether the last save succeeded */
  ok: boolean;
  /** Trigger save */
  onSave: () => void;
  /** Discard changes (reset to committed state) */
  onDiscard: () => void;
  /** Additional children slot (e.g. extra buttons like "Apply suggested defaults") */
  children?: React.ReactNode;
  className?: string;
}

export function SaveBar({
  dirtyCount,
  busy,
  visible,
  err,
  ok,
  onSave,
  onDiscard,
  children,
  className = '',
}: SaveBarProps): React.ReactElement | null {
  if (!visible && !err && !ok) return null;

  return (
    <div
      className={[
        'sticky bottom-0 z-20 flex items-center gap-3 flex-wrap',
        'bg-surface-raised border-t border-hairline px-4 py-3',
        'shadow-[0_-4px_16px_rgb(0_0_0_/_0.4)]',
        className,
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      {/* Dirty count badge */}
      {dirtyCount > 0 && (
        <span className="text-body-sm text-ink-2">
          <span className="font-mono tabular-nums text-accent-ink mr-1">{dirtyCount}</span>
          {dirtyCount === 1 ? 'change' : 'changes'} unsaved
        </span>
      )}

      {/* Status messages */}
      {err && (
        <span className="text-body-sm text-danger flex-1" aria-live="assertive">
          {err}
        </span>
      )}
      {ok && !err && <span className="text-body-sm text-ok flex-1">Saved.</span>}

      <div className="flex items-center gap-2 ml-auto">
        {/* Extra slot */}
        {children}

        {/* Discard */}
        {dirtyCount > 0 && (
          <button
            type="button"
            onClick={onDiscard}
            disabled={busy}
            className="px-3 py-1.5 text-body-sm rounded-[--r-control] border border-hairline text-ink-2 hover:text-ink hover:border-hairline-strong disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Discard
          </button>
        )}

        {/* Save */}
        <button
          type="button"
          onClick={onSave}
          disabled={busy || dirtyCount === 0}
          className="px-4 py-1.5 text-body-sm font-medium rounded-[--r-control] bg-accent text-on-accent hover:bg-[--accent-hi] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
