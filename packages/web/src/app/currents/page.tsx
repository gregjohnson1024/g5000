'use client';

import { useEffect, useState, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { currentNow, nextCurrentEvent } from '@g5000/tide';
import type { CurrentPrediction, CurrentEvent } from '@g5000/tide';
import { fetchBoatFix } from '../../lib/boat-fix';
import { fmtDistanceNm, sortByDistanceNm, type LatLon } from '../../lib/station-distance';

// ── Local types ───────────────────────────────────────────────────────────────

interface CurrentStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

// ── SVG dimensions ────────────────────────────────────────────────────────────

const SVG_W = 700;
const SVG_H = 120;
const PAD = { top: 8, right: 12, bottom: 20, left: 36 };
/** Minimum y-scale ceiling so an all-slack window doesn't divide by zero. */
const SPEED_FLOOR_KN = 0.5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ptsToPolyline(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function buildSpeedPolyline(
  predictions: CurrentPrediction[],
  tMin: number,
  tMax: number,
  yMax: number,
): { x: number; y: number }[] {
  if (predictions.length < 2) return [];
  const tSpan = Math.max(1, tMax - tMin);
  const plotW = SVG_W - PAD.left - PAD.right;
  const plotH = SVG_H - PAD.top - PAD.bottom;
  return predictions.map((p) => {
    const x = PAD.left + ((p.timeMs - tMin) / tSpan) * plotW;
    // Invert y: higher speed → lower y value (top of box = faster).
    const speed = Number.isFinite(p.speedKn) ? p.speedKn : 0;
    const y = PAD.top + (1 - speed / yMax) * plotH;
    return { x, y };
  });
}

function eventToX(timeMs: number, tMin: number, tMax: number): number {
  const tSpan = Math.max(1, tMax - tMin);
  const plotW = SVG_W - PAD.left - PAD.right;
  return PAD.left + ((timeMs - tMin) / tSpan) * plotW;
}

function eventToY(speedKn: number, yMax: number): number {
  const plotH = SVG_H - PAD.top - PAD.bottom;
  const speed = Number.isFinite(speedKn) ? speedKn : 0;
  return PAD.top + (1 - speed / yMax) * plotH;
}

// Token references — resolved via CSS custom properties at render time.
const EVENT_COLOURS: Record<string, string> = {
  slack: 'var(--flow-slack)',
  flood: 'var(--flow-flood)',
  ebb: 'var(--flow-ebb)',
};

const EVENT_LETTERS: Record<string, string> = {
  slack: 'S',
  flood: 'F',
  ebb: 'E',
};

const EVENT_LABELS: Record<string, string> = {
  slack: 'Slack',
  flood: 'Max flood',
  ebb: 'Max ebb',
};

// Format direction as 3-digit degrees true, e.g. "054°".
function fmtDir(deg: number): string {
  const rounded = ((Math.round(deg) % 360) + 360) % 360;
  return String(rounded).padStart(3, '0') + '°';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CurrentsPage() {
  const [stations, setStations] = useState<CurrentStation[]>([]);
  const [stationsError, setStationsError] = useState(false);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [predictions, setPredictions] = useState<CurrentPrediction[]>([]);
  const [events, setEvents] = useState<CurrentEvent[]>([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
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

  // Tick "now" every minute so the line + readout stay live.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch stations on mount.
  useEffect(() => {
    let ignored = false;
    void (async () => {
      try {
        const r = await fetch('/api/currents/stations');
        const j = (await r.json().catch(() => ({ ok: false, stations: [] }))) as {
          ok: boolean;
          stations: CurrentStation[];
        };
        if (ignored) return;
        if (!r.ok || !j.ok) {
          setStationsError(true);
          setStationsLoaded(true);
          return;
        }
        const sorted = [...j.stations].sort((a, b) => a.name.localeCompare(b.name));
        setStations(sorted);
        const qid = new URLSearchParams(window.location.search).get('station');
        const initialId = qid && sorted.some((s) => s.id === qid) ? qid : (sorted[0]?.id ?? null);
        setSelectedId(initialId);
        setStationsLoaded(true);
      } catch {
        if (ignored) return;
        setStationsError(true);
        setStationsLoaded(true);
      }
    })();
    return () => {
      ignored = true;
    };
  }, []);

  // Fetch predictions + events when selected station changes.
  useEffect(() => {
    if (!selectedId) return;
    let ignored = false;
    setLoadingPredictions(true);
    void (async () => {
      try {
        const r = await fetch(
          `/api/currents/predictions?stationId=${encodeURIComponent(selectedId)}`,
        );
        if (ignored) return;
        if (!r.ok) {
          setPredictions([]);
          setEvents([]);
          setLoadingPredictions(false);
          return;
        }
        const j = (await r.json().catch(() => ({ ok: false, predictions: [], events: [] }))) as {
          ok: boolean;
          predictions: CurrentPrediction[];
          events: CurrentEvent[];
        };
        if (ignored) return;
        if (j.ok) {
          const sortedPreds = [...j.predictions].sort((a, b) => a.timeMs - b.timeMs);
          const sortedEvents = [...j.events].sort((a, b) => a.timeMs - b.timeMs);
          setPredictions(sortedPreds);
          setEvents(sortedEvents);
        } else {
          setPredictions([]);
          setEvents([]);
        }
        setLoadingPredictions(false);
      } catch {
        if (ignored) return;
        setPredictions([]);
        setEvents([]);
        setLoadingPredictions(false);
      }
    })();
    return () => {
      ignored = true;
    };
  }, [selectedId]);

  // ── Derived values ────────────────────────────────────────────────────────

  // Distance-annotated list, closest-first when a fix is available; otherwise
  // the original (name-sorted) order with null distances.
  const annotated = useMemo(
    () => sortByDistanceNm(stations, boatFix, (s) => s),
    [stations, boatFix],
  );

  // Filter preserving selected station in list.
  const filtered = annotated.filter(
    ({ item: s }) => s.name.toLowerCase().includes(filter.toLowerCase()) || s.id === selectedId,
  );

  // Shared x-scale (derived from predictions window).
  const tMin = predictions.length > 0 ? predictions[0]!.timeMs : 0;
  const tMax = predictions.length > 0 ? predictions[predictions.length - 1]!.timeMs : 1;

  // y-scale ceiling — fold in event peak speeds so markers never clip.
  const yMax = Math.max(
    SPEED_FLOOR_KN,
    ...predictions.map((p) => p.speedKn).filter((v) => Number.isFinite(v)),
    ...events.map((e) => e.speedKn).filter((v) => Number.isFinite(v)),
  );

  const curvePts = predictions.length >= 2 ? buildSpeedPolyline(predictions, tMin, tMax, yMax) : [];
  const polyline = ptsToPolyline(curvePts);

  // Now-line x position, gated to x-range.
  const nowX = (() => {
    if (predictions.length < 2) return null;
    if (now < tMin || now > tMax) return null;
    return eventToX(now, tMin, tMax);
  })();

  // Current readout from @g5000/tide.
  const cn = predictions.length >= 2 ? currentNow(predictions, now) : null;
  const nextEv = events.length > 0 ? nextCurrentEvent(events, now) : null;

  const readout = (() => {
    if (!cn) return '—';
    const speedOk = Number.isFinite(cn.speedKn);
    const dirOk = Number.isFinite(cn.dirDeg);
    const speedStr = speedOk ? cn.speedKn.toFixed(1) + ' kn' : '— kn';
    const dirStr = dirOk ? 'Set ' + fmtDir(cn.dirDeg) : 'Set —';
    const base = `${dirStr} · Drift ${speedStr}`;
    if (nextEv) {
      return `${base} · → ${EVENT_LABELS[nextEv.kind] ?? nextEv.kind}`;
    }
    return base;
  })();

  // ── Early exit states ─────────────────────────────────────────────────────

  // Feature gate: hidden by default until settings.canadianTideCurrents is on.
  if (featureEnabled !== true) {
    return (
      <main className="p-6 max-w-3xl mx-auto text-slate-100">
        <h1 className="text-2xl font-semibold mb-4">Current Planning</h1>
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

  if (stationsError) {
    return (
      <main className="p-6 max-w-3xl mx-auto text-slate-100">
        <h1 className="text-2xl font-semibold mb-4">Current Planning</h1>
        <div className="p-4 bg-amber-900/40 border border-amber-700 rounded text-amber-200">
          <p className="font-medium">CHS currents unavailable — try again.</p>
        </div>
      </main>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="p-6 max-w-4xl mx-auto text-slate-100">
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-semibold">Current Planning</h1>
        <span className="text-xs text-slate-500">Predictions · next 48 h</span>
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
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-slate-400"
          disabled={!stationsLoaded || stations.length === 0}
        >
          {!stationsLoaded && <option value="">Loading stations…</option>}
          {filtered.map(({ item: s, distanceNm }) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {distanceNm !== null ? ` — ${fmtDistanceNm(distanceNm)}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Empty-stations message */}
      {stationsLoaded && !stationsError && stations.length === 0 && (
        <div className="mb-4 p-4 bg-amber-900/40 border border-amber-700 rounded text-amber-200">
          <p className="font-medium">No current-prediction stations available.</p>
        </div>
      )}

      {/* Drift-over-time graph */}
      {!loadingPredictions && curvePts.length > 0 && (
        <div className="mb-4 bg-slate-900 border border-slate-700 rounded p-3">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            Drift curve — {stations.find((s) => s.id === selectedId)?.name ?? ''}
          </div>
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full"
            style={{ height: `${SVG_H * 1.2}px` }}
          >
            {/* Zero baseline (speed = 0 at bottom) */}
            <line
              x1={PAD.left}
              y1={SVG_H - PAD.bottom}
              x2={SVG_W - PAD.right}
              y2={SVG_H - PAD.bottom}
              stroke="var(--ink-4)"
              strokeDasharray="2 2"
            />
            {/* Speed polyline */}
            <polyline points={polyline} fill="none" stroke="var(--flow-flood)" strokeWidth="1.5" />
            {/* Event markers — clamp x to plot area so out-of-span events stay at the edge */}
            {events.map((ev) => {
              const rawX = eventToX(ev.timeMs, tMin, tMax);
              const ex = Math.max(PAD.left, Math.min(SVG_W - PAD.right, rawX));
              const ey = eventToY(ev.speedKn, yMax);
              const colour = EVENT_COLOURS[ev.kind] ?? 'var(--ink-2)';
              const letter = EVENT_LETTERS[ev.kind] ?? '?';
              return (
                <Fragment key={`${ev.kind}-${ev.timeMs}`}>
                  <circle cx={ex} cy={ey} r={5} fill={colour} opacity={0.85} />
                  <text
                    x={ex}
                    y={ey + 4}
                    textAnchor="middle"
                    fill="var(--surface)"
                    fontSize="7"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {letter}
                  </text>
                </Fragment>
              );
            })}
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
              kn
            </text>
          </svg>

          {/* Now readout */}
          <div className="mt-1 text-xs font-mono text-slate-300">
            <span className="text-slate-500 mr-1">Now:</span>
            {cn ? (
              <span className="text-sky-300">{readout}</span>
            ) : (
              <span className="text-slate-500">— outside forecast window</span>
            )}
          </div>
        </div>
      )}

      {loadingPredictions && (
        <div className="mb-4 text-sm text-slate-500">Loading current predictions…</div>
      )}

      {/* Events table */}
      {!loadingPredictions && events.length > 0 && (
        <div className="mb-4">
          <table className="w-full text-sm font-mono border-collapse">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="text-left py-2 pr-4">Time (local)</th>
                <th className="text-left py-2 pr-4">Event</th>
                <th className="text-right py-2">Speed</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const speedStr =
                  ev.kind === 'slack'
                    ? '0.0 kn'
                    : Number.isFinite(ev.speedKn)
                      ? ev.speedKn.toFixed(1) + ' kn'
                      : '—';
                const colour =
                  ev.kind === 'flood'
                    ? 'text-sky-300'
                    : ev.kind === 'ebb'
                      ? 'text-orange-400'
                      : 'text-slate-400';
                return (
                  <tr
                    key={`${ev.kind}-${ev.timeMs}`}
                    className="border-b border-slate-800 hover:bg-slate-900/40"
                  >
                    <td className="py-1.5 pr-4 text-slate-300">
                      {new Date(ev.timeMs).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className={`py-1.5 pr-4 font-semibold ${colour}`}>
                      {EVENT_LABELS[ev.kind] ?? ev.kind}
                    </td>
                    <td className="py-1.5 text-right">{speedStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loadingPredictions && events.length === 0 && selectedId && stationsLoaded && (
        <div className="text-sm text-slate-500">No current events available for this station.</div>
      )}

      {/* Footer labels */}
      <div className="mt-6 space-y-0.5 text-[11px] text-slate-500">
        <p>Drift in knots · Set in °true</p>
        <p>
          Tidal-stream predictions at a CHS current station — distinct from the chart&apos;s
          ocean-current overlay.
        </p>
      </div>
    </main>
  );
}
