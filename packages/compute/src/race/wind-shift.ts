export interface WindShiftConfig {
  baselineWindowMs: number;
  currentWindowMs: number;
  /** Called per `update()` so the threshold can change at runtime
   *  without recreating the detector (which would discard the rolling
   *  baseline window). Return radians. */
  getThresholdRad: () => number;
  persistenceMs: number;
}

export interface WindShiftSample {
  /** Signed shift (current − baseline), radians, normalized to [-π, π]. */
  biasRad: number;
  /** One-shot event payload on transition into a sustained shift, null otherwise. */
  event: { direction: 'header' | 'lift' | 'shift'; deg: number } | null;
}

interface CircularSample {
  tMs: number;
  /** Unit vector components (cos, sin) — averaging these is the
   *  circular-mean trick that handles wraparound correctly. */
  cos: number;
  sin: number;
  twdRad: number;
}

interface Window {
  samples: CircularSample[];
  cosSum: number;
  sinSum: number;
}

function pushWindow(w: Window, s: CircularSample, windowMs: number): void {
  w.samples.push(s);
  w.cosSum += s.cos;
  w.sinSum += s.sin;
  while (w.samples.length > 0 && s.tMs - w.samples[0]!.tMs > windowMs) {
    const dropped = w.samples.shift()!;
    w.cosSum -= dropped.cos;
    w.sinSum -= dropped.sin;
  }
}

function windowMedianRad(w: Window): number | null {
  if (w.samples.length === 0) return null;
  // Circular median via the sample whose TWD is closest to the circular mean.
  // The mean is atan2(meanSin, meanCos); we find the sample that minimises
  // the circular distance to the mean — this gives the robust "median-like"
  // estimator without sorting on a wrapped scale.
  const n = w.samples.length;
  const meanRad = Math.atan2(w.sinSum / n, w.cosSum / n);
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    let d = w.samples[i]!.twdRad - meanRad;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const dAbs = Math.abs(d);
    if (dAbs < bestDist) {
      bestDist = dAbs;
      bestIdx = i;
    }
  }
  return w.samples[bestIdx]!.twdRad;
}

function circularDiffRad(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export interface WindShiftDetector {
  update(twdRad: number, tMs: number, hdgRad?: number | null): WindShiftSample;
  reset(): void;
}

export function createWindShiftDetector(cfg: WindShiftConfig): WindShiftDetector {
  const baseline: Window = { samples: [], cosSum: 0, sinSum: 0 };
  const current: Window = { samples: [], cosSum: 0, sinSum: 0 };
  let aboveThresholdSinceMs: number | null = null;
  let lastEventFiredAtMs: number | null = null;

  return {
    update(twdRad, tMs, hdgRad) {
      const s: CircularSample = {
        tMs,
        cos: Math.cos(twdRad),
        sin: Math.sin(twdRad),
        twdRad,
      };
      pushWindow(baseline, s, cfg.baselineWindowMs);
      pushWindow(current, s, cfg.currentWindowMs);
      const bMed = windowMedianRad(baseline);
      const cMed = windowMedianRad(current);
      if (bMed === null || cMed === null) {
        return { biasRad: 0, event: null };
      }
      const bias = circularDiffRad(cMed, bMed);
      // Persistence tracker — threshold is fetched fresh each tick so
      // changes from /api/race/state PUTs apply without recreating the
      // detector (preserving the 5-min rolling baseline).
      const thresholdRad = cfg.getThresholdRad();
      if (Math.abs(bias) > thresholdRad) {
        if (aboveThresholdSinceMs === null) aboveThresholdSinceMs = tMs;
      } else {
        aboveThresholdSinceMs = null;
      }
      let event: WindShiftSample['event'] = null;
      if (
        aboveThresholdSinceMs !== null &&
        tMs - aboveThresholdSinceMs >= cfg.persistenceMs &&
        // Don't re-fire until the shift resets.
        (lastEventFiredAtMs === null || lastEventFiredAtMs < aboveThresholdSinceMs)
      ) {
        const deg = (bias * 180) / Math.PI;
        let direction: 'header' | 'lift' | 'shift' = 'shift';
        if (hdgRad !== null && hdgRad !== undefined) {
          // Starboard tack = wind from starboard = circularDiff(twd, hdg) ∈ (0, π)
          const onStbdTack = circularDiffRad(bMed, hdgRad) > 0;
          // A clockwise shift (positive bias) when on starboard tack moves the
          // wind further astern → lift. When on port tack → header.
          if (onStbdTack) direction = bias > 0 ? 'lift' : 'header';
          else direction = bias > 0 ? 'header' : 'lift';
        }
        event = { direction, deg };
        lastEventFiredAtMs = tMs;
      }
      return { biasRad: bias, event };
    },
    reset() {
      baseline.samples.length = 0;
      baseline.cosSum = 0;
      baseline.sinSum = 0;
      current.samples.length = 0;
      current.cosSum = 0;
      current.sinSum = 0;
      aboveThresholdSinceMs = null;
      lastEventFiredAtMs = null;
    },
  };
}
