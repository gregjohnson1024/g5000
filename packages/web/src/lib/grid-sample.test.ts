import { describe, it, expect } from 'vitest';
import { sampleUV, type UvGrid } from './grid-sample';

// u varies with lon (x), v varies with lat (y), so interpolation in each axis
// is independently checkable.
const grid: UvGrid = {
  lats: [0, 2],
  lons: [0, 2],
  u: [
    [1, 3],
    [1, 3],
  ],
  v: [
    [10, 10],
    [20, 20],
  ],
};

describe('sampleUV', () => {
  it('bilinearly interpolates the interior', () => {
    const r = sampleUV(grid, 1, 1);
    expect(r).not.toBeNull();
    expect(r!.u).toBeCloseTo(2, 6); // lon midpoint of 1..3
    expect(r!.v).toBeCloseTo(15, 6); // lat midpoint of 10..20
  });

  it('returns exact corner values', () => {
    expect(sampleUV(grid, 0, 0)).toEqual({ u: 1, v: 10 });
    expect(sampleUV(grid, 2, 2)).toEqual({ u: 3, v: 20 });
  });

  it('interpolates along one axis only', () => {
    const r = sampleUV(grid, 0, 1); // lat at edge, lon midpoint
    expect(r!.u).toBeCloseTo(2, 6);
    expect(r!.v).toBeCloseTo(10, 6);
  });

  it('returns null outside coverage', () => {
    expect(sampleUV(grid, 3, 1)).toBeNull();
    expect(sampleUV(grid, 1, -1)).toBeNull();
  });

  it('returns null when a surrounding sample is non-finite', () => {
    const masked: UvGrid = {
      ...grid,
      u: [
        [NaN, 3],
        [1, 3],
      ],
    };
    expect(sampleUV(masked, 1, 1)).toBeNull();
  });

  it('returns null for a degenerate grid', () => {
    expect(sampleUV({ lats: [0], lons: [0], u: [[1]], v: [[1]] }, 0, 0)).toBeNull();
  });
});
