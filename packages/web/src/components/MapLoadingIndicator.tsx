'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';

/**
 * Small floating pill that appears while MapLibre has BASEMAP / CHART
 * tiles in flight. Anchors top-center of the chart canvas.
 *
 * Filters to the two raster tile sources we care about:
 *   - `osm` (OSM basemap, defined in Map.tsx)
 *   - `noaa-enc` (NOAA NCDS overlay, defined in EncLayer.tsx)
 *
 * The map's `idle` event clears the indicator. We deliberately ignore
 * `sourcedataloading` from every other source (AIS, wind, currents,
 * route, etc.) which fire on routine polling and would flash the pill
 * constantly with no actual tile loading happening.
 */
const TILE_SOURCE_IDS = new Set(['osm', 'noaa-enc']);

export function MapLoadingIndicator({ map }: { map: maplibregl.Map | null }) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!map) return;
    const onLoading = (e: { sourceId?: string }): void => {
      if (e.sourceId && TILE_SOURCE_IDS.has(e.sourceId)) setLoading(true);
    };
    const onIdle = (): void => setLoading(false);
    map.on('sourcedataloading', onLoading);
    map.on('idle', onIdle);
    return () => {
      map.off('sourcedataloading', onLoading);
      map.off('idle', onIdle);
    };
  }, [map]);

  if (!loading) return null;
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-slate-900/90 border border-slate-700 text-slate-100 text-xs shadow-lg flex items-center gap-2 pointer-events-none">
      <span
        aria-hidden="true"
        className="inline-block w-3 h-3 border-2 border-slate-500 border-t-slate-100 rounded-full animate-spin"
      />
      Loading map…
    </div>
  );
}
