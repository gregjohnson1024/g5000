/**
 * staleness — pure state-machine helpers for the StalenessShroud.
 *
 * No React, no DOM, no I/O — deterministic given ageMs.
 * Factored out so timing logic can be unit-tested independently.
 *
 * State thresholds (proposal §5 Tier-1 / StalenessShroud spec):
 *   fresh  — ageMs < 2 000 ms  → normal rendering
 *   aging  — 2 000 ≤ ageMs < 10 000 ms → dim to --ink-3
 *   stale  — ageMs ≥ 10 000 ms → hollow numerals + age chip
 */

export type StalenessState = 'fresh' | 'aging' | 'stale';

/** Threshold constants (ms) — exported for consumers that need numeric gates. */
export const FRESH_THRESHOLD_MS = 2_000;
export const STALE_THRESHOLD_MS = 10_000;

/**
 * Returns the staleness state for a given age in milliseconds.
 *
 * @param ageMs - milliseconds since the last sample (must be ≥ 0; negative treated as 0)
 */
export function stalenessState(ageMs: number): StalenessState {
  const age = Math.max(0, ageMs);
  if (age < FRESH_THRESHOLD_MS) return 'fresh';
  if (age < STALE_THRESHOLD_MS) return 'aging';
  return 'stale';
}

/**
 * Returns the Tailwind token classes to apply to the value container
 * for a given staleness state.
 *
 * Fresh  — no special classes (inherits text-ink-value from the tile)
 * Aging  — text-ink-3 (dims the numeral)
 * Stale  — text-ink-4 (hollows the slot; a separate age chip is shown)
 */
export function stalenessClasses(state: StalenessState): string {
  switch (state) {
    case 'fresh':
      return '';
    case 'aging':
      return 'text-ink-3';
    case 'stale':
      return 'text-ink-4';
  }
}

/**
 * Returns a compact human-readable age label for the stale chip.
 * Rounds to the nearest whole unit; never shows decimals.
 *
 * Examples:
 *   ageLabel(500)    → '< 1s'
 *   ageLabel(1000)   → '1s'
 *   ageLabel(12345)  → '12s'
 *   ageLabel(90000)  → '1m 30s'
 *   ageLabel(3661000)→ '1h 1m'
 */
export function ageLabel(ageMs: number): string {
  const totalS = Math.floor(Math.max(0, ageMs) / 1000);
  if (totalS < 1) return '< 1s';

  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;

  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (m > 0) {
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${s}s`;
}
