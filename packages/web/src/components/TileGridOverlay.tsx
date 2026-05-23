'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'tile-grid';
const LINE_LAYER_ID = 'tile-grid-line';

/**
 * Debug overlay: draws the boundary of every visible tile at the current
 * integer zoom level (matches the zoom MapLibre uses for raster sources)
 * plus a `z/x/y` label at the centre of each tile.
 *
 * Useful for diagnosing "why isn't this tile showing?" — you can see at
 * a glance which tile your viewport actually covers and cross-reference
 * with the cache state on disk.
 *
 * Pure client-side, no network: tile corners are computed from the
 * standard XYZ ↔ lat/lon math.
 */
export function TileGridOverlay({
  map,
  visible,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
}): null {
  // HTML markers for z/x/y labels — avoids MapLibre's `text-field` glyph
  // dependency. Keyed by tile id so we can reuse markers across moves and
  // remove only the ones that left the viewport.
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new globalThis.Map());

  // Source + line layer (rectangle outlines). Added once.
  useEffect(() => {
    if (!map) return;
    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }
        if (!map.getLayer(LINE_LAYER_ID)) {
          map.addLayer({
            id: LINE_LAYER_ID,
            type: 'line',
            source: SOURCE_ID,
            paint: {
              'line-color': '#10b981',
              'line-width': 1,
              'line-opacity': 0.7,
              'line-dasharray': [2, 2],
            },
          });
        }
      } catch {
        /* style torn down mid-render; retry on next styledata */
      }
    };
    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
    };
  }, [map]);

  // Visibility flip — line layer toggles via setLayoutProperty; markers
  // attach/detach. When hidden, drop every marker so they don't leak DOM.
  useEffect(() => {
    if (!map) return;
    const apply = (): void => {
      if (map.getLayer(LINE_LAYER_ID)) {
        map.setLayoutProperty(LINE_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
      }
    };
    apply();
    map.on('styledata', apply);
    if (!visible) {
      for (const m of markersRef.current.values()) m.remove();
      markersRef.current.clear();
    }
    return () => {
      map.off('styledata', apply);
    };
  }, [map, visible]);

  // Recompute lines + markers on every move/zoom.
  useEffect(() => {
    if (!map || !visible) return;
    const update = (): void => {
      try {
        const tiles = enumerateTiles(map);
        const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (src && 'setData' in src) {
          src.setData({
            type: 'FeatureCollection',
            features: tiles.map((t) => ({
              type: 'Feature' as const,
              geometry: {
                type: 'LineString' as const,
                coordinates: [
                  [t.west, t.north],
                  [t.east, t.north],
                  [t.east, t.south],
                  [t.west, t.south],
                  [t.west, t.north],
                ],
              },
              properties: {},
            })),
          });
        }
        // Sync markers: add new ones, remove ones that left the viewport.
        const wanted = new Set(tiles.map((t) => t.id));
        for (const [id, mk] of markersRef.current) {
          if (!wanted.has(id)) {
            mk.remove();
            markersRef.current.delete(id);
          }
        }
        for (const t of tiles) {
          if (markersRef.current.has(t.id)) continue;
          const el = document.createElement('div');
          el.textContent = t.id;
          el.style.cssText =
            'font:11px/1 ui-monospace,monospace;color:#10b981;background:#000a;' +
            'padding:1px 4px;border-radius:3px;pointer-events:none;white-space:nowrap;';
          const mk = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([(t.west + t.east) / 2, (t.north + t.south) / 2])
            .addTo(map);
          markersRef.current.set(t.id, mk);
        }
      } catch {
        /* map torn down mid-tick; ignore */
      }
    };
    update();
    map.on('moveend', update);
    map.on('zoomend', update);
    return () => {
      map.off('moveend', update);
      map.off('zoomend', update);
    };
  }, [map, visible]);

  // Cleanup all markers on unmount.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
    };
  }, []);

  return null;
}

interface TileBounds {
  id: string;
  west: number;
  east: number;
  north: number;
  south: number;
}

function tileToLonLat(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lon, lat];
}

function enumerateTiles(map: maplibregl.Map): TileBounds[] {
  // Match MapLibre's RasterTileSource selection: `roundZoom: true` means
  // tile zoom = Math.round(viewport_zoom).
  const z = Math.round(map.getZoom());
  if (z < 0 || z > 22) return [];
  const bounds = map.getBounds();
  const n = 2 ** z;
  const lonToX = (lon: number): number => Math.floor(((lon + 180) / 360) * n);
  const latToY = (lat: number): number => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const x0 = Math.max(0, lonToX(bounds.getWest()));
  const x1 = Math.min(n - 1, lonToX(bounds.getEast()));
  const y0 = Math.max(0, latToY(bounds.getNorth()));
  const y1 = Math.min(n - 1, latToY(bounds.getSouth()));
  // Hard cap on visible tiles so a wild zoom-out doesn't churn through
  // thousands of markers.
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return [];
  const out: TileBounds[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const [w, north] = tileToLonLat(x, y, z);
      const [e, south] = tileToLonLat(x + 1, y + 1, z);
      out.push({ id: `${z}/${x}/${y}`, west: w, east: e, north, south });
    }
  }
  return out;
}
