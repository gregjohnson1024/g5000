/**
 * Shared bilinear-interpolation helpers for regular 2D grids.
 *
 * Extracted verbatim from the polar and true-wind math modules, which had
 * byte-identical copies. The numeric behaviour is unchanged.
 */

/**
 * Bilinear interpolation on a regular grid. Inputs outside the grid are
 * clamped to the nearest edge. `xBins` and `yBins` must be strictly
 * increasing.
 */
export function bilinearInterpolate2D(
  xBins: number[],
  yBins: number[],
  grid: number[][],
  x: number,
  y: number,
): number {
  const xi = locate(xBins, x);
  const yi = locate(yBins, y);
  const x0 = xBins[xi.lo]!;
  const x1 = xBins[xi.hi]!;
  const y0 = yBins[yi.lo]!;
  const y1 = yBins[yi.hi]!;
  const fx = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  const fy = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
  const c00 = grid[xi.lo]![yi.lo]!;
  const c01 = grid[xi.lo]![yi.hi]!;
  const c10 = grid[xi.hi]![yi.lo]!;
  const c11 = grid[xi.hi]![yi.hi]!;
  return c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy;
}

export function locate(bins: number[], v: number): { lo: number; hi: number } {
  if (bins.length === 0) return { lo: 0, hi: 0 };
  if (v <= bins[0]!) return { lo: 0, hi: 0 };
  if (v >= bins[bins.length - 1]!) {
    return { lo: bins.length - 1, hi: bins.length - 1 };
  }
  for (let i = 0; i < bins.length - 1; i++) {
    if (v >= bins[i]! && v <= bins[i + 1]!) return { lo: i, hi: i + 1 };
  }
  return { lo: bins.length - 1, hi: bins.length - 1 };
}
