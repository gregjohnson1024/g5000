'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CompassDeviation } from '@g5000/db';
import { useSse } from '../../../hooks/use-sse';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export default function CompassDeviationPage() {
  const [cal, setCal] = useState<CompassDeviation | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [edit, setEdit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { channels } = useSse();
  const hdg = channels.get('boat.heading.magnetic');
  const cog = channels.get('nav.gps.cog');

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/compass-deviation', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/config/compass-deviation: ${res.status}`);
      const body = (await res.json()) as CompassDeviation;
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
      setEdit((cal.deviation[selected]! * RAD_TO_DEG).toFixed(2));
    }
  }, [selected, cal]);

  const handleApply = async (): Promise<void> => {
    if (!cal || selected === null) return;
    const d = Number(edit);
    if (!Number.isFinite(d)) {
      setErr('Deviation must be a finite number (degrees)');
      return;
    }
    const next: CompassDeviation = {
      deviation: cal.deviation.map((v, i) => (i === selected ? d * DEG_TO_RAD : v)),
    };
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/config/compass-deviation', {
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

  const fmtAngle = (s: { value: { kind: string; value?: number } } | undefined): string => {
    if (!s || s.value.kind !== 'scalar') return '—';
    return `${(s.value.value! * RAD_TO_DEG).toFixed(1)}°`;
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Compass deviation</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      <div className="grid grid-cols-2 gap-2 text-sm font-mono text-slate-300 max-w-xl">
        <div>Heading (mag): {fmtAngle(hdg as never)}</div>
        <div>GPS COG: {fmtAngle(cog as never)}</div>
      </div>
      <p className="text-xs text-slate-500 max-w-xl">
        Deviation = HDG_observed − HDG_true. With no current and a known variation, you can derive
        deviation per heading bin by comparing the compass against GPS COG on long straight runs.
      </p>

      {cal && (
        <div className="space-y-3">
          <table className="border-collapse text-xs font-mono">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-1">Bin start (°)</th>
                {cal.deviation.map((_, i) => (
                  <th key={i} className="p-1 text-right" style={{ minWidth: 32 }}>
                    {i * 10}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="p-1 text-slate-400 text-right pr-2">Dev (°)</th>
                {cal.deviation.map((d, i) => {
                  const isSel = selected === i;
                  return (
                    <td
                      key={i}
                      onClick={() => setSelected(i)}
                      className={`p-1 cursor-pointer text-right bg-slate-800 ${isSel ? 'ring-2 ring-amber-400' : ''}`}
                    >
                      {(d * RAD_TO_DEG).toFixed(1)}
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
                  {selected * 10}°–{selected * 10 + 10}°
                </span>{' '}
                heading
              </div>
              <label className="block text-sm">
                <span className="text-slate-400">Deviation (degrees, signed):</span>
                <input
                  type="number"
                  step="0.1"
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
