'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'noaa-enc';
const LAYER_ID = 'noaa-enc-layer';

/**
 * NOAA NCDS paper-chart raster overlay. Opaque tiles covering the
 * OSM basemap with the full nautical chart rendering — depth
 * contours, lit aids with characteristic, harbour limits, dredged
 * channels, anchorages.
 *
 * Tiles come from the same-origin /api/enc-tiles proxy, which
 * handles the XYZ → NOAA z-2 translation and disk caches under
 * ~/.g5000-router/enc-cache.
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by
 * Map.tsx, so wind / AIS / route / range-rings render on top.
 *
 * Coverage is US waters and territories only. NOAA's tile grid
 * tops out at standard XYZ z=18 (their z=16) — minzoom/maxzoom
 * on the source keep MapLibre from requesting outside that band.
 */
export function EncLayer({
  map,
  visible,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
}) {
  useEffect(() => {
    if (!map) return;
    // Same pattern as SeamarkLayer's post-fix form: do NOT gate on
    // map.isStyleLoaded() (it can stay false indefinitely while other
    // sources are loading). The chart page hands us `map` from inside
    // Map.tsx's `onLoad`, so the style is already initialized and
    // addSource/addLayer are safe. Wrap in try/catch to survive an
    // HMR race where the map has been torn down between renders.
    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: 'raster',
            tiles: ['/api/enc-tiles/{z}/{x}/{y}.png'],
            tileSize: 256,
            minzoom: 7,
            maxzoom: 18,
            attribution: 'NOAA / Office of Coast Survey',
          });
        }
        if (!map.getLayer(LAYER_ID)) {
          const beforeId = map.getLayer('__above-wind__')
            ? '__above-wind__'
            : undefined;
          map.addLayer(
            {
              id: LAYER_ID,
              type: 'raster',
              source: SOURCE_ID,
              layout: { visibility: visible ? 'visible' : 'none' },
            },
            beforeId,
          );
        }
      } catch {
        /* style torn down mid-render; the next styledata event retries */
      }
    };

    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
    };
  }, [map, visible]);

  useEffect(() => {
    if (!map) return;
    if (!map.getLayer(LAYER_ID)) return;
    map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
  }, [map, visible]);

  // Periodically reload the source while visible, so tiles that previously
  // timed out (our proxy served a transparent PNG with x-cache: TIMEOUT)
  // get re-requested. MapLibre's in-memory tile cache is independent of
  // HTTP cache headers, so without this the slow tiles would stay blank
  // forever until the user pans/zooms away and back. Successful tiles
  // hit our server-side disk cache and return instantly, so the cost is
  // just the slow tiles being re-attempted.
  useEffect(() => {
    if (!map || !visible) return;
    const RELOAD_MS = 60_000;
    const id = window.setInterval(() => {
      try {
        const src = map.getSource(SOURCE_ID) as
          | { reload?: () => void }
          | undefined;
        src?.reload?.();
      } catch {
        /* map may be torn down mid-tick; ignore */
      }
    }, RELOAD_MS);
    return () => window.clearInterval(id);
  }, [map, visible]);

  return null;
}
