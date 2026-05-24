import { FILL_STOPS } from '../lib/wind-scale';

/**
 * Discrete colour-bar legend for the wind-speed fill. One swatch per bin (so it
 * matches how the overlay actually draws — stepped, not interpolated), with the
 * lower-bound knot label under each swatch's left edge. Reuses the same
 * FILL_STOPS the overlay's fill uses, so they can't drift apart.
 */
export function WindLegend() {
  return (
    <div className="text-xs text-slate-400 leading-tight">
      <div className="mb-0.5">Wind speed (kn)</div>
      <div className="flex w-full overflow-hidden rounded-sm">
        {FILL_STOPS.map(([thr, color]) => (
          <div
            key={thr}
            className="h-3 flex-1"
            style={{ backgroundColor: color }}
            title={`≥ ${thr} kn`}
          />
        ))}
      </div>
      <div className="flex w-full">
        {FILL_STOPS.map(([thr]) => (
          <div key={thr} className="flex-1 text-left text-[9px] tabular-nums text-slate-500">
            {thr}
          </div>
        ))}
      </div>
    </div>
  );
}
