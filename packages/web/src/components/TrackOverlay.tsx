'use client';
import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { TrackPoint } from '../lib/tracks';

export type TrackColorMode = 'none' | 'sog';

/** SOG ramp in m/s (~0–20 kn): slow navy → fast red. Matches RoutePolyline's
 *  `sog` expression so a recorded track and a planned route read on one scale.
 *  interpolate-hcl keeps the midpoints vibrant (no muddy RGB blends). */
const SOG_EXPR: maplibregl.ExpressionSpecification = [
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

/** Solid colour for `none` mode. Violet so an ended track is visually distinct
 *  from the live recording's green trail (LiveBoatMarker). */
const PLAIN_COLOR = '#a855f7';

/** One LineString feature per consecutive pair, carrying the leading point's
 *  SOG so the `sog` colour mode can shade each segment. */
function segments(points: TrackPoint[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    features.push({
      type: 'Feature',
      properties: { sog: a.sog ?? 0 },
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Render one saved track as a coloured line on the chart. `id` is the unique
 * MapLibre source id (the layer is `${id}-line`). Mount/unmount and colour
 * changes are driven by props; the effect cleanup removes the source+layer so
 * toggling a track off on /tracks makes it disappear here.
 */
export function TrackOverlay({
  map,
  id,
  points,
  colorMode,
}: {
  map: maplibregl.Map | null;
  id: string;
  points: TrackPoint[];
  colorMode: TrackColorMode;
}) {
  useEffect(() => {
    if (!map) return;
    const layerId = `${id}-line`;
    const data = segments(points);
    const color = colorMode === 'sog' ? SOG_EXPR : PLAIN_COLOR;
    const ensure = (): void => {
      try {
        const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(data);
          if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'line-color', color);
        } else {
          map.addSource(id, { type: 'geojson', data });
          map.addLayer({
            id: layerId,
            type: 'line',
            source: id,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.9 },
          });
        }
      } catch {
        /* style not ready — styledata retry below covers it */
      }
    };
    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        /* map torn down */
      }
    };
  }, [map, id, points, colorMode]);

  return null;
}
