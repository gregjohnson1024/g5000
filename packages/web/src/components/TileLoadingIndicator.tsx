'use client';
import { useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';

/**
 * Small status dot — amber + pulsing when MapLibre is still loading
 * tiles, dim emerald when everything in the current viewport has
 * settled. Pinned bottom-left of the chart canvas, above the scale
 * bar. Useful on slow networks (boat / offshore) so the user knows
 * whether the OSM basemap, NOAA raster, or vector overlays are still
 * fetching — vs. truly empty / off-coverage.
 *
 * Uses MapLibre's `dataloading` + `idle` events. `idle` fires only
 * when the style is fully loaded AND all tile fetches have settled,
 * so it's the canonical "everything done" signal — no manual ref-
 * counting required.
 */
export function TileLoadingIndicator({
  map,
}: {
  map: maplibregl.Map | null;
}): React.ReactElement | null {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!map) return;
    const onLoading = (): void => setLoading(true);
    const onIdle = (): void => setLoading(false);
    map.on('dataloading', onLoading);
    map.on('idle', onIdle);
    // Seed initial state — if the map is already idle at mount time,
    // the dot starts dim instead of flashing on at the first event.
    setLoading(!map.loaded() || !map.areTilesLoaded());
    return () => {
      map.off('dataloading', onLoading);
      map.off('idle', onIdle);
    };
  }, [map]);

  return (
    <div
      className="absolute bottom-2 left-2 z-10 pointer-events-none"
      title={loading ? 'Loading tiles…' : 'Tiles loaded'}
    >
      <div
        aria-label={loading ? 'Loading tiles' : 'Tiles loaded'}
        role="status"
        className={
          'w-2.5 h-2.5 rounded-full shadow border border-black/30 ' +
          (loading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500/50')
        }
      />
    </div>
  );
}
