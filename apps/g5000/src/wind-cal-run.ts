import { Channels, getSharedSourcePriority, subscribeSelected, type Bus } from '@g5000/core';
import type { WindMisalignmentCal } from '@g5000/db';

/**
 * Guided two-tack TWD calibration run.
 *
 * While running, the collector buckets published true-wind-direction samples
 * by (tack, nearest AWS bin). Tack comes from the sign of the apparent wind
 * angle (positive = starboard per the bus convention); AWS is the bin key
 * because it's what the misalignment cal interpolates on. On stop, every bin
 * with enough samples on BOTH tacks yields a signed AWA offset:
 *
 *   offset = wrapToPi(circularMean(twd_port) − circularMean(twd_stbd)) / 2
 *
 * Since the environment's TWD is the same on both tacks, any tack-dependent
 * bias in the computed TWD shows up as a spread between the per-tack circular
 * means; half the (angle-wrapped) spread is the signed AWA correction that is
 * applied identically on both tacks.
 *
 * The controller is installed on a `globalThis` singleton
 * (`__g5000_windCalRun__`) so the Next.js route handlers under
 * /api/calibration/twd-run can drive it — same pattern as
 * `__g5000_alarms_config_ref__`.
 */

/** Default AWS bin centers for a run, m/s. */
export const DEFAULT_RUN_AWS_BINS = [3, 5, 8, 10];
/** A bin needs at least this many TWD samples on each tack to produce an offset. */
export const MIN_SAMPLES_PER_BUCKET = 30;
/** An AWA/AWS sample older than this cannot pair with an incoming TWD sample. */
const PAIRING_MAX_AGE_MS = 2000;

export type Tack = 'port' | 'starboard';

export interface WindCalRunQualityBin {
  /** AWS bin center, m/s. */
  awsBin: number;
  samplesPort: number;
  samplesStarboard: number;
}

export interface WindCalRunResult {
  awsBins: number[];
  awaOffsetRad: number[];
  quality: {
    minSamplesPerBucket: number;
    bins: WindCalRunQualityBin[];
  };
}

export interface WindCalRunStatus {
  running: boolean;
  /** Epoch ms (UTC) when the current/last run started; null before any run. */
  startedAt: number | null;
  awsBins: number[];
  /** Sample counts per AWS bin, per tack. */
  counts: { port: number[]; starboard: number[] };
  /** Live offset preview per AWS bin (rad); null where either tack lacks samples. */
  previewOffsetRad: (number | null)[];
  minSamplesPerBucket: number;
  /** Populated by stop(); cleared by start()/abort(). */
  result: WindCalRunResult | null;
}

/** Wrap an angle to (−π, π]. */
export function wrapToPi(rad: number): number {
  const TWO_PI = 2 * Math.PI;
  let a = rad % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  return a;
}

interface Bucket {
  count: number;
  sinSum: number;
  cosSum: number;
}

const emptyBuckets = (n: number): Bucket[] =>
  Array.from({ length: n }, () => ({ count: 0, sinSum: 0, cosSum: 0 }));

function nearestBinIndex(bins: number[], v: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < bins.length; i++) {
    const d = Math.abs(v - bins[i]!);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function circularMean(b: Bucket): number {
  return Math.atan2(b.sinSum, b.cosSum);
}

/**
 * Pure sample accumulator for a run — exported separately from the bus-facing
 * controller so the offset math is unit-testable with synthetic samples.
 */
export class WindCalRunCollector {
  private readonly buckets: Record<Tack, Bucket[]>;

  constructor(readonly awsBins: number[]) {
    this.buckets = { port: emptyBuckets(awsBins.length), starboard: emptyBuckets(awsBins.length) };
  }

  add(tack: Tack, aws: number, twdRad: number): void {
    if (this.awsBins.length === 0) return;
    const b = this.buckets[tack][nearestBinIndex(this.awsBins, aws)]!;
    b.count += 1;
    b.sinSum += Math.sin(twdRad);
    b.cosSum += Math.cos(twdRad);
  }

  counts(): { port: number[]; starboard: number[] } {
    return {
      port: this.buckets.port.map((b) => b.count),
      starboard: this.buckets.starboard.map((b) => b.count),
    };
  }

  /**
   * Per-bin offset (rad) using circular means, or null where either tack has
   * fewer than `minSamples`.
   */
  previewOffsets(minSamples: number): (number | null)[] {
    return this.awsBins.map((_, i) => {
      const port = this.buckets.port[i]!;
      const stbd = this.buckets.starboard[i]!;
      if (port.count < minSamples || stbd.count < minSamples) return null;
      return wrapToPi(circularMean(port) - circularMean(stbd)) / 2;
    });
  }

  /** Result over the bins that qualified, or null if none did. */
  finalize(minSamples: number): WindCalRunResult | null {
    const offsets = this.previewOffsets(minSamples);
    const awsBins: number[] = [];
    const awaOffsetRad: number[] = [];
    const bins: WindCalRunQualityBin[] = [];
    for (let i = 0; i < this.awsBins.length; i++) {
      const offset = offsets[i];
      if (offset === null || offset === undefined) continue;
      awsBins.push(this.awsBins[i]!);
      awaOffsetRad.push(offset);
      bins.push({
        awsBin: this.awsBins[i]!,
        samplesPort: this.buckets.port[i]!.count,
        samplesStarboard: this.buckets.starboard[i]!.count,
      });
    }
    if (awsBins.length === 0) return null;
    return { awsBins, awaOffsetRad, quality: { minSamplesPerBucket: minSamples, bins } };
  }
}

export interface WindCalRunController {
  start(): WindCalRunStatus;
  /** Stops collecting and computes the result (null if no bin qualified). */
  stop(): WindCalRunStatus;
  /** Stops collecting and discards everything. */
  abort(): WindCalRunStatus;
  status(): WindCalRunStatus;
  /** WindMisalignmentCal-shaped view of the last stop()'s result, or null. */
  result(): WindMisalignmentCal | null;
}

export function installWindCalRun(bus: Bus): WindCalRunController {
  let collector: WindCalRunCollector | null = null;
  let running = false;
  let startedAt: number | null = null;
  let result: WindCalRunResult | null = null;
  let unsubs: Array<() => void> = [];
  let latestAwa: { value: number; atMs: number } | null = null;
  let latestAws: { value: number; atMs: number } | null = null;

  const unsubscribeAll = (): void => {
    for (const u of unsubs) u();
    unsubs = [];
    latestAwa = null;
    latestAws = null;
  };

  const status = (): WindCalRunStatus => {
    const awsBins = collector?.awsBins ?? DEFAULT_RUN_AWS_BINS;
    return {
      running,
      startedAt,
      awsBins,
      counts: collector?.counts() ?? {
        port: awsBins.map(() => 0),
        starboard: awsBins.map(() => 0),
      },
      previewOffsetRad:
        collector?.previewOffsets(MIN_SAMPLES_PER_BUCKET) ?? awsBins.map(() => null),
      minSamplesPerBucket: MIN_SAMPLES_PER_BUCKET,
      result,
    };
  };

  const controller: WindCalRunController = {
    start(): WindCalRunStatus {
      if (running) return status();
      collector = new WindCalRunCollector(DEFAULT_RUN_AWS_BINS);
      result = null;
      running = true;
      startedAt = Date.now();
      // Inputs are arbitrated the same way the true-wind pipeline arbitrates
      // its own (multi-source apparent wind on a real boat).
      unsubs.push(
        subscribeSelected(bus, Channels.Wind.ApparentAngle, getSharedSourcePriority, (s) => {
          if (s.value.kind !== 'scalar') return;
          latestAwa = { value: s.value.value, atMs: Date.now() };
        }),
        subscribeSelected(bus, Channels.Wind.ApparentSpeed, getSharedSourcePriority, (s) => {
          if (s.value.kind !== 'scalar') return;
          latestAws = { value: s.value.value, atMs: Date.now() };
        }),
        subscribeSelected(bus, Channels.Wind.TrueDirection, getSharedSourcePriority, (s) => {
          if (s.value.kind !== 'scalar' || !collector) return;
          const now = Date.now();
          if (!latestAwa || now - latestAwa.atMs > PAIRING_MAX_AGE_MS) return;
          if (!latestAws || now - latestAws.atMs > PAIRING_MAX_AGE_MS) return;
          // AWA sign convention: positive = wind from starboard = starboard tack.
          const tack: Tack = latestAwa.value < 0 ? 'port' : 'starboard';
          collector.add(tack, latestAws.value, s.value.value);
        }),
      );
      return status();
    },

    stop(): WindCalRunStatus {
      if (!running) return status();
      unsubscribeAll();
      running = false;
      result = collector?.finalize(MIN_SAMPLES_PER_BUCKET) ?? null;
      return status();
    },

    abort(): WindCalRunStatus {
      unsubscribeAll();
      running = false;
      collector = null;
      result = null;
      return status();
    },

    status,

    result(): WindMisalignmentCal | null {
      if (!result) return null;
      return { awsBins: result.awsBins, awaOffsetRad: result.awaOffsetRad };
    },
  };

  (globalThis as { __g5000_windCalRun__?: WindCalRunController }).__g5000_windCalRun__ = controller;
  return controller;
}

export function getWindCalRun(): WindCalRunController | undefined {
  return (globalThis as { __g5000_windCalRun__?: WindCalRunController }).__g5000_windCalRun__;
}
