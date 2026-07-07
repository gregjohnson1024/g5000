/**
 * hold-progress — pure hold-timing helpers.
 *
 * Factored out of HoldButton so timing logic can be unit-tested
 * without a DOM or React dependency.
 *
 * All functions are deterministic given elapsed + holdMs — no side effects.
 */

/**
 * Returns the hold fraction in the range [0, 1].
 *
 * @param elapsed - milliseconds elapsed since the hold started
 * @param holdMs  - total hold duration in milliseconds (must be > 0)
 */
export function holdFraction(elapsed: number, holdMs: number): number {
  if (holdMs <= 0) return 1;
  return Math.min(1, elapsed / holdMs);
}

/**
 * Returns true when the hold fraction represents a completed hold.
 * Uses an exact check: fraction must reach exactly 1.0 (clamped by holdFraction).
 *
 * @param fraction - value returned by holdFraction
 */
export function isComplete(fraction: number): boolean {
  return fraction >= 1;
}
