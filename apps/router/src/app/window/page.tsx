'use client';
import { useState } from 'react';
import { WindowHeatmap, type WindowResult } from '../../components/WindowHeatmap';

type Pos = { lat: number; lon: number };

function parseLatLon(s: string): Pos | undefined {
  const parts = s.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 2) return undefined;
  const lat = parts[0];
  const lon = parts[1];
  if (lat === undefined || lon === undefined) return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return { lat, lon };
}

export default function WindowPage() {
  const [startStr, setStartStr] = useState<string>('32.30, -64.78'); // Bermuda
  const [endStr, setEndStr] = useState<string>('41.49, -71.31'); // Newport, RI
  const [model, setModel] = useState<'GFS' | 'ECMWF'>('GFS');
  const [windowStart, setWindowStart] = useState<string>(
    new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
  );
  const [windowHours, setWindowHours] = useState<number>(120);
  const [stepHours, setStepHours] = useState<number>(6);
  const [useCurrents, setUseCurrents] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [results, setResults] = useState<WindowResult[] | undefined>();

  const onScan = async () => {
    setError(undefined);
    setResults(undefined);
    const start = parseLatLon(startStr);
    const end = parseLatLon(endStr);
    if (!start || !end) {
      setError('Start/End must be "lat, lon".');
      return;
    }
    const ts = Math.floor(new Date(windowStart).getTime() / 1000);
    if (!Number.isFinite(ts)) {
      setError('Invalid window-start datetime.');
      return;
    }
    setLoading(true);
    try {
      const polarRes = await fetch('/api/live/polar');
      if (!polarRes.ok) {
        setError('No polar available (live or cached).');
        return;
      }
      const { polar } = await polarRes.json();
      const req = {
        start,
        end,
        windowStart: ts,
        windowHours,
        stepHours,
        model,
        polarId: polar.id ?? 'default',
        polar: polar.polar ?? polar,
        useCurrents,
      };
      const res = await fetch('/api/route/window', {
        method: 'POST',
        body: JSON.stringify(req),
        headers: { 'content-type': 'application/json' },
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? 'scan failed');
        return;
      }
      setResults(j.results as WindowResult[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const onPick = (r: WindowResult) => {
    const start = parseLatLon(startStr);
    const end = parseLatLon(endStr);
    if (!start || !end) return;
    const qs = new URLSearchParams({
      dep: String(r.departure),
      start: `${start.lat},${start.lon}`,
      end: `${end.lat},${end.lon}`,
    });
    window.location.href = `/?${qs.toString()}`;
  };

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4 text-slate-200">
      <h1 className="text-2xl">Departure-window scan</h1>
      <div className="grid grid-cols-2 gap-3 max-w-2xl">
        <label className="block text-sm">
          Start (lat, lon)
          <input
            type="text"
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block text-sm">
          End (lat, lon)
          <input
            type="text"
            value={endStr}
            onChange={(e) => setEndStr(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block text-sm">
          Window start (UTC)
          <input
            type="datetime-local"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block text-sm">
          Wind model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as 'GFS' | 'ECMWF')}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
          >
            <option value="GFS">GFS (NOAA)</option>
            <option value="ECMWF">ECMWF</option>
          </select>
        </label>
        <label className="block text-sm">
          Window length (hours)
          <input
            type="number"
            min={1}
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block text-sm">
          Step (hours)
          <input
            type="number"
            min={1}
            value={stepHours}
            onChange={(e) => setStepHours(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
          />
        </label>
        <label className="flex items-center gap-2 text-sm col-span-2">
          <input
            type="checkbox"
            checked={useCurrents}
            onChange={(e) => setUseCurrents(e.target.checked)}
            className="bg-slate-900 border border-slate-700 rounded"
          />
          Use surface currents (RTOFS)
        </label>
      </div>
      <button
        disabled={loading}
        onClick={onScan}
        className="bg-emerald-700 disabled:bg-slate-700 px-4 py-2 rounded text-sm"
      >
        {loading ? 'Scanning…' : 'Scan window'}
      </button>
      {error && <div className="text-rose-400 text-xs">{error}</div>}
      {results && (
        <div className="space-y-2">
          <div className="text-xs text-slate-400">
            {results.length} departures · click a cell to drill into that route
          </div>
          <WindowHeatmap results={results} onPick={onPick} />
        </div>
      )}
    </main>
  );
}
