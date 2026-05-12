'use client';
import type maplibregl from 'maplibre-gl';
import type { Route } from '@g5000/routing';

export function attachRoute(map: maplibregl.Map, id: string, route: Route, color = '#22d3ee'): void {
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: route.legs.map((l) => [l.lon, l.lat]),
      },
    }],
  };
  if (map.getSource(id)) {
    (map.getSource(id) as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: { 'line-color': color, 'line-width': 2 },
    });
  }
}

export function detachRoute(map: maplibregl.Map, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}
