import { describe, expect, it } from 'vitest';
import { depthContours } from './contours.js';
import type { EsriGrid } from './esriascii.js';

describe('depthContours', () => {
  it('emits a MultiLineString feature per threshold that the field crosses', () => {
    // 4x4 grid sloping from -5 (shallow, north) to -120 (deep, south),
    // so the -10, -50, -100 contours all fall inside.
    const ncols = 4;
    const nrows = 4;
    const rows = [
      [-5, -5, -5, -5],
      [-40, -40, -40, -40],
      [-90, -90, -90, -90],
      [-120, -120, -120, -120],
    ];
    const values = new Float64Array(ncols * nrows);
    let i = 0;
    for (const row of rows) for (const v of row) values[i++] = v;
    const grid: EsriGrid = {
      ncols,
      nrows,
      xll: -71,
      yll: 40,
      cellsize: 1,
      nodata: -2147483648,
      values,
    };
    const fc = depthContours(grid, [-10, -50, -100, -200]);
    const depths = fc.features
      .map((f) => (f.properties as { depth: number }).depth)
      .sort((a, b) => a - b);
    // -200 never reached (deepest is -120) → no feature for it.
    expect(depths).toEqual([10, 50, 100]);
    // Geometry is geographic: longitudes within the bbox, lats within [40,44].
    const f0 = fc.features[0]!;
    expect(f0.geometry.type).toBe('MultiLineString');
    const [lon, lat] = (f0.geometry as GeoJSON.MultiLineString).coordinates[0]![0]!;
    expect(lon).toBeGreaterThanOrEqual(-71);
    expect(lon).toBeLessThanOrEqual(-67);
    expect(lat).toBeGreaterThanOrEqual(40);
    expect(lat).toBeLessThanOrEqual(44);
  });
});
