import { describe, expect, it } from 'vitest';
import { parseEsriAscii } from './esriascii.js';

describe('parseEsriAscii', () => {
  it('parses header and row-major values (row 0 = north)', () => {
    const text = [
      'ncols 3',
      'nrows 2',
      'xllcorner -71.0',
      'yllcorner 40.0',
      'cellsize 0.5',
      'nodata_value -2147483648',
      '-10 -20 -30',
      '-2147483648 -50 -60',
    ].join('\n');
    const g = parseEsriAscii(text);
    expect(g.ncols).toBe(3);
    expect(g.nrows).toBe(2);
    expect(g.xll).toBeCloseTo(-71.0);
    expect(g.yll).toBeCloseTo(40.0);
    expect(g.cellsize).toBeCloseTo(0.5);
    // Row 0 is the northern row, stored first.
    expect(Array.from(g.values.slice(0, 3))).toEqual([-10, -20, -30]);
    // nodata is replaced with +9999 so it sits above all negative thresholds.
    expect(g.values[3]).toBe(9999);
    expect(g.values[4]).toBe(-50);
  });
});
