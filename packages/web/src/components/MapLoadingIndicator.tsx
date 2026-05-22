'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';

/**
 * Small floating pill that appears while MapLibre has tiles in flight.
 * Anchors top-center of the chart canvas.
 *
 * Uses two MapLibre events:
 *   - `sourcedataloading` fires when any source begins loading tiles
 *   - `idle` fires when no more tiles / sprites / glyphs are pending
 *
 * The `idle` event is a clean "everything done" signal — much simpler
 * than counting individual tile loads.
 */
export function MapLoadingIndicator({ map }: { map: maplibregl.Map | null }) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!map) return;
    const onLoading = (): void => setLoading(true);
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
