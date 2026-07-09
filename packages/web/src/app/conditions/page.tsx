'use client';
import { useCallback, useEffect, useState } from 'react';
import { fmtTimestamp } from '../../lib/tz';
import { useShipClock } from '../../lib/use-ship-clock';
import { Panel } from '../../components/ui';
import { Button } from '../../components/ui';
import { DataTable } from '../../components/ui';
import type { ColumnDef } from '../../components/ui/DataTable';

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

// Fixed forecast hours: every 3 h out to 168 h (7 days).
const FORECAST_HOURS: number[] = Array.from({ length: 57 }, (_, i) => i * 3);

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

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

// ── Broadcast helper — also used by /conditions/models via BroadcastChannel ───

function broadcastForecastRefresh(): void {
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel('forecast-cache');
    bc.postMessage({ kind: 'fetch-complete', at: Date.now() });
    bc.close();
  }
}

// ── DataTable column definitions ─────────────────────────────────────────────

interface AvailRow {
  id: string;
  model: string;
  latestRun: string;
  age: string;
  nextRun: string;
}

const AVAIL_COLS: ColumnDef<AvailRow>[] = [
  { key: 'model', label: 'Model', sortable: false, align: 'left', render: (r) => r.model },
  { key: 'latestRun', label: 'Latest run', sortable: false, render: (r) => r.latestRun },
  { key: 'age', label: 'Age', sortable: false, render: (r) => r.age },
  { key: 'nextRun', label: 'Next run', sortable: false, render: (r) => r.nextRun },
];

interface GridRow {
  id: string;
  model: string;
  fh: string;
  run: string;
  valid: string;
  bbox: string;
  age: string;
}

const GRID_COLS: ColumnDef<GridRow>[] = [
  { key: 'model', label: 'Model', sortable: false, align: 'left', render: (r) => r.model },
  { key: 'fh', label: '+h', sortable: true, render: (r) => r.fh, sortValue: (r) => parseInt(r.fh) },
  { key: 'run', label: 'Run', sortable: false, render: (r) => r.run },
  { key: 'valid', label: 'Valid', sortable: false, render: (r) => r.valid },
  { key: 'bbox', label: 'Bbox', sortable: false, render: (r) => r.bbox },
  { key: 'age', label: 'Age', sortable: false, render: (r) => r.age },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  const clock = useShipClock();
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

  // Listen for refresh events from /conditions/models (and vice-versa)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('forecast-cache');
    bc.onmessage = () => void reloadManifest();
    return () => bc.close();
  }, [reloadManifest]);

  const runFetch = async (): Promise<void> => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      const s = await fetch('/api/settings', { cache: 'no-store' });
      const sj = (await s.json()) as { settings?: { forecastBbox?: ManifestEntry['bbox'] } };
      const bbox = sj.settings?.forecastBbox;
      if (!bbox) {
        setErr('No forecast ROI set yet — drag the ROI box on the chart first.');
        return;
      }
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
      broadcastForecastRefresh();
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

  // ── Build DataTable rows ──────────────────────────────────────────────────

  const availRows: AvailRow[] = (['gfs', 'ecmwf'] as WindModel[]).flatMap((m) => {
    const a = manifest?.availability?.[m];
    if (!a) return [];
    const ageSec = now - a.latestRunUnix;
    const untilNext = a.nextRunAvailableUnix - now;
    return [
      {
        id: m,
        model: m.toUpperCase(),
        latestRun: fmtTimestamp(a.latestRunUnix, clock),
        age: fmtAge(ageSec) + ' ago',
        nextRun: `${fmtTimestamp(a.nextRunAvailableUnix, clock)} (${fmtDuration(untilNext)})`,
      },
    ];
  });

  const gridRows: GridRow[] = (manifest?.entries ?? []).map((e, i) => ({
    id: String(i),
    model: e.model.toUpperCase(),
    fh: `+${e.forecastHour}h`,
    run: fmtTimestamp(e.runAt, clock),
    valid: fmtTimestamp(e.validAt, clock),
    bbox: `${e.bbox.latMin.toFixed(1)}…${e.bbox.latMax.toFixed(1)}N ${e.bbox.lonMin.toFixed(1)}…${e.bbox.lonMax.toFixed(1)}E`,
    age: fmtAge(now - Math.floor(e.fetchedAt / 1000)),
  }));

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Forecast data</h1>
        <Button variant="secondary" size="sm" onClick={() => void reloadManifest()}>
          Reload manifest
        </Button>
      </div>

      {err && <p className="text-body-sm text-danger">{err}</p>}

      {/* Run availability */}
      <Panel label="Run availability">
        {availRows.length === 0 ? (
          <p className="text-body-sm text-ink-3">Loading availability…</p>
        ) : (
          <DataTable columns={AVAIL_COLS} rows={availRows} rowKey={(r) => r.id} />
        )}
      </Panel>

      {/* Refresh forecast cache */}
      <Panel label="Refresh forecast cache">
        <div className="space-y-3">
          <p className="text-body-sm text-ink-3">
            Fetches GFS + ECMWF for the forecast ROI (the draggable box on the chart), every 3 h out
            to +168 h (57 snapshots/model). The Pi runs the same refresh on a 3 h timer in the
            background; this button lets you trigger one out of band. Partial 404s (ECMWF when its
            run hasn&apos;t published yet) are normal.
          </p>
          <Button variant="primary" onClick={() => void runFetch()} disabled={busy}>
            {busy ? 'Starting…' : 'Refresh now'}
          </Button>
          {notice && <p className="text-body-sm text-ok">{notice}</p>}
        </div>
      </Panel>

      {/* Surface currents (CMEMS) */}
      <Panel label="Surface currents (CMEMS)">
        <div className="space-y-3">
          <p className="text-body-sm text-ink-3">
            Copernicus Marine daily-mean surface currents (1/12°). Covers the Gulf Stream region
            plus your wind ROI (combined into one box). The Pi refreshes this automatically on the
            same 3 h timer; this button triggers one out of band.
          </p>
          <Button variant="primary" onClick={() => void runCmemsFetch()} disabled={cmemsBusy}>
            {cmemsBusy ? 'Fetching CMEMS…' : 'Refresh CMEMS'}
          </Button>
          {cmemsNotice && <p className="text-body-sm text-ok">{cmemsNotice}</p>}
        </div>
      </Panel>

      {/* Cached grids */}
      <Panel
        label={`Cached grids (${manifest?.entries.length ?? 0})`}
        action={
          <Button variant="ghost" size="sm" onClick={() => void reloadManifest()}>
            ↻
          </Button>
        }
      >
        {!manifest || manifest.entries.length === 0 ? (
          <p className="text-body-sm text-ink-3">
            Nothing cached yet. Drag the forecast ROI box on the chart, or click Refresh now.
          </p>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <DataTable columns={GRID_COLS} rows={gridRows} rowKey={(r) => r.id} />
          </div>
        )}
      </Panel>
    </main>
  );
}
