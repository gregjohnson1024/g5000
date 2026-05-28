'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { Route } from '@g5000/routing';
import { makeBarb } from '../lib/wind-barb';

const MS_TO_KN = 1 / 0.514444;
// One barb per ~6 h of sailing time.
const SAMPLE_INTERVAL_S = 6 * 3600;
// Shaft length in metres — sized to be legible at typical passage zoom levels.
const SHAFT_M = 30_000;

// Colours match the route polyline palette.
const COLOR: Record<'GFS' | 'ECMWF', string> = {
  GFS: '#60a5fa',
  ECMWF: '#fbbf24',
};

function toGeoJson(route: Route | undefined): GeoJSON.FeatureCollection {
  if (!route) return { type: 'FeatureCollection', features: [] };
  const { legs } = route;
  if (legs.length < 2) return { type: 'FeatureCollection', features: [] };

  // Estimate planner step from consecutive legs, then compute stride.
  const dt = legs[1]!.t - legs[0]!.t;
  const stride = Math.max(1, Math.round(SAMPLE_INTERVAL_S / dt));

  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < legs.length; i += stride) {
    const leg = legs[i]!;
    // Skip legs where wind direction can't be determined (motoring, start/end
    // synthetic legs have no tack).
    if (leg.tack === undefined) continue;
    // Wind is coming FROM: heading ± twa (+ starboard, - port)
    const windFrom = leg.heading + (leg.tack === 'starboard' ? leg.twa : -leg.twa);
    features.push(...makeBarb(leg.lat, leg.lon, leg.tws * MS_TO_KN, windFrom, SHAFT_M));
  }
  return { type: 'FeatureCollection', features };
}

function ensureModel(
  map: maplibregl.Map,
  srcId: string,
  lineId: string,
  fillId: string,
  color: string,
  route: Route | undefined,
): void {
  const data = toGeoJson(route);
  if (!map.getSource(srcId)) {
    map.addSource(srcId, { type: 'geojson', data });
  } else {
    (map.getSource(srcId) as maplibregl.GeoJSONSource).setData(data);
  }
  if (!map.getLayer(lineId)) {
    map.addLayer({
      id: lineId,
      type: 'line',
      source: srcId,
      filter: ['!=', ['get', 'kind'], 'pennant'],
      paint: { 'line-color': color, 'line-width': 1.2, 'line-opacity': 0.75 },
    });
  }
  if (!map.getLayer(fillId)) {
    map.addLayer({
      id: fillId,
      type: 'fill',
      source: srcId,
      filter: ['==', ['get', 'kind'], 'pennant'],
      paint: { 'fill-color': color, 'fill-opacity': 0.75 },
    });
  }
}

function removeModel(map: maplibregl.Map, srcId: string, lineId: string, fillId: string): void {
  for (const id of [lineId, fillId]) {
    if (map.getLayer(id)) try { map.removeLayer(id); } catch { /* ignore */ }
  }
  if (map.getSource(srcId)) try { map.removeSource(srcId); } catch { /* ignore */ }
}

/**
 * Renders wind barbs along a planned route at ~6 h sailing intervals. Wind
 * speed and direction are derived from each leg's `tws`, `twa`, and `tack`
 * fields — no additional data fetch required. Only mounts when
 * `showRouteWind` is true; the parent unmounts to hide.
 */
export function RouteWindLayer({
  map,
  routes,
}: {
  map: maplibregl.Map | null;
  routes: Partial<Record<'GFS' | 'ECMWF', Route>>;
}) {
  useEffect(() => {
    if (!map) return;

    const sync = (): void => {
      if (!map.isStyleLoaded()) return;
      try {
        ensureModel(map, 'rwind-gfs', 'rwind-gfs-line', 'rwind-gfs-fill', COLOR.GFS, routes.GFS);
        ensureModel(map, 'rwind-ecmwf', 'rwind-ecmwf-line', 'rwind-ecmwf-fill', COLOR.ECMWF, routes.ECMWF);
      } catch { /* style race */ }
    };

    if (map.isStyleLoaded()) sync();
    else map.once('load', sync);
    map.on('styledata', sync);

    return () => {
      map.off('styledata', sync);
      removeModel(map, 'rwind-gfs', 'rwind-gfs-line', 'rwind-gfs-fill');
      removeModel(map, 'rwind-ecmwf', 'rwind-ecmwf-line', 'rwind-ecmwf-fill');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (!map?.isStyleLoaded()) return;
    try {
      (map.getSource('rwind-gfs') as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJson(routes.GFS));
      (map.getSource('rwind-ecmwf') as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJson(routes.ECMWF));
    } catch { /* style race */ }
  }, [map, routes]);

  return null;
}
