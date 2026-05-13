'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { contours } from 'd3-contour';

export type WindModel = 'gfs' | 'ecmwf';

export interface WindGrid {
  lats: number[];
  lons: number[];
  u: number[][];
  v: number[][];
  /** Mean sea level pressure in Pa (optional — may be absent for some models). */
  prmsl?: number[][];
  validAt: number;
  runAt: number;
  forecastHour: number;
  model: WindModel;
}

const SRC_FILL = 'wind-fill';
const SRC_BARBS = 'wind-barbs';
const SRC_ISOBARS = 'wind-isobars';
const LAYER_FILL = 'wind-fill-layer';
const LAYER_BARB_LINE = 'wind-barb-line';
const LAYER_BARB_PENNANT = 'wind-barb-pennant';
const LAYER_ISOBAR_LINE = 'wind-isobar-line';

const M_PER_DEG_LAT = 111_320;
const MS_TO_KN = 1 / 0.514444;

// Speed bin → fill color. Steps match common nautical-wind palettes.
const FILL_STOPS: Array<[number, string]> = [
  [0, '#1e3a8a'], // navy
  [5, '#3b82f6'], // blue-500
  [10, '#22d3ee'], // cyan-400
  [15, '#10b981'], // emerald-500
  [20, '#a3e635'], // lime-400
  [25, '#facc15'], // yellow-400
  [30, '#fb923c'], // orange-400
  [35, '#f87171'], // red-400
  [45, '#c084fc'], // purple-400
  [60, '#fb7185'], // rose-400
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
 * Build wind-barb GeoJSON features at a grid point. Standard meteorological
 * convention: shaft points INTO the wind (open end toward where wind is
 * coming from), barbs at the grid-point end angled back. Northern-hemisphere
 * barbs on the left side of the shaft.
 */
function makeBarb(
  lat: number,
  lon: number,
  speedKn: number,
  windFromBearingRad: number,
  shaftLenM: number,
): GeoJSON.Feature[] {
  if (speedKn < 2.5) {
    // Calm: just a small circle around the grid point. Render as a tiny
    // degenerate line so the same paint layer covers it.
    const tinyTip = project(lat, lon, 50, 0);
    return [
      {
        type: 'Feature',
        properties: { kind: 'shaft' },
        geometry: { type: 'LineString', coordinates: [[lon, lat], tinyTip] },
      },
    ];
  }
  const shaftEnd = project(lat, lon, shaftLenM, windFromBearingRad);
  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { kind: 'shaft' },
      geometry: { type: 'LineString', coordinates: [[lon, lat], shaftEnd] },
    },
  ];

  // Decompose speed in 5-kn rounding
  const rounded = Math.round(speedKn / 5) * 5;
  const pennants = Math.floor(rounded / 50);
  const fulls = Math.floor((rounded - pennants * 50) / 10);
  const halfs = Math.floor((rounded - pennants * 50 - fulls * 10) / 5);

  // Barbs are drawn on the LEFT side of the shaft when looking along the
  // shaft direction (toward wind source). Perpendicular bearing = shaft - 90°.
  const perpBearing = windFromBearingRad - Math.PI / 2;
  // Tick lengths
  const fullLen = shaftLenM * 0.45;
  const halfLen = shaftLenM * 0.25;
  const pennantLen = shaftLenM * 0.45;
  // Step size between adjacent ticks along the shaft (from open end inward).
  const stepM = shaftLenM * 0.18;
  // Position of the first tick — at the OPEN end of shaft (where wind comes
  // from), then walk back toward the grid point.
  let distFromGrid = shaftLenM;

  // Pennants first (closest to open end)
  for (let i = 0; i < pennants; i++) {
    const base = project(lat, lon, distFromGrid, windFromBearingRad);
    const inner = project(lat, lon, distFromGrid - stepM, windFromBearingRad);
    const tip = project(base[1], base[0], pennantLen, perpBearing);
    features.push({
      type: 'Feature',
      properties: { kind: 'pennant' },
      geometry: { type: 'Polygon', coordinates: [[base, tip, inner, base]] },
    });
    distFromGrid -= stepM;
  }
  // Full barbs
  for (let i = 0; i < fulls; i++) {
    const base = project(lat, lon, distFromGrid, windFromBearingRad);
    const tip = project(base[1], base[0], fullLen, perpBearing);
    features.push({
      type: 'Feature',
      properties: { kind: 'barb' },
      geometry: { type: 'LineString', coordinates: [base, tip] },
    });
    distFromGrid -= stepM;
  }
  // Half barbs (one max per the decomposition above)
  if (halfs > 0) {
    // If there are no fulls and no pennants, the half barb shouldn't sit
    // right at the shaft's open end (looks like a stray spike) — pull it
    // one step inward.
    if (fulls === 0 && pennants === 0) distFromGrid -= stepM;
    const base = project(lat, lon, distFromGrid, windFromBearingRad);
    const tip = project(base[1], base[0], halfLen, perpBearing);
    features.push({
      type: 'Feature',
      properties: { kind: 'barb' },
      geometry: { type: 'LineString', coordinates: [base, tip] },
    });
  }
  return features;
}

/**
 * Helper: convert a flat field's grid coords back to lat/lon and emit a
 * FeatureCollection of LineString (`type='line'`) or Polygon features at
 * the chosen thresholds. `closed` decides between lines (false) and fills
 * (true).
 */
function contourField(
  field: Float64Array,
  W: number,
  H: number,
  lats: number[],
  lons: number[],
  thresholds: number[],
  closed: boolean,
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
    if (closed) {
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
    } else {
      // For lines, take the outer rings as LineStrings.
      const lines: number[][][] = [];
      for (const poly of c.coordinates as number[][][][]) {
        for (const ring of poly) {
          lines.push(ring.map(toLatLon));
        }
      }
      features.push({
        type: 'Feature',
        properties: { value },
        geometry: { type: 'MultiLineString', coordinates: lines },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Build a d3-contour speed field from a wind grid and return a FeatureCollection
 * with one Polygon per threshold band. Each feature has a `speed` property = the
 * lower threshold of the band, used to drive the fill-color step expression.
 */
function buildSpeedContours(grid: WindGrid): GeoJSON.FeatureCollection {
  const { lats, lons, u, v } = grid;
  const W = lons.length;
  const H = lats.length;
  // d3-contour expects a flat row-major array. d3-contour treats row 0 as
  // the TOP — we'll flip Y so highest lat is at y=0 to match.
  const speed = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const yi = H - 1 - y; // flip so y=0 is highest lat
    for (let x = 0; x < W; x++) {
      const uu = u[yi]![x] ?? 0;
      const vv = v[yi]![x] ?? 0;
      speed[y * W + x] = Math.hypot(uu, vv) * MS_TO_KN;
    }
  }
  const thresholds = FILL_STOPS.map((s) => s[0]);
  const fc = contourField(speed, W, H, lats, lons, thresholds, true);
  // Rename `value` → `speed` so the fill layer's step expression matches.
  for (const f of fc.features) {
    f.properties = { speed: (f.properties as { value: number }).value };
  }
  return fc;
}

/**
 * Build isobar lines (LineStrings) at every 2 hPa.
 */
function buildIsobars(grid: WindGrid): GeoJSON.FeatureCollection {
  if (!grid.prmsl) return { type: 'FeatureCollection', features: [] };
  const { lats, lons, prmsl } = grid;
  const W = lons.length;
  const H = lats.length;
  const pField = new Float64Array(W * H);
  let minHpa = Infinity;
  let maxHpa = -Infinity;
  for (let y = 0; y < H; y++) {
    const yi = H - 1 - y;
    for (let x = 0; x < W; x++) {
      const v = prmsl[yi]?.[x] ?? NaN;
      const hpa = Number.isFinite(v) ? v / 100 : NaN; // Pa → hPa
      pField[y * W + x] = hpa;
      if (Number.isFinite(hpa)) {
        if (hpa < minHpa) minHpa = hpa;
        if (hpa > maxHpa) maxHpa = hpa;
      }
    }
  }
  if (!Number.isFinite(minHpa) || !Number.isFinite(maxHpa)) {
    return { type: 'FeatureCollection', features: [] };
  }
  const lo = Math.floor(minHpa / 2) * 2;
  const hi = Math.ceil(maxHpa / 2) * 2;
  const thresholds: number[] = [];
  for (let t = lo; t <= hi; t += 2) thresholds.push(t);
  return contourField(pField, W, H, lats, lons, thresholds, false);
}

export interface WindOverlayProps {
  map: maplibregl.Map | null;
  centerLat: number | null;
  centerLon: number | null;
  model: WindModel;
  hours: number;
  radius?: number;
  hidden?: boolean;
  /** Grid stride for barbs — 1 = every cell, 2 = every other. Default 2. */
  stride?: number;
  /** Opacity for the speed-fill layer. Barbs are always full strength. */
  opacity?: number;
  /** When true, draw the colored speed-fill. */
  showFill?: boolean;
  /** When true, draw black wind barbs. */
  showBarbs?: boolean;
  /** When true, draw black isobar contours at 2 hPa intervals. */
  showIsobars?: boolean;
  /** Bumping this triggers a fetch from cache. */
  refreshKey: number;
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
  opacity = 0.5,
  showFill = true,
  showBarbs = true,
  showIsobars = false,
  refreshKey,
  onLoaded,
}: WindOverlayProps) {
  const [grid, setGrid] = useState<WindGrid | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    if (refreshKey === 0) return;
    let cancelled = false;
    // Look up the cached grid by (model, hour). /forecast fetches with a
    // specific bbox; this endpoint returns whatever's cached for that
    // (model, hour) regardless of bbox, so /chart doesn't have to mirror
    // /forecast's ROI.
    void centerLat;
    void centerLon;
    void radius;
    const url = `/api/forecast/grid?model=${model}&hour=${hours}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          onLoadedRef.current?.({ grid: null, identical: false, error: j.error?.message ?? 'fetch failed' });
        } else {
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
        onLoadedRef.current?.({ grid: null, identical: false, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Render
  useEffect(() => {
    if (!map) return;
    const ensure = (): void => {
      if (!map.getSource(SRC_FILL)) {
        map.addSource(SRC_FILL, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        const stepArgs: (string | number)[] = [];
        for (const [thr, col] of FILL_STOPS) {
          stepArgs.push(col, thr);
        }
        // step expression: step(input, base, stop1, color1, stop2, color2, …)
        // We provide base = first color; pairs of (threshold, color) follow.
        const stepExpr: maplibregl.DataDrivenPropertyValueSpecification<string> = [
          'step',
          ['get', 'speed'],
          FILL_STOPS[0]![1],
          ...stepArgs.slice(2),
        ] as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>;
        map.addLayer({
          id: LAYER_FILL,
          type: 'fill',
          source: SRC_FILL,
          paint: {
            'fill-color': stepExpr,
            'fill-opacity': opacity,
            'fill-antialias': true,
          },
        });
      }
      if (!map.getSource(SRC_BARBS)) {
        map.addSource(SRC_BARBS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: LAYER_BARB_LINE,
          type: 'line',
          source: SRC_BARBS,
          filter: ['in', ['get', 'kind'], ['literal', ['shaft', 'barb']]],
          paint: { 'line-color': '#000000', 'line-width': 1.4 },
        });
        map.addLayer({
          id: LAYER_BARB_PENNANT,
          type: 'fill',
          source: SRC_BARBS,
          filter: ['==', ['get', 'kind'], 'pennant'],
          paint: { 'fill-color': '#000000' },
        });
      }
      if (!map.getSource(SRC_ISOBARS)) {
        map.addSource(SRC_ISOBARS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: LAYER_ISOBAR_LINE,
          type: 'line',
          source: SRC_ISOBARS,
          paint: {
            'line-color': '#1f2937', // slate-800
            'line-width': [
              'case',
              // Bold every 10 hPa
              ['==', ['%', ['get', 'value'], 10], 0], 1.8,
              0.8,
            ],
            'line-opacity': 0.85,
          },
        });
      }
    };
    if (map.isStyleLoaded()) ensure();
    else map.once('load', ensure);

    const fillSrc = map.getSource(SRC_FILL) as maplibregl.GeoJSONSource | undefined;
    const barbSrc = map.getSource(SRC_BARBS) as maplibregl.GeoJSONSource | undefined;
    const isoSrc = map.getSource(SRC_ISOBARS) as maplibregl.GeoJSONSource | undefined;

    if (hidden || !grid) {
      fillSrc?.setData({ type: 'FeatureCollection', features: [] });
      barbSrc?.setData({ type: 'FeatureCollection', features: [] });
      isoSrc?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    if (showIsobars && isoSrc) {
      isoSrc.setData(buildIsobars(grid));
    } else if (isoSrc) {
      isoSrc.setData({ type: 'FeatureCollection', features: [] });
    }
    if (showFill && fillSrc) {
      fillSrc.setData(buildSpeedContours(grid));
    } else if (fillSrc) {
      fillSrc.setData({ type: 'FeatureCollection', features: [] });
    }
    if (showBarbs && barbSrc) {
      const features: GeoJSON.Feature[] = [];
      // Shaft length scales with grid spacing so barbs fit one cell.
      const dLat =
        grid.lats.length > 1 ? Math.abs(grid.lats[1]! - grid.lats[0]!) : 0.25;
      const shaftLenM = dLat * M_PER_DEG_LAT * 0.75 * stride;
      for (let yi = 0; yi < grid.lats.length; yi += stride) {
        for (let xi = 0; xi < grid.lons.length; xi += stride) {
          const lat = grid.lats[yi]!;
          const lon = grid.lons[xi]!;
          const uu = grid.u[yi]?.[xi];
          const vv = grid.v[yi]?.[xi];
          if (typeof uu !== 'number' || typeof vv !== 'number') continue;
          const speedMps = Math.hypot(uu, vv);
          const speedKn = speedMps * MS_TO_KN;
          // Wind FROM bearing (compass) is direction from which wind blows:
          // = bearing of -V vector (since V is northward).
          let windFrom = Math.atan2(-uu, -vv);
          if (windFrom < 0) windFrom += 2 * Math.PI;
          features.push(...makeBarb(lat, lon, speedKn, windFrom, shaftLenM));
        }
      }
      barbSrc.setData({ type: 'FeatureCollection', features });
    } else if (barbSrc) {
      barbSrc.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [map, grid, hidden, stride, showFill, showBarbs, showIsobars]);

  // Live opacity update
  useEffect(() => {
    if (!map) return;
    if (map.getLayer(LAYER_FILL)) map.setPaintProperty(LAYER_FILL, 'fill-opacity', opacity);
  }, [map, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    if (!map) return;
    return () => {
      for (const id of [LAYER_FILL, LAYER_BARB_LINE, LAYER_BARB_PENNANT, LAYER_ISOBAR_LINE]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [SRC_FILL, SRC_BARBS, SRC_ISOBARS]) {
        if (map.getSource(id)) map.removeSource(id);
      }
    };
  }, [map]);

  return null;
}
