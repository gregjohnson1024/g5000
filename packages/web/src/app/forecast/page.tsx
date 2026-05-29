'use client';
import { useCallback, useEffect, useState } from 'react';
import { fmtUtcMinute } from '../../lib/tz';

type WindModel = 'gfs' | 'ecmwf';

interface ManifestEntry {
  model: WindModel;
  forecastHour: number;
  runAt: number;
  validAt: number;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  fetchedAt: number;
  points: number;
}

interface Availability {
  latestRunUnix: number;
  nextRunAvailableUnix: number;
}

interface ManifestResponse {
  ok: boolean;
  entries: ManifestEntry[];
  availability: Record<WindModel, Availability>;
  nowUnix: number;
}

// Fixed forecast hours: every 3 h out to 168 h (7 days). Matches the
// systemd timer's refresh-forecast.sh, so the manual "Refresh now" button
// fetches the same set as the periodic background refresh.
const FORECAST_HOURS: number[] = Array.from({ length: 57 }, (_, i) => i * 3);

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

// Western North Atlantic — the full Gulf Stream meander region. CMEMS always
// covers at least this so the currents overlay shows the Stream regardless of
// where the (smaller) wind ROI sits.
const GULF_STREAM_BBOX: Bbox = { latMin: 20, latMax: 50, lonMin: -82, lonMax: -40 };

function unionBbox(a: Bbox, b: Bbox): Bbox {
  return {
    latMin: Math.min(a.latMin, b.latMin),
    latMax: Math.max(a.latMax, b.latMax),
    lonMin: Math.min(a.lonMin, b.lonMin),
    lonMax: Math.max(a.lonMax, b.lonMax),
  };
}

function fmtAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return 'available now';
  if (seconds < 60) return `in ${seconds}s`;
  if (seconds < 3600) return `in ${Math.floor(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `in ${h}h ${m}m`;
}

export default function ForecastPage() {
  const [manifest, setManifest] = useState<ManifestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cmemsBusy, setCmemsBusy] = useState(false);
  const [cmemsNotice, setCmemsNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reloadManifest = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch('/api/forecast/manifest', { cache: 'no-store' });
      const j = (await r.json()) as ManifestResponse;
      if (j.ok) setManifest(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reloadManifest();
    const id = setInterval(() => void reloadManifest(), 30_000);
    return () => clearInterval(id);
  }, [reloadManifest]);

  const runFetch = async (): Promise<void> => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      // The ROI is whatever the draggable forecast box on the chart last set
      // (persisted to settings.forecastBbox); this button just triggers an
      // out-of-band pull of that same region.
      const s = await fetch('/api/settings', { cache: 'no-store' });
      const sj = (await s.json()) as { settings?: { forecastBbox?: ManifestEntry['bbox'] } };
      const bbox = sj.settings?.forecastBbox;
      if (!bbox) {
        setErr('No forecast ROI set yet — drag the ROI box on the chart first.');
        return;
      }
      // The refresh runs as a background job server-side (returns 202), so we
      // don't hold the connection while ~114 grids fetch. The cached-grids
      // table below fills in as they land; re-poll the manifest a few times.
      const r = await fetch('/api/forecast/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bbox,
          models: ['gfs', 'ecmwf'] as WindModel[],
          hours: FORECAST_HOURS,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        setErr(j.error?.message ?? `fetch failed: HTTP ${r.status}`);
        return;
      }
      setNotice(
        'Refresh started — caching GFS + ECMWF in the background. The cached-grids table below fills in over the next 1–2 min.',
      );
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('forecast-cache');
        bc.postMessage({ kind: 'fetch-complete', at: Date.now() });
        bc.close();
      }
      [10_000, 30_000, 60_000, 120_000].forEach((ms) =>
        setTimeout(() => void reloadManifest(), ms),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runCmemsFetch = async (): Promise<void> => {
    setErr(null);
    setCmemsNotice(null);
    setCmemsBusy(true);
    try {
      // Always cover the Gulf Stream; extend to include the wind ROI so the
      // currents overlay has data wherever the route box sits (union — one
      // grid, since the overlay shows a single current grid).
      const s = await fetch('/api/settings', { cache: 'no-store' });
      const sj = (await s.json()) as { settings?: { forecastBbox?: Bbox } };
      const roi = sj.settings?.forecastBbox;
      const bbox = roi ? unionBbox(GULF_STREAM_BBOX, roi) : GULF_STREAM_BBOX;
      const r = await fetch('/api/current/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, days: [0] }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        results?: Array<{ ok: boolean; error?: string }>;
        error?: { message?: string };
      };
      if (!r.ok || !j.ok || !j.results?.[0]?.ok) {
        setErr(
          j.results?.[0]?.error ?? j.error?.message ?? `CMEMS refresh failed: HTTP ${r.status}`,
        );
        return;
      }
      setCmemsNotice('CMEMS surface currents refreshed.');
      // Nudge an open /chart to re-read the cached current grid.
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('current-cache');
        bc.postMessage({ kind: 'fetch-complete', at: Date.now() });
        bc.close();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCmemsBusy(false);
    }
  };

  const now = manifest?.nowUnix ?? Math.floor(Date.now() / 1000);

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Forecast data</h1>
        <button
          onClick={() => void reloadManifest()}
          className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
        >
          Reload manifest
        </button>
      </div>

      {err && <p className="text-rose-400 text-sm">{err}</p>}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Run availability</h2>
        <table className="text-sm border-collapse">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="p-2">Model</th>
              <th className="p-2">Latest available run</th>
              <th className="p-2">Run age</th>
              <th className="p-2">Next run becomes available</th>
            </tr>
          </thead>
          <tbody>
            {(['gfs', 'ecmwf'] as WindModel[]).map((m) => {
              const a = manifest?.availability?.[m];
              if (!a) return null;
              const ageSec = now - a.latestRunUnix;
              const untilNext = a.nextRunAvailableUnix - now;
              return (
                <tr key={m} className="border-b border-slate-900">
                  <td className="p-2 font-mono">{m.toUpperCase()}</td>
                  <td className="p-2 font-mono">{fmtUtcMinute(a.latestRunUnix)}</td>
                  <td className="p-2 text-slate-300">{fmtAge(ageSec)} ago</td>
                  <td className="p-2 text-slate-300">
                    {fmtUtcMinute(a.nextRunAvailableUnix)} ({fmtDuration(untilNext)})
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 border border-slate-800 rounded p-4 bg-slate-900/30">
        <h2 className="text-base font-semibold">Refresh forecast cache</h2>
        <p className="text-xs text-slate-500">
          Fetches GFS + ECMWF for the forecast ROI (the draggable box on the chart), every 3 h out
          to +168 h (57 snapshots/model). The Pi runs the same refresh on a 3 h timer in the
          background; this button just lets you trigger one out of band. Partial 404s (ECMWF when
          its run hasn&apos;t published yet) are normal.
        </p>
        <button
          onClick={() => void runFetch()}
          disabled={busy}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-900 rounded text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Refresh now'}
        </button>
        {notice && <p className="text-xs text-emerald-300">{notice}</p>}
      </section>

      <section className="space-y-3 border border-slate-800 rounded p-4 bg-slate-900/30">
        <h2 className="text-base font-semibold">Surface currents (CMEMS)</h2>
        <p className="text-xs text-slate-500">
          Copernicus Marine daily-mean surface currents (1/12°). Covers the Gulf Stream region plus
          your wind ROI (combined into one box). The Pi refreshes this automatically on the same 3 h
          timer; this button triggers one out of band.
        </p>
        <button
          onClick={() => void runCmemsFetch()}
          disabled={cmemsBusy}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-900 rounded text-sm font-medium disabled:opacity-50"
        >
          {cmemsBusy ? 'Fetching CMEMS…' : 'Refresh CMEMS'}
        </button>
        {cmemsNotice && <p className="text-xs text-emerald-300">{cmemsNotice}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Cached grids ({manifest?.entries.length ?? 0})</h2>
        {(!manifest || manifest.entries.length === 0) && (
          <p className="text-sm text-slate-500">
            Nothing cached yet. Drag the forecast ROI box on the chart, or click Refresh now.
          </p>
        )}
        {manifest && manifest.entries.length > 0 && (
          <table className="text-sm border-collapse">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-2">Model</th>
                <th className="p-2">+h</th>
                <th className="p-2">Run</th>
                <th className="p-2">Valid</th>
                <th className="p-2">Bbox</th>
                <th className="p-2">Age</th>
              </tr>
            </thead>
            <tbody>
              {manifest.entries.map((e, i) => (
                <tr key={i} className="border-b border-slate-900">
                  <td className="p-2 font-mono">{e.model.toUpperCase()}</td>
                  <td className="p-2 font-mono">+{e.forecastHour}h</td>
                  <td className="p-2 font-mono">{fmtUtcMinute(e.runAt)}</td>
                  <td className="p-2 font-mono">{fmtUtcMinute(e.validAt)}</td>
                  <td className="p-2 font-mono text-xs text-slate-400">
                    {e.bbox.latMin.toFixed(1)}…{e.bbox.latMax.toFixed(1)} N ·{' '}
                    {e.bbox.lonMin.toFixed(1)}…{e.bbox.lonMax.toFixed(1)} E
                  </td>
                  <td className="p-2 text-slate-300">
                    {fmtAge(now - Math.floor(e.fetchedAt / 1000))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
