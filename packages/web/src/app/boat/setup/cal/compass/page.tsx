'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompassDeviation, BoatConfig } from '@g5000/db';
import { useSse } from '../../../../../hooks/use-sse';
import { useChannelHistory } from '../../../../../hooks/use-channel-history';
import { CaptureWizard } from '../../../../../components/ui/CaptureWizard';
import type { CaptureResult } from '../../../../../components/ui/capture-wizard';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

// Normalize an angle into [0, 2π) radians.
const norm = (a: number): number => {
  let x = a % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x;
};

// Signed shortest-arc difference a-b in (-π, π].
const shortest = (a: number, b: number): number => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};

export default function CompassDeviationPage() {
  const [cal, setCal] = useState<CompassDeviation | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [edit, setEdit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { channels } = useSse();
  const hdg = channels.get('boat.heading.magnetic');
  const cog = channels.get('nav.gps.cog');

  const [boat, setBoat] = useState<BoatConfig | null>(null);
  useEffect(() => {
    fetch('/api/config/boat')
      .then((r) => r.json())
      .then(setBoat)
      .catch(() => {});
  }, []);

  const histHdg = useChannelHistory(channels.get('boat.heading.magnetic'), 6000);
  const histCog = useChannelHistory(channels.get('nav.gps.cog'), 6000);

  // Always-current refs so the compute callback (called 5 s after click) reads
  // the latest data regardless of which render closure it was created in.
  const calRef = useRef<CompassDeviation | null>(null);
  calRef.current = cal;
  const boatRef = useRef<BoatConfig | null>(null);
  boatRef.current = boat;
  const histHdgRef = useRef(histHdg);
  histHdgRef.current = histHdg;
  const histCogRef = useRef(histCog);
  histCogRef.current = histCog;

  const computeCompass = useCallback((): CaptureResult<number> | null => {
    const currentCal = calRef.current;
    const currentBoat = boatRef.current;
    if (!currentCal) return null;
    const hdgVal = histHdgRef.current.average();
    const cogVal = histCogRef.current.average();
    if (hdgVal === null || cogVal === null) {
      return null;
    }
    // Bin selected by the current HDG (10° bins, 36 total).
    const binWidth = (2 * Math.PI) / 36;
    const binIdx = Math.min(35, Math.floor(norm(hdgVal) / binWidth));
    // Deviation = HDG_observed - HDG_true. HDG_true = COG (assuming no current).
    const magvarRad = (currentBoat?.magVarDeg ?? 0) * (Math.PI / 180);
    const newDevRad = shortest(hdgVal, cogVal - magvarRad);
    return {
      binIdx,
      newValue: newDevRad,
      reviewRows: [
        { label: 'HDG avg', value: `${(hdgVal * RAD_TO_DEG).toFixed(1)}°` },
        { label: 'COG avg', value: `${(cogVal * RAD_TO_DEG).toFixed(1)}°` },
        { label: 'Bin', value: `${binIdx * 10}°–${binIdx * 10 + 10}°` },
        { label: 'New deviation', value: `${(newDevRad * RAD_TO_DEG).toFixed(2)}°` },
        { label: 'Current', value: `${(currentCal.deviation[binIdx]! * RAD_TO_DEG).toFixed(2)}°` },
      ],
    };
  }, []);

  const onApplyCompass = useCallback(async (result: CaptureResult<number>): Promise<void> => {
    const currentCal = calRef.current;
    if (!currentCal) throw new Error('Cal not loaded');
    const next: CompassDeviation = {
      deviation: currentCal.deviation.map((v, i) => (i === result.binIdx ? result.newValue : v)),
    };
    const res = await fetch('/api/config/compass-deviation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`PUT failed: ${res.status}`);
    setCal(next);
  }, []);

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
    <main className="page-main p-6 space-y-4">
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
      {cal && (
        <CaptureWizard<number>
          title="Capture wizard"
          instructions="Sail steady on a single heading (no current). Click Capture to record 5 s of compass HDG and GPS COG; deviation for the current heading bin is computed from their difference (with magvar from boat config)."
          durationMs={5000}
          compute={computeCompass}
          failureMessage="Capture failed: need both HDG and COG samples"
          onApply={onApplyCompass}
          onError={setErr}
        />
      )}
    </main>
  );
}
