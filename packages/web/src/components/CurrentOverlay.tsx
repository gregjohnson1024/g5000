'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { contours } from 'd3-contour';

export interface CurrentGrid {
  lats: number[];
  lons: number[];
  u: number[][];
  v: number[][];
  validAt: number;
  runAt: number;
  forecastDay: number;
  source: 'CMEMS';
}

const SRC_FILL = 'current-fill';
const SRC_ARROWS = 'current-arrows';
const LAYER_FILL = 'current-fill-layer';
const LAYER_ARROWS = 'current-arrows-layer';

const M_PER_DEG_LAT = 111_320;
const MS_TO_KN = 1 / 0.514444;

// Speed bin (knots) → fill color w/ alpha. Faster = more opaque so Gulf
// Stream core stands out clearly against the OSM basemap.
const FILL_STOPS: Array<[number, string]> = [
  [0.0, '#1e3a8a40'], // <0.25 kn: indigo, mostly transparent
  [0.25, '#3b82f680'], // 0.25-0.5: blue
  [0.5, '#0891b290'], // 0.5-1: cyan
  [1.0, '#10b981a0'], // 1-1.5: emerald
  [1.5, '#84cc16b0'], // 1.5-2: lime
  [2.0, '#eab308c0'], // 2-3: yellow
  [3.0, '#f97316d0'], // 3-4: orange
  [4.0, '#dc2626e0'], // 4+: red (Gulf Stream core)
];

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

/**
 * Build a small directional arrow as a single LineString with a shaft +
 * two arrowhead tick legs. Bearing is the FLOW direction (where the
 * current is going TO), measured from north, clockwise positive.
 *
 * Geometry: [start, end, headLeft, end, headRight] — 5 vertices in a
 * single LineString. Drawing the line as start→end→headLeft→end→headRight
 * means we backtrack to `end` so both head legs share the tip vertex.
 * 4 vertices wouldn't let us close both head legs to the tip cleanly.
 */
function makeArrow(
  lat: number,
  lon: number,
  shaftLenM: number,
  bearingRad: number,
): GeoJSON.Feature {
  const start: [number, number] = [lon, lat];
  const end = project(lat, lon, shaftLenM, bearingRad);
  // Arrowhead legs at ±150° from the bearing, attached to the end point.
  // 150° = bearing of the LEG (pointing back toward start, splayed out).
  const headLen = shaftLenM * 0.35;
  const headLeft = project(end[1], end[0], headLen, bearingRad + (150 * Math.PI) / 180);
  const headRight = project(end[1], end[0], headLen, bearingRad - (150 * Math.PI) / 180);
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [start, end, headLeft, end, headRight],
    },
  };
}

/**
 * Convert a flat row-major field back to lat/lon space and emit a
 * FeatureCollection of MultiPolygon features at the chosen thresholds.
 * Mirrors WindOverlay.contourField but only for closed (filled) contours.
 */
function contourField(
  field: Float64Array,
  W: number,
  H: number,
  lats: number[],
  lons: number[],
  thresholds: number[],
): GeoJSON.FeatureCollection {
  const gen = contours().size([W, H]).thresholds(thresholds)(Array.from(field));
  const features: GeoJSON.Feature[] = [];
  const toLatLon = (pt: number[]): number[] => {
    const gx = pt[0] ?? 0;
    const gy = pt[1] ?? 0;
    const xi = Math.max(0, Math.min(W - 1, gx));
    const yi = Math.max(0, Math.min(H - 1, gy));
    const xLow = Math.floor(xi);
    const xFrac = xi - xLow;
    const lon = lons[xLow]! * (1 - xFrac) + (lons[xLow + 1] ?? lons[xLow]!) * xFrac;
    const yLow = Math.floor(yi);
    const yFrac = yi - yLow;
    const latIdxLow = H - 1 - yLow;
    const latIdxHigh = H - 1 - Math.min(H - 1, yLow + 1);
    const lat = lats[latIdxLow]! * (1 - yFrac) + lats[latIdxHigh]! * yFrac;
    return [lon, lat];
  };
  for (const c of gen) {
    const value = c.value;
    const polys: number[][][][] = [];
    for (const poly of c.coordinates as number[][][][]) {
      const ringsOut: number[][][] = poly.map((ring) => ring.map(toLatLon));
      polys.push(ringsOut);
    }
    features.push({
      type: 'Feature',
      properties: { value },
      geometry: { type: 'MultiPolygon', coordinates: polys },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Build a d3-contour speed field (knots) from a current grid and return
 * a FeatureCollection with one MultiPolygon per threshold band. Each
 * feature has a `speed` property = the lower threshold of the band,
 * driving the fill-color step expression.
 */
function buildSpeedContours(grid: CurrentGrid): GeoJSON.FeatureCollection {
  const { lats, lons, u, v } = grid;
  const W = lons.length;
  const H = lats.length;
  // d3-contour treats row 0 as the TOP — flip Y so highest lat is at y=0.
  const speed = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const yi = H - 1 - y;
    for (let x = 0; x < W; x++) {
      const uu = u[yi]![x] ?? 0;
      const vv = v[yi]![x] ?? 0;
      speed[y * W + x] = Math.hypot(uu, vv) * MS_TO_KN;
    }
  }
  const thresholds = FILL_STOPS.map((s) => s[0]);
  const fc = contourField(speed, W, H, lats, lons, thresholds);
  // Rename `value` → `speed` so the fill layer's step expression matches.
  for (const f of fc.features) {
    f.properties = { speed: (f.properties as { value: number }).value };
  }
  return fc;
}

export interface CurrentOverlayProps {
  map: maplibregl.Map | null;
  hidden?: boolean;
  /** Forecast day to fetch (0 = today UTC, 1 = tomorrow, …). Default 0. */
  day?: number;
  /** Grid stride for arrows. Default 3. */
  stride?: number;
  /** Opacity multiplier for the fill (arrows always full). Default 1.0. */
  opacity?: number;
  /** When true (default), draw the colored speed fill. */
  showFill?: boolean;
  /** When true (default), draw direction arrows. */
  showArrows?: boolean;
  /** Bumping this triggers a re-fetch. */
  refreshKey?: number;
  onLoaded?: (info: { grid: CurrentGrid | null; identical: boolean; error: string | null }) => void;
}

export function CurrentOverlay({
  map,
  hidden = false,
  day = 0,
  stride = 3,
  opacity = 1.0,
  showFill = true,
  showArrows = true,
  refreshKey = 0,
  onLoaded,
}: CurrentOverlayProps) {
  const [grid, setGrid] = useState<CurrentGrid | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  // Keep prior grid in a ref so we can detect identical (same run + hour)
  // re-fetches without forcing it into the effect's dependency array.
  const gridRef = useRef<CurrentGrid | null>(null);
  gridRef.current = grid;

  // Fetch on mount + whenever refreshKey changes.
  useEffect(() => {
    let cancelled = false;
    const url = `/api/current/grid?day=${day}`;
    fetch(url)
      .then(async (r) => {
        if (r.status === 404) {
          if (!cancelled)
            onLoadedRef.current?.({ grid: null, identical: false, error: 'not cached' });
          return;
        }
        const j = (await r.json()) as
          | { ok: true; grid: CurrentGrid }
          | { ok: false; error?: { message?: string } };
        if (cancelled) return;
        if (!j.ok) {
          onLoadedRef.current?.({
            grid: null,
            identical: false,
            error: j.error?.message ?? 'fetch failed',
          });
          return;
        }
        const newGrid = j.grid;
        const prev = gridRef.current;
        const identical =
          !!prev && prev.runAt === newGrid.runAt && prev.forecastDay === newGrid.forecastDay;
        setGrid(newGrid);
        onLoadedRef.current?.({ grid: newGrid, identical, error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        onLoadedRef.current?.({
          grid: null,
          identical: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [day, refreshKey]);

  // Render layers + push grid data.
  useEffect(() => {
    if (!map) return;
    // Insert below the '__above-wind__' sentinel so we sit between OSM
    // and the annotation layers (trail, COG, AIS, route, waypoints).
    const beforeId = (): string | undefined =>
      map.getLayer('__above-wind__') ? '__above-wind__' : undefined;

    const ensure = (): void => {
      if (!map.getSource(SRC_FILL)) {
        map.addSource(SRC_FILL, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        // Build step expression. Thresholds MUST be literal numbers and
        // come BEFORE their corresponding output. The base output (used
        // below the first threshold) is FILL_STOPS[0][1].
        const stepArgs: (string | number)[] = [];
        for (let i = 1; i < FILL_STOPS.length; i++) {
          const stop = FILL_STOPS[i]!;
          stepArgs.push(stop[0], stop[1]);
        }
        const stepExpr: maplibregl.DataDrivenPropertyValueSpecification<string> = [
          'step',
          ['get', 'speed'],
          FILL_STOPS[0]![1],
          ...stepArgs,
        ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;
        map.addLayer(
          {
            id: LAYER_FILL,
            type: 'fill',
            source: SRC_FILL,
            paint: {
              'fill-color': stepExpr,
              'fill-opacity': opacity,
              'fill-antialias': true,
            },
          },
          beforeId(),
        );
      }
      if (!map.getSource(SRC_ARROWS)) {
        map.addSource(SRC_ARROWS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer(
          {
            id: LAYER_ARROWS,
            type: 'line',
            source: SRC_ARROWS,
            paint: { 'line-color': '#000000', 'line-width': 1.5 },
          },
          beforeId(),
        );
      }
    };

    const doRender = (): void => {
      const fillSrc = map.getSource(SRC_FILL) as maplibregl.GeoJSONSource | undefined;
      const arrowSrc = map.getSource(SRC_ARROWS) as maplibregl.GeoJSONSource | undefined;
      if (hidden || !grid) {
        fillSrc?.setData({ type: 'FeatureCollection', features: [] });
        arrowSrc?.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      if (showFill && fillSrc) {
        fillSrc.setData(buildSpeedContours(grid));
      } else if (fillSrc) {
        fillSrc.setData({ type: 'FeatureCollection', features: [] });
      }
      if (showArrows && arrowSrc) {
        const features: GeoJSON.Feature[] = [];
        const dLat = grid.lats.length > 1 ? Math.abs(grid.lats[1]! - grid.lats[0]!) : 0.25;
        // Cap arrow length to one stride-cell so neighbours don't overlap.
        const cellLenM = dLat * M_PER_DEG_LAT * stride;
        for (let yi = 0; yi < grid.lats.length; yi += stride) {
          for (let xi = 0; xi < grid.lons.length; xi += stride) {
            const lat = grid.lats[yi]!;
            const lon = grid.lons[xi]!;
            const uu = grid.u[yi]?.[xi];
            const vv = grid.v[yi]?.[xi];
            if (typeof uu !== 'number' || typeof vv !== 'number') continue;
            const speedMps = Math.hypot(uu, vv);
            if (speedMps < 0.02) continue; // skip near-zero cells; no useful direction
            const speedKn = speedMps * MS_TO_KN;
            // Flow-TO bearing (atan2(east, north)) — from north, clockwise.
            const bearing = Math.atan2(uu, vv);
            // Length scales with speed, capped at 0.9 * cell so adjacent
            // arrows don't crash. 1 kn → ~0.3 cell, 4 kn → 0.9 cell.
            const lenFrac = Math.min(0.9, 0.25 + speedKn * 0.18);
            const shaftLenM = cellLenM * lenFrac;
            features.push(makeArrow(lat, lon, shaftLenM, bearing));
          }
        }
        arrowSrc.setData({ type: 'FeatureCollection', features });
      } else if (arrowSrc) {
        arrowSrc.setData({ type: 'FeatureCollection', features: [] });
      }
    };

    // Style-loaded handling: parent's onLoad callback may fire AFTER the
    // map's 'load' event has already fired, so map.once('load', …)
    // registered now would silently no-op. Listen on BOTH 'styledata' and
    // 'load' (both can fire later) and also call immediately. ensure() is
    // idempotent (getSource/getLayer guards).
    const tryEnsure = (): void => {
      ensure();
      doRender();
    };
    tryEnsure();
    map.on('styledata', tryEnsure);
    map.on('load', tryEnsure);

    return () => {
      map.off('styledata', tryEnsure);
      map.off('load', tryEnsure);
      // The map may already be torn down by the time we clean up.
      try {
        for (const id of [LAYER_ARROWS, LAYER_FILL]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        for (const id of [SRC_ARROWS, SRC_FILL]) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch {
        /* map is gone; nothing to do */
      }
    };
  }, [map, grid, hidden, stride, showFill, showArrows, opacity]);

  // Live opacity update — set without rebuilding the layer.
  useEffect(() => {
    if (!map) return;
    if (map.getLayer(LAYER_FILL)) map.setPaintProperty(LAYER_FILL, 'fill-opacity', opacity);
  }, [map, opacity]);

  return null;
}
