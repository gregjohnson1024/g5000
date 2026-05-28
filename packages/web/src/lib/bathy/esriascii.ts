export interface EsriGrid {
  ncols: number;
  nrows: number;
  /** Lower-left corner longitude of the lower-left cell. */
  xll: number;
  /** Lower-left corner latitude of the lower-left cell. */
  yll: number;
  cellsize: number;
  /** Original nodata sentinel from the header. */
  nodata: number;
  /** Row-major, row 0 = northernmost. nodata replaced with +9999. */
  values: Float64Array;
}

/**
 * Parse an ESRI ASCII grid (as returned by GMRT GridServer
 * `format=esriascii`). The six header lines are case-insensitive
 * `key value` pairs; the body is `nrows` lines of `ncols` whitespace-
 * separated numbers, the first line being the northernmost row.
 *
 * nodata cells are replaced with +9999 (above every depth threshold) so
 * d3-contour, which can't represent NaN, never draws a spurious contour
 * across a data gap.
 */
export function parseEsriAscii(text: string): EsriGrid {
  const header: Record<string, number> = {};
  let bodyStart = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*([a-zA-Z_]+)\s+(-?[\d.eE+]+)\s*$/.exec(lines[i]!);
    if (!m) {
      bodyStart = i;
      break;
    }
    header[m[1]!.toLowerCase()] = Number(m[2]);
  }
  const ncols = header.ncols!;
  const nrows = header.nrows!;
  const nodata = header.nodata_value ?? -2147483648;
  const values = new Float64Array(ncols * nrows);
  let idx = 0;
  for (let r = 0; r < nrows; r++) {
    const row = lines[bodyStart + r]!.trim().split(/\s+/);
    for (let c = 0; c < ncols; c++) {
      const v = Number(row[c]);
      values[idx++] = v === nodata ? 9999 : v;
    }
  }
  return {
    ncols,
    nrows,
    xll: header.xllcorner!,
    yll: header.yllcorner!,
    cellsize: header.cellsize!,
    nodata,
    values,
  };
}
