'use client';

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { interpolateHeight, tideSnapshot } from '@g5000/tide';
import type { Station, TidalEvent } from '@g5000/tide';
import { fmtDistanceNm, sortByDistanceNm } from '../../../lib/station-distance';
import type { LatLon } from '../../../lib/station-distance';
import { fmtDayLabel, fmtHourLabel, fmtShortTime, toDayKey } from '../../../lib/tz';
import type { ShipClock } from '../../../lib/tz';
import { useShipClock } from '../../../lib/use-ship-clock';

// ── Types ────────────────────────────────────────────────────────────────────

type SourceId = 'admiralty' | 'chs';

interface PickerEntry {
  sourceId: SourceId;
  station: Station;
}

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

// ── SVG dimensions (compact for the drawer) ──────────────────────────────────

const SVG_W = 600;
const SVG_H = 80;
const PAD = { top: 6, right: 10, bottom: 16, left: 28 };

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
    const y = PAD.top + (1 - (h - hMin) / hSpan) * plotH;
    pts.push({ x, y });
  }
  return pts;
}

function ptsToPolyline(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function groupByDay(events: TidalEvent[], clock: ShipClock): Map<string, TidalEvent[]> {
  const m = new Map<string, TidalEvent[]>();
  for (const ev of events) {
    const key = toDayKey(ev.timeMs / 1000, clock);
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(ev);
  }
  return m;
}

// ── Tab component ─────────────────────────────────────────────────────────────

export function TidesTab({ lat, lon }: { lat: number; lon: number }): React.ReactElement {
  const clock = useShipClock();
  const [pickerList, setPickerList] = useState<PickerEntry[]>([]);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const [tideSource, setTideSource] = useState<string | null>(null);
  const [pinnedStationId, setPinnedStationId] = useState<string | null>(null);
  const [pinnedSourceId, setPinnedSourceId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [events, setEvents] = useState<TidalEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  // Use the anchor page's lat/lon prop as the boat fix for distance sorting.
  const boatFix: LatLon | null = { lat, lon };

  // Feature gate + stations fetch.
  useEffect(() => {
    let cancelled = false;

    void fetch('/api/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled)
          setFeatureEnabled(
            (j as { settings?: { canadianTideCurrents?: boolean } })?.settings
              ?.canadianTideCurrents === true,
          );
      })
      .catch(() => {
        if (!cancelled) setFeatureEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Tick now every minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  // Fetch stations + active pin, then choose initial selection.
  useEffect(() => {
    let cancelled = false;
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
      if (cancelled) return;
      setPickerList(entries);
      setStationsLoaded(true);

      let pinnedKey: string | null = null;
      const ar = await fetch('/api/tide/active');
      if (ar.ok && !cancelled) {
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

      const firstKey = entries[0] ? entryKey(entries[0]) : null;
      if (!cancelled) setSelectedKey(pinnedKey ?? firstKey);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch events whenever selected entry changes.
  useEffect(() => {
    if (!selectedKey) return;
    const { sourceId, stationId } = parseEntryKey(selectedKey);
    setLoadingEvents(true);
    let cancelled = false;
    void (async () => {
      const r = await fetch(
        `/api/tide/events?stationId=${encodeURIComponent(stationId)}&source=${encodeURIComponent(sourceId)}`,
      );
      if (cancelled) return;
      if (!r.ok) {
        setEvents([]);
        setLoadingEvents(false);
        return;
      }
      const j = (await r.json()) as { ok: boolean; events: TidalEvent[] };
      if (cancelled) return;
      if (j.ok) {
        setEvents([...j.events].sort((a, b) => a.timeMs - b.timeMs));
      } else {
        setEvents([]);
      }
      setLoadingEvents(false);
    })();
    return () => {
      cancelled = true;
    };
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

  const annotated = useMemo(
    () => sortByDistanceNm(pickerList, boatFix, (e) => e.station),
    [pickerList, boatFix],
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

  const nowX = (() => {
    if (events.length < 2) return null;
    const tMin = events[0]!.timeMs;
    const tMax = events[events.length - 1]!.timeMs;
    if (now < tMin || now > tMax) return null;
    const plotW = SVG_W - PAD.left - PAD.right;
    return PAD.left + ((now - tMin) / Math.max(1, tMax - tMin)) * plotW;
  })();

  const dayGroups = groupByDay(events, clock);

  // ── Feature gate ───────────────────────────────────────────────────────────

  if (featureEnabled !== true) {
    return (
      <div className="text-sm text-ink-3">
        {featureEnabled === null
          ? 'Loading…'
          : 'Canadian Tide/Currents is disabled — enable it in Settings.'}
      </div>
    );
  }

  if (stationsLoaded && pickerList.length === 0) {
    return (
      <div className="p-3 bg-warn/20 border border-warn-strong [border-radius:var(--r-panel)] text-ink text-xs">
        <p className="font-medium">No tide source available yet</p>
        <p className="mt-0.5 text-ink-2">
          Waiting for position, or set{' '}
          <code className="font-mono bg-surface-raised px-1 rounded">ADMIRALTY_TIDAL_API_KEY</code>{' '}
          for UK waters.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-ink-value">
      {/* Station picker */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={selectedKey ?? ''}
          onChange={(e) => setSelectedKey(e.target.value || null)}
          className="flex-1 min-w-0 px-2 py-1 bg-surface-raised border border-hairline-strong rounded text-xs text-ink-value focus:outline-none focus:border-accent-hi"
          disabled={pickerList.length === 0}
        >
          {pickerList.length === 0 && !stationsLoaded && (
            <option value="">Loading stations…</option>
          )}
          {annotated.map(({ item: e, distanceNm }) => {
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
            className={`shrink-0 px-2 py-1 rounded text-xs font-medium disabled:opacity-40 ${
              isPinned
                ? 'bg-accent-strong hover:bg-accent text-on-accent'
                : 'bg-surface-raised hover:bg-hairline-strong text-ink'
            }`}
          >
            {pinning ? '…' : isPinned ? 'Un-pin' : 'Pin'}
          </button>
        )}

        {selectedEntry && tideSource && (
          <span className="text-[0.611rem] text-ink-3 uppercase">{tideSource}</span>
        )}
      </div>

      {/* Compact height curve */}
      {!loadingEvents && curvePts.length > 0 && (
        <div className="bg-surface border border-hairline [border-radius:var(--r-panel)] p-2">
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full"
            style={{ height: `${SVG_H}px` }}
          >
            <line
              x1={PAD.left}
              y1={SVG_H - PAD.bottom}
              x2={SVG_W - PAD.right}
              y2={SVG_H - PAD.bottom}
              stroke="var(--ink-4)"
              strokeDasharray="2 2"
            />
            <polyline points={polyline} fill="none" stroke="var(--info)" strokeWidth="1.5" />
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
                  y={PAD.top + 8}
                  fill="var(--flow-ebb)"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  now
                </text>
              </>
            )}
          </svg>

          <div className="mt-1 text-xs font-mono text-ink-2">
            {snapshot?.heightNowM != null ? (
              <>
                Now: <span className="text-info">{snapshot.heightNowM.toFixed(2)} m</span>
                {snapshot.state && <span className="ml-2 text-ink-3">{snapshot.state}</span>}
                {snapshot.next && (
                  <span className="ml-2 text-ink-3">
                    → {snapshot.next.type} {snapshot.next.heightM.toFixed(2)} m at{' '}
                    {fmtHourLabel(snapshot.next.timeMs / 1000, clock)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-ink-3">— outside forecast window</span>
            )}
          </div>
        </div>
      )}

      {loadingEvents && <div className="text-xs text-ink-3">Loading tide events…</div>}

      {/* Compact tide table — next few events only */}
      {!loadingEvents && events.length > 0 && (
        <div className="overflow-y-auto max-h-24">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="text-ink-3 border-b border-hairline">
                <th className="text-left py-1 pr-3">Time</th>
                <th className="text-left py-1 pr-3">Type</th>
                <th className="text-right py-1">Height</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(dayGroups.entries())
                .slice(0, 2)
                .map(([day, dayEvents]) => (
                  <Fragment key={day}>
                    <tr>
                      <td
                        colSpan={3}
                        className="pt-2 pb-0.5 text-[0.611rem] uppercase tracking-wide text-ink-4"
                      >
                        {fmtDayLabel(dayEvents[0]!.timeMs / 1000, clock)}
                      </td>
                    </tr>
                    {dayEvents.map((ev) => (
                      <tr key={ev.timeMs} className="border-b border-hairline">
                        <td className="py-0.5 pr-3 text-ink-2">
                          {fmtShortTime(ev.timeMs / 1000, clock)}
                        </td>
                        <td
                          className={`py-0.5 pr-3 font-semibold ${
                            ev.type === 'HW' ? 'text-info' : 'text-ink-3'
                          }`}
                        >
                          {ev.type}
                        </td>
                        <td className="py-0.5 text-right">{ev.heightM.toFixed(1)} m</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {!loadingEvents && events.length === 0 && selectedKey && (
        <div className="text-xs text-ink-3">No events available for this station.</div>
      )}

      <p className="text-[0.611rem] text-ink-4">
        Heights in metres above Chart Datum. Approximate.
      </p>
    </div>
  );
}
