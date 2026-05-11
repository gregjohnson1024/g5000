'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BspCal } from '@g5000/db';
import { useSse } from '../../../hooks/use-sse';

const MS_TO_KNOTS = 1 / 0.514444;

export default function BspCalPage() {
  const [cal, setCal] = useState<BspCal | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [edit, setEdit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { channels } = useSse();
  const bsp = channels.get('boat.speed.water');
  const sog = channels.get('nav.gps.sog');

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/bsp', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/config/bsp: ${res.status}`);
      const body = (await res.json()) as BspCal;
      setCal(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (selected !== null && cal) {
      setEdit(cal.multiplier[selected]!.toFixed(3));
    }
  }, [selected, cal]);

  const handleApply = async (): Promise<void> => {
    if (!cal || selected === null) return;
    const m = Number(edit);
    if (!Number.isFinite(m) || m <= 0) {
      setErr('Multiplier must be a positive number');
      return;
    }
    const next: BspCal = {
      ...cal,
      multiplier: cal.multiplier.map((v, i) => (i === selected ? m : v)),
    };
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/config/bsp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`PUT failed: ${res.status} ${t}`);
      }
      setCal(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fmt = (s: { value: { kind: string; value?: number } } | undefined): string => {
    if (!s || s.value.kind !== 'scalar') return '—';
    return `${(s.value.value! * MS_TO_KNOTS).toFixed(2)} kn`;
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">BSP calibration</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      <div className="grid grid-cols-2 gap-2 text-sm font-mono text-slate-300 max-w-xl">
        <div>BSP (boat speed): {fmt(bsp as never)}</div>
        <div>SOG (GPS speed): {fmt(sog as never)}</div>
      </div>
      <p className="text-xs text-slate-500 max-w-xl">
        In still water with no current, ideal multiplier ≈ SOG / BSP. Note the
        ratio at each speed bin and edit cells accordingly.
      </p>

      {cal && (
        <div className="space-y-3">
          <table className="border-collapse text-xs font-mono">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-1">Bin (kn)</th>
                {cal.bins.map((b, i) => (
                  <th key={i} className="p-1 text-right">
                    {(b * MS_TO_KNOTS).toFixed(0)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="p-1 text-slate-400 text-right pr-2">Multiplier</th>
                {cal.multiplier.map((m, i) => {
                  const isSel = selected === i;
                  return (
                    <td
                      key={i}
                      onClick={() => setSelected(i)}
                      className={`p-2 cursor-pointer text-right bg-slate-800 ${isSel ? 'ring-2 ring-amber-400' : ''}`}
                    >
                      {m.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

          {selected !== null && (
            <div className="border border-slate-700 rounded p-4 space-y-3 max-w-xl">
              <div className="text-sm text-slate-300">
                Editing bin at{' '}
                <span className="font-mono">
                  {(cal.bins[selected]! * MS_TO_KNOTS).toFixed(1)} kn
                </span>
              </div>
              <label className="block text-sm">
                <span className="text-slate-400">Multiplier (1.0 = no correction):</span>
                <input
                  type="number"
                  step="0.01"
                  value={edit}
                  onChange={(e) => setEdit(e.target.value)}
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
            </div>
          )}
        </div>
      )}
    </main>
  );
}
