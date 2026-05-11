'use client';

import { useState, useEffect } from 'react';
import type { PolarTable } from '@g5000/db';

const MS_TO_KNOTS = 1 / 0.514444;
const KNOTS_TO_MS = 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export interface PolarCellEditorProps {
  polar: PolarTable;
  cell: { twsIdx: number; twaIdx: number };
  onApply: (updated: PolarTable) => void | Promise<void>;
}

export function PolarCellEditor({ polar, cell, onApply }: PolarCellEditorProps) {
  const currentMs = polar.boatSpeed[cell.twsIdx]![cell.twaIdx]!;
  const [newKn, setNewKn] = useState((currentMs * MS_TO_KNOTS).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setNewKn((currentMs * MS_TO_KNOTS).toFixed(2));
    setErr(null);
  }, [cell.twsIdx, cell.twaIdx, currentMs]);

  const handleApply = async (): Promise<void> => {
    const parsed = Number(newKn);
    if (!Number.isFinite(parsed)) {
      setErr('Not a number');
      return;
    }
    const newMs = parsed * KNOTS_TO_MS;
    const updated: PolarTable = {
      ...polar,
      boatSpeed: polar.boatSpeed.map((row, i) =>
        i === cell.twsIdx ? row.map((v, j) => (j === cell.twaIdx ? newMs : v)) : row.slice(),
      ),
    };
    setBusy(true);
    setErr(null);
    try {
      await onApply(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const twsAt = polar.twsBins[cell.twsIdx]! * MS_TO_KNOTS;
  const twaAt = polar.twaBins[cell.twaIdx]! * RAD_TO_DEG;

  return (
    <div className="border border-slate-700 rounded p-4 space-y-3">
      <div className="text-sm text-slate-300">
        Editing cell at <span className="font-mono">TWS {twsAt.toFixed(1)} kn</span> ×{' '}
        <span className="font-mono">TWA {twaAt.toFixed(0)}°</span>
      </div>
      <label className="block text-sm">
        <span className="text-slate-400">Target boat speed (knots):</span>
        <input
          type="number"
          step="0.1"
          value={newKn}
          onChange={(e) => setNewKn(e.target.value)}
          className="block w-32 mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono"
        />
      </label>
      <button
        onClick={handleApply}
        disabled={busy}
        className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Apply'}
      </button>
      {err && <div className="text-sm text-red-400">{err}</div>}
    </div>
  );
}
