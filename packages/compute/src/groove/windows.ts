export interface FlagSample {
  t_ns: bigint;
  flag: boolean;
}
export interface NumSample {
  t_ns: bigint;
  value: number;
}

const secondsBetween = (a: bigint, b: bigint): number => Number(b - a) / 1e9;

/**
 * Time-weighted fraction of the window where flag is true. Each interval
 * [tᵢ, tᵢ₊₁) is weighted by its duration and the flag value at tᵢ.
 * Returns null with < 2 samples.
 */
export function timeWeightedFraction(samples: ReadonlyArray<FlagSample>): number | null {
  if (samples.length < 2) return null;
  let trueTime = 0;
  let total = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const dt = secondsBetween(samples[i]!.t_ns, samples[i + 1]!.t_ns);
    if (dt <= 0) continue;
    total += dt;
    if (samples[i]!.flag) trueTime += dt;
  }
  if (total <= 0) return null;
  return trueTime / total;
}

/**
 * Circular standard deviation of angles (radians). Uses the mean resultant
 * length R: SD = sqrt(-2·ln R), which is wrap-safe. Returns null when empty.
 */
export function circularStdDev(angles: ReadonlyArray<number>): number | null {
  if (angles.length === 0) return null;
  let sumSin = 0;
  let sumCos = 0;
  for (const a of angles) {
    sumSin += Math.sin(a);
    sumCos += Math.cos(a);
  }
  const n = angles.length;
  const r = Math.hypot(sumSin / n, sumCos / n);
  if (r >= 1) return 0;
  if (r <= 0) return Math.sqrt(-2 * Math.log(Number.EPSILON));
  return Math.sqrt(-2 * Math.log(r));
}

/** Std-dev ÷ mean. Null when empty or |mean| < 1e-9. */
export function coefficientOfVariation(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (Math.abs(mean) < 1e-9) return null;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(variance) / mean;
}

/**
 * Reversals per minute: count sign changes in successive deltas, ignoring
 * deltas whose magnitude is below the dead-band. Null with < 2 samples or
 * zero span.
 */
export function reversalsPerMinute(
  samples: ReadonlyArray<NumSample>,
  deadband: number,
): number | null {
  if (samples.length < 2) return null;
  const span = secondsBetween(samples[0]!.t_ns, samples[samples.length - 1]!.t_ns);
  if (span <= 0) return null;
  let reversals = 0;
  let lastDir = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i]!.value - samples[i - 1]!.value;
    if (Math.abs(d) < deadband) continue;
    const dir = d > 0 ? 1 : -1;
    if (lastDir !== 0 && dir !== lastDir) reversals++;
    lastDir = dir;
  }
  return (reversals / span) * 60;
}

/** Largest positive d(value)/dt across consecutive samples, units value/s. Null with < 2. */
export function maxRisingSlope(samples: ReadonlyArray<NumSample>): number | null {
  if (samples.length < 2) return null;
  let best = -Infinity;
  for (let i = 1; i < samples.length; i++) {
    const dt = secondsBetween(samples[i - 1]!.t_ns, samples[i]!.t_ns);
    if (dt <= 0) continue;
    const slope = (samples[i]!.value - samples[i - 1]!.value) / dt;
    if (slope > best) best = slope;
  }
  return best === -Infinity ? null : best;
}

/** Drop samples older than `cutoff_ns`. Returns a new array. */
export function pruneBefore<T extends { t_ns: bigint }>(
  samples: ReadonlyArray<T>,
  cutoff_ns: bigint,
): T[] {
  return samples.filter((s) => s.t_ns >= cutoff_ns);
}
