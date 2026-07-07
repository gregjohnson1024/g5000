'use client';

import type { ReactNode } from 'react';
import { StalenessShroud } from './StalenessShroud';

/**
 * InstrumentTile — the canonical instrument readout cell.
 *
 * Extracted from sail/HelmTile.tsx with a drop-in-compatible API surface,
 * grown with:
 *   - Display sizes d1–d4 (proposal §4.3 typography tiers)
 *   - Built-in StalenessShroud (pass tMs to enable)
 *   - Severity left-edge (3px coloured bar — proposal §5 / D3 graft)
 *   - Severity map retokenized to text-ok / text-accent / text-danger / text-ink-value
 *   - Slot-stable: reserves space and renders '—' when value is absent/undefined
 *
 * Size → CSS class mapping (Plex Mono w600, 0.4× unit at --ink-3):
 *   d1  4.5rem  Race timer, mast hero
 *   d2  3.5rem  Helm core strip (matches old text-6xl)
 *   d3  2.25rem Secondary tiles (matches old text-4xl / small=true)
 *   d4  1.5rem  Panel hero values
 *
 * Severity colour map (token-only, no raw hex):
 *   good    → text-ok        (emerald / ok token)
 *   ok      → text-accent-ink (amber / selected)
 *   bad     → text-danger    (red / danger token)
 *   neutral → text-ink-value (default numeral colour)
 *
 * API compatibility with HelmTile:
 *   label / value / unit / severity / sub / small / children
 *   `small` maps to size='d3' when size is not explicitly set, preserving
 *   backward-compatible rendering in existing CoreStrip + groups.
 *
 * Tokens only — no raw hex, no slate-/emerald-/rose- color classes.
 */

export type InstrumentSize = 'd1' | 'd2' | 'd3' | 'd4';
export type InstrumentSeverity = 'good' | 'ok' | 'bad' | 'neutral';

export interface InstrumentTileProps {
  /** Label rendered in the label voice (uppercase, ink-2). */
  label: string;
  /**
   * Formatted value string. When undefined or null, renders '—' in a
   * reserved slot (slot-stable — the tile never collapses).
   */
  value?: string | null;
  /** Unit suffix rendered at 0.4× size in text-ink-3. */
  unit?: string;
  /** Display size tier (default 'd2' — matches original HelmTile text-6xl). */
  size?: InstrumentSize;
  /**
   * Backward-compat shim: when true, forces size='d3' if size is not set.
   * Mirrors HelmTile's `small` prop so existing CoreStrip callers still work.
   */
  small?: boolean;
  /**
   * Optional severity for colour-coding the value.
   *   good    → text-ok        (green / ok token)
   *   ok      → text-accent-ink (amber)
   *   bad     → text-danger    (red)
   *   neutral → text-ink-value (default)
   */
  severity?: InstrumentSeverity;
  /** Optional sub-label shown beside the main label (e.g. 'target'). */
  sub?: string;
  /**
   * Unix-ms timestamp of the last live sample (sample.t_ms).
   * When provided, enables the built-in StalenessShroud which computes age
   * internally so it advances correctly even when the parent is frozen:
   *   <2s fresh / 2-10s aging (dim) / >10s stale (hollow + age chip).
   * When omitted, the value is rendered without any staleness styling.
   */
  tMs?: number;
  /** Extra content rendered below the value (e.g. tiny derived labels). */
  children?: ReactNode;
}

// --- internal helpers -------------------------------------------------------

const SIZE_CLASS: Record<InstrumentSize, string> = {
  d1: 'text-[4.5rem] leading-none font-semibold font-mono',
  d2: 'text-[3.5rem] leading-none font-semibold font-mono',
  d3: 'text-[2.25rem] leading-none font-semibold font-mono',
  d4: 'text-[1.5rem] leading-none font-semibold font-mono',
};

const UNIT_SIZE_CLASS: Record<InstrumentSize, string> = {
  d1: 'text-[1.8rem]', // ~0.4× of 4.5rem
  d2: 'text-[1.4rem]', // ~0.4× of 3.5rem
  d3: 'text-[0.9rem]', // ~0.4× of 2.25rem
  d4: 'text-[0.6rem]', // ~0.4× of 1.5rem
};

const SEVERITY_TEXT: Record<InstrumentSeverity, string> = {
  good: 'text-ok',
  ok: 'text-accent-ink',
  bad: 'text-danger',
  neutral: 'text-ink-value',
};

/** The 3px left severity edge (proposal §5 D3 graft). */
const SEVERITY_EDGE: Record<InstrumentSeverity, string> = {
  good: 'border-l-[3px] border-ok',
  ok: 'border-l-[3px] border-accent-ink',
  bad: 'border-l-[3px] border-danger',
  neutral: '',
};

// ---------------------------------------------------------------------------

export function InstrumentTile({
  label,
  value,
  unit,
  size: sizeProp,
  small,
  severity = 'neutral',
  sub,
  tMs,
  children,
}: InstrumentTileProps): React.ReactElement {
  // Resolve effective size: explicit size → small shim → default d2
  const size: InstrumentSize = sizeProp ?? (small ? 'd3' : 'd2');

  const valueClass = [SIZE_CLASS[size], SEVERITY_TEXT[severity]].join(' ');
  const unitClass = [UNIT_SIZE_CLASS[size], 'text-ink-3 ml-1'].join(' ');

  const edgeClass = SEVERITY_EDGE[severity];

  // Value node — rendered inside StalenessShroud when tMs is provided
  const valueContent =
    value != null ? (
      <>
        {value}
        {unit && <span className={unitClass}>{unit}</span>}
      </>
    ) : null;

  return (
    <div
      className={[
        'bg-surface border border-hairline [border-radius:var(--r-panel)]',
        'p-3 flex flex-col gap-1 min-w-0',
        edgeClass,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Label row */}
      <div className="text-[0.667rem] font-semibold uppercase tracking-[0.08em] text-ink-2 flex items-baseline gap-2 leading-none">
        <span>{label}</span>
        {sub && <span className="text-ink-4 text-[0.611rem] normal-case font-normal">({sub})</span>}
      </div>

      {/* Value — with or without StalenessShroud */}
      {tMs !== undefined ? (
        <StalenessShroud t_ms={value != null ? tMs : undefined} className={valueClass}>
          {valueContent}
        </StalenessShroud>
      ) : (
        <span
          className={['tabular-nums', valueClass, value == null ? 'text-ink-4' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {value != null ? valueContent : '—'}
        </span>
      )}

      {/* Optional children (sub-readouts, source labels, etc.) */}
      {children}
    </div>
  );
}
