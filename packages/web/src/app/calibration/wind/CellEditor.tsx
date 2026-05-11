'use client';

import { useState, useEffect } from 'react';
import type { AwsAwaCalTable } from '@h6000/db';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export interface CellEditorProps {
  cal: AwsAwaCalTable;
  cell: { awsIdx: number; awaIdx: number };
  onApply: (updatedCal: AwsAwaCalTable) => void | Promise<void>;
}

export function CellEditor({ cal, cell, onApply }: CellEditorProps) {
  const currentRad = cal.angleCorrection[cell.awsIdx]![cell.awaIdx]!;
  const [newDeg, setNewDeg] = useState((currentRad * RAD_TO_DEG).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setNewDeg((currentRad * RAD_TO_DEG).toFixed(2));
    setErr(null);
  }, [cell.awsIdx, cell.awaIdx, currentRad]);

  const handleApply = async (): Promise<void> => {
    const parsed = Number(newDeg);
    if (!Number.isFinite(parsed)) {
      setErr('Not a number');
      return;
    }
    const newRad = parsed * DEG_TO_RAD;
    const updated: AwsAwaCalTable = {
      ...cal,
      angleCorrection: cal.angleCorrection.map((row, i) =>
        i === cell.awsIdx ? row.map((v, j) => (j === cell.awaIdx ? newRad : v)) : row.slice(),
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

  const awsAt = cal.awsBins[cell.awsIdx]!;
  const awaAt = cal.awaBins[cell.awaIdx]! * RAD_TO_DEG;

  return (
    <div className="border border-slate-700 rounded p-4 space-y-3">
      <div className="text-sm text-slate-300">
        Editing cell at <span className="font-mono">AWS {awsAt.toFixed(1)} m/s</span> ×{' '}
        <span className="font-mono">|AWA| {awaAt.toFixed(0)}°</span>
      </div>
      <label className="block text-sm">
        <span className="text-slate-400">Angle correction (degrees):</span>
        <input
          type="number"
          step="0.1"
          value={newDeg}
          onChange={(e) => setNewDeg(e.target.value)}
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
