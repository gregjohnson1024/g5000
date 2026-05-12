/**
 * Return an ordered list of candidate headings (radians) covering
 * `center ± halfWidth` at `resolution`. Values are NOT normalized to
 * `[0, 2π)` — the caller is responsible for wrap-safe consumption
 * (e.g. `atan2` handles wrap naturally when sampling wind).
 */
export function generateHeadingFan(
  center: number,
  halfWidth: number,
  resolution: number,
): number[] {
  const headings: number[] = [];
  const n = Math.round((2 * halfWidth) / resolution);
  for (let i = 0; i <= n; i++) {
    headings.push(center - halfWidth + i * resolution);
  }
  return headings;
}
