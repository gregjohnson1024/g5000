/**
 * SOG ramp in m/s (~0–20 kn): slow navy → fast red. Matches RoutePolyline's
 * `sog` expression so a recorded track and a planned route read on one scale.
 * interpolate-hcl keeps the midpoints vibrant (no muddy RGB blends).
 *
 * Returned as `unknown` so consumers can cast to MapLibre's ExpressionSpecification
 * at the call site without this module importing maplibre-gl. Copied verbatim from
 * TrackOverlay's SOG_EXPR.
 *
 * NOTE: MapLibre paint expressions don't support CSS var() — hex literals required.
 * Stop values map to token equivalents in DAY theme:
 *   0 m/s → --seq-1 (#1e3a8a navy), 2.5 → --info-strong (#3b82f6),
 *   5 m/s → --ok area (#22c55e), 7.5 → --accent-hi (#f59e0b), 10 → --danger-strong (#ef4444).
 */
export const SOG_COLOR_EXPR: unknown = [
  'interpolate-hcl',
  ['linear'],
  ['get', 'sog'],
  0,
  '#1e3a8a',
  2.5,
  '#3b82f6',
  5,
  '#22c55e',
  7.5,
  '#f59e0b',
  10,
  '#ef4444',
];
