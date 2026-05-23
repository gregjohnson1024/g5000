/**
 * Pre-warm the NOAA NCDS chart tile cache for the US coastline.
 *
 * Sweeps standard XYZ zoom levels (default 2..10) over a small set of
 * US coastal bounding boxes, fetching tiles directly from NOAA's ArcGIS
 * MapServer and writing them into `~/.g5000-router/enc-cache/{z}/{x}/{y}.png`
 * — the exact same layout the runtime proxy at /api/enc-tiles/{z}/{x}/{y}
 * reads from. Tiles already present and fresh (<30 days) are skipped, so
 * the script is idempotent and resumable: ctrl-C any time, rerun with a
 * higher --max-zoom to extend coverage.
 *
 * NOAA convention reminder: noaa_z = std_z - 2, and the upstream URL
 * uses ArcGIS row/col order — `/tile/{noaa_z}/{y}/{x}`.
 *
 * Usage:
 *   npx tsx scripts/prewarm-noaa-tiles.ts            # default zooms 2..10
 *   npx tsx scripts/prewarm-noaa-tiles.ts --max-zoom=12 --concurrency=8
 *   npx tsx scripts/prewarm-noaa-tiles.ts --regions=CONUS-East,CONUS-West
 *
 * Tile counts grow ~4x per zoom level. Rough estimates for the union of
 * all default regions:
 *   z=2..5:    ~50–500 tiles total
 *   z=6..8:    ~5k tiles
 *   z=9..10:   ~50k–250k tiles
 *   z=11..12:  ~1M–4M tiles
 *   z=13..18:  exponential — coastline-clipping needed (not implemented here).
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_ROOT = process.env.G5000_ROUTER_ROOT
  ? join(process.env.G5000_ROUTER_ROOT, 'enc-cache')
  : join(homedir(), '.g5000-router', 'enc-cache');

const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
// Tight timeout: a slow tile blocks one worker until it returns. Better to
// drop it and re-attempt on the next sweep than to lose a slot for 30s.
const REQUEST_TIMEOUT_MS = 8_000;
// Single retry with backoff catches most transient timeouts cheaply.
const RETRIES = 1;
const RETRY_BACKOFF_MS = 500;

// 67-byte fully-transparent 1x1 PNG. Written as a marker file when NOAA
// returns 404 (tile outside their chart cache), so subsequent runs and
// MapLibre requests through the proxy see a cache HIT instead of refetching.
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

interface Region {
  name: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

// US coastal regions. Bbox-based rather than coastline-clipped, so each
// bbox over-covers inland area too — fine at low/mid zooms (tile counts
// are small and NOAA returns 404 quickly for off-coverage), but means we
// should not push past z≈12 without coastline-clipping.
const REGIONS: Region[] = [
  { name: 'CONUS-East+Gulf', bbox: [-98, 24, -66, 47] },
  { name: 'CONUS-West', bbox: [-126, 32, -117, 49] },
  { name: 'Great-Lakes', bbox: [-93, 41, -76, 49] },
  { name: 'Alaska-main', bbox: [-180, 51, -129, 72] },
  { name: 'Alaska-Aleutians', bbox: [170, 50, 180, 56] },
  { name: 'Hawaii', bbox: [-161, 18, -154, 23] },
  { name: 'PR-USVI', bbox: [-68, 17, -64, 19] },
];

const MIN_Z = 2;
const MAX_Z_HARDCAP = 18;

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
}

interface Tile {
  z: number;
  x: number;
  y: number;
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(max, v));
}

function tilesForBbox(z: number, bbox: [number, number, number, number]): Tile[] {
  const [w, s, e, n] = bbox;
  const maxIdx = 2 ** z - 1;
  const xMin = clamp(lonToTileX(w, z), maxIdx);
  const xMax = clamp(lonToTileX(e, z), maxIdx);
  // Mercator y increases southward → north latitude maps to smaller y.
  const yMin = clamp(latToTileY(n, z), maxIdx);
  const yMax = clamp(latToTileY(s, z), maxIdx);
  const out: Tile[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      out.push({ z, x, y });
    }
  }
  return out;
}

function tilesForZoom(z: number, regions: Region[]): Tile[] {
  const seen = new Set<string>();
  const out: Tile[] = [];
  for (const r of regions) {
    for (const t of tilesForBbox(z, r.bbox)) {
      const k = `${t.x},${t.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

async function existsAndFresh(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return Date.now() - s.mtimeMs < MAX_AGE_MS;
  } catch {
    return false;
  }
}

type FetchResult = 'cached' | 'fetched' | 'empty' | 'error';

async function fetchOnce(url: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

async function fetchTile(t: Tile): Promise<FetchResult> {
  const path = join(CACHE_ROOT, String(t.z), String(t.x), `${t.y}.png`);
  if (await existsAndFresh(path)) return 'cached';
  const noaaZ = t.z - 2;
  const url =
    `https://gis.charttools.noaa.gov/arcgis/rest/services/` +
    `MarineChart_Services/NOAACharts/MapServer/tile/${noaaZ}/${t.y}/${t.x}`;
  let r: Response | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
    r = await fetchOnce(url);
    if (r) break;
  }
  if (!r) return 'error';
  if (r.status === 404) {
    // Cache an empty marker so we don't re-hit on future runs / requests.
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, TRANSPARENT_PNG);
    } catch {
      /* best-effort */
    }
    return 'empty';
  }
  if (!r.ok) return 'error';
  const buf = Buffer.from(await r.arrayBuffer());
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
  } catch {
    /* best-effort: log nothing, count as fetched anyway */
  }
  return 'fetched';
}

async function runPool<T>(
  items: T[],
  workers: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const run = async (): Promise<void> => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
}

function parseArg(flag: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(flag + '='));
  return a?.split('=')[1];
}

async function main(): Promise<void> {
  const maxZ = Math.min(MAX_Z_HARDCAP, Number(parseArg('--max-zoom') ?? 10));
  const concurrency = Number(parseArg('--concurrency') ?? 8);
  const regionsArg = parseArg('--regions');
  const regions = regionsArg
    ? REGIONS.filter((r) => regionsArg.split(',').includes(r.name))
    : REGIONS;
  if (regions.length === 0) {
    console.error(`No regions matched "${regionsArg}". Available: ${REGIONS.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  if (!Number.isInteger(maxZ) || maxZ < MIN_Z) {
    console.error(`--max-zoom must be an integer >= ${MIN_Z}`);
    process.exit(1);
  }

  console.log(`[prewarm] cache root: ${CACHE_ROOT}`);
  console.log(`[prewarm] regions: ${regions.map((r) => r.name).join(', ')}`);
  console.log(`[prewarm] zoom range: ${MIN_Z}..${maxZ}, concurrency: ${concurrency}`);
  console.log();

  const grand = { cached: 0, fetched: 0, empty: 0, error: 0 };

  for (let z = MIN_Z; z <= maxZ; z++) {
    const tiles = tilesForZoom(z, regions);
    const counts = { cached: 0, fetched: 0, empty: 0, error: 0 };
    const t0 = Date.now();
    let lastLog = t0;
    console.log(`[z=${z}] ${tiles.length} unique tiles`);
    await runPool(tiles, concurrency, async (t) => {
      const result = await fetchTile(t);
      counts[result]++;
      const total = counts.cached + counts.fetched + counts.empty + counts.error;
      const now = Date.now();
      if (now - lastLog > 2000) {
        lastLog = now;
        const rate = total / ((now - t0) / 1000);
        const pct = ((total / tiles.length) * 100).toFixed(1);
        process.stdout.write(
          `\r[z=${z}] ${total}/${tiles.length} (${pct}%)  cached=${counts.cached} new=${counts.fetched} empty=${counts.empty} err=${counts.error}  ${rate.toFixed(1)}/s    `,
        );
      }
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    process.stdout.write(
      `\r[z=${z}] done in ${dt}s — cached=${counts.cached} new=${counts.fetched} empty=${counts.empty} err=${counts.error}                              \n`,
    );
    grand.cached += counts.cached;
    grand.fetched += counts.fetched;
    grand.empty += counts.empty;
    grand.error += counts.error;
  }

  console.log();
  console.log(
    `[prewarm] all done — total: cached=${grand.cached} new=${grand.fetched} empty=${grand.empty} err=${grand.error}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
