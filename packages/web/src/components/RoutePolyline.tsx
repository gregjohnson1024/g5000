'use client';
import type maplibregl from 'maplibre-gl';
import type { Route } from '@g5000/routing';

export type RouteColorMode = 'none' | 'tack' | 'sog' | 'twa';

/** Per-mode `line-color` expression over the segment features. 'none' → the
 *  solid base colour (the model's amber/cyan). */
function colorExpr(
  mode: RouteColorMode,
  base: string,
): maplibregl.ExpressionSpecification | string {
  switch (mode) {
    case 'tack':
      return ['match', ['get', 'tack'], 'port', '#ef4444', 'starboard', '#22c55e', base];
    case 'sog':
      // Through-water/over-ground speed in m/s (~0–20 kn): slow blue → fast red.
      // interpolate-hcl blends in perceptual colour space — no muddy RGB midpoints.
      return [
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
    case 'twa':
      // |TWA| radians: upwind blue → reach green/amber → run red.
      return [
        'interpolate-hcl',
        ['linear'],
        ['get', 'twa'],
        0,
        '#3b82f6',
        1.0472,
        '#22c55e',
        2.0944,
        '#f59e0b',
        Math.PI,
        '#ef4444',
      ];
    default:
      return base;
  }
}

/** One LineString feature per leg, carrying the attributes the colour modes
 *  key on plus a `motoring` flag (1/0) for the dashed-segment filter. */
function segments(route: Route): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const legs = route.legs;
  for (let i = 0; i < legs.length - 1; i++) {
    const a = legs[i]!;
    const b = legs[i + 1]!;
    features.push({
      type: 'Feature',
      properties: {
        tack: a.tack ?? 'none',
        sog: a.sogGround,
        twa: a.twa,
        motoring: a.motoring ? 1 : 0,
      },
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
 * Draw a route as per-leg segments coloured by `mode`, with motoring legs
 * dashed. Two line layers share one GeoJSON source: the base layer renders
 * sailing segments solid, the `__motor` layer renders motoring segments
 * dashed. Switching colour mode just updates each layer's `line-color`.
 */
export function attachRoute(
  map: maplibregl.Map,
  id: string,
  route: Route,
  color = '#000000',
  mode: RouteColorMode = 'none',
): void {
  const data = segments(route);
  const expr = colorExpr(mode, color);
  const dashId = `${id}__motor`;
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', expr);
    if (map.getLayer(dashId)) map.setPaintProperty(dashId, 'line-color', expr);
  } else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      filter: ['!=', ['get', 'motoring'], 1],
      paint: { 'line-color': expr, 'line-width': 3 },
    });
    map.addLayer({
      id: dashId,
      type: 'line',
      source: id,
      filter: ['==', ['get', 'motoring'], 1],
      paint: { 'line-color': expr, 'line-width': 3, 'line-dasharray': [2, 2] },
    });
  }
  try {
    map.moveLayer(id);
    map.moveLayer(dashId);
  } catch {
    /* style not ready */
  }
}

export function detachRoute(map: maplibregl.Map, id: string): void {
  for (const lid of [id, `${id}__motor`]) {
    if (map.getLayer(lid)) map.removeLayer(lid);
  }
  if (map.getSource(id)) map.removeSource(id);
}
