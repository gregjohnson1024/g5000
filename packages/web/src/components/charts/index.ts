/**
 * components/charts — Tier-2 Chart Primitive Library
 *
 * Token-only, theme-agnostic chart primitives.
 * All components in this folder use design tokens exclusively (no raw hex).
 *
 * Phase 6 (task-1):
 *   TimeSeriesPanel — responsive multi-line time series with real y-ticks + fixed domain
 *   StripChart       — unified conditions strip chart (tides + currents)
 *   HeatmapGrid      — generic heatmap backed by canonical ramp
 *   RampLegend       — canonical legend that derives from the same stops as HeatmapGrid
 *   ramp.ts          — shared ramp module (buildStops, colourForValue, etc.)
 *   plot-scale.ts    — Y-domain, tick, and coordinate helpers
 */

export { TimeSeriesPanel } from './TimeSeriesPanel';
export type { TimeSeriesPanelProps } from './TimeSeriesPanel';

export { StripChart } from './StripChart';
export type { StripChartProps, StripPoint, StripEvent, EventKind } from './StripChart';

export { HeatmapGrid } from './HeatmapGrid';
export type { HeatmapGridProps, HeatmapCell } from './HeatmapGrid';

export { RampLegend } from './RampLegend';
export type { RampLegendProps } from './RampLegend';

export {
  buildStops,
  colourForValue,
  colourAtPosition,
  normalisedPosition,
  resolveToken,
} from './ramp';
export type { RampMode, RampStop } from './ramp';

export { computeYDomain, yTicks, yCoord, xCoord, fmtTick } from './plot-scale';
export type { YDomain } from './plot-scale';
