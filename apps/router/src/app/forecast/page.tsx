'use client';
import { useCallback, useEffect, useState } from 'react';

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

interface FetchResult {
  model: WindModel;
  hour: number;
  ok: boolean;
  runAt?: number;
  validAt?: number;
  points?: number;
  error?: string;
}

const DEFAULT_HOURS = [0, 6, 12, 24, 36, 48, 72];

function fmtUtc(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
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
  const [boatLat, setBoatLat] = useState<number | null>(null);
  const [boatLon, setBoatLon] = useState<number | null>(null);

  // ROI state — defaults to a box around the boat once we have a fix.
  const [roi, setRoi] = useState<{ latMin: number; latMax: number; lonMin: number; lonMax: number }>(
    { latMin: 30, latMax: 40, lonMin: -75, lonMax: -65 },
  );
  const [gfsOn, setGfsOn] = useState(true);
  const [ecmwfOn, setEcmwfOn] = useState(true);
  const [hours, setHours] = useState<number[]>(DEFAULT_HOURS);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FetchResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Poll the live position once on mount so we can auto-fill an ROI centred
  // on the boat the first time the user lands here.
  useEffect(() => {
    const es = new EventSource('/api/live/position');
    es.onmessage = (e) => {
      try {
        const p = JSON.parse(e.data) as { lat?: number; lon?: number };
        if (typeof p.lat === 'number' && typeof p.lon === 'number') {
          setBoatLat(p.lat);
          setBoatLon(p.lon);
          es.close();
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

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

  const centerOnBoat = (): void => {
    if (boatLat === null || boatLon === null) return;
    const radius = 6;
    setRoi({
      latMin: boatLat - radius,
      latMax: boatLat + radius,
      lonMin: boatLon - radius,
      lonMax: boatLon + radius,
    });
  };

  const toggleHour = (h: number): void => {
    setHours((prev) => (prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h].sort((a, b) => a - b)));
  };

  const runFetch = async (): Promise<void> => {
    const models: WindModel[] = [];
    if (gfsOn) models.push('gfs');
    if (ecmwfOn) models.push('ecmwf');
    if (models.length === 0) {
      setErr('Select at least one model');
      return;
    }
    if (hours.length === 0) {
      setErr('Select at least one forecast hour');
      return;
    }
    setErr(null);
    setBusy(true);
    setResults(null);
    try {
      const r = await fetch('/api/forecast/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox: roi, models, hours }),
      });
      const j = (await r.json()) as { ok: boolean; results: FetchResult[]; error?: { message: string } };
      if (!j.ok) {
        setErr(j.error?.message ?? 'fetch failed');
      } else {
        setResults(j.results);
      }
      await reloadManifest();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
                  <td className="p-2 font-mono">{fmtUtc(a.latestRunUnix)}</td>
                  <td className="p-2 text-slate-300">{fmtAge(ageSec)} ago</td>
                  <td className="p-2 text-slate-300">
                    {fmtUtc(a.nextRunAvailableUnix)} ({fmtDuration(untilNext)})
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="space-y-3 border border-slate-800 rounded p-4 bg-slate-900/30">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Region of interest</h2>
          <button
            onClick={centerOnBoat}
            disabled={boatLat === null}
            className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50"
          >
            Centre on boat (±6°)
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 text-sm">
          {(
            [
              ['latMin', 'Lat min'],
              ['latMax', 'Lat max'],
              ['lonMin', 'Lon min'],
              ['lonMax', 'Lon max'],
            ] as Array<[keyof typeof roi, string]>
          ).map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-xs text-slate-400">{label}</span>
              <input
                type="number"
                step={0.25}
                value={roi[k]}
                onChange={(e) =>
                  setRoi((prev) => ({ ...prev, [k]: Number(e.target.value) }))
                }
                className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono"
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          ECMWF Open Data is global per request; the response is cropped to this box client-side after decode. GFS is fetched as a NOMADS subset (native bbox support, smaller transfer).
        </p>
      </section>

      <section className="space-y-3 border border-slate-800 rounded p-4 bg-slate-900/30">
        <h2 className="text-base font-semibold">Models &amp; forecast hours</h2>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={gfsOn} onChange={(e) => setGfsOn(e.target.checked)} />
            <span>GFS (NOAA, 0.25°, 1 h cadence)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ecmwfOn} onChange={(e) => setEcmwfOn(e.target.checked)} />
            <span>ECMWF (IFS Open Data, 0.25°, 3 h cadence)</span>
          </label>
        </div>
        <div className="flex gap-2 flex-wrap text-sm">
          <span className="text-slate-400">Hours:</span>
          {[0, 3, 6, 12, 18, 24, 36, 48, 60, 72, 96, 120].map((h) => (
            <label
              key={h}
              className={`px-2 py-0.5 rounded cursor-pointer ${
                hours.includes(h)
                  ? 'bg-amber-600 text-slate-900'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              <input
                type="checkbox"
                checked={hours.includes(h)}
                onChange={() => toggleHour(h)}
                className="hidden"
              />
              +{h}h
            </label>
          ))}
        </div>
        <button
          onClick={() => void runFetch()}
          disabled={busy}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-900 rounded text-sm font-medium disabled:opacity-50"
        >
          {busy
            ? `Fetching ${(gfsOn ? 1 : 0) + (ecmwfOn ? 1 : 0)} model × ${hours.length} hours…`
            : 'Fetch all'}
        </button>
      </section>

      {results && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Last fetch results</h2>
          <table className="text-sm border-collapse">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-2">Model</th>
                <th className="p-2">Hour</th>
                <th className="p-2">Status</th>
                <th className="p-2">Run</th>
                <th className="p-2">Valid</th>
                <th className="p-2">Points</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b border-slate-900">
                  <td className="p-2 font-mono">{r.model.toUpperCase()}</td>
                  <td className="p-2 font-mono">+{r.hour}h</td>
                  <td className={`p-2 ${r.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {r.ok ? 'OK' : r.error ?? 'failed'}
                  </td>
                  <td className="p-2 font-mono">{r.runAt ? fmtUtc(r.runAt) : '—'}</td>
                  <td className="p-2 font-mono">{r.validAt ? fmtUtc(r.validAt) : '—'}</td>
                  <td className="p-2 text-slate-400">{r.points ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">
          Cached grids ({manifest?.entries.length ?? 0})
        </h2>
        {(!manifest || manifest.entries.length === 0) && (
          <p className="text-sm text-slate-500">Nothing cached yet. Pick an ROI and click Fetch all.</p>
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
                  <td className="p-2 font-mono">{fmtUtc(e.runAt)}</td>
                  <td className="p-2 font-mono">{fmtUtc(e.validAt)}</td>
                  <td className="p-2 font-mono text-xs text-slate-400">
                    {e.bbox.latMin.toFixed(1)}…{e.bbox.latMax.toFixed(1)} N · {e.bbox.lonMin.toFixed(1)}…{e.bbox.lonMax.toFixed(1)} E
                  </td>
                  <td className="p-2 text-slate-300">{fmtAge(now - Math.floor(e.fetchedAt / 1000))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
