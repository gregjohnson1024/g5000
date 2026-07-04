/**
 * Trip detection — a pure, dependency-free state machine that turns a stream
 * of position/SOG fixes into discrete trips (dock-to-dock / anchor-to-anchor
 * passages).
 *
 * States: 'moored' ⇄ 'underway'.
 *
 *  - moored → underway ("start"): SOG >= `underwaySogKn`, sustained for
 *    `underwayHoldS`. The start is backdated to the first fix of the
 *    sustained-fast window (when the boat actually started moving), and
 *    distance accumulates from that fix.
 *  - underway → moored ("end"): SOG < `mooredSogKn`, sustained for
 *    `mooredHoldS`. The end is backdated to the first fix of the
 *    sustained-slow window (when the boat actually stopped); distance/summary
 *    are snapshotted at that fix, so anchor-swing creep during the slow
 *    window is excluded.
 *
 * Robustness rules:
 *  - GPS-glitch rejection: a fix that jumps more than `glitchJumpM` from the
 *    last accepted fix in under `glitchMaxDtS` is dropped entirely (no
 *    distance, no state-machine input). Because the comparison is against
 *    the last *accepted* fix, a single-sample glitch self-heals on the next
 *    good fix, and a genuine sustained relocation is accepted once the gap
 *    to the last accepted fix exceeds `glitchMaxDtS`.
 *  - Gap close: a sample gap longer than `gapCloseS` force-closes an open
 *    trip at the last good fix (backdated to the slow window if one was
 *    open), then treats the new sample as a fresh moored-state fix.
 *  - Short-trip discard: a closing trip with distance < `minTripM` emits
 *    `{ type: 'discard' }` INSTEAD of `{ type: 'end' }`. A 'start' will
 *    already have been emitted for it — consumers must treat 'discard' as
 *    cancelling the open trip without persisting it.
 */

export interface TripDetectorConfig {
  /** SOG at/above which the boat counts as moving (kn). */
  underwaySogKn: number;
  /** Seconds SOG must stay >= underwaySogKn to open a trip. */
  underwayHoldS: number;
  /** SOG below which the boat counts as stopped (kn). */
  mooredSogKn: number;
  /** Seconds SOG must stay < mooredSogKn to close a trip. */
  mooredHoldS: number;
  /** Sample gap (s) that force-closes an open trip at the last good fix. */
  gapCloseS: number;
  /** Trips shorter than this (m) are discarded, not ended. ~0.2 NM. */
  minTripM: number;
  /** Position jump (m) that is rejected when the fix interval is short. */
  glitchJumpM: number;
  /** Max interval (s) under which a >glitchJumpM jump counts as a glitch. */
  glitchMaxDtS: number;
}

export const DEFAULT_TRIP_DETECTOR_CONFIG: TripDetectorConfig = {
  underwaySogKn: 1.5,
  underwayHoldS: 60,
  mooredSogKn: 0.7,
  mooredHoldS: 600,
  gapCloseS: 900,
  minTripM: 370,
  glitchJumpM: 500,
  glitchMaxDtS: 5,
};

export interface TripFixInput {
  tMs: number;
  lat: number;
  lon: number;
  /** SOG in knots; null when unknown (keeps an open trip open). */
  sogKn: number | null;
}

export interface TripSummary {
  distanceM: number;
  durationS: number;
  maxSogKn: number;
  avgSogKn: number;
  samples: number;
}

export type TripEvent =
  | { type: 'start'; tMs: number; lat: number; lon: number }
  | { type: 'end'; tMs: number; lat: number; lon: number; summary: TripSummary }
  | { type: 'discard'; tMs: number; lat: number; lon: number };

export interface TripDetectorSnapshot {
  state: 'moored' | 'underway';
  /** When the current state began (trip start for underway; last trip end for moored). */
  sinceMs: number;
  liveDistanceM: number;
  liveDurationS: number;
}

interface Fix {
  tMs: number;
  lat: number;
  lon: number;
}

/** Accumulator shared by the provisional fast-window and the open trip. */
interface TripAccum {
  startMs: number;
  startLat: number;
  startLon: number;
  distanceM: number;
  maxSogKn: number;
  samples: number;
}

interface SlowWindow {
  sinceMs: number;
  endFix: Fix;
  /** Trip stats snapshotted at the first slow fix (the backdated end). */
  distanceMAt: number;
  maxSogKnAt: number;
  samplesAt: number;
}

const MEAN_EARTH_RADIUS_M = 6371_008.8;
const DEG_TO_RAD = Math.PI / 180;
const MPS_TO_KN = 1 / 0.514444;

/** Local haversine so the detector stays dependency-free. */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const dφ = (lat2 - lat1) * DEG_TO_RAD;
  const dλ = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dφ / 2) * Math.sin(dφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) * Math.sin(dλ / 2);
  return 2 * MEAN_EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class TripDetector {
  private readonly cfg: TripDetectorConfig;
  private state: 'moored' | 'underway' = 'moored';
  private lastFix: Fix | null = null;
  /** Provisional accumulator while a sustained-fast window is open (moored). */
  private fastWindow: TripAccum | null = null;
  /** The open trip (underway). */
  private trip: TripAccum | null = null;
  /** Sustained-slow window while underway (candidate backdated end). */
  private slowWindow: SlowWindow | null = null;
  /** When the current moored period began (last trip end); null before any trip. */
  private mooredSinceMs: number | null = null;
  private firstFedMs: number | null = null;

  constructor(config?: Partial<TripDetectorConfig>) {
    this.cfg = { ...DEFAULT_TRIP_DETECTOR_CONFIG, ...config };
  }

  feed(input: TripFixInput): TripEvent[] {
    const events: TripEvent[] = [];
    const { tMs, lat, lon, sogKn } = input;
    if (this.firstFedMs === null) this.firstFedMs = tMs;

    // Gap: force-close an open trip at the last good fix, then restart fresh.
    if (this.lastFix && tMs - this.lastFix.tMs > this.cfg.gapCloseS * 1000) {
      events.push(...this.closeOpenTrip());
      this.lastFix = null;
      this.fastWindow = null;
    }

    // Glitch rejection: impossible jump from the last accepted fix.
    if (
      this.lastFix &&
      tMs - this.lastFix.tMs < this.cfg.glitchMaxDtS * 1000 &&
      haversineM(this.lastFix.lat, this.lastFix.lon, lat, lon) > this.cfg.glitchJumpM
    ) {
      return events;
    }

    const distM = this.lastFix ? haversineM(this.lastFix.lat, this.lastFix.lon, lat, lon) : 0;
    const fix: Fix = { tMs, lat, lon };
    this.lastFix = fix;

    if (this.state === 'moored') {
      if (sogKn !== null && sogKn >= this.cfg.underwaySogKn) {
        if (!this.fastWindow) {
          this.fastWindow = {
            startMs: tMs,
            startLat: lat,
            startLon: lon,
            distanceM: 0,
            maxSogKn: sogKn,
            samples: 1,
          };
        } else {
          this.fastWindow.distanceM += distM;
          this.fastWindow.maxSogKn = Math.max(this.fastWindow.maxSogKn, sogKn);
          this.fastWindow.samples += 1;
        }
        if (tMs - this.fastWindow.startMs >= this.cfg.underwayHoldS * 1000) {
          // Promote: trip start backdated to the first fast fix.
          this.trip = this.fastWindow;
          this.fastWindow = null;
          this.slowWindow = null;
          this.state = 'underway';
          events.push({
            type: 'start',
            tMs: this.trip.startMs,
            lat: this.trip.startLat,
            lon: this.trip.startLon,
          });
        }
      } else {
        // Slow or unknown SOG resets the fast window.
        this.fastWindow = null;
      }
    } else {
      const trip = this.trip!;
      trip.distanceM += distM;
      trip.samples += 1;
      if (sogKn !== null) trip.maxSogKn = Math.max(trip.maxSogKn, sogKn);

      if (sogKn !== null && sogKn < this.cfg.mooredSogKn) {
        if (!this.slowWindow) {
          this.slowWindow = {
            sinceMs: tMs,
            endFix: fix,
            distanceMAt: trip.distanceM,
            maxSogKnAt: trip.maxSogKn,
            samplesAt: trip.samples,
          };
        } else if (tMs - this.slowWindow.sinceMs >= this.cfg.mooredHoldS * 1000) {
          events.push(...this.closeOpenTrip());
        }
      } else {
        // Fast or unknown SOG resets the slow window (unknown is conservative:
        // it keeps the trip open rather than ending it on missing data).
        this.slowWindow = null;
      }
    }

    return events;
  }

  /**
   * Force-close any open trip (mode swap, shutdown). Ends at the sustained-slow
   * window if one is open, else at the last accepted fix. Returns the emitted
   * events ('end' or 'discard'; empty when already moored).
   */
  close(): TripEvent[] {
    this.fastWindow = null;
    return this.closeOpenTrip();
  }

  snapshot(nowMs: number): TripDetectorSnapshot {
    if (this.state === 'underway' && this.trip) {
      return {
        state: 'underway',
        sinceMs: this.trip.startMs,
        liveDistanceM: this.trip.distanceM,
        liveDurationS: Math.max(0, (nowMs - this.trip.startMs) / 1000),
      };
    }
    const sinceMs = this.mooredSinceMs ?? this.firstFedMs ?? nowMs;
    return {
      state: 'moored',
      sinceMs,
      liveDistanceM: 0,
      liveDurationS: Math.max(0, (nowMs - sinceMs) / 1000),
    };
  }

  private closeOpenTrip(): TripEvent[] {
    if (this.state !== 'underway' || !this.trip || !this.lastFix) return [];
    const trip = this.trip;
    const endFix = this.slowWindow?.endFix ?? this.lastFix;
    const endMs = this.slowWindow?.sinceMs ?? this.lastFix.tMs;
    const distanceM = this.slowWindow?.distanceMAt ?? trip.distanceM;
    const maxSogKn = this.slowWindow?.maxSogKnAt ?? trip.maxSogKn;
    const samples = this.slowWindow?.samplesAt ?? trip.samples;
    const durationS = Math.max(0, (endMs - trip.startMs) / 1000);

    this.state = 'moored';
    this.trip = null;
    this.slowWindow = null;
    this.mooredSinceMs = endMs;

    if (distanceM < this.cfg.minTripM) {
      return [{ type: 'discard', tMs: endMs, lat: endFix.lat, lon: endFix.lon }];
    }
    const avgSogKn = durationS > 0 ? (distanceM / durationS) * MPS_TO_KN : 0;
    return [
      {
        type: 'end',
        tMs: endMs,
        lat: endFix.lat,
        lon: endFix.lon,
        summary: { distanceM, durationS, maxSogKn, avgSogKn, samples },
      },
    ];
  }
}
