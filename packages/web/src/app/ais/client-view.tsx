'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { computeCpa, type CpaResult } from '@g5000/compute';
import type { AisTarget, JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';
import { aisDetailRows, fmtTcpa } from '../../lib/ais-detail';
import { MS_TO_KN, RAD_TO_DEG, wrap360 } from '../../lib/units';

const NM = 1852;
const RANGE_OPTIONS_NM = [1, 2, 4, 8, 20, 30];
const DEFAULT_RANGE_NM = 30;
/** localStorage key for the user's preferred radar range. Survives tab
 *  navigation and page reloads. */
const RANGE_STORAGE_KEY = 'ais:rangeNm';
/**
 * Time horizon (minutes) used to project each vessel forward along its COG at
 * its own SOG. Length = SOG × this. Matches standard ARPA radar convention of
 * a tactical-horizon vector, scaled to sailing speeds: at 10 kn the arrow is
 * ~5 NM, at 20 kn ~10 NM. Clipped to the visible range so fast targets near
 * the edge don't run off-canvas.
 */
const COG_EXTENSION_MINUTES = 30;
/**
 * SOG floor (knots) below which a vessel is treated as stationary: rendered
 * with a diamond icon and no COG extension. COG is meaningless at very low
 * speeds (sensor noise dominates the bearing). 0.5 kn is well above the noise
 * floor and below realistic underway speeds for any AIS-equipped boat.
 */
const STATIONARY_THRESHOLD_KN = 0.5;
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

/**
 * Lazy-initialised AudioContext + continuous klaxon. While any threat is
 * present (and alarm is enabled), plays a two-tone square-wave klaxon —
 * 800 Hz / 600 Hz alternating at 4 Hz — through a soft-knee compressor at
 * near-clipping gain. Stops the moment the threat set goes empty. Respects
 * browser autoplay policies by deferring AudioContext creation until first
 * user interaction (the "Arm audio" button).
 */
function useThreatAudio(
  threatMmsis: Set<number>,
  enabled: boolean,
): { armed: boolean; arm: () => void; test: (durationMs?: number) => void; testing: boolean } {
  const ctxRef = useRef<AudioContext | null>(null);
  const klaxonRef = useRef<{
    osc: OscillatorNode;
    gain: GainNode;
    toneTimer: ReturnType<typeof setInterval>;
  } | null>(null);
  const [armed, setArmed] = useState(false);
  const [testing, setTesting] = useState(false);
  const testTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = () => {
    if (ctxRef.current) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      ctxRef.current = ctx;
      // Safari (and some Chromium builds) instantiate AudioContext in
      // `suspended` state even when constructed inside a user gesture.
      // resume() inside the same gesture unblocks it.
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      setArmed(true);
    } catch {
      /* AudioContext not available; alarm stays visual-only */
    }
  };

  const startKlaxon = (): void => {
    const ctx = ctxRef.current;
    if (!ctx || klaxonRef.current) return;
    // Soft-knee compressor pre-stage so peaks don't clip and average loudness
    // is pushed up. After compression a master gain at 0.95 is just shy of
    // clipping; the OS / browser volume control is the final ceiling.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 6;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.1;
    const master = ctx.createGain();
    master.gain.value = 0.95;
    const osc = ctx.createOscillator();
    osc.type = 'square'; // harsher than sine → louder perceived volume
    osc.frequency.value = 800;
    osc.connect(compressor).connect(master).connect(ctx.destination);
    osc.start();
    // Two-tone alternation: 800 / 600 Hz at 4 Hz (125 ms per tone). Browser
    // setInterval has 4–10 ms jitter — fine for a klaxon.
    let toggle = false;
    const toneTimer = setInterval(() => {
      toggle = !toggle;
      osc.frequency.setValueAtTime(toggle ? 600 : 800, ctx.currentTime);
    }, 125);
    klaxonRef.current = { osc, gain: master, toneTimer };
  };

  const stopKlaxon = (): void => {
    const k = klaxonRef.current;
    if (!k) return;
    clearInterval(k.toneTimer);
    try {
      k.osc.stop();
      k.osc.disconnect();
      k.gain.disconnect();
    } catch {
      /* already stopped */
    }
    klaxonRef.current = null;
  };

  useEffect(() => {
    // Gate on `armed` (state) rather than `ctxRef.current` (ref) so React
    // knows to re-run this effect when the user clicks "Arm audio". Refs
    // are invisible to the deps array.
    if (!armed) {
      stopKlaxon();
      return;
    }
    // Test mode bypasses the alarm-enabled gate so a "Test alarm" press
    // always sounds, even when the alarm is OFF. Real threats still respect
    // the gate. If both are true the klaxon just stays playing.
    if (testing || (enabled && threatMmsis.size > 0)) {
      startKlaxon();
    } else {
      stopKlaxon();
    }
  }, [threatMmsis, enabled, testing, armed]);

  // Cleanup on unmount — otherwise the klaxon survives a hot reload.
  useEffect(() => {
    return () => {
      stopKlaxon();
      if (testTimerRef.current) clearTimeout(testTimerRef.current);
    };
  }, []);

  const test = (durationMs = 3000): void => {
    if (!ctxRef.current) return;
    if (testTimerRef.current) clearTimeout(testTimerRef.current);
    setTesting(true);
    testTimerRef.current = setTimeout(() => {
      setTesting(false);
      testTimerRef.current = null;
    }, durationMs);
  };

  return { armed, arm, test, testing };
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
  type SortKey = 'mmsi' | 'name' | 'length' | 'sog' | 'cog' | 'range' | 'cpa' | 'tcpa';
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
          <svg
            width={svgSize}
            height={svgSize}
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            className="bg-slate-950 border border-slate-800 rounded"
          >
            {/* Rotate the whole field for course-up mode. */}
            <g transform={`rotate(${canvasRotationDeg} ${center} ${center})`}>
              {/* Range rings */}
              {ringRadii.map((rNm) => (
                <circle
                  key={rNm}
                  cx={center}
                  cy={center}
                  r={rNm * NM * metersToPx}
                  fill="none"
                  stroke="#334155"
                  strokeDasharray="4 4"
                />
              ))}
              {/* Outer ring at full range */}
              <circle cx={center} cy={center} r={svgRadius} fill="none" stroke="#475569" />
              {/* Crosshair */}
              <line
                x1={center}
                y1={center - svgRadius}
                x2={center}
                y2={center + svgRadius}
                stroke="#1e293b"
              />
              <line
                x1={center - svgRadius}
                y1={center}
                x2={center + svgRadius}
                y2={center}
                stroke="#1e293b"
              />

              {/* Predicted CPA markers + connector lines (rendered behind
                  the target triangles so the triangle stays the dominant
                  visual). Only drawn for threats with a positive TCPA — past
                  CPAs aren't relevant to a tactical decision. */}
              {targetsWithCpa.map(({ target, cpa }) => {
                if (!cpa || !isThreat(cpa)) return null;
                if (cpa.tcpaSeconds <= 0) return null;
                // Target's current relative pos in canvas pixels.
                const dist = cpa.rangeMeters * metersToPx;
                const targetX = center + dist * Math.sin(cpa.bearingRadians);
                const targetY = center - dist * Math.cos(cpa.bearingRadians);
                // Target's predicted relative pos at TCPA, in canvas pixels.
                // The compute helper returns this in own-centred east/north
                // meters; convert to canvas (east → +x, north → -y).
                const cpaX = center + cpa.cpaRelativeEast * metersToPx;
                const cpaY = center - cpa.cpaRelativeNorth * metersToPx;
                // Clamp drawing to the visible chart area — if the CPA point
                // is off-canvas the dashed connector still terminates at the
                // edge, but we skip the marker.
                const cpaInBounds = Math.hypot(cpaX - center, cpaY - center) < svgRadius + 12;
                return (
                  <g key={`cpa-${target.mmsi}`} pointerEvents="none">
                    <line
                      x1={targetX}
                      y1={targetY}
                      x2={cpaX}
                      y2={cpaY}
                      stroke="#fbbf24"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    {cpaInBounds && (
                      <>
                        {/* CPA cross-hair */}
                        <line
                          x1={cpaX - 6}
                          y1={cpaY}
                          x2={cpaX + 6}
                          y2={cpaY}
                          stroke="#fbbf24"
                          strokeWidth="1.5"
                        />
                        <line
                          x1={cpaX}
                          y1={cpaY - 6}
                          x2={cpaX}
                          y2={cpaY + 6}
                          stroke="#fbbf24"
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={cpaX}
                          cy={cpaY}
                          r={Math.max(3, (cpa.cpaMeters * metersToPx) / 2)}
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth="0.5"
                          strokeDasharray="2 2"
                          opacity="0.5"
                        />
                      </>
                    )}
                  </g>
                );
              })}

              {/* AIS targets */}
              {targetsWithCpa.map(({ target, cpa, stale }) => {
                if (!cpa) return null;
                // Position in the (world-frame) canvas: bearing 0 = up (N).
                const dist = cpa.rangeMeters * metersToPx;
                if (dist > svgRadius) return null;
                const x = center + dist * Math.sin(cpa.bearingRadians);
                const y = center - dist * Math.cos(cpa.bearingRadians);
                // Stale targets never count as threats (last position is too
                // old to be tactically meaningful).
                const threat = !stale && isThreat(cpa);
                const cogDeg = ((target.cog ?? 0) * RAD_TO_DEG) % 360;
                // Stationary vessels (under 0.5 kn or no SOG) render with a
                // diamond icon and no COG leader — COG isn't meaningful at
                // that speed.
                const sogKn = (target.sog ?? 0) * MS_TO_KN;
                const stationary = !Number.isFinite(sogKn) || sogKn < STATIONARY_THRESHOLD_KN;
                // SOG-proportional leader: SOG (m/s) × horizon (s) → metres,
                // then scaled to canvas px. Clipped to the visible chart
                // so fast vessels near the edge don't shoot off-canvas.
                const leaderLen = stationary
                  ? 0
                  : Math.min(
                      (target.sog ?? 0) * COG_EXTENSION_MINUTES * 60 * metersToPx,
                      svgRadius - dist + 7,
                    );
                const fill = stale ? 'none' : threat ? '#ef4444' : '#94a3b8';
                const stroke = stale ? '#64748b' : '#0f172a';
                const leaderStroke = stale ? '#475569' : threat ? '#ef4444' : '#475569';
                return (
                  <g
                    key={target.mmsi}
                    onClick={() => setSelectedMmsi(target.mmsi)}
                    style={{ cursor: 'pointer' }}
                    opacity={stale ? 0.55 : 1}
                  >
                    <g transform={`translate(${x}, ${y})`}>
                      {stationary ? (
                        // Diamond, not rotated — directionless icon for
                        // anchored/moored vessels.
                        <polygon
                          points="0,-9 9,0 0,9 -9,0"
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={stale ? 1.5 : 1}
                          strokeDasharray={stale ? '3 2' : undefined}
                        />
                      ) : (
                        <g transform={`rotate(${cogDeg})`}>
                          <polygon
                            points="0,-14 -8,10 8,10"
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={stale ? 1.5 : 1}
                            strokeDasharray={stale ? '3 2' : undefined}
                          />
                          {leaderLen > 1 && (
                            <line
                              x1="0"
                              y1="-14"
                              x2="0"
                              y2={-14 - leaderLen}
                              stroke={leaderStroke}
                              strokeWidth="1.5"
                              strokeDasharray={stale ? '4 3' : undefined}
                            />
                          )}
                        </g>
                      )}
                      {selectedMmsi === target.mmsi && (
                        <circle r="11" fill="none" stroke="#fbbf24" strokeWidth="1.5" />
                      )}
                      {threat && (
                        <circle r="14" fill="none" stroke="#ef4444" strokeWidth="2">
                          <animate
                            attributeName="r"
                            values="10;18;10"
                            dur="2s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="opacity"
                            values="1;0;1"
                            dur="2s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      )}
                    </g>
                  </g>
                );
              })}

              {/* Own boat — at center. Triangle and SOG-proportional leader
                  both rotated by COG so the apparent direction matches every
                  other vessel on the screen. (HDG is published separately and
                  shown in the helm view; on the radar we want a consistent
                  COG-based picture.) Under 0.5 kn we render a diamond with no
                  leader, same convention as AIS targets. */}
              {(() => {
                const ownSogKn = ownSog * MS_TO_KN;
                const ownStationary =
                  !Number.isFinite(ownSogKn) || ownSogKn < STATIONARY_THRESHOLD_KN;
                if (ownStationary) {
                  return (
                    <g transform={`translate(${center}, ${center})`}>
                      <polygon
                        points="0,-9 9,0 0,9 -9,0"
                        fill="#fbbf24"
                        stroke="#0f172a"
                        strokeWidth="1"
                      />
                    </g>
                  );
                }
                const ownCogDeg = (ownCog * RAD_TO_DEG) % 360;
                const ownLeaderLen = Math.min(
                  ownSog * COG_EXTENSION_MINUTES * 60 * metersToPx,
                  svgRadius - 14,
                );
                return (
                  <g transform={`translate(${center}, ${center}) rotate(${ownCogDeg})`}>
                    {ownLeaderLen > 1 && (
                      <line
                        x1="0"
                        y1="-14"
                        x2="0"
                        y2={-14 - ownLeaderLen}
                        stroke="#fbbf24"
                        strokeWidth="1.5"
                        strokeOpacity="0.85"
                      />
                    )}
                    <polygon
                      points="0,-14 -8,10 8,10"
                      fill="#fbbf24"
                      stroke="#0f172a"
                      strokeWidth="1"
                    />
                  </g>
                );
              })()}
            </g>

            {/* North indicator — UNrotated; arrow points to where north is on
                the canvas. In north-up it's straight up; in course-up it points
                back relative to own's heading. */}
            <g transform={`translate(30, 30)`}>
              <circle r="18" fill="#0f172a" stroke="#334155" />
              <g transform={`rotate(${canvasRotationDeg})`}>
                <polygon
                  points="0,-12 -4,4 0,1 4,4"
                  fill="#fbbf24"
                  stroke="#0f172a"
                  strokeWidth="0.5"
                />
              </g>
              <text
                x="0"
                y="-22"
                textAnchor="middle"
                fontSize="10"
                fill="#94a3b8"
                fontFamily="monospace"
              >
                N
              </text>
            </g>

            {/* Range-ring scale labels */}
            {ringRadii.map((rNm, i) => (
              <text
                key={rNm}
                x={center + 4}
                y={center - rNm * NM * metersToPx - 2}
                fontSize="9"
                fill="#475569"
                fontFamily="monospace"
              >
                {rNm.toFixed(rNm < 1 ? 1 : 0)}
                {i === ringRadii.length - 1 ? ' NM' : ''}
              </text>
            ))}
            <text
              x={center + 4}
              y={center - svgRadius - 2}
              fontSize="9"
              fill="#94a3b8"
              fontFamily="monospace"
            >
              {rangeNm} NM
            </text>
          </svg>

          {!ownPos && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-slate-900/90 border border-slate-700 rounded px-4 py-2 text-xs text-slate-300 font-mono">
                Waiting for nav.gps.position…
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-[320px]">
          <h2 className="font-semibold mb-2 text-slate-300">Targets ({targetsWithCpa.length})</h2>
          {selectedRow && (
            <div className="mb-3 bg-slate-900 border border-slate-800 rounded p-3 text-xs font-mono">
              <div className="text-slate-400 mb-1 text-[10px] uppercase">Selected</div>
              <div className="grid grid-cols-2 gap-y-1">
                {aisDetailRows(selectedRow.target, selectedRow.cpa).map(([label, value]) => (
                  <Fragment key={label}>
                    <div className="text-slate-400">{label}</div>
                    <div>{value}</div>
                  </Fragment>
                ))}
              </div>
            </div>
          )}
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                {(
                  [
                    { k: 'mmsi', label: 'MMSI', align: 'left' },
                    { k: 'name', label: 'Name', align: 'left' },
                    { k: 'length', label: 'LOA', align: 'right' },
                    { k: 'sog', label: 'SOG', align: 'right' },
                    { k: 'cog', label: 'COG', align: 'right' },
                    { k: 'range', label: 'Range', align: 'right' },
                    { k: 'cpa', label: 'CPA', align: 'right' },
                    { k: 'tcpa', label: 'TCPA', align: 'right' },
                  ] as { k: SortKey; label: string; align: 'left' | 'right' }[]
                ).map(({ k, label, align }) => {
                  const active = sortKey === k;
                  const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
                  return (
                    <th
                      key={k}
                      className={`py-1 ${align === 'left' ? 'text-left' : 'text-right'} cursor-pointer select-none hover:text-slate-200 ${active ? 'text-slate-200' : ''}`}
                      onClick={() => handleSort(k)}
                      title={`Sort by ${label}`}
                    >
                      {label}
                      {arrow && <span className="ml-1 text-[10px]">{arrow}</span>}
                    </th>
                  );
                })}
                <th className="text-right py-1">Mute</th>
              </tr>
            </thead>
            <tbody>
              {targetsWithCpa
                .filter(({ cpa }) => cpa && cpa.rangeMeters < rangeNm * NM * 2)
                .sort((a, b) => {
                  // Safety invariant: threats always float to the top of the
                  // list regardless of column-sort choice. Stale-position CPA
                  // doesn't count as a threat (last fix is too old to act on).
                  const ta = !a.stale && isThreat(a.cpa) ? 0 : 1;
                  const tb = !b.stale && isThreat(b.cpa) ? 0 : 1;
                  if (ta !== tb) return ta - tb;
                  // Within the threat / non-threat groups, sort by the
                  // selected column. Missing values sort to the bottom of
                  // whichever direction is active so they don't dominate.
                  const valueOf = (r: typeof a): number | string | null => {
                    switch (sortKey) {
                      case 'mmsi':
                        return r.target.mmsi;
                      case 'name':
                        return r.target.name ?? null;
                      case 'length':
                        return r.target.length ?? null;
                      case 'sog':
                        return r.target.sog ?? null;
                      case 'cog':
                        return r.target.cog ?? null;
                      case 'range':
                        return r.cpa?.rangeMeters ?? null;
                      case 'cpa':
                        return r.cpa?.cpaMeters ?? null;
                      case 'tcpa':
                        return r.cpa?.tcpaSeconds ?? null;
                    }
                  };
                  const av = valueOf(a);
                  const bv = valueOf(b);
                  if (av === null && bv === null) return 0;
                  if (av === null) return 1;
                  if (bv === null) return -1;
                  const raw =
                    typeof av === 'string' && typeof bv === 'string'
                      ? av.localeCompare(bv)
                      : (av as number) - (bv as number);
                  return sortDir === 'asc' ? raw : -raw;
                })
                .map(({ target, cpa, stale }) => {
                  const threat = !stale && isThreat(cpa);
                  const selected = selectedMmsi === target.mmsi;
                  const mutedAt = mutes[target.mmsi];
                  const muted = mutedAt !== undefined;
                  const remutedTriggerNm = muted ? (mutedAt * 0.9) / NM : null;
                  const rowClass = stale
                    ? 'text-slate-500 italic'
                    : muted
                      ? 'text-slate-500'
                      : threat
                        ? 'text-red-300'
                        : '';
                  return (
                    <tr
                      key={target.mmsi}
                      className={`border-b border-slate-900 cursor-pointer hover:bg-slate-900 ${
                        selected ? 'bg-slate-800' : ''
                      } ${rowClass}`}
                      onClick={() => setSelectedMmsi(target.mmsi)}
                    >
                      <td className="py-1">{target.mmsi}</td>
                      <td className="py-1">
                        {target.name ?? '—'}
                        {stale && (
                          <span
                            className="ml-1 px-1 text-[10px] uppercase rounded bg-slate-800 text-slate-400"
                            title={`Last seen ${Math.round((Date.now() - target.lastSeenMs) / 1000)}s ago`}
                          >
                            stale
                          </span>
                        )}
                      </td>
                      <td className="py-1 text-right">
                        {target.length !== undefined ? `${target.length.toFixed(0)}m` : '—'}
                      </td>
                      <td className="py-1 text-right">
                        {target.sog !== undefined ? (target.sog * MS_TO_KN).toFixed(1) : '—'}
                      </td>
                      <td className="py-1 text-right">
                        {target.cog !== undefined
                          ? `${String(Math.round(wrap360(target.cog * RAD_TO_DEG))).padStart(3, '0')}°`
                          : '—'}
                      </td>
                      <td className="py-1 text-right">
                        {cpa ? `${(cpa.rangeMeters / NM).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1 text-right">
                        {cpa ? `${(cpa.cpaMeters / NM).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1 text-right">{cpa ? fmtTcpa(cpa.tcpaSeconds) : '—'}</td>
                      <td
                        className="py-1 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {muted ? (
                          <button
                            type="button"
                            onClick={() => unmuteVessel(target.mmsi)}
                            title={`Re-arm now (would auto-arm at CPA < ${remutedTriggerNm!.toFixed(2)} NM)`}
                            className="px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-emerald-700 hover:text-slate-100 rounded"
                          >
                            muted ≥{remutedTriggerNm!.toFixed(2)}
                          </button>
                        ) : threat ? (
                          <button
                            type="button"
                            onClick={() => muteVessel(target.mmsi)}
                            title="Silence the klaxon for this vessel until CPA closes by 10%"
                            className="px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-red-700 hover:text-red-100 rounded"
                          >
                            Mute
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
