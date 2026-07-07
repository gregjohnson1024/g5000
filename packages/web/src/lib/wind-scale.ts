/**
 * Wind-speed (knots) → fill colour. Discrete steps matching common nautical-wind
 * palettes: a speed in `[FILL_STOPS[i][0], FILL_STOPS[i+1][0])` renders as
 * `FILL_STOPS[i][1]`. Shared by the chart wind overlay's fill and the WindLegend
 * so the drawn colours and the legend can't drift apart.
 *
 * NOTE: Used in MapLibre paint expressions which do NOT support CSS var() — hex
 * literals are required. Values map to the sequential token ramp in DAY theme:
 *   0kn  → #1e3a8a  ≈ --seq-1 (navy)
 *   5kn  → #3b82f6  ≈ --info-strong (blue)
 *   10kn → #22d3ee  ≈ --info (cyan)
 *   15kn → #10b981  ≈ --ok (emerald)
 *   20kn → #a3e635  ≈ lime (between --seq-3/--seq-4)
 *   25kn → #facc15  ≈ --warn / --seq-4 (yellow)
 *   30kn → #fb923c  ≈ --flow-ebb (orange)
 *   35kn → #f87171  ≈ --danger (red)
 *   45kn → #c084fc  ≈ violet
 *   60kn → #fb7185  ≈ --port (rose)
 */
export const FILL_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, '#1e3a8a'], // ≈ --seq-1
  [5, '#3b82f6'], // ≈ --info-strong
  [10, '#22d3ee'], // ≈ --info
  [15, '#10b981'], // ≈ --ok
  [20, '#a3e635'], // lime
  [25, '#facc15'], // ≈ --warn
  [30, '#fb923c'], // ≈ --flow-ebb
  [35, '#f87171'], // ≈ --danger
  [45, '#c084fc'], // violet
  [60, '#fb7185'], // ≈ --port
];
