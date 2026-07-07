/**
 * HeatmapGrid — Tier-2 chart primitive.
 *
 * Generic heatmap backed by the canonical ramp module (ramp.ts). Replaces
 * the four unrelated heatmap implementations (PolarHeatmap, CalHeatmap,
 * WindowHeatmap, plus any future ones) with a single intensity-ramp grid.
 *
 * CANONICAL-RAMP LAW: the stops passed here MUST be the same object passed to
 * RampLegend — call buildStops(mode) once at the site and share it.
 *
 * Features:
 *   - sequential or diverging ramp (from ramp.ts)
 *   - tap-inspect replaces title= tooltip (bottom sheet / callback)
 *   - keyboard-accessible (Tab + Enter to select)
 *   - cells are 'use client' safe (no server-side DOM reads needed)
 *
 * Token-only. No raw hex.
 */

'use client';

import { useCallback, useState } from 'react';
import { buildStops, colourForValue, type RampMode, type RampStop } from './ramp';

export interface HeatmapCell {
  /** Row index */
  row: number;
  /** Column index */
  col: number;
  /** The raw value (used for colour lookup) */
  value: number;
  /** Display label inside the cell (e.g. formatted knots) */
  label: string;
}

export interface HeatmapGridProps {
  /** All cells to render */
  cells: HeatmapCell[];
  /** Number of rows */
  rows: number;
  /** Number of columns */
  cols: number;
  /** Row header labels (length === rows) */
  rowLabels?: string[];
  /** Column header labels (length === cols) */
  colLabels?: string[];
  /** Corner label for the row/col intersection header cell */
  cornerLabel?: string;
  /** Ramp mode (default 'sequential') */
  mode?: RampMode;
  /**
   * Pre-built stops. If not provided, buildStops(mode) is called on every
   * render. Pass a memoised result from buildStops() when the RampLegend
   * must share the same stops (canonical-ramp law).
   */
  stops?: readonly RampStop[];
  /**
   * Domain for colour mapping.
   *   sequential: [min, max] of value space
   *   diverging:  maxAbs (symmetric around 0)
   */
  domain: { mode: 'sequential'; min: number; max: number } | { mode: 'diverging'; maxAbs: number };
  /** Called with the selected cell when the user taps/clicks */
  onSelect?: (cell: HeatmapCell) => void;
  /** Currently selected cell ({row, col}) */
  selected?: { row: number; col: number };
  className?: string;
}

/** Perceived luminance helper for text contrast. */
function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Parse rgb(r,g,b) or #rrggbb into [r,g,b] or null. */
function parseColour(colour: string): [number, number, number] | null {
  const hex6 = colour.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex6) {
    return [parseInt(hex6[1]!, 16), parseInt(hex6[2]!, 16), parseInt(hex6[3]!, 16)];
  }
  const rgb = colour.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

/** Choose dark or light ink based on background luminance. */
function contrastInk(bg: string): string {
  const parsed = parseColour(bg);
  if (!parsed) return 'var(--ink-value)';
  const luma = luminance(...parsed);
  return luma > 0.45 ? 'var(--surface-sunken)' : 'var(--ink-value)';
}

export function HeatmapGrid({
  cells,
  rows,
  cols,
  rowLabels,
  colLabels,
  cornerLabel,
  mode = 'sequential',
  stops: stopsProp,
  domain,
  onSelect,
  selected,
  className = '',
}: HeatmapGridProps): React.ReactElement {
  const stops = stopsProp ?? buildStops(mode);
  const [inspected, setInspected] = useState<HeatmapCell | null>(null);

  // Build a fast lookup: Map<`${row}:${col}`, HeatmapCell>
  const cellMap = new Map<string, HeatmapCell>();
  for (const c of cells) cellMap.set(`${c.row}:${c.col}`, c);

  const handleCellClick = useCallback(
    (cell: HeatmapCell) => {
      setInspected(cell);
      onSelect?.(cell);
    },
    [onSelect],
  );

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="border-collapse text-caption font-mono">
        {/* Column headers */}
        {colLabels && (
          <thead>
            <tr>
              <th className="p-1 text-ink-3 text-left font-normal">{cornerLabel ?? ''}</th>
              {colLabels.map((lbl, c) => (
                <th key={c} className="p-1 text-ink-3 text-right font-normal">
                  {lbl}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {/* Row header */}
              {rowLabels && (
                <th className="p-1 text-ink-3 text-right font-normal pr-2">{rowLabels[r]}</th>
              )}
              {/* Data cells */}
              {Array.from({ length: cols }, (_, c) => {
                const cell = cellMap.get(`${r}:${c}`);
                if (!cell) {
                  return (
                    <td key={c} className="p-2 text-center text-ink-4">
                      —
                    </td>
                  );
                }
                const bg = colourForValue(cell.value, stops, domain);
                const ink = contrastInk(bg);
                const isSelected = selected?.row === r && selected.col === c;
                const isInspected = inspected?.row === r && inspected.col === c;
                return (
                  <td
                    key={c}
                    onClick={() => handleCellClick(cell)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleCellClick(cell);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Row ${r}, Col ${c}: ${cell.label}`}
                    aria-pressed={isSelected}
                    style={{ backgroundColor: bg, color: ink }}
                    className={[
                      'p-2 cursor-pointer text-right tabular-nums transition-opacity',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]',
                      isSelected ? 'ring-2 ring-[--accent-ink] ring-inset' : '',
                      isInspected && !isSelected ? 'opacity-80' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {cell.label}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Tap-inspect tooltip (replaces title= which dies on mobile) */}
      {inspected && (
        <div className="mt-2 flex items-center gap-2 text-caption text-ink-2">
          <span className="font-mono">{inspected.label}</span>
          <span className="text-ink-3">
            row {inspected.row} · col {inspected.col}
          </span>
          <button
            type="button"
            onClick={() => setInspected(null)}
            className="ml-auto text-ink-3 hover:text-ink px-1.5 py-0.5 rounded-[--r-control]"
            aria-label="Dismiss inspect"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
