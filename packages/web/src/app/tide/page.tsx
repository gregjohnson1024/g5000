'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { interpolateHeight, tideSnapshot } from '@g5000/tide';
import type { Station, TidalEvent } from '@g5000/tide';

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
  const [notConfigured, setNotConfigured] = useState(false);
  const [stations, setStations] = useState<Station[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<TidalEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick the "now" pointer once per minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch active pin and update state.
  const refreshActive = useCallback(async () => {
    const r = await fetch('/api/tide/active');
    if (!r.ok) return;
    const j = (await r.json()) as { ok: boolean; stationId: string | null };
    if (j.ok) setPinnedId(j.stationId ?? null);
  }, []);

  // Mount: fetch stations + active.
  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/tide/stations');
      // Parse body exactly once; treat network errors or missing ok as unconfigured.
      const j = await r.json().catch(() => ({ ok: false, stations: [] })) as {
        ok: boolean;
        stations: Station[];
      };
      if (!r.ok || !j.ok) {
        setNotConfigured(true);
        return;
      }
      const sorted = [...j.stations].sort((a, b) => a.name.localeCompare(b.name));
      setStations(sorted);

      // Also fetch active to set default selection.
      const ar = await fetch('/api/tide/active');
      if (ar.ok) {
        const aj = (await ar.json()) as { ok: boolean; stationId: string | null };
        if (aj.ok && aj.stationId) {
          setPinnedId(aj.stationId);
          // Use pinned station as default selection only if it exists in list.
          const inList = sorted.some((s) => s.id === aj.stationId);
          setSelectedId(inList ? aj.stationId : (sorted[0]?.id ?? null));
        } else {
          setSelectedId(sorted[0]?.id ?? null);
        }
      } else {
        setSelectedId(sorted[0]?.id ?? null);
      }
    })();
  }, []);

  // Fetch events whenever selected station changes.
  useEffect(() => {
    if (!selectedId) return;
    setLoadingEvents(true);
    void (async () => {
      const r = await fetch(`/api/tide/events?stationId=${encodeURIComponent(selectedId)}`);
      if (!r.ok) {
        setEvents([]);
        setLoadingEvents(false);
        return;
      }
      const j = (await r.json()) as { ok: boolean; events: TidalEvent[] };
      if (j.ok) {
        // Sort ascending by timeMs (defensive).
        const sorted = [...j.events].sort((a, b) => a.timeMs - b.timeMs);
        setEvents(sorted);
      } else {
        setEvents([]);
      }
      setLoadingEvents(false);
    })();
  }, [selectedId]);

  const handlePin = useCallback(async () => {
    if (!selectedId) return;
    const isCurrentlyPinned = pinnedId === selectedId;
    setPinning(true);
    await fetch('/api/tide/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stationId: isCurrentlyPinned ? null : selectedId }),
    });
    await refreshActive();
    setPinning(false);
  }, [selectedId, pinnedId, refreshActive]);

  // ── Derived display data ───────────────────────────────────────────────────
  const filtered = stations.filter(
    (s) =>
      s.name.toLowerCase().includes(filter.toLowerCase()) || s.id === selectedId,
  );
  const selectedStation = stations.find((s) => s.id === selectedId) ?? null;
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
  if (notConfigured) {
    return (
      <main className="p-6 max-w-3xl mx-auto text-slate-100">
        <h1 className="text-2xl font-semibold mb-4">Tide Planning</h1>
        <div className="p-4 bg-amber-900/40 border border-amber-700 rounded text-amber-200">
          <p className="font-medium">Tide API not configured</p>
          <p className="mt-1 text-sm text-amber-300">
            Set <code className="font-mono bg-amber-900/60 px-1 rounded">ADMIRALTY_TIDAL_API_KEY</code> to enable tide data.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-4xl mx-auto text-slate-100">
      <h1 className="text-2xl font-semibold mb-4">Tide Planning</h1>

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
          value={selectedId ?? ''}
          onChange={(e) => {
            setSelectedId(e.target.value || null);
          }}
          className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-slate-400"
          disabled={stations.length === 0}
        >
          {stations.length === 0 && <option value="">Loading stations…</option>}
          {filtered.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {pinnedId === s.id ? ' ★' : ''}
            </option>
          ))}
        </select>

        {selectedStation && (
          <button
            type="button"
            disabled={pinning}
            onClick={() => void handlePin()}
            className={`px-3 py-1.5 rounded text-sm font-medium disabled:opacity-40 ${
              pinnedId === selectedId
                ? 'bg-amber-700 hover:bg-amber-600 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-100'
            }`}
          >
            {pinning ? '…' : pinnedId === selectedId ? 'Un-pin' : 'Pin this station'}
          </button>
        )}
      </div>

      {/* Height curve */}
      {!loadingEvents && curvePts.length > 0 && (
        <div className="mb-4 bg-slate-900 border border-slate-700 rounded p-3">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            Height curve — {selectedStation?.name ?? ''}
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
              stroke="#475569"
              strokeDasharray="2 2"
            />
            {/* Curve */}
            <polyline points={polyline} fill="none" stroke="#38bdf8" strokeWidth="1.5" />
            {/* "Now" line */}
            {nowX !== null && (
              <>
                <line
                  x1={nowX}
                  y1={PAD.top}
                  x2={nowX}
                  y2={SVG_H - PAD.bottom}
                  stroke="#f97316"
                  strokeWidth="1.5"
                />
                <text
                  x={nowX + 3}
                  y={PAD.top + 10}
                  fill="#f97316"
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
              fill="#64748b"
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
                Now:{' '}
                <span className="text-sky-300">{snapshot.heightNowM.toFixed(2)} m</span>
                {snapshot.state && (
                  <span className="ml-2 text-slate-400">{snapshot.state}</span>
                )}
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

      {loadingEvents && (
        <div className="mb-4 text-sm text-slate-500">Loading tide events…</div>
      )}

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
                    <tr
                      key={ev.timeMs}
                      className="border-b border-slate-800 hover:bg-slate-900/40"
                    >
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
                      <td className="py-1.5 text-right">
                        {ev.heightM.toFixed(1)} m
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loadingEvents && events.length === 0 && selectedId && (
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
