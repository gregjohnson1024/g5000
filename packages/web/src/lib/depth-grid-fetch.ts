import { NODATA, type DepthTileMeta } from './depth-grid';

/**
 * ETOPO 2022 → depth-grid conversion helpers, shared by
 * scripts/depth-grid-fetch.ts and its unit tests. Pure logic only — the
 * network fetch takes an injectable `fetch` so tests never touch NOAA.
 */

/** Parsed ERDDAP griddap CSV: elevation in metres, positive UP (bedrock). */
export interface ElevGrid {
  /** Ascending. */
  lats: number[];
  /** Ascending. */
  lons: number[];
  /** elev[latIdx][lonIdx]; NaN = missing. */
  elev: number[][];
}

/**
 * Parse an ERDDAP griddap CSV response (header row, optional units row, then
 * `lat,lon,value` data rows in any lat order). Tolerates descending-latitude
 * datasets by sorting both axes ascending.
 */
export function parseGriddapCsv(text: string): ElevGrid {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('empty griddap response');
  const rows: Array<{ lat: number; lon: number; v: number }> = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    // Header + units rows have non-numeric lat/lon — skip them.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const v = Number(parts[2]);
    rows.push({ lat, lon, v: Number.isFinite(v) ? v : NaN });
  }
  if (rows.length === 0) throw new Error('griddap response contained no data rows');
  const lats = [...new Set(rows.map((r) => r.lat))].sort((a, b) => a - b);
  const lons = [...new Set(rows.map((r) => r.lon))].sort((a, b) => a - b);
  const latIdx = new Map(lats.map((v, i) => [v, i]));
  const lonIdx = new Map(lons.map((v, i) => [v, i]));
  const elev = lats.map(() => lons.map(() => NaN));
  for (const r of rows) elev[latIdx.get(r.lat)!]![lonIdx.get(r.lon)!] = r.v;
  return { lats, lons, elev };
}

/**
 * Convert an elevation grid (positive up) into one depth tile (positive
 * down). Land (elev >= 0) and missing samples become NODATA; depths are
 * rounded to whole metres and clamped to the Int16 range.
 */
export function elevGridToDepthTile(
  grid: ElevGrid,
  name: string,
): { meta: DepthTileMeta; data: Int16Array } {
  const { lats, lons, elev } = grid;
  if (lats.length < 2 || lons.length < 2) throw new Error(`tile ${name}: grid too small`);
  const rows = lats.length;
  const cols = lons.length;
  const data = new Int16Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = elev[r]![c]!;
      data[r * cols + c] = !Number.isFinite(e) || e >= 0 ? NODATA : Math.min(32767, Math.round(-e));
    }
  }
  return {
    meta: {
      name,
      latMin: lats[0]!,
      lonMin: lons[0]!,
      dLat: (lats[rows - 1]! - lats[0]!) / (rows - 1),
      dLon: (lons[cols - 1]! - lons[0]!) / (cols - 1),
      rows,
      cols,
    },
    data,
  };
}

export const DEFAULT_ETOPO_URL =
  'https://www.ngdc.noaa.gov/thredds-ocean/erddap/griddap/etopo_2022_bed_15s';

/** griddap CSV subset URL for variable `z` over a lat/lon box with a stride. */
export function griddapCsvUrl(
  base: string,
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  stride: number,
): string {
  const s = Math.max(1, Math.round(stride));
  return `${base}.csv?z[(${latMin}):${s}:(${latMax})][(${lonMin}):${s}:(${lonMax})]`;
}

export type Fetcher = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Fetch one elevation chunk with retries + backoff. `resArcSec` must be a
 * multiple of the dataset's native 15 arc-seconds (used as the stride).
 */
export async function fetchElevChunk(
  base: string,
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  resArcSec: number,
  fetcher: Fetcher,
  retries = 3,
  backoffMs = 2000,
): Promise<ElevGrid> {
  const url = griddapCsvUrl(base, latMin, latMax, lonMin, lonMax, resArcSec / 15);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetcher(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return parseGriddapCsv(await res.text());
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
    }
  }
  throw lastErr;
}
