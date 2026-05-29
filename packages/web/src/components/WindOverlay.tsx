'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { FILL_STOPS } from '../lib/wind-scale';
import { projectGeo, makeBarb } from '../lib/wind-barb';
import { contourField, buildSpeedContours, buildStepExpr } from '../lib/contour-field';

export type WindModel = 'gfs' | 'ecmwf' | 'hrrr';

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

// Speed bin → fill colour lives in lib/wind-scale so the legend reuses it.
// contourField + buildSpeedContours now live in lib/contour-field (shared with
// CurrentOverlay); buildIsobars below still calls contourField with closed=false.

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
  /** When set, only a grid cached for this exact ROI box is shown (keeps the
   *  overlay in step with the slider/banner, which key on the same box). */
  bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null;
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
  bbox = null,
  onLoaded,
}: WindOverlayProps) {
  const [grid, setGrid] = useState<WindGrid | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    if (refreshKey === 0) return;
    let cancelled = false;
    // Look up the cached grid by (model, hour) and — when given — the ROI bbox,
    // so the overlay only shows data fetched for the box the slider/banner
    // describe (no more "overlay draws an unrelated region's grid" mismatch).
    void centerLat;
    void centerLon;
    void radius;
    const bboxQ = bbox
      ? `&latMin=${bbox.latMin}&latMax=${bbox.latMax}&lonMin=${bbox.lonMin}&lonMax=${bbox.lonMax}`
      : '';
    const url = `/api/forecast/grid?model=${model}&hour=${hours}${bboxQ}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          // Clear the overlay — otherwise switching to a model with no cached
          // grid for this ROI (e.g. HRRR over an Atlantic-reaching box) leaves
          // the previous model's field on screen, so they look "identical".
          setGrid(null);
          onLoadedRef.current?.({
            grid: null,
            identical: false,
            error: j.error?.message ?? 'fetch failed',
          });
        } else {
          const newGrid = j.grid as WindGrid;
          let identical = false;
          if (
            grid &&
            grid.runAt === newGrid.runAt &&
            grid.forecastHour === newGrid.forecastHour &&
            grid.model === newGrid.model
          ) {
            identical = true;
          }
          setGrid(newGrid);
          onLoadedRef.current?.({ grid: newGrid, identical, error: null });
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Render
  useEffect(() => {
    if (!map) return;
    // All wind layers insert below the '__above-wind__' sentinel set up
    // in Map.tsx — keeps wind permanently between OSM and the annotation
    // layers (trail, COG, AIS, route, isochrones, waypoints). If the
    // sentinel isn't ready yet, fall back to undefined (append).
    const beforeId = (): string | undefined =>
      map.getLayer('__above-wind__') ? '__above-wind__' : undefined;
    const ensure = (): void => {
      if (!map.getSource(SRC_FILL)) {
        map.addSource(SRC_FILL, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        // step expression: step(input, base, threshold1, output1, threshold2, output2, …)
        // The thresholds MUST be literal numbers (not computed expressions),
        // and they come BEFORE their corresponding outputs. Built in lib/contour-field.
        const stepExpr = buildStepExpr(
          FILL_STOPS as [number, string][],
        ) as maplibregl.DataDrivenPropertyValueSpecification<string>;
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
      if (!map.getSource(SRC_BARBS)) {
        map.addSource(SRC_BARBS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer(
          {
            id: LAYER_BARB_LINE,
            type: 'line',
            source: SRC_BARBS,
            filter: ['in', ['get', 'kind'], ['literal', ['shaft', 'barb']]],
            paint: { 'line-color': '#000000', 'line-width': 1.4 },
          },
          beforeId(),
        );
        map.addLayer(
          {
            id: LAYER_BARB_PENNANT,
            type: 'fill',
            source: SRC_BARBS,
            filter: ['==', ['get', 'kind'], 'pennant'],
            paint: { 'fill-color': '#000000' },
          },
          beforeId(),
        );
      }
      if (!map.getSource(SRC_ISOBARS)) {
        map.addSource(SRC_ISOBARS, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer(
          {
            id: LAYER_ISOBAR_LINE,
            type: 'line',
            source: SRC_ISOBARS,
            paint: {
              'line-color': '#1f2937', // slate-800
              'line-width': [
                'case',
                // Bold every 10 hPa
                ['==', ['%', ['get', 'value'], 10], 0],
                1.8,
                0.8,
              ],
              'line-opacity': 0.85,
            },
          },
          beforeId(),
        );
      }
    };
    // Closure-staleness recap: ensure() + setData must run AS A PAIR
    // *after* the style is loaded. The previous version called
    // `map.once('load', ensure)` which silently no-op'd when load had
    // already fired before WindOverlay mounted — and worse, the
    // setData calls below would silently miss because `getSource()`
    // returned undefined. Wrap both in a single render() and retry on
    // styledata until the style is ready.
    // isStyleLoaded() returns false during ANY pending style mutation
    // (tile loads, other components adding sources/layers, etc.). It
    // never reliably becomes true while the chart is alive — which
    // means a `if (!isStyleLoaded()) defer()` guard creates an infinite
    // retry loop. addSource/addLayer work fine regardless; the only
    // thing they need is that the style ROOT spec is parsed, which
    // happens before the very first 'load' event.
    const render = (): void => {
      ensure();
      doRender();
    };
    const doRender = (): void => {
      const fillSrc = map.getSource(SRC_FILL) as maplibregl.GeoJSONSource | undefined;
      const barbSrc = map.getSource(SRC_BARBS) as maplibregl.GeoJSONSource | undefined;
      const isoSrc = map.getSource(SRC_ISOBARS) as maplibregl.GeoJSONSource | undefined;
      if (hidden || !grid) {
        fillSrc?.setData({ type: 'FeatureCollection', features: [] });
        barbSrc?.setData({ type: 'FeatureCollection', features: [] });
        isoSrc?.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      renderBody(fillSrc, barbSrc, isoSrc, grid);
    };
    render();
    return;

    function renderBody(
      fillSrc: maplibregl.GeoJSONSource | undefined,
      barbSrc: maplibregl.GeoJSONSource | undefined,
      isoSrc: maplibregl.GeoJSONSource | undefined,
      grid: WindGrid,
    ): void {
      if (showIsobars && isoSrc) {
        isoSrc.setData(buildIsobars(grid));
      } else if (isoSrc) {
        isoSrc.setData({ type: 'FeatureCollection', features: [] });
      }
      if (showFill && fillSrc) {
        fillSrc.setData(buildSpeedContours(grid, FILL_STOPS as [number, string][]));
      } else if (fillSrc) {
        fillSrc.setData({ type: 'FeatureCollection', features: [] });
      }
      if (showBarbs && barbSrc) {
        const features: GeoJSON.Feature[] = [];
        // Shaft length scales with grid spacing so barbs fit one cell.
        const dLat = grid.lats.length > 1 ? Math.abs(grid.lats[1]! - grid.lats[0]!) : 0.25;
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
    } // renderBody
  }, [map, grid, hidden, stride, showFill, showBarbs, showIsobars]);

  // Live opacity update
  useEffect(() => {
    if (!map) return;
    if (map.getLayer(LAYER_FILL)) map.setPaintProperty(LAYER_FILL, 'fill-opacity', opacity);
  }, [map, opacity]);

  // Layer cleanup intentionally not registered — parent Map.remove()
  // discards all layers on unmount.

  return null;
}
