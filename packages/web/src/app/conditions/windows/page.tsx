'use client';

/**
 * /conditions/windows — Departure-window scan.
 *
 * Phase 6 task-2:
 *   - Native inputs/select/checkbox → Field family (TextField, NumberField, SelectField, Checkbox).
 *   - WindowHeatmap → HeatmapGrid + RampLegend (mandatory legend; canonical-ramp law).
 *   - onPick: writes chart:planState in localStorage then navigates to /chart
 *     (was window.location.href = '/?...', now uses chart planState + router.push).
 *   - Retokenized (Panel + Button primitives; no raw slate-* classes).
 */

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Panel, Button } from '../../../components/ui';
import { HeatmapGrid, RampLegend, buildStops, type HeatmapCell } from '../../../components/charts';
import {
  TextField,
  NumberField,
  SelectField,
  Checkbox,
  type SelectOption,
} from '../../../components/ui/fields';

// ── Types ─────────────────────────────────────────────────────────────────────

type Pos = { lat: number; lon: number };

interface WindowResult {
  departure: number;
  eta: number;
  distance: number;
  meanTws: number;
  maxTws: number;
  incomplete?: boolean;
  reason?: 'exceeded_max_hours' | 'no_wind' | 'land_blocked';
}

function parseLatLon(s: string): Pos | undefined {
  const parts = s.split(',').map((x) => Number(x.trim()));
  if (parts.length !== 2) return undefined;
  const lat = parts[0];
  const lon = parts[1];
  if (lat === undefined || lon === undefined) return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return { lat, lon };
}

// ── Model selector options ────────────────────────────────────────────────────

const MODEL_OPTIONS: SelectOption<'GFS' | 'ECMWF'>[] = [
  { value: 'GFS', label: 'GFS (NOAA)' },
  { value: 'ECMWF', label: 'ECMWF' },
];

// ── HeatmapGrid helpers ───────────────────────────────────────────────────────

/**
 * Build cells + axes from window results.
 *
 * Layout: rows = UTC day, columns = hour-of-day at the departure step.
 * Value: ETA duration in hours (lower = better = darker blue).
 * Incomplete results get a sentinel value that renders as '—' at full ramp.
 */
function buildHeatmap(results: WindowResult[]): {
  cells: HeatmapCell[];
  rowLabels: string[];
  colLabels: string[];
  rows: number;
  cols: number;
  domainMax: number;
} {
  if (results.length === 0) {
    return { cells: [], rowLabels: [], colLabels: [], rows: 0, cols: 0, domainMax: 1 };
  }

  // Extract unique UTC days (row) and departure hours (col)
  const days = new Map<string, number>(); // ISO date → row index
  const hours = new Map<number, number>(); // hour-of-day → col index

  for (const r of results) {
    const d = new Date(r.departure * 1000);
    const dayKey = d.toISOString().slice(0, 10);
    if (!days.has(dayKey)) days.set(dayKey, days.size);
    const h = d.getUTCHours();
    if (!hours.has(h)) hours.set(h, hours.size);
  }

  const rowLabels = Array.from(days.keys());
  const colLabels = Array.from(hours.keys()).map((h) => `${String(h).padStart(2, '0')}z`);

  const completeResults = results.filter((r) => !r.incomplete);
  const etaHours = completeResults.map((r) => (r.eta - r.departure) / 3600);
  const domainMax = etaHours.length > 0 ? Math.max(...etaHours) : 200;

  const cells: HeatmapCell[] = results.map((r) => {
    const d = new Date(r.departure * 1000);
    const dayKey = d.toISOString().slice(0, 10);
    const h = d.getUTCHours();
    const row = days.get(dayKey)!;
    const col = hours.get(h)!;

    if (r.incomplete) {
      return {
        row,
        col,
        value: domainMax, // top of scale = worst
        label: r.reason === 'land_blocked' ? 'blk' : r.reason === 'no_wind' ? 'nwnd' : '…',
      };
    }

    const etaH = (r.eta - r.departure) / 3600;
    return {
      row,
      col,
      value: etaH,
      label: `${etaH.toFixed(0)}h`,
    };
  });

  return {
    cells,
    rowLabels,
    colLabels,
    rows: days.size,
    cols: hours.size,
    domainMax,
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WindowPage() {
  const router = useRouter();

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
    // windowStart is a datetime-local string — treat as UTC (user sees "z" suffix in label)
    const ts = Math.floor(new Date(windowStart + ':00Z').getTime() / 1000);
    if (!Number.isFinite(ts)) {
      setError('Invalid window-start datetime.');
      return;
    }
    setLoading(true);
    try {
      const polarRes = await fetch('/api/wardrobe/active');
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

  /**
   * When the user picks a departure window:
   *   1. Write chart:planState with the departure+route info so /chart can
   *      restore the route and pre-select the departure time.
   *   2. Push to /chart (preserves the keep-list: onPick chart handoff).
   */
  const onPick = (cell: HeatmapCell) => {
    if (!results) return;

    // Find the WindowResult that corresponds to this cell.
    // Build the same day/hour mapping used by buildHeatmap to reverse-look up.
    const days = new Map<string, number>();
    const hours = new Map<number, number>();
    for (const r of results) {
      const d = new Date(r.departure * 1000);
      const dayKey = d.toISOString().slice(0, 10);
      if (!days.has(dayKey)) days.set(dayKey, days.size);
      const h = d.getUTCHours();
      if (!hours.has(h)) hours.set(h, hours.size);
    }

    const result = results.find((r) => {
      const d = new Date(r.departure * 1000);
      return (
        days.get(d.toISOString().slice(0, 10)) === cell.row &&
        hours.get(d.getUTCHours()) === cell.col
      );
    });
    if (!result) return;

    const start = parseLatLon(startStr);
    const end = parseLatLon(endStr);
    if (!start || !end) return;

    // Write chart:planState so /chart can restore the route
    try {
      const planState = {
        departure: result.departure,
        start,
        end,
        model,
        pickedAt: Date.now(),
      };
      localStorage.setItem('chart:planState', JSON.stringify(planState));
    } catch {
      // localStorage unavailable — graceful no-op
    }

    router.push('/chart');
  };

  // ── Heatmap data ─────────────────────────────────────────────────────────────

  const stops = useMemo(() => buildStops('sequential'), []);

  const { cells, rowLabels, colLabels, rows, cols, domainMax } = useMemo(
    () => buildHeatmap(results ?? []),
    [results],
  );

  const domain = useMemo(
    () => ({ mode: 'sequential' as const, min: 0, max: domainMax }),
    [domainMax],
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold text-ink">Departure-window scan</h1>

      {/* Form inputs */}
      <Panel label="Route & timing">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <TextField
            label="Start (lat, lon)"
            value={startStr}
            onChange={setStartStr}
            placeholder="32.30, -64.78"
          />
          <TextField
            label="End (lat, lon)"
            value={endStr}
            onChange={setEndStr}
            placeholder="41.49, -71.31"
          />
          <div>
            <label className="text-label uppercase tracking-wider text-ink-2 block mb-1">
              Window start (UTC)
            </label>
            {/* datetime-local is inherently local-time in the browser; we label it UTC
                and parse with Z suffix to treat it as UTC per the keep-list convention. */}
            <input
              type="datetime-local"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className="w-full bg-surface-sunken border border-hairline rounded-[--r-control] text-ink px-3 h-11 text-body focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
            />
            <p className="text-caption text-ink-3 mt-1">Enter in UTC</p>
          </div>
          <SelectField
            label="Wind model"
            value={model}
            onChange={(v) => setModel(v as 'GFS' | 'ECMWF')}
            options={MODEL_OPTIONS}
          />
          <NumberField
            label="Window length"
            value={windowHours}
            onChange={setWindowHours}
            min={1}
            unit="h"
          />
          <NumberField label="Step" value={stepHours} onChange={setStepHours} min={1} unit="h" />
          <div className="sm:col-span-2">
            <Checkbox
              label="Use surface currents (CMEMS)"
              checked={useCurrents}
              onChange={setUseCurrents}
            />
          </div>
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={loading} onClick={() => void onScan()}>
          {loading ? 'Scanning…' : 'Scan window'}
        </Button>
        {error && <p className="text-body-sm text-danger">{error}</p>}
      </div>

      {/* Results heatmap */}
      {results && (
        <Panel label="Departure windows" chip="ok" chipLabel={`${results.length} departures`}>
          <p className="text-caption text-ink-3 mb-3">
            Rows = UTC day · Columns = departure hour · Value = passage duration (h). Tap a cell to
            open it on the chart.
          </p>

          {rows > 0 && (
            <div className="space-y-3">
              <HeatmapGrid
                cells={cells}
                rows={rows}
                cols={cols}
                rowLabels={rowLabels}
                colLabels={colLabels}
                cornerLabel="Date / Hour"
                mode="sequential"
                stops={stops}
                domain={domain}
                onSelect={onPick}
              />
              {/* Mandatory legend — canonical-ramp law */}
              <RampLegend
                stops={stops}
                domain={domain}
                unit="h (passage duration)"
                className="max-w-xs"
              />
            </div>
          )}

          {rows === 0 && (
            <p className="text-body-sm text-ink-4">No complete departure windows found.</p>
          )}
        </Panel>
      )}
    </main>
  );
}
