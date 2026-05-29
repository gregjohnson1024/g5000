import { contours } from 'd3-contour';

const MS_TO_KN = 1 / 0.514444;

/**
 * Convert a flat field's grid coords back to lat/lon and emit a
 * FeatureCollection of LineString (`closed=false`) or MultiPolygon
 * (`closed=true`) features at the chosen thresholds. `closed` decides
 * between lines (false) and fills (true).
 *
 * Canonical superset version: handles both open (isobar lines) and closed
 * (speed fills) contours. CurrentOverlay only ever needed closed=true.
 */
export function contourField(
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
 * Build a d3-contour speed field (knots) from a u/v grid and return a
 * FeatureCollection with one MultiPolygon per threshold band. Each feature
 * has a `speed` property = the lower threshold of the band, driving the
 * fill-color step expression. Thresholds come from the supplied fillStops
 * (wind kn and current kn use different bins — pass the caller's local array).
 */
export function buildSpeedContours(
  grid: { lats: number[]; lons: number[]; u: number[][]; v: number[][] },
  fillStops: Array<[number, string]>,
): GeoJSON.FeatureCollection {
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
  const thresholds = fillStops.map((s) => s[0]);
  const fc = contourField(speed, W, H, lats, lons, thresholds, true);
  // Rename `value` → `speed` so the fill layer's step expression matches.
  for (const f of fc.features) {
    f.properties = { speed: (f.properties as { value: number }).value };
  }
  return fc;
}

/**
 * Build the MapLibre `step` color expression over `['get','speed']`:
 * step(input, base, threshold1, output1, …). The base output (used below the
 * first threshold) is fillStops[0][1]; thresholds MUST be literal numbers and
 * come BEFORE their corresponding outputs. Returned as `unknown` — cast to the
 * MapLibre data-driven property type at the call site, as before.
 */
export function buildStepExpr(fillStops: Array<[number, string]>): unknown {
  const stepArgs: (string | number)[] = [];
  for (let i = 1; i < fillStops.length; i++) {
    const stop = fillStops[i]!;
    stepArgs.push(stop[0], stop[1]);
  }
  return ['step', ['get', 'speed'], fillStops[0]![1], ...stepArgs];
}
