'use client';

import { useCallback, useEffect, useState } from 'react';

const RAD_TO_DEG = 180 / Math.PI;

interface RunStatus {
  running: boolean;
  startedAt: number | null;
  awsBins: number[];
  counts: { port: number[]; starboard: number[] };
  previewOffsetRad: (number | null)[];
  minSamplesPerBucket: number;
  result: {
    awsBins: number[];
    awaOffsetRad: number[];
  } | null;
}

type TwdRunResponse = { ok: true; status: RunStatus } | { ok: false; error: { message: string } };

export function TwdRunCard() {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/calibration/twd-run', { cache: 'no-store' });
      const body = (await res.json()) as TwdRunResponse;
      if (!body.ok) {
        setErr(body.error.message);
        return;
      }
      setStatus(body.status);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const post = async (action: 'start' | 'stop' | 'abort' | 'apply'): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch('/api/calibration/twd-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json()) as TwdRunResponse;
      if (!body.ok) {
        setErr(body.error.message);
      } else {
        setStatus(body.status);
        setErr(null);
        if (action === 'apply') setApplied(true);
        if (action === 'start') setApplied(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const result = status?.result ?? null;

  return (
    <div className="border border-slate-700 rounded p-4 space-y-3">
      <div className="text-lg font-semibold">TWD calibration run</div>
      <p className="text-sm text-slate-300">
        Sail upwind and hold each tack steady for ~2–3 minutes; flat water gives the cleanest
        result. The run buckets true-wind direction per tack and wind-speed bin, then computes a
        signed vane-offset correction from the port/starboard TWD spread. Live mode only.
      </p>

      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      <div className="flex gap-2">
        {!status?.running && (
          <button
            onClick={() => void post('start')}
            disabled={busy || !status}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
          >
            Start
          </button>
        )}
        {status?.running && (
          <>
            <button
              onClick={() => void post('stop')}
              disabled={busy}
              className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
            >
              Stop
            </button>
            <button
              onClick={() => void post('abort')}
              disabled={busy}
              className="px-3 py-1 bg-slate-700 text-slate-200 rounded disabled:opacity-50"
            >
              Abort
            </button>
          </>
        )}
      </div>

      {status && (
        <table className="text-xs font-mono text-slate-300">
          <thead>
            <tr className="text-slate-400">
              <th className="pr-4 text-left font-normal">AWS bin</th>
              <th className="pr-4 text-right font-normal">Port</th>
              <th className="pr-4 text-right font-normal">Stbd</th>
              <th className="text-right font-normal">Offset</th>
            </tr>
          </thead>
          <tbody>
            {status.awsBins.map((bin, i) => {
              const offset = status.previewOffsetRad[i] ?? null;
              return (
                <tr key={bin}>
                  <td className="pr-4">{bin.toFixed(0)} m/s</td>
                  <td className="pr-4 text-right">{status.counts.port[i]}</td>
                  <td className="pr-4 text-right">{status.counts.starboard[i]}</td>
                  <td className="text-right">
                    {offset !== null ? `${(offset * RAD_TO_DEG).toFixed(1)}°` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {status && !status.running && result && !applied && (
        <div className="space-y-2 text-sm">
          <div className="text-slate-200">
            Computed offsets:{' '}
            {result.awsBins.map((bin, i) => (
              <span key={bin} className="font-mono pr-3">
                {bin.toFixed(0)} m/s → {(result.awaOffsetRad[i]! * RAD_TO_DEG).toFixed(1)}°
              </span>
            ))}
          </div>
          <button
            onClick={() => void post('apply')}
            disabled={busy}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}

      {status && !status.running && !result && status.startedAt !== null && !applied && (
        <p className="text-sm text-slate-400">
          No result yet — a bin needs ≥{status.minSamplesPerBucket} samples on each tack.
        </p>
      )}

      {applied && <p className="text-sm text-green-400">Offsets applied to the wind cal.</p>}
    </div>
  );
}
