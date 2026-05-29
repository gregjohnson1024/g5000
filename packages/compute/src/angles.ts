/**
 * Small angle helpers shared across compute root modules.
 */

/**
 * Wrap an angle (radians) into the half-open interval [0, 2π).
 *
 * Implements the canonical `((x % 2π) + 2π) % 2π` idiom verbatim, so the
 * numeric result is identical to the inline expressions it replaces.
 */
export function wrapTwoPi(x: number): number {
  return ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}
