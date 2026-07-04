import type { Bus } from '@g5000/core';
import { Channels, getSharedSourcePriority, subscribeSelected } from '@g5000/core';
import {
  type ConfigStore,
  type TripMode,
  type TripStayKind,
  type AlarmsConfig,
  insertShipLogEntry,
  insertTrip,
} from '@g5000/db';
import {
  TripDetector,
  type TripDetectorSnapshot,
  type TripEvent,
  haversineMeters,
} from '@g5000/compute';

const MS_TO_KN = 1 / 0.514444;
/** SOG samples older than this are treated as unknown when feeding the detector. */
const SOG_STALE_MS = 5_000;
/** TWS at/above this (m/s) counts a moment as "sailable wind". */
const SAIL_TWS_MPS = 3;
/** Fraction of underway time with sailable wind required to call a trip 'sail'. */
const SAIL_TWS_FRACTION = 0.6;
/** Fraction of underway time with an engine running required to call it 'motor'. */
const MOTOR_ENGINE_FRACTION = 0.5;
/** Anchor-watch arming must land within this window of trip end to classify the stay. */
const ANCHOR_WINDOW_MS = 10 * 60_000;
/** Nearest waypoint within this radius names the moorage; else compact DMM. */
const MOORAGE_WAYPOINT_M = 500;
/** Cap per-sample point-of-sail accumulation so stale streams don't inflate a bucket. */
const POS_MAX_STEP_MS = 10_000;

type EndEvent = Extract<TripEvent, { type: 'end' }>;

export interface TripEngineHandle {
  dispose: () => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __g5000_trip_engine__: { snapshot: () => TripDetectorSnapshot } | undefined;
}

/** Compact marine DMM, matching packages/web's fmtLatLonDmm: `33 42.232n 66 25.240w`. */
function fmtDmm(lat: number, lon: number): string {
  const one = (value: number, pos: string, neg: string): string => {
    const hemi = value >= 0 ? pos : neg;
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const min = ((abs - deg) * 60).toFixed(3);
    return `${deg} ${min}${hemi}`;
  };
  return `${one(lat, 'n', 's')} ${one(lon, 'e', 'w')}`;
}

function fmtDuration(durationS: number): string {
  const totalMin = Math.round(durationS / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Trip engine — feeds live position/SOG into the pure TripDetector and
 * persists closed trips.
 *
 * Mode gating matches the track recorder: samples are consumed only while
 * `getMode() === 'live'`. Demo (synthetic Ottawa GPS) and replay share the
 * nav channels, so a mode swap mid-trip force-closes the open trip at the
 * last live fix rather than stitching synthetic fixes into it.
 *
 * On trip end the engine:
 *  - classifies `stayKind`: 'anchor' when the anchor watch was armed within
 *    ±10 min of the (backdated) trip end — read from the live alarms config
 *    ref (`droppedAt`); armed-with-no-timestamp stays 'unknown';
 *  - names moorages by the nearest waypoint within 500 m of the start/end
 *    fix, falling back to a compact DMM string;
 *  - classifies propulsion `mode` (heuristic, user-overridable later):
 *    engines-on for > 50% of underway time → 'motor' (Sula has no engine
 *    data on N2K, so this is the manual BoatState UI toggle, sampled at
 *    1 Hz); else TWS >= 3 m/s for >= 60% of underway time → 'sail'; some
 *    evidence of each but neither dominant → 'mixed'; no data → 'unknown';
 *  - inserts a `trips` row plus a kind='trip' ship's-log entry.
 *
 * Point-of-sail seconds accumulate over the open trip's wall clock (the
 * sustained-slow window before the backdated end therefore leaks a few
 * minutes of 'not-sailing' — acceptable for a per-trip summary).
 *
 * A restart mid-trip loses the in-memory trip (no phantom end row is
 * written on dispose — the boat is usually still moving).
 */
export function startTripEngine(args: {
  bus: Bus;
  store: ConfigStore;
  boatId: string;
  getMode: () => string;
}): TripEngineHandle {
  const { bus, store, boatId, getMode } = args;
  const detector = new TripDetector();

  let sog: { kn: number; atMs: number } | null = null;
  let tws: { mps: number; atMs: number } | null = null;

  // Per-trip accumulators (reset on start).
  let open = false;
  let startFix: { lat: number; lon: number } | null = null;
  let startAtMs: number | null = null;
  let pointOfSailSec: Record<string, number> = {};
  let lastPosState: string | null = null;
  let lastPosAtMs = 0;
  let twsSamples = 0;
  let twsSailSamples = 0;
  let engineSamples = 0;
  let engineOnSamples = 0;

  const resetAccumulators = (): void => {
    pointOfSailSec = {};
    lastPosAtMs = Date.now();
    twsSamples = 0;
    twsSailSamples = 0;
    engineSamples = 0;
    engineOnSamples = 0;
  };

  const classifyStay = (endMs: number): TripStayKind => {
    const ref = (globalThis as { __g5000_alarms_config_ref__?: { current: AlarmsConfig } })
      .__g5000_alarms_config_ref__;
    const anchor = ref?.current?.thresholds?.anchor;
    if (!anchor?.armed || !anchor.droppedAt) return 'unknown';
    const droppedMs = Date.parse(anchor.droppedAt);
    if (!Number.isFinite(droppedMs)) return 'unknown';
    return Math.abs(droppedMs - endMs) <= ANCHOR_WINDOW_MS ? 'anchor' : 'unknown';
  };

  const moorageName = (lat: number, lon: number): string => {
    let best: { name: string; distM: number } | null = null;
    for (const wp of store.getWaypoints()) {
      const distM = haversineMeters({ lat, lon }, { lat: wp.lat, lon: wp.lon });
      if (distM <= MOORAGE_WAYPOINT_M && (!best || distM < best.distM)) {
        best = { name: wp.name, distM };
      }
    }
    return best ? best.name : fmtDmm(lat, lon);
  };

  const classifyMode = (): TripMode => {
    const engineFrac = engineSamples > 0 ? engineOnSamples / engineSamples : null;
    const sailFrac = twsSamples > 0 ? twsSailSamples / twsSamples : null;
    if (engineFrac !== null && engineFrac > MOTOR_ENGINE_FRACTION) return 'motor';
    if (sailFrac !== null && sailFrac >= SAIL_TWS_FRACTION) return 'sail';
    if ((engineFrac !== null && engineFrac > 0) || sailFrac !== null) return 'mixed';
    return 'unknown';
  };

  const persistTrip = async (e: EndEvent): Promise<void> => {
    // Flush the trailing point-of-sail segment.
    if (lastPosState !== null && lastPosAtMs > 0) {
      const dtMs = Math.min(Date.now() - lastPosAtMs, POS_MAX_STEP_MS);
      if (dtMs > 0) {
        pointOfSailSec[lastPosState] = (pointOfSailSec[lastPosState] ?? 0) + dtMs / 1000;
      }
    }
    const start = startFix;
    const pointOfSail = Object.keys(pointOfSailSec).length > 0 ? { ...pointOfSailSec } : null;
    await insertTrip(store, {
      boatId,
      startMs: startAtMs ?? e.tMs - e.summary.durationS * 1000,
      endMs: e.tMs,
      startLat: start?.lat ?? e.lat,
      startLon: start?.lon ?? e.lon,
      endLat: e.lat,
      endLon: e.lon,
      distanceM: e.summary.distanceM,
      durationS: Math.round(e.summary.durationS),
      maxSogKn: e.summary.maxSogKn,
      avgSogKn: e.summary.avgSogKn,
      mode: classifyMode(),
      pointOfSail,
      stayKind: classifyStay(e.tMs),
      moorageStartName: start ? moorageName(start.lat, start.lon) : null,
      moorageEndName: moorageName(e.lat, e.lon),
    });
    const nm = (e.summary.distanceM / 1852).toFixed(1);
    await insertShipLogEntry(store, {
      tsMs: e.tMs,
      source: 'auto',
      kind: 'trip',
      text: `Trip ended — ${nm} NM in ${fmtDuration(e.summary.durationS)}`,
      lat: e.lat,
      lon: e.lon,
      sogKn: sog ? sog.kn : null,
      twsKn: tws ? tws.mps * MS_TO_KN : null,
      author: null,
      boatId,
    });
  };

  const handleEvents = (events: TripEvent[]): void => {
    for (const e of events) {
      if (e.type === 'start') {
        open = true;
        startFix = { lat: e.lat, lon: e.lon };
        startAtMs = e.tMs;
        resetAccumulators();
      } else if (e.type === 'discard') {
        open = false;
        startFix = null;
        startAtMs = null;
      } else {
        open = false;
        void persistTrip(e).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[autopilot] trip engine: failed to persist trip:', err);
        });
        startFix = null;
        startAtMs = null;
      }
    }
  };

  const subs: Array<() => void> = [];
  subs.push(
    subscribeSelected(bus, Channels.Nav.Position, getSharedSourcePriority, (s) => {
      if (s.value.kind !== 'geo') return;
      if (getMode() !== 'live') {
        // Same semantics as the track recorder: demo/replay fixes are never
        // consumed, and a swap away from live force-closes the open trip.
        if (open) handleEvents(detector.close());
        return;
      }
      const now = Date.now();
      const sogKn = sog && now - sog.atMs <= SOG_STALE_MS ? sog.kn : null;
      handleEvents(
        detector.feed({ tMs: now, lat: s.value.value.lat, lon: s.value.value.lon, sogKn }),
      );
      if (open) {
        // Engine run state is a manual UI toggle (no engine data on N2K).
        const engines = store.getBoatState().engines;
        engineSamples += 1;
        if (engines.port.running || engines.starboard.running) engineOnSamples += 1;
      }
    }),
  );
  subs.push(
    subscribeSelected(bus, Channels.Nav.Sog, getSharedSourcePriority, (s) => {
      if (s.value.kind === 'scalar') sog = { kn: s.value.value * MS_TO_KN, atMs: Date.now() };
    }),
  );
  subs.push(
    bus.subscribe(Channels.Wind.TrueSpeed, (s) => {
      if (s.value.kind !== 'scalar') return;
      tws = { mps: s.value.value, atMs: Date.now() };
      if (open) {
        twsSamples += 1;
        if (s.value.value >= SAIL_TWS_MPS) twsSailSamples += 1;
      }
    }),
  );
  subs.push(
    bus.subscribe(Channels.Groove.PointOfSail, (s) => {
      if (s.value.kind !== 'enum') return;
      const now = Date.now();
      if (open && lastPosState !== null && lastPosAtMs > 0) {
        const dtMs = Math.min(now - lastPosAtMs, POS_MAX_STEP_MS);
        if (dtMs > 0) {
          pointOfSailSec[lastPosState] = (pointOfSailSec[lastPosState] ?? 0) + dtMs / 1000;
        }
      }
      lastPosState = s.value.value;
      lastPosAtMs = now;
    }),
  );

  globalThis.__g5000_trip_engine__ = { snapshot: () => detector.snapshot(Date.now()) };

  return {
    dispose: () => {
      for (const u of subs) u();
      globalThis.__g5000_trip_engine__ = undefined;
    },
  };
}
