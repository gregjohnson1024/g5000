'use client';
import type maplibregl from 'maplibre-gl';
import type { Route } from '@g5000/routing';

const ISOCHRONE_SRC = 'route-isochrones';
const ISOCHRONE_LAYER = 'route-isochrones-line';

export function attachRoute(
  map: maplibregl.Map,
  id: string,
  route: Route,
  color = '#000000',
  showIsochrones = true,
): void {
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: route.legs.map((l) => [l.lon, l.lat]),
        },
      },
    ],
  };
  if (map.getSource(id)) {
    (map.getSource(id) as maplibregl.GeoJSONSource).setData(data);
    // Update colour in case caller passed a different one.
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color);
  } else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: { 'line-color': color, 'line-width': 3 },
    });
  }
  // Isochrones either attach (showing exploration depth) or clear.
  if (showIsochrones) {
    attachIsochrones(map, route);
  } else if (map.getSource(ISOCHRONE_SRC)) {
    (map.getSource(ISOCHRONE_SRC) as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [],
    });
  }
  // Make sure the route line is rendered above the isochrones (both
  // already above the wind sentinel — this just enforces the inner order).
  try {
    map.moveLayer(id);
  } catch {
    /* style not ready */
  }
}

/**
 * Draw only the first `count` isochrones of a route. Used to animate the
 * planner's frontier expanding step by step ("see the planning as it
 * happens"); call repeatedly with an increasing count. Creates the source/
 * layer on first call and updates its data thereafter.
 */
export function attachIsochronesUpTo(map: maplibregl.Map, route: Route, count: number): void {
  attachIsochrones(map, route, count);
}

function attachIsochrones(map: maplibregl.Map, route: Route, count?: number): void {
  const all = route.isochrones ?? [];
  const isos = count == null ? all : all.slice(0, Math.max(0, count));
  if (isos.length === 0) {
    // Clear any previous isochrones from an earlier plan.
    if (map.getSource(ISOCHRONE_SRC)) {
      (map.getSource(ISOCHRONE_SRC) as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    return;
  }
  const features: GeoJSON.Feature[] = isos.map((iso) => {
    const hoursFromStart = (iso.t - route.start) / 3600;
    return {
      type: 'Feature',
      properties: { hours: hoursFromStart },
      geometry: {
        type: 'LineString',
        coordinates: iso.points.map((p) => [p.lon, p.lat]),
      },
    };
  });
  const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
  if (map.getSource(ISOCHRONE_SRC)) {
    (map.getSource(ISOCHRONE_SRC) as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(ISOCHRONE_SRC, { type: 'geojson', data });
    map.addLayer({
      id: ISOCHRONE_LAYER,
      type: 'line',
      source: ISOCHRONE_SRC,
      paint: {
        // Cool blue at +0h ramping to magenta at +72h+ — same colour vocabulary
        // as the wind speed-fill, so a fast isochrone (covering more ground)
        // stands out against light winds (also cool) and against fast winds
        // (warm). Interpolation stops are forecast-hours.
        'line-color': [
          'interpolate',
          ['linear'],
          ['get', 'hours'],
          0,
          '#7dd3fc', // sky-300
          12,
          '#22d3ee', // cyan-400
          24,
          '#86efac', // green-300
          48,
          '#fde047', // yellow-300
          72,
          '#fb7185', // rose-400
        ],
        'line-width': 1.5,
        'line-opacity': 0.7,
      },
    });
  }
}

export function detachRoute(map: maplibregl.Map, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  if (map.getLayer(ISOCHRONE_LAYER)) map.removeLayer(ISOCHRONE_LAYER);
  if (map.getSource(ISOCHRONE_SRC)) map.removeSource(ISOCHRONE_SRC);
}
