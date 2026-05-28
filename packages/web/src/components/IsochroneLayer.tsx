'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { Route } from '@g5000/routing';

const SOURCE_GFS = 'isochrones-gfs';
const SOURCE_ECMWF = 'isochrones-ecmwf';
const LAYER_GFS = 'isochrones-gfs-line';
const LAYER_ECMWF = 'isochrones-ecmwf-line';

// GFS: slate-blue, ECMWF: amber — matches the route polyline palette.
const COLOR: Record<'GFS' | 'ECMWF', string> = {
  GFS: '#60a5fa',
  ECMWF: '#fbbf24',
};

function toGeoJson(route: Route | undefined) {
  const features =
    route?.isochrones?.map((iso) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: iso.points.map((p) => [p.lon, p.lat]),
      },
      properties: { t: iso.t },
    })) ?? [];
  return { type: 'FeatureCollection' as const, features };
}

function ensureModel(
  map: maplibregl.Map,
  sourceId: string,
  layerId: string,
  color: string,
  route: Route | undefined,
): void {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: 'geojson', data: toGeoJson(route) });
  } else {
    (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(toGeoJson(route));
  }
  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': color,
        'line-width': 0.8,
        'line-opacity': 0.45,
      },
    });
  }
}

function removeModel(map: maplibregl.Map, sourceId: string, layerId: string): void {
  if (map.getLayer(layerId)) try { map.removeLayer(layerId); } catch { /* ignore */ }
  if (map.getSource(sourceId)) try { map.removeSource(sourceId); } catch { /* ignore */ }
}

/**
 * Renders captured isochrone frontiers as thin polylines, one layer per wind
 * model. Only mounts when the parent passes showIsochrones=true; the parent
 * unmounts this component to hide.
 */
export function IsochroneLayer({
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
        ensureModel(map, SOURCE_GFS, LAYER_GFS, COLOR.GFS, routes.GFS);
        ensureModel(map, SOURCE_ECMWF, LAYER_ECMWF, COLOR.ECMWF, routes.ECMWF);
      } catch { /* style race */ }
    };

    if (map.isStyleLoaded()) sync();
    else map.once('load', sync);
    map.on('styledata', sync);

    return () => {
      map.off('styledata', sync);
      removeModel(map, SOURCE_GFS, LAYER_GFS);
      removeModel(map, SOURCE_ECMWF, LAYER_ECMWF);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    if (!map?.isStyleLoaded()) return;
    try {
      (map.getSource(SOURCE_GFS) as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJson(routes.GFS));
      (map.getSource(SOURCE_ECMWF) as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJson(routes.ECMWF));
    } catch { /* style race */ }
  }, [map, routes]);

  return null;
}
