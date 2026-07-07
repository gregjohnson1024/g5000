'use client';

import { useEffect, useState, useMemo, Fragment, useCallback } from 'react';
import Link from 'next/link';
import { currentNow, nextCurrentEvent } from '@g5000/tide';
import type { CurrentPrediction, CurrentEvent } from '@g5000/tide';
import { fetchBoatFix } from '../../../lib/boat-fix';
import { fmtDistanceNm, sortByDistanceNm, type LatLon } from '../../../lib/station-distance';
import { StripChart, type StripPoint, type StripEvent } from '../../../components/charts';
import { Panel } from '../../../components/ui';
import { SelectField, type SelectOption, TextField } from '../../../components/ui/fields';

// ── Local types ───────────────────────────────────────────────────────────────

interface CurrentStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

// ── Constants / helpers ───────────────────────────────────────────────────────

/** Minimum y-scale ceiling so an all-slack window doesn't divide by zero. */
const SPEED_FLOOR_KN = 0.5;

// Token references — resolved via CSS custom properties at render time.
const EVENT_LABELS: Record<string, string> = {
  slack: 'Slack',
  flood: 'Max flood',
  ebb: 'Max ebb',
};

function fmtDir(deg: number): string {
  const rounded = ((Math.round(deg) % 360) + 360) % 360;
  return String(rounded).padStart(3, '0') + '°';
}

/** "HH:MMz DD Mon" UTC */
function fmtUtcShort(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${hh}:${mm}z ${day} ${mon}`;
}

// ── Build StripChart data ─────────────────────────────────────────────────────

function buildStripPoints(predictions: CurrentPrediction[]): StripPoint[] {
  return predictions
    .filter((p) => Number.isFinite(p.speedKn))
    .map((p) => ({ tMs: p.timeMs, v: p.speedKn }));
}

function buildStripEvents(events: CurrentEvent[]): StripEvent[] {
  return events.map((ev) => ({
    tMs: ev.timeMs,
    kind: ev.kind as 'flood' | 'ebb' | 'slack',
    label: ev.kind === 'slack' ? 'S' : ev.kind === 'flood' ? 'F' : 'E',
  }));
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
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [boatFix, setBoatFix] = useState<LatLon | null>(null);

  // Mount: feature gate + boat fix
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

  // Tick "now" every minute
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch stations on mount
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

  // Fetch predictions + events when selection changes
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
          setPredictions([...j.predictions].sort((a, b) => a.timeMs - b.timeMs));
          setEvents([...j.events].sort((a, b) => a.timeMs - b.timeMs));
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

  // Pin toggle (persisted similarly to tides)
  const handlePin = useCallback(async () => {
    if (!selectedId) return;
    const isCurrentlyPinned = pinnedId === selectedId;
    setPinning(true);
    // POST to /api/currents/pin (if it exists; graceful no-op if not)
    try {
      await fetch('/api/currents/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isCurrentlyPinned ? { stationId: null } : { stationId: selectedId }),
      });
      setPinnedId(isCurrentlyPinned ? null : selectedId);
    } catch {
      // no-op if endpoint doesn't exist
    }
    setPinning(false);
  }, [selectedId, pinnedId]);

  // ── Derived values ────────────────────────────────────────────────────────

  const annotated = useMemo(
    () => sortByDistanceNm(stations, boatFix, (s) => s),
    [stations, boatFix],
  );

  const filtered = annotated.filter(
    ({ item: s }) => s.name.toLowerCase().includes(filter.toLowerCase()) || s.id === selectedId,
  );

  const tMin = predictions.length > 0 ? predictions[0]!.timeMs : 0;
  const tMax = predictions.length > 0 ? predictions[predictions.length - 1]!.timeMs : 1;

  const yMax = Math.max(
    SPEED_FLOOR_KN,
    ...predictions.map((p) => p.speedKn).filter((v) => Number.isFinite(v)),
    ...events.map((e) => e.speedKn).filter((v) => Number.isFinite(v)),
  );

  const stripPoints = useMemo(() => buildStripPoints(predictions), [predictions]);
  const stripEvents = useMemo(() => buildStripEvents(events), [events]);

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

  const isPinned = pinnedId === selectedId;

  // ── Select options ────────────────────────────────────────────────────────

  const selectOptions = useMemo((): SelectOption[] => {
    return filtered.map(({ item: s, distanceNm }) => ({
      value: s.id,
      label: [s.name, distanceNm !== null ? fmtDistanceNm(distanceNm) : null]
        .filter(Boolean)
        .join(' — '),
    }));
  }, [filtered]);

  // ── Feature gate ──────────────────────────────────────────────────────────

  if (featureEnabled !== true) {
    return (
      <main className="p-6 max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-ink mb-3">Current Planning</h1>
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

  if (stationsError) {
    return (
      <main className="p-6 max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold text-ink mb-3">Current Planning</h1>
        <Panel label="Unavailable" chip="warn" chipLabel="Error">
          <p className="text-body-sm text-ink-2">CHS currents unavailable — try again.</p>
        </Panel>
      </main>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold text-ink">Current Planning</h1>
        <span className="text-caption text-ink-3">Predictions · next 48 h</span>
      </div>

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
            value={selectedId}
            onChange={setSelectedId}
            options={selectOptions}
            placeholder={stationsLoaded ? 'Select a station…' : 'Loading stations…'}
            disabled={!stationsLoaded || stations.length === 0}
          />
        </div>
      </div>

      {/* Empty-stations message */}
      {stationsLoaded && !stationsError && stations.length === 0 && (
        <Panel label="No stations" chip="warn" chipLabel="Empty">
          <p className="text-body-sm text-ink-2">No current-prediction stations available.</p>
        </Panel>
      )}

      {/* Drift strip chart */}
      {loadingPredictions && (
        <p className="text-body-sm text-ink-3">Loading current predictions…</p>
      )}

      {!loadingPredictions && stripPoints.length > 0 && (
        <StripChart
          label={`Drift — ${stations.find((s) => s.id === selectedId)?.name ?? ''}`}
          points={stripPoints}
          tMin={tMin}
          tMax={tMax}
          domain={[0, yMax]}
          color="var(--flow-flood)"
          events={stripEvents}
          nowMs={now}
          source="CHS"
          pinned={selectedId ? isPinned : undefined}
          onPinToggle={selectedId ? () => void handlePin() : undefined}
          height={90}
        />
      )}

      {/* Now readout */}
      {!loadingPredictions && cn && (
        <p className="text-caption font-mono text-ink-2">
          <span className="text-ink-3 mr-1">Now:</span>
          <span className="text-info">{readout}</span>
        </p>
      )}
      {!loadingPredictions && !cn && selectedId && (
        <p className="text-caption font-mono text-ink-4">— outside forecast window</p>
      )}

      {/* Events table */}
      {!loadingPredictions && events.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm font-mono border-collapse">
            <thead>
              <tr className="text-ink-3 border-b border-hairline">
                <th className="text-left py-2 pr-4">Time (UTC)</th>
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
                const colClass =
                  ev.kind === 'flood'
                    ? 'text-flow-flood'
                    : ev.kind === 'ebb'
                      ? 'text-flow-ebb'
                      : 'text-flow-slack';
                return (
                  <tr
                    key={`${ev.kind}-${ev.timeMs}`}
                    className="border-b border-hairline hover:bg-surface-raised"
                  >
                    <td className="py-1.5 pr-4 text-ink-2 tabular-nums">
                      {fmtUtcShort(ev.timeMs)}
                    </td>
                    <td className={`py-1.5 pr-4 font-semibold ${colClass}`}>
                      {EVENT_LABELS[ev.kind] ?? ev.kind}
                    </td>
                    <td className="py-1.5 text-right text-ink tabular-nums">{speedStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loadingPredictions && events.length === 0 && selectedId && stationsLoaded && (
        <p className="text-body-sm text-ink-4">No current events available for this station.</p>
      )}

      {/* Footer */}
      <div className="space-y-0.5 text-caption text-ink-4">
        <p>Drift in knots · Set in °true</p>
        <p>
          Tidal-stream predictions at a CHS current station — distinct from the chart&apos;s
          ocean-current overlay.
        </p>
      </div>
    </main>
  );
}
