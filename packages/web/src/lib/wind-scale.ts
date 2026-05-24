/**
 * Wind-speed (knots) → fill colour. Discrete steps matching common nautical-wind
 * palettes: a speed in `[FILL_STOPS[i][0], FILL_STOPS[i+1][0])` renders as
 * `FILL_STOPS[i][1]`. Shared by the chart wind overlay's fill and the WindLegend
 * so the drawn colours and the legend can't drift apart.
 */
export const FILL_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, '#1e3a8a'], // navy
  [5, '#3b82f6'], // blue-500
  [10, '#22d3ee'], // cyan-400
  [15, '#10b981'], // emerald-500
  [20, '#a3e635'], // lime-400
  [25, '#facc15'], // yellow-400
  [30, '#fb923c'], // orange-400
  [35, '#f87171'], // red-400
  [45, '#c084fc'], // purple-400
  [60, '#fb7185'], // rose-400
];
