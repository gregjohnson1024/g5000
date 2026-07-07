'use client';

import type { ReactNode } from 'react';

/**
 * SegmentedControl — one implementation replacing HelmTabs + TzToggle + every
 * dialect across the app.
 *
 * Accessibility:
 *   - role="group" on the wrapper with aria-label
 *   - Each segment: role="radio" + aria-pressed={active} + aria-checked={active}
 *   - Keyboard: Tab moves between segments; selected segment is focusable.
 *
 * Selected state:
 *   DAY / SUN — accent fill (bg-accent, text-on-accent)
 *   NIGHT      — red outline (border-accent text-accent bg-accent-dim-bg)
 *   Both use the same token set; the theme switch handles the colour swap.
 *   No component branches on theme — tokens do the work.
 *
 * Sizes:
 *   md — min-height 44px (default; glance surfaces)
 *   sm — min-height 36px (work surfaces + pointer:fine)
 *
 * The container is bg-surface-sunken with border-hairline and r-control radius.
 * Tokens only — no raw hex, no slate-/rose-/emerald- classes.
 */

export type SegmentedControlSize = 'md' | 'sm';

export interface Segment<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Optional accessible label when label is not a plain string. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. Required. */
  'aria-label': string;
  size?: SegmentedControlSize;
  className?: string;
}

const SIZE_CLASSES: Record<SegmentedControlSize, string> = {
  md: 'min-h-[44px] px-3 py-2 text-[0.833rem]',
  sm: 'min-h-[36px] px-2 py-1.5 text-[0.722rem]',
};

export function SegmentedControl<T extends string = string>({
  segments,
  value,
  onChange,
  'aria-label': ariaLabel,
  size = 'md',
  className,
}: SegmentedControlProps<T>): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={[
        'inline-flex',
        'bg-surface-sunken border border-hairline',
        '[border-radius:var(--r-control)]',
        'p-0.5 gap-0.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {segments.map((seg) => {
        const active = seg.value === value;
        return (
          <button
            key={seg.value}
            type="button"
            role="radio"
            aria-pressed={active}
            aria-checked={active}
            aria-label={typeof seg.label === 'string' ? seg.label : seg.ariaLabel}
            onClick={() => onChange(seg.value)}
            className={[
              'flex-1 font-semibold leading-none uppercase tracking-wide',
              'transition-colors duration-150',
              '[border-radius:calc(var(--r-control)-2px)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-sunken)]',
              SIZE_CLASSES[size],
              active
                ? 'bg-accent text-on-accent border border-accent'
                : 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-raised hover:text-ink',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
