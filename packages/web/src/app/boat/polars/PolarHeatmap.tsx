'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PolarTable } from '@g5000/db';
import {
  addTwaBin,
  addTwsBin,
  canAddTwaBin,
  canAddTwsBin,
  interpolatePolarSpeed,
  MIN_BINS,
  optimalTwaForVmg,
  removeTwaBin,
  removeTwsBin,
  setCell,
  vmgFor,
} from '@g5000/compute';
import { ConfirmDialog, Dialog, Button } from '../../../components/ui';
import { HeatmapGrid, type HeatmapCell } from '../../../components/charts/HeatmapGrid';
import { RampLegend } from '../../../components/charts/RampLegend';
import { buildStops } from '../../../components/charts/ramp';

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

/** Dialog state discriminated union for the three alert/confirm cases. */
type DialogState =
  | { kind: 'none' }
  | { kind: 'alert'; message: string }
  | { kind: 'confirm-remove-twa'; twaIdx: number; deg: string }
  | { kind: 'confirm-remove-tws'; twsIdx: number; kn: string }
  | { kind: 'edit-cell'; twsIdx: number; twaIdx: number };

export function PolarHeatmap({ polar, selected, onSelect, onChange }: PolarHeatmapProps) {
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const maxBsp = Math.max(1e-6, ...polar.boatSpeed.flat());

  // Canonical ramp — shared between HeatmapGrid and RampLegend (canonical-ramp law).
  const stops = useMemo(() => buildStops('sequential'), []);

  const domain = useMemo(
    () => ({ mode: 'sequential' as const, min: 0, max: maxBsp * MS_TO_KNOTS }),
    [maxBsp],
  );

  // When the polar shape changes (e.g. import or resize), dismiss any open dialog.
  useEffect(() => {
    setDialog({ kind: 'none' });
  }, [polar.twsBins.length, polar.twaBins.length]);

  // Build HeatmapCell array from the polar table.
  const cells: HeatmapCell[] = useMemo(() => {
    const out: HeatmapCell[] = [];
    for (let r = 0; r < polar.twsBins.length; r++) {
      for (let c = 0; c < polar.twaBins.length; c++) {
        const ms = polar.boatSpeed[r]![c]!;
        const kn = ms * MS_TO_KNOTS;
        out.push({ row: r, col: c, value: kn, label: kn.toFixed(1) });
      }
    }
    return out;
  }, [polar]);

  const rowLabels = useMemo(
    () => polar.twsBins.map((tws) => `${(tws * MS_TO_KNOTS).toFixed(0)} kn`),
    [polar.twsBins],
  );
  const colLabels = useMemo(
    () => polar.twaBins.map((twa) => `${(twa * RAD_TO_DEG).toFixed(0)}°`),
    [polar.twaBins],
  );

  const heatmapSelected = selected ? { row: selected.twsIdx, col: selected.twaIdx } : undefined;

  // ---------------------------------------------------------------------------
  // Bin add / remove handlers
  // ---------------------------------------------------------------------------

  const handleAddTwa = async (): Promise<void> => {
    if (!onChange) return;
    if (!canAddTwaBin(polar)) {
      setDialog({ kind: 'alert', message: 'Cannot add TWA bin: already at 180°.' });
      return;
    }
    await onChange(addTwaBin(polar));
  };

  const handleRemoveTwa = (twaIdx: number): void => {
    if (!onChange) return;
    if (polar.twaBins.length <= MIN_BINS) {
      setDialog({
        kind: 'alert',
        message: `Cannot shrink TWA bins below ${MIN_BINS}.`,
      });
      return;
    }
    const deg = (polar.twaBins[twaIdx]! * RAD_TO_DEG).toFixed(0);
    setDialog({ kind: 'confirm-remove-twa', twaIdx, deg });
  };

  const handleAddTws = async (): Promise<void> => {
    if (!onChange) return;
    if (!canAddTwsBin(polar)) return;
    await onChange(addTwsBin(polar));
  };

  const handleRemoveTws = (twsIdx: number): void => {
    if (!onChange) return;
    if (polar.twsBins.length <= MIN_BINS) {
      setDialog({
        kind: 'alert',
        message: `Cannot shrink TWS bins below ${MIN_BINS}.`,
      });
      return;
    }
    const kn = (polar.twsBins[twsIdx]! * MS_TO_KNOTS).toFixed(0);
    setDialog({ kind: 'confirm-remove-tws', twsIdx, kn });
  };

  // ---------------------------------------------------------------------------
  // Cell edit
  // ---------------------------------------------------------------------------

  const commitCellEdit = async (twsIdx: number, twaIdx: number, rawKnots: string): Promise<void> => {
    setDialog({ kind: 'none' });
    const parsed = Number(rawKnots);
    if (!Number.isFinite(parsed)) return;
    const newMs = parsed * KNOTS_TO_MS;
    const currentMs = polar.boatSpeed[twsIdx]![twaIdx]!;
    if (Math.abs(newMs - currentMs) < 1e-9) return;
    if (!onChange) return;
    const updated = setCell(polar, twsIdx, twaIdx, newMs);
    await onChange(updated);
  };

  const canShrinkTwa = polar.twaBins.length > MIN_BINS && !!onChange;
  const canShrinkTws = polar.twsBins.length > MIN_BINS && !!onChange;
  const canExpandTwa = canAddTwaBin(polar) && !!onChange;
  const canExpandTws = canAddTwsBin(polar) && !!onChange;

  return (
    <div className="space-y-3">
      {/* Heatmap grid via canonical primitive */}
      <HeatmapGrid
        cells={cells}
        rows={polar.twsBins.length}
        cols={polar.twaBins.length}
        rowLabels={rowLabels}
        colLabels={colLabels}
        cornerLabel="TWS \ TWA"
        stops={stops}
        domain={domain}
        selected={heatmapSelected}
        onSelect={(cell) => onSelect?.({ twsIdx: cell.row, twaIdx: cell.col })}
      />

      {/* Ramp legend — derives from the same stops (canonical-ramp law) */}
      <RampLegend stops={stops} domain={domain} unit="kn (boat speed)" className="max-w-xs" />

      {/* Bin management controls */}
      {onChange && (
        <div className="flex flex-wrap gap-2 items-center">
          {/* TWA column controls */}
          <span className="text-caption text-ink-3 uppercase tracking-wide">TWA cols:</span>
          {canShrinkTwa && (
            <div className="flex gap-1 flex-wrap">
              {polar.twaBins.map((twa, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemoveTwa(i)}
                  aria-label={`Remove ${(twa * RAD_TO_DEG).toFixed(0)}° column`}
                  className="text-danger border-danger-strong text-caption px-2 py-0.5"
                >
                  −{(twa * RAD_TO_DEG).toFixed(0)}°
                </Button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleAddTwa()}
            disabled={!canExpandTwa}
            aria-label="Add TWA bin at the high-angle end"
          >
            + TWA
          </Button>

          <span className="text-caption text-ink-3 uppercase tracking-wide ml-2">TWS rows:</span>
          {canShrinkTws && (
            <div className="flex gap-1 flex-wrap">
              {polar.twsBins.map((tws, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemoveTws(i)}
                  aria-label={`Remove ${(tws * MS_TO_KNOTS).toFixed(0)} kn row`}
                  className="text-danger border-danger-strong text-caption px-2 py-0.5"
                >
                  −{(tws * MS_TO_KNOTS).toFixed(0)} kn
                </Button>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleAddTws()}
            disabled={!canExpandTws}
            aria-label="Add TWS bin at the high-wind end"
          >
            + TWS
          </Button>

          {/* Explicit edit affordance — replaces double-click */}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (selected) {
                setDialog({ kind: 'edit-cell', twsIdx: selected.twsIdx, twaIdx: selected.twaIdx });
              }
            }}
            disabled={!selected}
            aria-label="Edit selected cell value"
          >
            Edit cell
          </Button>
        </div>
      )}

      {/* Computed target rows */}
      <div className="overflow-x-auto">
        <table className="border-collapse text-caption font-mono">
          <thead>
            <tr>
              <th className="p-1 text-ink-3 text-left font-normal w-36">Target</th>
              {polar.twsBins.map((tws, i) => (
                <th key={i} className="p-1 text-ink-3 text-right font-normal">
                  {(tws * MS_TO_KNOTS).toFixed(0)} kn
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TargetRow polar={polar} label="TWA upwind" kind="twa" direction="upwind" />
            <TargetRow polar={polar} label="VMG upwind" kind="vmg" direction="upwind" />
            <TargetRow polar={polar} label="TWA downwind" kind="twa" direction="downwind" />
            <TargetRow polar={polar} label="VMG downwind" kind="vmg" direction="downwind" />
          </tbody>
        </table>
        <p className="text-caption text-ink-3 mt-1">
          Blue rows = upwind targets · Orange rows = downwind targets (read-only).
          Click a cell to select it, then use &ldquo;Edit cell&rdquo; to change its value.
        </p>
      </div>

      {/* Alert dialog (info only — no confirm needed) */}
      <Dialog
        open={dialog.kind === 'alert'}
        onClose={() => setDialog({ kind: 'none' })}
        title="Cannot resize"
        actions={
          <Button variant="secondary" onClick={() => setDialog({ kind: 'none' })}>
            OK
          </Button>
        }
      >
        <p className="text-ink">{dialog.kind === 'alert' ? dialog.message : ''}</p>
      </Dialog>

      {/* Remove TWA column confirm */}
      <ConfirmDialog
        open={dialog.kind === 'confirm-remove-twa'}
        onClose={() => setDialog({ kind: 'none' })}
        onConfirm={async () => {
          if (dialog.kind !== 'confirm-remove-twa') return;
          setDialog({ kind: 'none' });
          await onChange?.(removeTwaBin(polar, dialog.twaIdx));
        }}
        title="Remove TWA column?"
        message={
          dialog.kind === 'confirm-remove-twa'
            ? `Remove TWA ${dialog.deg}° column? This will delete that column of values.`
            : ''
        }
        confirmLabel="Remove column"
        hold
      />

      {/* Remove TWS row confirm */}
      <ConfirmDialog
        open={dialog.kind === 'confirm-remove-tws'}
        onClose={() => setDialog({ kind: 'none' })}
        onConfirm={async () => {
          if (dialog.kind !== 'confirm-remove-tws') return;
          setDialog({ kind: 'none' });
          await onChange?.(removeTwsBin(polar, dialog.twsIdx));
        }}
        title="Remove TWS row?"
        message={
          dialog.kind === 'confirm-remove-tws'
            ? `Remove TWS ${dialog.kn} kn row? This will delete that row of values.`
            : ''
        }
        confirmLabel="Remove row"
        hold
      />

      {/* Cell edit dialog */}
      {dialog.kind === 'edit-cell' && (
        <CellEditDialog
          twsIdx={dialog.twsIdx}
          twaIdx={dialog.twaIdx}
          polar={polar}
          onCommit={commitCellEdit}
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TargetRow — read-only computed rows (upwind/downwind VMG + TWA)
// ---------------------------------------------------------------------------

function TargetRow({
  polar,
  label,
  kind,
  direction,
}: {
  polar: PolarTable;
  label: string;
  kind: 'twa' | 'vmg';
  direction: 'upwind' | 'downwind';
}): React.JSX.Element {
  const labelClass = direction === 'upwind' ? 'text-info' : 'text-[--series-4]';
  return (
    <tr className="bg-surface-sunken/60">
      <th className={`p-1 pr-2 text-right text-caption font-normal ${labelClass}`}>{label}</th>
      {polar.twsBins.map((tws, twsIdx) => {
        const optimalTwa = optimalTwaForVmg(polar, tws, direction);
        if (kind === 'twa') {
          return (
            <td key={twsIdx} className={`p-2 text-right tabular-nums ${labelClass}`}>
              {(optimalTwa * RAD_TO_DEG).toFixed(0)}°
            </td>
          );
        }
        const bsp = interpolatePolarSpeed(polar, tws, optimalTwa);
        const vmg = Math.abs(vmgFor(bsp, optimalTwa));
        return (
          <td key={twsIdx} className={`p-2 text-right tabular-nums ${labelClass}`}>
            {(vmg * MS_TO_KNOTS).toFixed(2)}
          </td>
        );
      })}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// CellEditDialog — Dialog-based cell editor (replaces double-click-to-edit)
// ---------------------------------------------------------------------------

function CellEditDialog({
  twsIdx,
  twaIdx,
  polar,
  onCommit,
  onClose,
}: {
  twsIdx: number;
  twaIdx: number;
  polar: PolarTable;
  onCommit: (twsIdx: number, twaIdx: number, rawKnots: string) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const initialKn = (polar.boatSpeed[twsIdx]![twaIdx]! * MS_TO_KNOTS).toFixed(1);
  const [value, setValue] = useState(initialKn);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const tws = (polar.twsBins[twsIdx]! * MS_TO_KNOTS).toFixed(0);
  const twa = (polar.twaBins[twaIdx]! * RAD_TO_DEG).toFixed(0);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void onCommit(twsIdx, twaIdx, value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit cell — TWS ${tws} kn, TWA ${twa}°`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void onCommit(twsIdx, twaIdx, value)}>
            Apply
          </Button>
        </>
      }
    >
      <label className="block space-y-2">
        <span className="text-ink-2 text-sm">Boat speed (knots)</span>
        <input
          ref={inputRef}
          type="number"
          step="0.1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          className="block w-full bg-surface-sunken border border-hairline [border-radius:var(--r-control)] px-3 py-2 font-mono text-ink text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
        />
      </label>
    </Dialog>
  );
}
