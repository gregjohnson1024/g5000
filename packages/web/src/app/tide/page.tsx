'use client';

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { interpolateHeight, tideSnapshot } from '@g5000/tide';
import type { Station, TidalEvent } from '@g5000/tide';
import { fetchBoatFix } from '../../lib/boat-fix';
import { fmtDistanceNm, sortByDistanceNm, type LatLon } from '../../lib/station-distance';

// ── Types ────────────────────────────────────────────────────────────────────
type SourceId = 'admiralty' | 'chs';

interface PickerEntry {
  sourceId: SourceId;
  station: Station;
}

// Composite key used as <select> option value.
function entryKey(e: PickerEntry): string {
  return `${e.sourceId}:${e.station.id}`;
}

function parseEntryKey(key: string): { sourceId: SourceId; stationId: string } {
  const colon = key.indexOf(':');
  return {
    sourceId: key.slice(0, colon) as SourceId,
    stationId: key.slice(colon + 1),
  };
}

// ── SVG dimensions ──────────────────────────────────────────────────────────
const SVG_W = 700;
const SVG_H = 120;
const PAD = { top: 8, right: 12, bottom: 20, left: 36 };

// Sample the piecewise-cosine curve every 10 min across all event pairs.
function buildCurvePts(events: TidalEvent[]): { x: number; y: number }[] {
  if (events.length < 2) return [];
  const tMin = events[0]!.timeMs;
  const tMax = events[events.length - 1]!.timeMs;
  const tSpan = Math.max(1, tMax - tMin);
  const hVals = events.map((e) => e.heightM);
  const hMin = Math.min(...hVals);
  const hMax = Math.max(...hVals);
  const hSpan = Math.max(0.1, hMax - hMin);
  const plotW = SVG_W - PAD.left - PAD.right;
  const plotH = SVG_H - PAD.top - PAD.bottom;
  const STEP_MS = 10 * 60_000;
  const pts: { x: number; y: number }[] = [];
  for (let t = tMin; t <= tMax; t += STEP_MS) {
    // Find the bracketing pair for this sample.
    let h: number | null = null;
    for (let i = 0; i < events.length - 1; i++) {
      const a = events[i]!;
      const b = events[i + 1]!;
      if (a.timeMs <= t && t <= b.timeMs) {
        h = interpolateHeight(a.timeMs, a.heightM, b.timeMs, b.heightM, t);
        break;
      }
    }
    if (h === null) continue;
    const x = PAD.left + ((t - tMin) / tSpan) * plotW;
    // Invert y: higher height → lower y value (top of box).
    const y = PAD.top + (1 - (h - hMin) / hSpan) * plotH;
    pts.push({ x, y });
  }
  return pts;
}

function ptsToPolyline(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

// Format epoch ms as local date+time string.
function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Group events by local date string for the table.
function groupByDay(events: TidalEvent[]): Map<string, TidalEvent[]> {
  const m = new Map<string, TidalEvent[]>();
  for (const ev of events) {
    const key = new Date(ev.timeMs).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(ev);
  }
  return m;
}

export default function TidePage() {
  // pickerList is the flattened, sorted list of {sourceId, station} entries.
  const [pickerList, setPickerList] = useState<PickerEntry[]>([]);
  // stationsLoaded tracks whether the initial fetch has completed.
  const [stationsLoaded, setStationsLoaded] = useState(false);
  // tideSource from /api/tide/active (auto|admiralty|chs).
  const [tideSource, setTideSource] = useState<string | null>(null);
  // pinnedStationId + pinnedSourceId from /api/tide/active.
  const [pinnedStationId, setPinnedStationId] = useState<string | null>(null);
  const [pinnedSourceId, setPinnedSourceId] = useState<string | null>(null);
  // selectedKey is a composite "sourceId:stationId" string.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [events, setEvents] = useState<TidalEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Feature gate: settings.canadianTideCurrents (default false). null = loading.
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  // One-shot boat fix for station distances; null = no fix (render undistanced).
  const [boatFix, setBoatFix] = useState<LatLon | null>(null);

  // Mount: read the feature gate and grab a one-shot fix for distances.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setFeatureEnabled(j?.settings?.canadianTideCurrents === true);
      })
      .catch(() => {
        if (!cancelled) setFeatureEnabled(false);
      });
    void fetchBoatFix().then((f) => {
      if (!cancelled) setBoatFix(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Tick the "now" pointer once per minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch active pin state and update.
  const refreshActive = useCallback(async () => {
    const r = await fetch('/api/tide/active');
    if (!r.ok) return;
    const j = (await r.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      tideSource?: string;
      pinnedStationId?: string | null;
      pinnedSourceId?: string | null;
    };
    if (j.ok) {
      setTideSource(j.tideSource ?? null);
      setPinnedStationId(j.pinnedStationId ?? null);
      setPinnedSourceId(j.pinnedSourceId ?? null);
    }
  }, []);

  // Mount: fetch stations + active, then choose the selected entry ONCE
  // with precedence query-param > pinned > first. Computing it in one place
  // avoids a late /api/tide/active callback overwriting a deep-link selection.
  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/tide/stations');
      const j = (await r.json().catch(() => ({ ok: false, sources: {} }))) as {
        ok: boolean;
        sources: Record<string, Station[]>;
      };

      const entries: PickerEntry[] = [];
      if (r.ok && j.ok) {
        for (const [srcId, stationArr] of Object.entries(j.sources)) {
          for (const station of stationArr) {
            entries.push({ sourceId: srcId as SourceId, station });
          }
        }
        entries.sort((a, b) => a.station.name.localeCompare(b.station.name));
      }
      setPickerList(entries);
      setStationsLoaded(true);

      // (1) Query-param selection (highest precedence).
      const params = new URLSearchParams(window.location.search);
      const qStation = params.get('station');
      const qSource = params.get('source');
      let queryKey: string | null = null;
      if (qStation) {
        const match = entries.find(
          (e) => e.station.id === qStation && (!qSource || e.sourceId === qSource),
        );
        if (match) queryKey = entryKey(match);
      }

      // (2) Pinned default — also drives the source label. Fetch regardless.
      let pinnedKey: string | null = null;
      const ar = await fetch('/api/tide/active');
      if (ar.ok) {
        const aj = (await ar.json()) as {
          ok: boolean;
          tideSource?: string;
          pinnedStationId?: string | null;
          pinnedSourceId?: string | null;
        };
        if (aj.ok) {
          setTideSource(aj.tideSource ?? null);
          const psId = aj.pinnedStationId ?? null;
          const pSrc = aj.pinnedSourceId ?? null;
          setPinnedStationId(psId);
          setPinnedSourceId(pSrc);
          if (psId && pSrc) {
            const pk = `${pSrc}:${psId}`;
            if (entries.some((e) => entryKey(e) === pk)) pinnedKey = pk;
          }
        }
      }

      // (3) First entry as the final fallback. Select once.
      const firstKey = entries[0] ? entryKey(entries[0]) : null;
      setSelectedKey(queryKey ?? pinnedKey ?? firstKey);
    })();
  }, []);

  // Fetch events whenever selected entry changes.
  useEffect(() => {
    if (!selectedKey) return;
    const { sourceId, stationId } = parseEntryKey(selectedKey);
    setLoadingEvents(true);
    void (async () => {
      const r = await fetch(
        `/api/tide/events?stationId=${encodeURIComponent(stationId)}&source=${encodeURIComponent(sourceId)}`,
      );
      if (!r.ok) {
        setEvents([]);
        setLoadingEvents(false);
        return;
      }
      const j = (await r.json()) as { ok: boolean; events: TidalEvent[] };
      if (j.ok) {
        const sorted = [...j.events].sort((a, b) => a.timeMs - b.timeMs);
        setEvents(sorted);
      } else {
        setEvents([]);
      }
      setLoadingEvents(false);
    })();
  }, [selectedKey]);

  const handlePin = useCallback(async () => {
    if (!selectedKey) return;
    const { sourceId, stationId } = parseEntryKey(selectedKey);
    const isCurrentlyPinned = pinnedStationId === stationId && pinnedSourceId === sourceId;
    setPinning(true);
    await fetch('/api/tide/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isCurrentlyPinned ? { stationId: null } : { stationId, sourceId }),
    });
    await refreshActive();
    setPinning(false);
  }, [selectedKey, pinnedStationId, pinnedSourceId, refreshActive]);

  // ── Derived display data ───────────────────────────────────────────────────
  const multiSource = new Set(pickerList.map((e) => e.sourceId)).size > 1;

  // Distance-annotated list, closest-first when a fix is available; otherwise
  // the original (name-sorted) order with null distances.
  const annotated = useMemo(
    () => sortByDistanceNm(pickerList, boatFix, (e) => e.station),
    [pickerList, boatFix],
  );

  const filtered = annotated.filter(
    ({ item: e }) =>
      e.station.name.toLowerCase().includes(filter.toLowerCase()) || entryKey(e) === selectedKey,
  );

  const selectedEntry = selectedKey
    ? (pickerList.find((e) => entryKey(e) === selectedKey) ?? null)
    : null;

  const isPinned =
    !!selectedEntry &&
    pinnedStationId === selectedEntry.station.id &&
    pinnedSourceId === selectedEntry.sourceId;

  const curvePts = events.length >= 2 ? buildCurvePts(events) : [];
  const polyline = ptsToPolyline(curvePts);
  const snapshot = events.length >= 2 ? tideSnapshot(events, now) : null;

  // Compute "now" x position for the vertical marker.
  const nowX = (() => {
    if (events.length < 2) return null;
    const tMin = events[0]!.timeMs;
    const tMax = events[events.length - 1]!.timeMs;
    if (now < tMin || now > tMax) return null;
    const plotW = SVG_W - PAD.left - PAD.right;
    return PAD.left + ((now - tMin) / Math.max(1, tMax - tMin)) * plotW;
  })();

  const dayGroups = groupByDay(events);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Feature gate: hidden by default until settings.canadianTideCurrents is on.
  if (featureEnabled !== true) {
    return (
      <main className="p-6 max-w-3xl mx-auto text-slate-100">
        <h1 className="text-2xl font-semibold mb-4">Tide Planning</h1>
        {featureEnabled === false && (
          <p className="text-sm text-slate-400">
            Canadian Tide/Currents is disabled — enable it in{' '}
            <Link href="/settings" className="text-sky-400 underline">
              Settings
            </Link>
            .
          </p>
        )}
      </main>
    );
  }

  // No-source state: loaded but nothing came back.
  if (stationsLoaded && pickerList.length === 0) {
    return (
      <main className="p-6 max-w-3xl mx-auto text-slate-100">
        <h1 className="text-2xl font-semibold mb-4">Tide Planning</h1>
        <div className="p-4 bg-amber-900/40 border border-amber-700 rounded text-amber-200">
          <p className="font-medium">No tide source available yet</p>
          <p className="mt-1 text-sm text-amber-300">
            Waiting for position, or set{' '}
            <code className="font-mono bg-amber-900/60 px-1 rounded">ADMIRALTY_TIDAL_API_KEY</code>{' '}
            for UK waters.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-4xl mx-auto text-slate-100">
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Tide Planning</h1>
        {selectedEntry && (
          <span className="text-sm text-slate-400">
            Source:{' '}
            <span className="font-medium text-slate-200 uppercase">{selectedEntry.sourceId}</span>
            {tideSource && (
              <span className="ml-2 text-xs text-slate-500">(mode: {tideSource})</span>
            )}
          </span>
        )}
      </div>

      {/* Station picker */}
      <div className="mb-4 flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Filter stations…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-none w-full sm:w-48 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-400"
        />
        <select
          value={selectedKey ?? ''}
          onChange={(e) => {
            setSelectedKey(e.target.value || null);
          }}
          className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-slate-400"
          disabled={pickerList.length === 0}
        >
          {pickerList.length === 0 && !stationsLoaded && (
            <option value="">Loading stations…</option>
          )}
          {filtered.map(({ item: e, distanceNm }) => {
            const key = entryKey(e);
            const isEntryPinned = pinnedStationId === e.station.id && pinnedSourceId === e.sourceId;
            const label = multiSource ? `${e.station.name} (${e.sourceId})` : e.station.name;
            return (
              <option key={key} value={key}>
                {label}
                {distanceNm !== null ? ` — ${fmtDistanceNm(distanceNm)}` : ''}
                {isEntryPinned ? ' ★' : ''}
              </option>
            );
          })}
        </select>

        {selectedEntry && (
          <button
            type="button"
            disabled={pinning}
            onClick={() => void handlePin()}
            className={`px-3 py-1.5 rounded text-sm font-medium disabled:opacity-40 ${
              isPinned
                ? 'bg-amber-700 hover:bg-amber-600 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-100'
            }`}
          >
            {pinning ? '…' : isPinned ? 'Un-pin' : 'Pin this station'}
          </button>
        )}
      </div>

      {/* Height curve */}
      {!loadingEvents && curvePts.length > 0 && (
        <div className="mb-4 bg-slate-900 border border-slate-700 rounded p-3">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            Height curve — {selectedEntry?.station.name ?? ''}
          </div>
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full"
            style={{ height: `${SVG_H * 1.2}px` }}
          >
            {/* Zero baseline (lowest displayed height) */}
            <line
              x1={PAD.left}
              y1={SVG_H - PAD.bottom}
              x2={SVG_W - PAD.right}
              y2={SVG_H - PAD.bottom}
              stroke="var(--ink-4)"
              strokeDasharray="2 2"
            />
            {/* Curve */}
            <polyline points={polyline} fill="none" stroke="var(--info)" strokeWidth="1.5" />
            {/* "Now" line */}
            {nowX !== null && (
              <>
                <line
                  x1={nowX}
                  y1={PAD.top}
                  x2={nowX}
                  y2={SVG_H - PAD.bottom}
                  stroke="var(--flow-ebb)"
                  strokeWidth="1.5"
                />
                <text
                  x={nowX + 3}
                  y={PAD.top + 10}
                  fill="var(--flow-ebb)"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  now
                </text>
              </>
            )}
            {/* Y axis label */}
            <text
              x={PAD.left - 4}
              y={SVG_H - PAD.bottom}
              fill="var(--ink-3)"
              fontSize="8"
              textAnchor="end"
            >
              m
            </text>
          </svg>

          {/* Snapshot readout */}
          <div className="mt-1 text-xs font-mono text-slate-300">
            {snapshot?.heightNowM != null ? (
              <>
                Now: <span className="text-sky-300">{snapshot.heightNowM.toFixed(2)} m</span>
                {snapshot.state && <span className="ml-2 text-slate-400">{snapshot.state}</span>}
                {snapshot.next && (
                  <span className="ml-2 text-slate-400">
                    → {snapshot.next.type} {snapshot.next.heightM.toFixed(2)} m at{' '}
                    {fmtTime(snapshot.next.timeMs)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-500">— outside forecast window</span>
            )}
          </div>
        </div>
      )}

      {loadingEvents && <div className="mb-4 text-sm text-slate-500">Loading tide events…</div>}

      {/* Tide table */}
      {!loadingEvents && events.length > 0 && (
        <div className="mb-4">
          <table className="w-full text-sm font-mono border-collapse">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left py-2 pr-4">Time (local)</th>
                <th className="text-left py-2 pr-4">Type</th>
                <th className="text-right py-2">Height</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(dayGroups.entries()).map(([day, dayEvents]) => (
                <Fragment key={day}>
                  <tr>
                    <td
                      colSpan={3}
                      className="pt-3 pb-1 text-xs uppercase tracking-wide text-slate-500"
                    >
                      {day}
                    </td>
                  </tr>
                  {dayEvents.map((ev) => (
                    <tr key={ev.timeMs} className="border-b border-slate-800 hover:bg-slate-900/40">
                      <td className="py-1.5 pr-4 text-slate-300">
                        {new Date(ev.timeMs).toLocaleString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td
                        className={`py-1.5 pr-4 font-semibold ${
                          ev.type === 'HW' ? 'text-sky-300' : 'text-slate-400'
                        }`}
                      >
                        {ev.type}
                      </td>
                      <td className="py-1.5 text-right">{ev.heightM.toFixed(1)} m</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loadingEvents && events.length === 0 && selectedKey && (
        <div className="text-sm text-slate-500">No events available for this station.</div>
      )}

      {/* Disclaimer labels */}
      <div className="mt-6 space-y-0.5 text-[11px] text-slate-500">
        <p>Heights in metres above Chart Datum.</p>
        <p>Approximate curve — not for under-keel clearance.</p>
        <p>Free tier: 7-day horizon.</p>
      </div>
    </main>
  );
}
