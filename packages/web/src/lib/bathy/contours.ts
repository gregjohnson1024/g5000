import { contours } from 'd3-contour';
import type { EsriGrid } from './esriascii.js';

/**
 * Generate depth contour lines from an ESRI grid.
 *
 * `thresholds` are signed elevations in metres (negative = below sea level),
 * e.g. -50 for the 50 m isobath. d3-contour treats the array row-major with
 * row 0 at the TOP; the grid is already north-first, so no flip is needed.
 * Grid coordinate (gx, gy) maps to geographic coordinates by uniform spacing:
 *   lon = xll + gx*cellsize
 *   lat = yll + (nrows - gy)*cellsize   (gy=0 is the north edge)
 *
 * Each output feature is a MultiLineString with `depth` = the positive depth
 * in metres (|threshold|).
 */
export function depthContours(grid: EsriGrid, thresholds: number[]): GeoJSON.FeatureCollection {
  const { ncols: W, nrows: H, xll, yll, cellsize, values } = grid;
  // Smallest sampled elevation. A threshold below this isn't crossed by the
  // field — d3-contour would still emit a boundary ring wrapping the whole
  // grid (the "value and above" region is everything), so we drop those.
  let min = Infinity;
  for (const v of values) if (v < min) min = v;
  const gen = contours().size([W, H]).thresholds(thresholds)(Array.from(values));
  const toLonLat = (pt: number[]): number[] => {
    const gx = pt[0] ?? 0;
    const gy = pt[1] ?? 0;
    return [xll + gx * cellsize, yll + (H - gy) * cellsize];
  };
  const features: GeoJSON.Feature[] = [];
  for (const c of gen) {
    // Skip thresholds the field never reaches: d3 still returns a ring
    // (the whole-grid boundary) for them, which isn't a real isobath.
    if (c.value < min) continue;
    // d3 emits closed rings (polygons of "value and above"). For isobaths we
    // render their boundaries as lines. Skip empty bands.
    const lines: number[][][] = [];
    for (const poly of c.coordinates as number[][][][]) {
      for (const ring of poly) lines.push(ring.map(toLonLat));
    }
    if (lines.length === 0) continue;
    features.push({
      type: 'Feature',
      properties: { depth: Math.abs(c.value) },
      geometry: { type: 'MultiLineString', coordinates: lines },
    });
  }
  return { type: 'FeatureCollection', features };
}
