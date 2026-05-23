'use client';
import { useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';

/**
 * Tiny bottom-right pill that shows the current MapLibre zoom level.
 *
 * Optional `noaaFloor` + `noaaEnabled` props colour the pill amber when
 * the user has the NOAA layer toggled on but is zoomed below NOAA's
 * configured minzoom — i.e. "you won't see NOAA tiles at this scale". A
 * silent hint for the floor that the EncLayer source enforces.
 */
export function ZoomIndicator({
  map,
  noaaFloor,
  noaaEnabled = false,
}: {
  map: maplibregl.Map | null;
  /** NOAA source minzoom — used to colour-cue when the user is below it. */
  noaaFloor?: number;
  /** Whether the NOAA layer is currently enabled. */
  noaaEnabled?: boolean;
}): React.ReactElement | null {
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    if (!map) return;
    const update = (): void => setZoom(map.getZoom());
    update();
    map.on('zoom', update);
    return () => {
      map.off('zoom', update);
    };
  }, [map]);

  if (zoom === null) return null;

  const belowFloor =
    noaaEnabled && typeof noaaFloor === 'number' && zoom < noaaFloor;

  return (
    <div
      className={
        'absolute bottom-2 right-2 z-10 px-2 py-1 text-xs font-mono rounded border shadow ' +
        (belowFloor
          ? 'bg-amber-500/85 text-slate-900 border-amber-600'
          : 'bg-slate-900/80 text-slate-100 border-slate-700')
      }
      title={
        belowFloor
          ? `Below NOAA minzoom (${noaaFloor}) — chart layer is hidden at this scale`
          : 'Current zoom'
      }
    >
      z={zoom.toFixed(1)}
    </div>
  );
}
