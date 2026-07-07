/**
 * RampLegend — Tier-2 chart primitive.
 *
 * Renders a colour bar + labels derived from the SAME stops array that the
 * associated HeatmapGrid renders. This is the canonical-ramp law in practice:
 * pass the same stops from buildStops(mode) to both components so they cannot
 * drift apart.
 *
 * Usage:
 *   const stops = useMemo(() => buildStops('sequential'), []);
 *   <HeatmapGrid stops={stops} domain={...} ... />
 *   <RampLegend stops={stops} domain={...} unit="kn" />
 *
 * Token-only. No raw hex.
 */

import { type RampStop } from './ramp';

export interface RampLegendProps {
  /** The SAME stops passed to HeatmapGrid — canonical-ramp law. */
  stops: readonly RampStop[];
  /**
   * Domain: determines the label values shown under each stop.
   *   sequential: [min, max] — labels are linearly interpolated from min..max
   *   diverging:  maxAbs — labels run from -maxAbs to +maxAbs
   */
  domain: { mode: 'sequential'; min: number; max: number } | { mode: 'diverging'; maxAbs: number };
  /** Unit label shown above the bar */
  unit?: string;
  /** Additional className for the wrapper */
  className?: string;
}

function formatLabel(v: number): string {
  if (Number.isInteger(v) || Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(1);
}

function stopToValue(position: number, domain: RampLegendProps['domain']): number {
  if (domain.mode === 'sequential') {
    return domain.min + position * (domain.max - domain.min);
  }
  // diverging: position 0→-maxAbs, 0.5→0, 1→+maxAbs
  return (position * 2 - 1) * domain.maxAbs;
}

export function RampLegend({
  stops,
  domain,
  unit,
  className = '',
}: RampLegendProps): React.ReactElement {
  return (
    <div className={`text-caption text-ink-3 leading-tight ${className}`}>
      {unit && <div className="mb-0.5 text-ink-2">{unit}</div>}
      {/* Colour bar: one swatch per stop, flex-1 each.
           NOTE — flex-1 distributes equal width regardless of the stop's
           position value. This is correct for SEQUENTIAL ramps where stops are
           evenly spaced (0, 0.2, 0.4, 0.6, 0.8, 1.0). It would misrepresent
           a DIVERGING ramp with unevenly spaced stops (e.g. 0, 0.2, 0.4, 0.5,
           0.6, 0.8, 1.0 — the midpoint slack would appear equal to the outer
           bands). Both live consumers (wind overlay, current overlay) are
           sequential, so this latent constraint is acceptable. If a diverging
           ramp is ever added, weight each swatch by the gap to the next stop. */}
      <div className="flex w-full overflow-hidden rounded-sm">
        {stops.map(([pos, colour], i) => (
          <div
            key={i}
            className="h-3 flex-1"
            style={{ backgroundColor: colour }}
            aria-hidden="true"
          />
        ))}
      </div>
      {/* Label row: one label per stop, inherits text-caption from parent wrapper */}
      <div className="flex w-full">
        {stops.map(([pos], i) => {
          const v = stopToValue(pos, domain);
          return (
            <div key={i} className="flex-1 text-left tabular-nums">
              {formatLabel(v)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
