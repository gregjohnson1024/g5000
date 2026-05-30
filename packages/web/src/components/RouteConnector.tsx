'use client';
import type maplibregl from 'maplibre-gl';

export interface PathPoint {
  lat: number;
  lon: number;
}

/**
 * Draw the planned route as straight segments connecting its waypoints
 * (start → via… → end). This is the navigational route the user is building,
 * INDEPENDENT of the wind/current/polar-optimised path (attachRoute). Rendered
 * dashed so it reads as intent vs. the solid coloured optimised path. Fewer
 * than two points clears the line.
 */
export function attachRouteConnector(map: maplibregl.Map, id: string, points: PathPoint[]): void {
  if (points.length < 2) {
    detachRouteConnector(map, id);
    return;
  }
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: points.slice(0, -1).map((p, i) => ({
      type: 'Feature',
      properties: { segIndex: i },
      geometry: {
        type: 'LineString',
        coordinates: [
          [p.lon, p.lat],
          [points[i + 1]!.lon, points[i + 1]!.lat],
        ],
      },
    })),
  };
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    return;
  }
  try {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f8fafc',
        'line-width': 2,
        'line-dasharray': [2, 2],
        'line-opacity': 0.9,
      },
    });
  } catch {
    /* style not ready yet — the page effect re-runs and retries */
  }
}

export function detachRouteConnector(map: maplibregl.Map, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}
