'use client';
import { useCallback, useLayoutEffect, useRef } from 'react';
import type { FormattedTile } from './format';

/**
 * Tile — mast-display number cell.
 *
 * Uses app theme tokens for colors so the display re-themes with data-theme.
 * When .mast-night is active, the CSS overrides collapse all tokens to red —
 * the JS here never needs to know about night mode.
 *
 * The JS ResizeObserver fit drives ONLY the numeral fontSize via inline style.
 * It is completely independent of --instrument-scale (mast tiles fill their
 * container physically; --instrument-scale applies to UI InstrumentTile only).
 */

/**
 * Maps FormattedTile color to app theme tokens.
 *   green   → --ok        (ok / emerald)
 *   amber   → --accent-ink (selected / amber)
 *   red     → --danger    (danger / rose)
 *   default → --ink-value (default numeral colour)
 * In mast-night mode the CSS collapses all of these to the same red, so the
 * mapping is purely a day/sun/day-UI concern.
 */
const COLOR_VAR: Record<FormattedTile['color'], string> = {
  green: 'var(--ok)',
  amber: 'var(--accent-ink)',
  red: 'var(--danger)',
  default: 'var(--ink-value)',
};

/** Number fills ~82% of cell width, capped at ~60% of cell height (room for label/units). */
const FILL_W = 0.82;
const FILL_H = 0.6;

export function Tile({ label, units, fmt }: { label: string; units: string; fmt: FormattedTile }) {
  const cellRef = useRef<HTMLDivElement>(null);
  const valRef = useRef<HTMLSpanElement>(null);
  const lastLenRef = useRef(-1);

  // Scale the number to fill the cell (width-bound in tall cells, height-bound in wide ones).
  const fit = useCallback(() => {
    const cell = cellRef.current;
    const val = valRef.current;
    if (!cell || !val) return;
    val.style.fontSize = '100px';
    const tw = val.scrollWidth || 1;
    const th = val.scrollHeight || 1;
    const s = Math.min((cell.clientWidth * FILL_W) / tw, (cell.clientHeight * FILL_H) / th);
    val.style.fontSize = `${Math.max(8, Math.floor(100 * s))}px`;
  }, []);

  // Re-fit on cell resize (layout/orientation changes).
  useLayoutEffect(() => {
    const cell = cellRef.current;
    if (!cell) return;
    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(cell);
    return () => ro.disconnect();
  }, [fit]);

  // Re-fit only when the digit count changes, so the size is stable under live data.
  useLayoutEffect(() => {
    if (fmt.text.length !== lastLenRef.current) {
      lastLenRef.current = fmt.text.length;
      fit();
    }
  }, [fmt.text, fit]);

  return (
    <div
      ref={cellRef}
      className="mast-tile flex flex-col items-center justify-center h-full w-full"
    >
      <div className="mast-tile-label uppercase tracking-widest">{label}</div>
      <span
        ref={valRef}
        className={`mast-tile-value font-bold leading-none tabular-nums${fmt.stale ? ' mast-stale' : ''}`}
        style={{ color: fmt.stale ? undefined : COLOR_VAR[fmt.color] }}
      >
        {fmt.text}
      </span>
      <div className="mast-tile-units">{units}</div>
    </div>
  );
}
