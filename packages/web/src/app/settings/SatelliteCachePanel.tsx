'use client';
import { useCallback, useEffect, useState } from 'react';

interface ZoomStat {
  bytes: number;
  tiles: number;
}
interface CacheStats {
  totalBytes: number;
  tileCount: number;
  capBytes: number;
  byZoom: Record<number, ZoomStat>;
}
interface PruneResult {
  removedTiles: number;
  removedBytes: number;
  totalBytesAfter: number;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function SatelliteCachePanel(): React.ReactElement {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [days, setDays] = useState<string>('90');
  const [busy, setBusy] = useState<boolean>(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sat-cache');
      if (!res.ok) throw new Error(`stats ${res.status}`);
      setStats((await res.json()) as CacheStats);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load cache stats');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const prune = useCallback(
    async (payload: { olderThanDays?: number; maxGb?: number }) => {
      setBusy(true);
      setStatus(undefined);
      setError(undefined);
      try {
        const res = await fetch('/api/sat-cache/prune', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`prune ${res.status}`);
        const r = (await res.json()) as PruneResult;
        setStatus(`Freed ${fmtBytes(r.removedBytes)} (${r.removedTiles} tiles)`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'prune failed');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const overBudget = stats ? stats.totalBytes > stats.capBytes : false;
  const pct = stats && stats.capBytes > 0 ? Math.min(100, (stats.totalBytes / stats.capBytes) * 100) : 0;
  const zooms = stats ? Object.keys(stats.byZoom).map(Number).sort((a, b) => a - b) : [];

  return (
    <section className="rounded border border-zinc-700 bg-zinc-900/50 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">Satellite tile cache</h2>
      {stats ? (
        <>
          <p className="mt-1 text-xs text-zinc-400">
            {fmtBytes(stats.totalBytes)} of {fmtBytes(stats.capBytes)} · {stats.tileCount} tiles
          </p>
          <div className="mt-2 h-2 w-full rounded bg-zinc-800">
            <div
              className={'h-2 rounded ' + (overBudget ? 'bg-red-500' : 'bg-emerald-500')}
              style={{ width: `${pct}%` }}
            />
          </div>
          {zooms.length > 0 ? (
            <table className="mt-3 w-full text-xs text-zinc-300">
              <thead>
                <tr className="text-zinc-500">
                  <th className="text-left font-normal">zoom</th>
                  <th className="text-right font-normal">tiles</th>
                  <th className="text-right font-normal">size</th>
                </tr>
              </thead>
              <tbody>
                {zooms.map((z) => (
                  <tr key={z}>
                    <td>z{z}</td>
                    <td className="text-right">{stats.byZoom[z]!.tiles}</td>
                    <td className="text-right">{fmtBytes(stats.byZoom[z]!.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">Loading…</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs text-zinc-400">
          Remove tiles not viewed in
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="mx-1 w-16 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100"
          />
          days
        </label>
        <button
          type="button"
          disabled={busy || !days}
          onClick={() => void prune({ olderThanDays: Number(days) })}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          Prune unused tiles
        </button>
        {overBudget ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void prune({ maxGb: stats!.capBytes / 1024 ** 3 })}
            className="rounded border border-red-700 px-2 py-1 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-40"
          >
            Prune to cap
          </button>
        ) : null}
      </div>

      {status ? <p className="mt-2 text-xs text-emerald-400">{status}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </section>
  );
}
