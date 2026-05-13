'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

export type WindModel = 'gfs' | 'ecmwf';

export interface WindGrid {
  lats: number[];
  lons: number[];
  u: number[][];
  v: number[][];
  validAt: number;
  runAt: number;
  forecastHour: number;
  model: WindModel;
}

const SOURCE_ID = 'wind-overlay';
const LAYER_LINE = 'wind-overlay-shaft';
const LAYER_HEAD = 'wind-overlay-head';

const M_PER_DEG_LAT = 111_320;
const M_PER_NM = 1852;
const MS_TO_KN = 1 / 0.514444;

/** Color ramp from light cyan (calm) to magenta (storm) in knots. */
function colorForSpeedKn(kn: number): string {
  if (kn < 5) return '#7dd3fc'; // sky-300
  if (kn < 10) return '#67e8f9'; // cyan-300
  if (kn < 15) return '#86efac'; // green-300
  if (kn < 20) return '#fde047'; // yellow-300
  if (kn < 25) return '#fdba74'; // orange-300
  if (kn < 30) return '#fca5a5'; // red-300
  return '#f0abfc'; // fuchsia-300
}

function project(
  fromLat: number,
  fromLon: number,
  meters: number,
  bearingRad: number,
): [number, number] {
  const dN = meters * Math.cos(bearingRad);
  const dE = meters * Math.sin(bearingRad);
  const dLat = dN / M_PER_DEG_LAT;
  const dLon = dE / (M_PER_DEG_LAT * Math.cos((fromLat * Math.PI) / 180));
  return [fromLon + dLon, fromLat + dLat];
}

export interface WindOverlayProps {
  map: maplibregl.Map | null;
  centerLat: number | null;
  centerLon: number | null;
  /** Model: GFS or ECMWF. */
  model: WindModel;
  /** Forecast hours ahead. */
  hours: number;
  /** Half-width of bbox in degrees. */
  radius?: number;
  /** When true, no overlay rendered. */
  hidden?: boolean;
  /** Subsample factor — render every Nth grid cell to keep the map readable. */
  stride?: number;
  /** Arrow length per knot, in NM. */
  nmPerKn?: number;
  /** Opacity for the overlay layer, 0..1. */
  opacity?: number;
  /** Bumping this triggers a fetch. Center/hours/model changes alone do NOT. */
  refreshKey: number;
  /** Called when fetch completes — `grid` is null if response had no change. */
  onLoaded?: (info: { grid: WindGrid | null; identical: boolean; error: string | null }) => void;
}

export function WindOverlay({
  map,
  centerLat,
  centerLon,
  model,
  hours,
  radius = 6,
  hidden = false,
  stride = 2,
  nmPerKn = 0.18,
  opacity = 0.85,
  refreshKey,
  onLoaded,
}: WindOverlayProps) {
  const [grid, setGrid] = useState<WindGrid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  // Fetch ONLY when refreshKey changes; cached-only by default so /chart
  // never triggers a fresh download itself. Use the /forecast tab for that.
  useEffect(() => {
    if (centerLat === null || centerLon === null) return;
    if (refreshKey === 0) return;
    let cancelled = false;
    const url = `/api/wind?model=${model}&lat=${centerLat.toFixed(2)}&lon=${centerLon.toFixed(2)}&hours=${hours}&radius=${radius}&cached=1`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          setErr(j.error?.message ?? 'wind fetch failed');
          onLoadedRef.current?.({ grid: null, identical: false, error: j.error?.message ?? 'fetch failed' });
        } else {
          setErr(null);
          const newGrid = j.grid as WindGrid;
          let identical = false;
          if (grid && grid.runAt === newGrid.runAt && grid.forecastHour === newGrid.forecastHour && grid.model === newGrid.model) {
            identical = true;
          }
          setGrid(newGrid);
          onLoadedRef.current?.({ grid: newGrid, identical, error: null });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        onLoadedRef.current?.({ grid: null, identical: false, error: msg });
      });
    return () => {
      cancelled = true;
    };
  // intentionally driven by refreshKey only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Render whenever the grid changes (or hidden flips).
  useEffect(() => {
    if (!map) return;
    const ensureLayers = (): void => {
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: LAYER_LINE,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'shaft'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': opacity },
      });
      map.addLayer({
        id: LAYER_HEAD,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'head'],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': opacity },
      });
    };
    if (map.isStyleLoaded()) ensureLayers();
    else map.once('load', ensureLayers);

    const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (hidden || !grid) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const features: GeoJSON.Feature[] = [];
    for (let yi = 0; yi < grid.lats.length; yi += stride) {
      for (let xi = 0; xi < grid.lons.length; xi += stride) {
        const lat = grid.lats[yi]!;
        const lon = grid.lons[xi]!;
        const u = grid.u[yi]?.[xi];
        const v = grid.v[yi]?.[xi];
        if (typeof u !== 'number' || typeof v !== 'number') continue;
        // U is eastward, V is northward. Wind FROM bearing = atan2(-u, -v).
        // For visualization we draw the vector along the direction the wind
        // is going TO (i.e., the velocity vector) so arrows point downwind.
        const speedMps = Math.hypot(u, v);
        if (speedMps < 0.2) continue;
        const speedKn = speedMps * MS_TO_KN;
        const dirRad = Math.atan2(u, v); // direction wind is going TO
        const lengthM = speedKn * nmPerKn * M_PER_NM;
        const tip = project(lat, lon, lengthM, dirRad);
        const color = colorForSpeedKn(speedKn);
        features.push({
          type: 'Feature',
          properties: { kind: 'shaft', color },
          geometry: { type: 'LineString', coordinates: [[lon, lat], tip] },
        });
        // Arrowhead
        const headLen = Math.max(lengthM * 0.3, 600);
        const headHalfAngle = (22 * Math.PI) / 180;
        const leftBearing = dirRad + Math.PI - headHalfAngle;
        const rightBearing = dirRad + Math.PI + headHalfAngle;
        const left = project(tip[1], tip[0], headLen, leftBearing);
        const right = project(tip[1], tip[0], headLen, rightBearing);
        features.push({
          type: 'Feature',
          properties: { kind: 'head', color },
          geometry: { type: 'Polygon', coordinates: [[tip, left, right, tip]] },
        });
      }
    }
    src.setData({ type: 'FeatureCollection', features });
  }, [map, grid, hidden, stride, nmPerKn]);

  // Update layer opacity when the prop changes (avoid full re-render).
  useEffect(() => {
    if (!map) return;
    if (map.getLayer(LAYER_LINE)) map.setPaintProperty(LAYER_LINE, 'line-opacity', opacity);
    if (map.getLayer(LAYER_HEAD)) map.setPaintProperty(LAYER_HEAD, 'fill-opacity', opacity);
  }, [map, opacity]);

  useEffect(() => {
    if (!map) return;
    return () => {
      if (map.getLayer(LAYER_HEAD)) map.removeLayer(LAYER_HEAD);
      if (map.getLayer(LAYER_LINE)) map.removeLayer(LAYER_LINE);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  if (err) {
    return (
      <div className="absolute bottom-3 left-3 text-xs bg-rose-900/80 text-rose-100 px-2 py-1 rounded">
        Wind: {err}
      </div>
    );
  }
  return null;
}
