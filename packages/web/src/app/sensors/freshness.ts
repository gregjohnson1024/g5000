export type Freshness = 'green' | 'yellow' | 'red';

export const FRESH_THRESHOLD_MS = 2_000;
export const STALE_THRESHOLD_MS = 10_000;

/**
 * Classify a sensor reading's freshness for the status dot.
 *
 * `ageMs` is the number of milliseconds since the most recent sample on any of
 * the sensor's channels, or `null` if no sample has ever been observed.
 */
export function freshnessOf(ageMs: number | null): Freshness {
  if (ageMs === null) return 'red';
  if (ageMs < FRESH_THRESHOLD_MS) return 'green';
  if (ageMs < STALE_THRESHOLD_MS) return 'yellow';
  return 'red';
}
