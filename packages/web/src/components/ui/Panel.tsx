import type { ReactNode } from 'react';
import type { StatusChipKind } from './status-chip-kind';
import { StatusChip } from './StatusChip';

/**
 * Panel — the canonical card grammar extracted from the anchor DepthPanel
 * and codified as the app-wide surface primitive.
 *
 * Variants:
 *   default — bg-surface + border-hairline
 *   hero    — same structure, intended for large-value panels
 *   alarm   — bg-danger-surface + border-danger-strong + tinted header
 *
 * Slots:
 *   label   — required header label (rendered in label voice: uppercase, ink-2)
 *   chip    — optional StatusChip kind + text shown after the label
 *   action  — optional 44px-hit action element in the header trailing edge
 *   children — panel body
 *   footer  — optional footer row (e.g. sub-value, source, timestamp)
 *   emptyState — when provided and children is absent, renders the empty slot
 *                with '—' and the reason text.
 *
 * Radius: --r-panel via [border-radius:var(--r-panel)].
 * Tokens only — no raw hex, no slate-/rose-/emerald- classes.
 */
export type PanelVariant = 'default' | 'hero' | 'alarm';

export interface PanelEmptyState {
  reason?: string;
}

export function Panel({
  label,
  chip,
  chipLabel,
  action,
  variant = 'default',
  emptyState,
  footer,
  className,
  children,
}: {
  label: string;
  chip?: StatusChipKind;
  chipLabel?: string;
  action?: ReactNode;
  variant?: PanelVariant;
  emptyState?: PanelEmptyState;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}): React.ReactElement {
  const isAlarm = variant === 'alarm';

  const wrapperClasses = [
    '[border-radius:var(--r-panel)]',
    'border',
    isAlarm ? 'bg-danger-surface border-danger-strong' : 'bg-surface border-hairline',
    'flex flex-col',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const headerClasses = [
    'flex items-center gap-2 px-3 pt-3 pb-2',
    isAlarm ? 'border-b border-danger-strong' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      {/* Header */}
      <div className={headerClasses}>
        <span className="text-[0.667rem] font-semibold uppercase tracking-[0.08em] text-ink-2 flex-1">
          {label}
        </span>
        {chip && chipLabel && <StatusChip kind={chip} label={chipLabel} />}
        {action && <div className="flex-shrink-0 min-w-[44px] flex items-center">{action}</div>}
      </div>

      {/* Body */}
      <div className="flex-1 px-3 pb-3">
        {children ?? (
          /* Built-in empty state — reserved slot so the panel never collapses */
          <div className="flex flex-col items-center justify-center min-h-[48px] gap-1">
            <span className="text-ink-4 text-lg font-medium tabular-nums select-none">—</span>
            {emptyState?.reason && (
              <span className="text-[0.722rem] text-ink-4 italic">{emptyState.reason}</span>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {footer && (
        <div className="px-3 pb-2 border-t border-hairline pt-2 text-[0.722rem] text-ink-3">
          {footer}
        </div>
      )}
    </div>
  );
}
