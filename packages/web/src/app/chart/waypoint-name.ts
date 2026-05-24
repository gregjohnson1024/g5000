/**
 * Auto-name for a chart-dropped waypoint: "WP N" where N is one past the
 * highest existing "WP <n>" name. Names that don't match "WP <n>" are ignored.
 */
export function nextWaypointName(existingNames: string[]): string {
  let max = 0;
  for (const name of existingNames) {
    const m = /^WP (\d+)$/.exec(name.trim());
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `WP ${max + 1}`;
}
