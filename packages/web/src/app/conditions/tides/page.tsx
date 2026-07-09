'use client';

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import Link from 'next/link';
import { interpolateHeight, tideSnapshot } from '@g5000/tide';
import type { Station, TidalEvent } from '@g5000/tide';
import { fetchBoatFix } from '../../../lib/boat-fix';
import { fmtDistanceNm, sortByDistanceNm, type LatLon } from '../../../lib/station-distance';
import { fmtDayLabel, fmtHourLabel, toDayKey, type ShipClock } from '../../../lib/tz';
import { useShipClock } from '../../../lib/use-ship-clock';
import { StripChart, type StripPoint, type StripEvent } from '../../../components/charts';
import { Panel } from '../../../components/ui';
import { SelectField, type SelectOption, TextField } from '../../../components/ui/fields';
import { Button } from '../../../components/ui';

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

// ── Day grouping ─────────────────────────────────────────────────────────────

/** Group events by ship-clock wall day. */
function groupByDay(events: TidalEvent[], clock: ShipClock): Map<string, TidalEvent[]> {
  const m = new Map<string, TidalEvent[]>();
  for (const ev of events) {
    const key = toDayKey(ev.timeMs / 1000, clock);
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(ev);
  }
  return m;
}

// ── Build StripChart data ─────────────────────────────────────────────────

function buildStripPoints(events: TidalEvent[]): StripPoint[] {
  if (events.length < 2) return [];
  const tMin = events[0]!.timeMs;
  const tMax = events[events.length - 1]!.timeMs;
  const STEP_MS = 10 * 60_000;
  const pts: StripPoint[] = [];
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
    if (h !== null) pts.push({ tMs: t, v: h });
  }
  return pts;
}

function buildStripEvents(events: TidalEvent[]): StripEvent[] {
  return events.map((ev) => ({
    tMs: ev.timeMs,
    kind: ev.type === 'HW' ? 'flood' : 'ebb',
    label: ev.type === 'HW' ? 'HW' : 'LW',
  }));
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function TidePage() {
  const clock = useShipClock();
  const [pickerList, setPickerList] = useState<PickerEntry[]>([]);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const [tideSource, setTideSource] = useState<string | null>(null);
  const [pinnedStationId, setPinnedStationId] = useState<string | null>(null);
  const [pinnedSourceId, setPinnedSourceId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [events, setEvents] = useState<TidalEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [boatFix, setBoatFix] = useState<LatLon | null>(null);

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

      const firstKey = entries[0] ? entryKey(entries[0]) : null;
      setSelectedKey(queryKey ?? pinnedKey ?? firstKey);
    })();
  }, []);

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
        setEvents([...j.events].sort((a, b) => a.timeMs - b.timeMs));
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

  // ── Derived ───────────────────────────────────────────────────────────────

  const multiSource = new Set(pickerList.map((e) => e.sourceId)).size > 1;

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

  const stripPoints = useMemo(() => buildStripPoints(events), [events]);
  const stripEvents = useMemo(() => buildStripEvents(events), [events]);
  const snapshot = events.length >= 2 ? tideSnapshot(events, now) : null;

  const tMin = events.length > 0 ? events[0]!.timeMs : 0;
  const tMax = events.length > 0 ? events[events.length - 1]!.timeMs : 1;

  const dayGroups = useMemo(() => groupByDay(events, clock), [events, clock]);

  // ── Select options ─────────────────────────────────────────────────────────

  const selectOptions = useMemo((): SelectOption[] => {
    return filtered.map(({ item: e, distanceNm }) => {
      const key = entryKey(e);
      const isEntryPinned = pinnedStationId === e.station.id && pinnedSourceId === e.sourceId;
      const label = multiSource ? `${e.station.name} (${e.sourceId})` : e.station.name;
      return {
        value: key,
        label: [
          label,
          distanceNm !== null ? fmtDistanceNm(distanceNm) : null,
          isEntryPinned ? '★' : null,
        ]
          .filter(Boolean)
          .join(' — '),
      };
    });
  }, [filtered, multiSource, pinnedStationId, pinnedSourceId]);

  // ── Source badge label ─────────────────────────────────────────────────────

  const sourceBadge = selectedEntry
    ? selectedEntry.sourceId.toUpperCase() + (tideSource ? ` · ${tideSource}` : '')
    : undefined;

  // ── Feature gate ──────────────────────────────────────────────────────────

  if (featureEnabled !== true) {
    return (
      <main className="page-main p-6">
        <h1 className="text-xl font-semibold text-ink mb-3">Tide Planning</h1>
        {featureEnabled === false && (
          <Panel label="Feature disabled" emptyState={{ reason: 'Canadian Tide/Currents is off' }}>
            <p className="text-body-sm text-ink-2">
              Enable it in{' '}
              <Link href="/boat/setup" className="text-accent-ink underline">
                Settings
              </Link>
              .
            </p>
          </Panel>
        )}
      </main>
    );
  }

  if (stationsLoaded && pickerList.length === 0) {
    return (
      <main className="page-main p-6">
        <h1 className="text-xl font-semibold text-ink mb-3">Tide Planning</h1>
        <Panel label="No tide source" chip="warn" chipLabel="Waiting">
          <p className="text-body-sm text-ink-2">
            Waiting for position, or set{' '}
            <code className="font-mono bg-surface-raised px-1 rounded-sm">
              ADMIRALTY_TIDAL_API_KEY
            </code>{' '}
            for UK waters.
          </p>
        </Panel>
      </main>
    );
  }

  return (
    <main className="page-main p-6 space-y-4">
      <h1 className="text-xl font-semibold text-ink">Tide Planning</h1>

      {/* Station picker */}
      <div className="flex flex-col sm:flex-row gap-3">
        <TextField
          label="Filter"
          value={filter}
          onChange={setFilter}
          placeholder="Filter stations…"
          className="sm:w-48 flex-none"
        />
        <div className="flex-1">
          <SelectField
            label="Station"
            value={selectedKey}
            onChange={setSelectedKey}
            options={selectOptions}
            placeholder={stationsLoaded ? 'Select a station…' : 'Loading stations…'}
            disabled={pickerList.length === 0}
          />
        </div>
        {selectedEntry && (
          <div className="flex items-end">
            <Button
              variant={isPinned ? 'primary' : 'secondary'}
              disabled={pinning}
              onClick={() => void handlePin()}
              size="md"
            >
              {pinning ? '…' : isPinned ? 'Pinned' : 'Pin station'}
            </Button>
          </div>
        )}
      </div>

      {/* Height strip chart */}
      {loadingEvents && <p className="text-body-sm text-ink-3">Loading tide events…</p>}

      {!loadingEvents && stripPoints.length > 0 && (
        <StripChart
          label={`Height — ${selectedEntry?.station.name ?? ''}`}
          points={stripPoints}
          tMin={tMin}
          tMax={tMax}
          color="var(--info)"
          events={stripEvents}
          nowMs={now}
          source={sourceBadge}
          pinned={selectedEntry ? isPinned : undefined}
          onPinToggle={selectedEntry ? () => void handlePin() : undefined}
          height={90}
        />
      )}

      {/* Snapshot readout */}
      {!loadingEvents && snapshot && (
        <p className="text-caption font-mono text-ink-2">
          {snapshot.heightNowM != null ? (
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
            <span className="text-ink-4">— outside forecast window</span>
          )}
        </p>
      )}

      {/* Tide table */}
      {!loadingEvents && events.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm font-mono border-collapse">
            <thead>
              <tr className="text-ink-3 border-b border-hairline">
                <th className="text-left py-2 pr-4">Time</th>
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
                      className="pt-3 pb-1 text-caption uppercase tracking-wide text-ink-3"
                    >
                      {fmtDayLabel(dayEvents[0]!.timeMs / 1000, clock)}
                    </td>
                  </tr>
                  {dayEvents.map((ev) => (
                    <tr
                      key={ev.timeMs}
                      className="border-b border-hairline hover:bg-surface-raised"
                    >
                      <td className="py-1.5 pr-4 text-ink-2 tabular-nums">
                        {fmtHourLabel(ev.timeMs / 1000, clock)}
                      </td>
                      <td
                        className={`py-1.5 pr-4 font-semibold ${
                          ev.type === 'HW' ? 'text-flow-flood' : 'text-flow-ebb'
                        }`}
                      >
                        {ev.type}
                      </td>
                      <td className="py-1.5 text-right text-ink tabular-nums">
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

      {!loadingEvents && events.length === 0 && selectedKey && (
        <p className="text-body-sm text-ink-4">No events available for this station.</p>
      )}

      {/* Footer */}
      <div className="space-y-0.5 text-caption text-ink-4">
        <p>Heights in metres above Chart Datum.</p>
        <p>Approximate curve — not for under-keel clearance.</p>
        <p>Free tier: 7-day horizon.</p>
      </div>
    </main>
  );
}
