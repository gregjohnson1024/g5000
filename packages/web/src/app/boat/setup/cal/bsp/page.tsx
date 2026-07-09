'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BspCal } from '@g5000/db';
import { useSse } from '../../../../../hooks/use-sse';
import { useChannelHistory } from '../../../../../hooks/use-channel-history';
import { CaptureWizard } from '../../../../../components/ui/CaptureWizard';
import type { CaptureResult } from '../../../../../components/ui/capture-wizard';

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

  const histBsp = useChannelHistory(channels.get('boat.speed.water'), 6000);
  const histSog = useChannelHistory(channels.get('nav.gps.sog'), 6000);

  // Always-current refs so the compute callback (called 5 s after click) reads
  // the latest data regardless of which render closure it was created in.
  const calRef = useRef<BspCal | null>(null);
  calRef.current = cal;
  const histBspRef = useRef(histBsp);
  histBspRef.current = histBsp;
  const histSogRef = useRef(histSog);
  histSogRef.current = histSog;

  const computeBsp = useCallback((): CaptureResult<number> | null => {
    const currentCal = calRef.current;
    if (!currentCal) return null;
    const bspVal = histBspRef.current.average();
    const sogVal = histSogRef.current.average();
    if (bspVal === null || sogVal === null || bspVal <= 0.1 || sogVal <= 0.1) {
      return null;
    }
    // Snap to nearest bin.
    let bestIdx = 0;
    let bestDist = Math.abs(currentCal.bins[0]! - bspVal);
    for (let i = 1; i < currentCal.bins.length; i++) {
      const d = Math.abs(currentCal.bins[i]! - bspVal);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const newMultiplier = sogVal / bspVal;
    return {
      binIdx: bestIdx,
      newValue: newMultiplier,
      reviewRows: [
        { label: 'BSP avg', value: `${(bspVal * MS_TO_KNOTS).toFixed(2)} kn` },
        { label: 'SOG avg', value: `${(sogVal * MS_TO_KNOTS).toFixed(2)} kn` },
        {
          label: 'Bin selected',
          value: `${(currentCal.bins[bestIdx]! * MS_TO_KNOTS).toFixed(0)} kn`,
        },
        { label: 'New multiplier', value: newMultiplier.toFixed(3) },
        { label: 'Current', value: currentCal.multiplier[bestIdx]!.toFixed(3) },
      ],
    };
  }, []);

  const onApplyBsp = useCallback(async (result: CaptureResult<number>): Promise<void> => {
    const currentCal = calRef.current;
    if (!currentCal) throw new Error('Cal not loaded');
    const next: BspCal = {
      ...currentCal,
      multiplier: currentCal.multiplier.map((v, i) => (i === result.binIdx ? result.newValue : v)),
    };
    const res = await fetch('/api/config/bsp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
    setCal(next);
  }, []);

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
    <main className="page-main p-6 space-y-4">
      <h1 className="text-2xl font-semibold">BSP calibration</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      <div className="grid grid-cols-2 gap-2 text-sm font-mono text-slate-300 max-w-xl">
        <div>BSP (boat speed): {fmt(bsp as never)}</div>
        <div>SOG (GPS speed): {fmt(sog as never)}</div>
      </div>
      <p className="text-xs text-slate-500 max-w-xl">
        In still water with no current, ideal multiplier ≈ SOG / BSP. Note the ratio at each speed
        bin and edit cells accordingly.
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
      {cal && (
        <CaptureWizard<number>
          title="Capture wizard"
          instructions="Sail steady in still water (no current) at a known speed. Click Capture to record 5s of BSP and GPS SOG; the wizard computes the multiplier and snaps to the nearest bin."
          durationMs={5000}
          compute={computeBsp}
          failureMessage="Capture failed: BSP and SOG samples must both be > 0.1 m/s"
          onApply={onApplyBsp}
          onError={setErr}
        />
      )}
    </main>
  );
}
