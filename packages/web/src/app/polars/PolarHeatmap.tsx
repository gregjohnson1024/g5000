'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { PolarTable } from '@g5000/db';
import {
  addTwaBin,
  addTwsBin,
  canAddTwaBin,
  canAddTwsBin,
  MIN_BINS,
  removeTwaBin,
  removeTwsBin,
  setCell,
} from '@g5000/compute';

export interface PolarHeatmapProps {
  polar: PolarTable;
  selected?: { twsIdx: number; twaIdx: number };
  onSelect?: (cell: { twsIdx: number; twaIdx: number }) => void;
  /**
   * Called when the user has produced a mutated PolarTable (inline cell edit,
   * row/column add or remove). The parent is expected to PUT this to the
   * server and reload.
   */
  onChange?: (updated: PolarTable) => void | Promise<void>;
}

const MS_TO_KNOTS = 1 / 0.514444;
const KNOTS_TO_MS = 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export function PolarHeatmap({ polar, selected, onSelect, onChange }: PolarHeatmapProps) {
  const [editing, setEditing] = useState<{ twsIdx: number; twaIdx: number } | null>(null);
  const maxBsp = Math.max(1e-6, ...polar.boatSpeed.flat());

  // When the polar shape changes underneath us (e.g. an import or resize), drop any in-flight edit.
  useEffect(() => {
    setEditing(null);
  }, [polar.twsBins.length, polar.twaBins.length]);

  const cellStyle = (v: number): CSSProperties => {
    if (v <= 0) return { backgroundColor: '#1e293b', color: '#e2e8f0' };
    const intensity = Math.min(1, v / maxBsp);
    // Cool teal → bright cyan as speed rises.
    const r = Math.floor(24 + intensity * 80);
    const g = Math.floor(80 + intensity * 150);
    const b = Math.floor(160 + intensity * 60);
    // Switch text colour by perceived luminance so cells stay legible at the bright end.
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const color = luma > 0.55 ? '#0f172a' : '#e2e8f0';
    return { backgroundColor: `rgb(${r},${g},${b})`, color };
  };

  const commitCellEdit = async (
    twsIdx: number,
    twaIdx: number,
    rawKnots: string,
  ): Promise<void> => {
    setEditing(null);
    const parsed = Number(rawKnots);
    if (!Number.isFinite(parsed)) return;
    const newMs = parsed * KNOTS_TO_MS;
    const currentMs = polar.boatSpeed[twsIdx]![twaIdx]!;
    if (Math.abs(newMs - currentMs) < 1e-9) return; // no-op
    if (!onChange) return;
    const updated = setCell(polar, twsIdx, twaIdx, newMs);
    await onChange(updated);
  };

  const handleAddTwa = async (): Promise<void> => {
    if (!onChange) return;
    if (!canAddTwaBin(polar)) {
      alert('Cannot add TWA bin: already at 180°.');
      return;
    }
    await onChange(addTwaBin(polar));
  };

  const handleRemoveTwa = async (twaIdx: number): Promise<void> => {
    if (!onChange) return;
    if (polar.twaBins.length <= MIN_BINS) {
      alert(`Cannot shrink TWA bins below ${MIN_BINS}.`);
      return;
    }
    const deg = (polar.twaBins[twaIdx]! * RAD_TO_DEG).toFixed(0);
    if (!confirm(`Remove TWA ${deg}° bin? This will delete that column.`)) return;
    await onChange(removeTwaBin(polar, twaIdx));
  };

  const handleAddTws = async (): Promise<void> => {
    if (!onChange) return;
    if (!canAddTwsBin(polar)) return;
    await onChange(addTwsBin(polar));
  };

  const handleRemoveTws = async (twsIdx: number): Promise<void> => {
    if (!onChange) return;
    if (polar.twsBins.length <= MIN_BINS) {
      alert(`Cannot shrink TWS bins below ${MIN_BINS}.`);
      return;
    }
    const kn = (polar.twsBins[twsIdx]! * MS_TO_KNOTS).toFixed(0);
    if (!confirm(`Remove TWS ${kn} kn bin? This will delete that row.`)) return;
    await onChange(removeTwsBin(polar, twsIdx));
  };

  const canShrinkTwa = polar.twaBins.length > MIN_BINS && !!onChange;
  const canShrinkTws = polar.twsBins.length > MIN_BINS && !!onChange;
  const canExpandTwa = canAddTwaBin(polar) && !!onChange;
  const canExpandTws = canAddTwsBin(polar) && !!onChange;

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs font-mono">
        <thead>
          <tr>
            <th className="p-1 text-slate-500">TWS \ TWA</th>
            {polar.twaBins.map((twa, i) => (
              <th key={i} className="p-1 text-slate-500 text-right align-bottom">
                <div className="flex flex-col items-end gap-0.5">
                  <span>{(twa * RAD_TO_DEG).toFixed(0)}°</span>
                  {canShrinkTwa && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveTwa(i)}
                      title={`Remove ${(twa * RAD_TO_DEG).toFixed(0)}° column`}
                      className="w-4 h-4 leading-none text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded text-[10px]"
                    >
                      −
                    </button>
                  )}
                </div>
              </th>
            ))}
            {onChange && (
              <th className="p-1 text-slate-500 align-bottom">
                <button
                  type="button"
                  onClick={() => void handleAddTwa()}
                  disabled={!canExpandTwa}
                  title="Add a new TWA bin at the high-angle end"
                  className="w-5 h-5 leading-none rounded bg-slate-800 text-amber-400 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
                >
                  +
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {polar.twsBins.map((tws, twsIdx) => (
            <tr key={twsIdx}>
              <th className="p-1 text-slate-500 text-right pr-2 align-middle">
                <div className="flex items-center justify-end gap-1">
                  {canShrinkTws && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveTws(twsIdx)}
                      title={`Remove ${(tws * MS_TO_KNOTS).toFixed(0)} kn row`}
                      className="w-4 h-4 leading-none text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded text-[10px]"
                    >
                      −
                    </button>
                  )}
                  <span>{(tws * MS_TO_KNOTS).toFixed(0)} kn</span>
                </div>
              </th>
              {polar.twaBins.map((_, twaIdx) => {
                const v = polar.boatSpeed[twsIdx]![twaIdx]!;
                const isSelected = selected?.twsIdx === twsIdx && selected.twaIdx === twaIdx;
                const isEditing = editing?.twsIdx === twsIdx && editing.twaIdx === twaIdx;
                return (
                  <td
                    key={twaIdx}
                    onClick={() => onSelect?.({ twsIdx, twaIdx })}
                    onDoubleClick={() => setEditing({ twsIdx, twaIdx })}
                    style={cellStyle(v)}
                    className={`p-2 cursor-pointer text-right ${
                      isSelected ? 'ring-2 ring-amber-400' : ''
                    }`}
                    title={`TWS ${(tws * MS_TO_KNOTS).toFixed(1)} kn, TWA ${(
                      polar.twaBins[twaIdx]! * RAD_TO_DEG
                    ).toFixed(0)}°, target ${(v * MS_TO_KNOTS).toFixed(2)} kn — double-click to edit`}
                  >
                    {isEditing ? (
                      <CellInput
                        initialKnots={v * MS_TO_KNOTS}
                        onCommit={(rawKn) => commitCellEdit(twsIdx, twaIdx, rawKn)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      (v * MS_TO_KNOTS).toFixed(1)
                    )}
                  </td>
                );
              })}
              {onChange && <td />}
            </tr>
          ))}
          {onChange && (
            <tr>
              <th className="p-1 text-right">
                <button
                  type="button"
                  onClick={() => void handleAddTws()}
                  disabled={!canExpandTws}
                  title="Add a new TWS bin at the high-wind end"
                  className="w-5 h-5 leading-none rounded bg-slate-800 text-amber-400 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
                >
                  +
                </button>
              </th>
              <td colSpan={polar.twaBins.length + 1} />
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-2">
        Boat speed shown in knots. Click to select, double-click to edit. Use{' '}
        <span className="text-amber-400">+</span> / <span className="text-red-400">−</span> to
        add/remove bins.
      </p>
    </div>
  );
}

/**
 * Borderless `<input type=number>` that lives inside a cell. Auto-focuses,
 * selects all on mount, commits on Enter or blur, cancels on Escape.
 */
function CellInput({
  initialKnots,
  onCommit,
  onCancel,
}: {
  initialKnots: number;
  onCommit: (rawKnots: string) => void | Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initialKnots.toFixed(1));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void onCommit(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      type="number"
      step="0.1"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={handleKey}
      onClick={(e) => e.stopPropagation()}
      // Inline borderless look: inherit cell colours, no outline, no spacing.
      className="w-full bg-transparent border-0 outline-none text-right font-mono p-0 m-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      style={{ color: 'inherit' }}
    />
  );
}
