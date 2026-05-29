'use client';

import { useEffect, useMemo, useState } from 'react';
import { computeCpa, type CpaResult } from '@g5000/compute';
import type { AisTarget, JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';
import { RAD_TO_DEG } from '../../lib/units';
import { useThreatAudio } from './use-threat-audio';
import { RadarScope } from './RadarScope';
import { TargetsTable, type SortKey } from './TargetsTable';

const NM = 1852;
const RANGE_OPTIONS_NM = [1, 2, 4, 8, 20, 30];
const DEFAULT_RANGE_NM = 30;
/** localStorage key for the user's preferred radar range. Survives tab
 *  navigation and page reloads. */
const RANGE_STORAGE_KEY = 'ais:rangeNm';
/** Targets unseen for this long render in a "stale" style. */
const STALE_MS = 60_000;
/** Targets unseen for this long are dropped from the UI (server evicts at
 *  the same threshold; client filter is defense-in-depth). */
const DROP_MS = 5 * 60_000;

function readSavedRange(): number {
  try {
    const raw = localStorage.getItem(RANGE_STORAGE_KEY);
    if (raw === null) return DEFAULT_RANGE_NM;
    const n = Number(raw);
    // Validate against the current option set so old saved values that
    // are no longer offered (e.g. the previous 15) silently fall back to
    // the default instead of leaving the select empty.
    if (RANGE_OPTIONS_NM.includes(n)) return n;
  } catch {
    /* SSR / quota — keep default */
  }
  return DEFAULT_RANGE_NM;
}

interface AisAlarmConfig {
  enabled: boolean;
  cpaMeters: number;
  tcpaSeconds: number;
}

const DEFAULT_ALARM: AisAlarmConfig = {
  enabled: true,
  cpaMeters: NM,
  tcpaSeconds: 600,
};

/** Narrow a Sample to its geo lat/lon, or null if it's missing/wrong-kind. */
function geoValue(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

/** Narrow a Sample to its scalar number, or null if it's missing/wrong-kind. */
function scalarValue(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

export function AisClientView() {
  const { channels } = useSse();
  const [targets, setTargets] = useState<AisTarget[]>([]);
  const [alarmConfig, setAlarmConfig] = useState<AisAlarmConfig>(DEFAULT_ALARM);
  // Seed with the default to avoid SSR/client hydration mismatch, then
  // hydrate from localStorage on mount. Mirrors the pattern in
  // passage/page.tsx for the tz toggle.
  const [rangeNm, setRangeNm] = useState(DEFAULT_RANGE_NM);
  useEffect(() => {
    setRangeNm(readSavedRange());
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, String(rangeNm));
    } catch {
      /* quota / private mode — silently drop */
    }
  }, [rangeNm]);

  // Sort state for the targets table. Threats always float to the top
  // regardless of sort selection (safety invariant); within the threat
  // group and the non-threat group, rows order by `sortKey` in `sortDir`.
  const [sortKey, setSortKey] = useState<SortKey>('cpa');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const handleSort = (k: SortKey): void => {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      // Numeric columns default to ascending (smallest range/CPA first feels
      // natural); name defaults to ascending alphabetical. No special case.
      setSortDir('asc');
    }
  };
  // North-up toggle removed at the user's request — page is permanently
  // north-up. The branch below in canvasRotationDeg is now effectively a
  // no-op; left in place in case we want the toggle back.
  const northUp = true;
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const [showAlarmEdit, setShowAlarmEdit] = useState(false);
  const [draftCpaNm, setDraftCpaNm] = useState(1);
  const [draftTcpaMin, setDraftTcpaMin] = useState(10);

  // Poll AIS targets every 2s
  useEffect(() => {
    let cancelled = false;
    const fetchTargets = async () => {
      try {
        const r = await fetch('/api/ais/targets', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { targets: AisTarget[] };
        if (!cancelled) setTargets(j.targets);
      } catch {
        /* swallow — next tick retries */
      }
    };
    void fetchTargets();
    const id = setInterval(fetchTargets, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Load alarm config once
  useEffect(() => {
    void fetch('/api/ais/alarm-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c && typeof c === 'object') {
          const cfg = c as AisAlarmConfig;
          setAlarmConfig(cfg);
          setDraftCpaNm(cfg.cpaMeters / NM);
          setDraftTcpaMin(cfg.tcpaSeconds / 60);
        }
      })
      .catch(() => {});
  }, []);

  // Own boat state from SSE
  const ownPos = geoValue(channels.get('nav.gps.position'));
  const ownCog = scalarValue(channels.get('nav.gps.cog')) ?? 0;
  const ownSog = scalarValue(channels.get('nav.gps.sog')) ?? 0;
  const ownHeading = scalarValue(channels.get('boat.heading.magnetic')) ?? ownCog;

  // Compute CPA per target — depends on own pos + every target's pos/cog/sog.
  // Targets unseen >5 min are dropped here so the rest of the UI never has to
  // think about them. Targets unseen >1 min carry a `stale` flag so the icon
  // and row both render in a faded state.
  const targetsWithCpa = useMemo(() => {
    if (!ownPos) return [];
    const now = Date.now();
    return targets
      .filter((t) => now - t.lastSeenMs < DROP_MS)
      .map((t) => {
        const stale = now - t.lastSeenMs > STALE_MS;
        if (t.lat === undefined || t.lon === undefined) {
          return { target: t, cpa: null as CpaResult | null, stale };
        }
        const own = { lat: ownPos.lat, lon: ownPos.lon, cog: ownCog, sog: ownSog };
        const tgt = { lat: t.lat, lon: t.lon, cog: t.cog ?? 0, sog: t.sog ?? 0 };
        return { target: t, cpa: computeCpa(own, tgt), stale };
      });
  }, [targets, ownPos, ownCog, ownSog]);

  const svgSize = 600;
  const svgRadius = 280;
  const metersToPx = svgRadius / (rangeNm * NM);
  const center = svgSize / 2;
  // Range-ring radii to draw inside the canvas. We draw at half-, three-quarter-
  // and full-range marks.
  const ringRadii = [rangeNm * 0.25, rangeNm * 0.5, rangeNm * 0.75].filter((r) => r > 0);

  // Visual threat indication (red triangle, pulse ring, red row text) is
  // independent of `alarmConfig.enabled` — situational awareness should always
  // be on. `alarmConfig.enabled` continues to gate the audio klaxon inside
  // `useThreatAudio`, so turning the alarm OFF silences sound but keeps the
  // chart visually honest.
  const isThreat = (cpa: CpaResult | null): boolean =>
    !!cpa &&
    cpa.cpaMeters < alarmConfig.cpaMeters &&
    cpa.tcpaSeconds > 0 &&
    cpa.tcpaSeconds < alarmConfig.tcpaSeconds;

  // Per-vessel klaxon mute. Key: MMSI. Value: the CPA in meters at the time
  // the mute was applied. The vessel re-arms (mute auto-clears) once the
  // current CPA drops below 90% of that value — i.e. the situation has
  // closed by 10% since the helmsman decided to silence it.
  const [mutes, setMutes] = useState<Record<number, number>>({});

  // Auto-unmute when CPA tightens 10% past the mute snapshot.
  useEffect(() => {
    setMutes((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of targetsWithCpa) {
        const mutedAt = next[r.target.mmsi];
        if (mutedAt !== undefined && r.cpa && r.cpa.cpaMeters < mutedAt * 0.9) {
          delete next[r.target.mmsi];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [targetsWithCpa]);

  const muteVessel = (mmsi: number): void => {
    const row = targetsWithCpa.find((r) => r.target.mmsi === mmsi);
    if (!row?.cpa) return;
    setMutes((prev) => ({ ...prev, [mmsi]: row.cpa!.cpaMeters }));
  };
  const unmuteVessel = (mmsi: number): void => {
    setMutes((prev) => {
      const { [mmsi]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  };

  // Set of currently-threatening MMSIs that drive the klaxon. Muted vessels
  // and stale targets (>1 min unseen) are excluded — stale-position CPA is
  // not actionable and would generate false alarms.
  const threatMmsis = useMemo(() => {
    const s = new Set<number>();
    for (const r of targetsWithCpa) {
      if (r.stale) continue;
      if (!isThreat(r.cpa)) continue;
      if (mutes[r.target.mmsi] !== undefined) continue;
      s.add(r.target.mmsi);
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsWithCpa, alarmConfig.cpaMeters, alarmConfig.tcpaSeconds, mutes]);

  const {
    armed: audioArmed,
    arm: armAudio,
    test: testAudio,
    testing: audioTesting,
  } = useThreatAudio(threatMmsis, alarmConfig.enabled);

  // Course-up rotation: in course-up mode, the canvas rotates clockwise by
  // own's heading so own's heading points up. North-up means no rotation.
  const canvasRotationDeg = northUp ? 0 : -ownHeading * RAD_TO_DEG;

  const toggleAlarmEnabled = async () => {
    const next = { ...alarmConfig, enabled: !alarmConfig.enabled };
    setAlarmConfig(next);
    await fetch('/api/ais/alarm-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next.enabled }),
    });
  };

  const saveThresholds = async () => {
    const cpaMeters = Math.max(1, draftCpaNm * NM);
    const tcpaSeconds = Math.max(1, draftTcpaMin * 60);
    const next = { ...alarmConfig, cpaMeters, tcpaSeconds };
    setAlarmConfig(next);
    setShowAlarmEdit(false);
    await fetch('/api/ais/alarm-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpaMeters, tcpaSeconds }),
    });
  };

  const selectedRow =
    selectedMmsi !== null ? targetsWithCpa.find((r) => r.target.mmsi === selectedMmsi) : null;

  return (
    <main className="p-4 max-w-7xl mx-auto text-slate-100">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">AIS</h1>
        <div className="flex gap-3 items-center text-sm font-mono flex-wrap">
          <label className="text-slate-300">
            Range:&nbsp;
            <select
              value={rangeNm}
              onChange={(e) => setRangeNm(Number(e.target.value))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
            >
              {RANGE_OPTIONS_NM.map((n) => (
                <option key={n} value={n}>
                  {n} NM
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void toggleAlarmEnabled()}
            className={`px-2 py-1 rounded text-xs ${
              alarmConfig.enabled
                ? 'bg-emerald-700 hover:bg-emerald-600'
                : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            Alarm {alarmConfig.enabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => armAudio()}
            disabled={audioArmed}
            title={
              audioArmed
                ? 'Audio alarm armed — beeps on new threats'
                : 'Click to enable beep on new threats (browser requires this user gesture)'
            }
            className={`px-2 py-1 rounded text-xs ${
              audioArmed ? 'bg-emerald-700 cursor-default' : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            {audioArmed ? 'Audio armed' : 'Arm audio'}
          </button>
          <button
            type="button"
            onClick={() => testAudio()}
            disabled={!audioArmed || audioTesting}
            title={
              audioArmed
                ? 'Plays the klaxon for 3 seconds — bypasses Alarm ON/OFF'
                : 'Arm audio first'
            }
            className={`px-2 py-1 rounded text-xs ${
              !audioArmed
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : audioTesting
                  ? 'bg-red-700 cursor-default'
                  : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            {audioTesting ? 'Testing…' : 'Test alarm'}
          </button>
          <button
            type="button"
            onClick={() => setShowAlarmEdit((v) => !v)}
            className="px-2 py-1 rounded text-xs bg-slate-800 border border-slate-700 hover:bg-slate-700"
          >
            CPA {(alarmConfig.cpaMeters / NM).toFixed(1)} NM · TCPA{' '}
            {Math.round(alarmConfig.tcpaSeconds / 60)} min
          </button>
        </div>
      </div>

      {showAlarmEdit && (
        <div className="mb-3 bg-slate-900 border border-slate-800 rounded p-3 flex items-end gap-3 text-sm">
          <label className="text-slate-300 flex flex-col gap-1">
            <span className="text-xs text-slate-400">CPA threshold (NM)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={draftCpaNm}
              onChange={(e) => setDraftCpaNm(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 font-mono"
            />
          </label>
          <label className="text-slate-300 flex flex-col gap-1">
            <span className="text-xs text-slate-400">TCPA threshold (min)</span>
            <input
              type="number"
              step="1"
              min="1"
              value={draftTcpaMin}
              onChange={(e) => setDraftTcpaMin(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 font-mono"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveThresholds()}
            className="px-3 py-1 rounded bg-amber-600 text-slate-900 font-medium hover:bg-amber-500"
          >
            Save
          </button>
        </div>
      )}

      <div className="flex gap-4 flex-wrap">
        <div className="relative">
          <RadarScope
            svgSize={svgSize}
            svgRadius={svgRadius}
            center={center}
            metersToPx={metersToPx}
            ringRadii={ringRadii}
            canvasRotationDeg={canvasRotationDeg}
            targetsWithCpa={targetsWithCpa}
            isThreat={isThreat}
            selectedMmsi={selectedMmsi}
            setSelectedMmsi={setSelectedMmsi}
            ownSog={ownSog}
            ownCog={ownCog}
            rangeNm={rangeNm}
          />

          {!ownPos && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-slate-900/90 border border-slate-700 rounded px-4 py-2 text-xs text-slate-300 font-mono">
                Waiting for nav.gps.position…
              </div>
            </div>
          )}
        </div>

        <TargetsTable
          targetsWithCpa={targetsWithCpa}
          selectedRow={selectedRow}
          sortKey={sortKey}
          sortDir={sortDir}
          handleSort={handleSort}
          selectedMmsi={selectedMmsi}
          setSelectedMmsi={setSelectedMmsi}
          isThreat={isThreat}
          rangeNm={rangeNm}
          mutes={mutes}
          muteVessel={muteVessel}
          unmuteVessel={unmuteVessel}
        />
      </div>
    </main>
  );
}
