/**
 * Pre-warm the Esri World Imagery tile cache.
 *
 * Two subcommands, both writing into
 * `~/.g5000-router/sat-cache/{z}/{x}/{y}.jpg` — the layout the runtime proxy
 * at /api/sat-tiles reads. Idempotent (skip tiles fresh within the proxy's
 * 365-day TTL) and resumable (Ctrl-C any time, rerun).
 *
 *   npx tsx scripts/sat-seed.ts regions               # seed ~/.g5000-router/sat-seed-regions.json
 *   npx tsx scripts/sat-seed.ts global                # whole world z0..7
 *   npx tsx scripts/sat-seed.ts global --max-zoom=8 --concurrency=8
 *
 * Esri convention: standard XYZ zoom (NO offset), ArcGIS row/col order
 * (`/tile/{z}/{y}/{x}`), JPEG tiles.
 *
 * Budget guard: before each zoom level the script checks total cache size
 * via readCacheStats; if it would cross 8 GB it stops and tells you to prune
 * (UI or `scripts/sat-cache.ts`) or pass --max-gb to raise the ceiling. It
 * never deletes.
 */
import { mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { readCacheStats, CAP_BYTES } from '../packages/web/src/lib/sat-cache';

const ROUTER_ROOT = process.env.G5000_ROUTER_ROOT ?? join(homedir(), '.g5000-router');
const CACHE_ROOT = join(ROUTER_ROOT, 'sat-cache');
const REGIONS_FILE = join(ROUTER_ROOT, 'sat-seed-regions.json');

const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';
const MAX_AGE_MS = 365 * 24 * 3600 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const RETRIES = 1;
const RETRY_BACKOFF_MS = 500;

const MIN_Z = 0;
const GLOBAL_MAX_Z_HARDCAP = 9;

interface Region {
  name: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  maxZoom: number;
}

const STARTER_REGIONS: Region[] = [
  { name: 'Bermuda', bbox: [-64.95, 32.2, -64.6, 32.45], maxZoom: 17 },
  { name: 'Narragansett-Bay', bbox: [-71.45, 41.45, -71.2, 41.75], maxZoom: 18 },
];

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(max, v));
}

interface Tile {
  z: number;
  x: number;
  y: number;
}

function tilesForBbox(z: number, bbox: [number, number, number, number]): Tile[] {
  const [w, s, e, n] = bbox;
  const maxIdx = 2 ** z - 1;
  const xMin = clamp(lonToTileX(w, z), maxIdx);
  const xMax = clamp(lonToTileX(e, z), maxIdx);
  const yMin = clamp(latToTileY(n, z), maxIdx); // north → smaller y
  const yMax = clamp(latToTileY(s, z), maxIdx);
  const out: Tile[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) out.push({ z, x, y });
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

type FetchResult = 'cached' | 'fetched' | 'error';

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
  const path = join(CACHE_ROOT, String(t.z), String(t.x), `${t.y}.jpg`);
  if (await existsAndFresh(path)) return 'cached';
  const url =
    `https://server.arcgisonline.com/ArcGIS/rest/services/` +
    `World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`;
  let r: Response | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
    r = await fetchOnce(url);
    if (r) break;
  }
  if (!r || !r.ok) return 'error';
  const buf = Buffer.from(await r.arrayBuffer());
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
  } catch {
    /* best-effort */
  }
  return 'fetched';
}

async function runPool<T>(items: T[], workers: number, fn: (item: T) => Promise<void>): Promise<void> {
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
  return process.argv.find((x) => x.startsWith(flag + '='))?.split('=')[1];
}

async function loadRegions(): Promise<Region[]> {
  try {
    const raw = await readFile(REGIONS_FILE, 'utf8');
    return JSON.parse(raw) as Region[];
  } catch {
    await mkdir(dirname(REGIONS_FILE), { recursive: true });
    await writeFile(REGIONS_FILE, JSON.stringify(STARTER_REGIONS, null, 2));
    console.log(`[sat-seed] wrote starter region file: ${REGIONS_FILE}`);
    console.log('[sat-seed] edit it (add your areas) and rerun `sat-seed regions`.');
    return [];
  }
}

async function overBudget(capGb: number): Promise<boolean> {
  const cap = capGb * 1024 ** 3;
  const { totalBytes } = await readCacheStats(CACHE_ROOT);
  if (totalBytes >= cap) {
    console.error(
      `\n[sat-seed] cache is ${(totalBytes / 1024 ** 3).toFixed(2)} GB ≥ cap ${capGb} GB — stopping.\n` +
        `           Prune (Settings UI or \`npx tsx scripts/sat-cache.ts prune\`) or pass --max-gb to raise the ceiling.`,
    );
    return true;
  }
  return false;
}

async function seedTiles(label: string, tilesByZoom: Map<number, Tile[]>, capGb: number): Promise<void> {
  const concurrency = Number(parseArg('--concurrency') ?? 8);
  for (const z of [...tilesByZoom.keys()].sort((a, b) => a - b)) {
    if (await overBudget(capGb)) return;
    const tiles = tilesByZoom.get(z)!;
    const counts = { cached: 0, fetched: 0, error: 0 };
    console.log(`[${label}] z=${z}: ${tiles.length} tiles`);
    await runPool(tiles, concurrency, async (t) => {
      counts[await fetchTile(t)]++;
    });
    console.log(`[${label}] z=${z} done — cached=${counts.cached} new=${counts.fetched} err=${counts.error}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const capGb = Number(parseArg('--max-gb') ?? CAP_BYTES / 1024 ** 3);

  if (cmd === 'global') {
    const maxZ = Math.min(GLOBAL_MAX_Z_HARDCAP, Number(parseArg('--max-zoom') ?? 7));
    const byZoom = new Map<number, Tile[]>();
    for (let z = MIN_Z; z <= maxZ; z++) byZoom.set(z, tilesForBbox(z, [-180, -85, 180, 85]));
    await seedTiles('global', byZoom, capGb);
  } else if (cmd === 'regions') {
    const regions = await loadRegions();
    if (regions.length === 0) return;
    const byZoom = new Map<number, Tile[]>();
    for (const r of regions) {
      for (let z = MIN_Z; z <= r.maxZoom; z++) {
        const list = byZoom.get(z) ?? [];
        for (const t of tilesForBbox(z, r.bbox)) list.push(t);
        byZoom.set(z, list);
      }
    }
    await seedTiles('regions', byZoom, capGb);
  } else {
    console.error('usage: sat-seed <regions|global> [--max-zoom=N] [--concurrency=N] [--max-gb=N]');
    process.exit(1);
  }
  console.log('[sat-seed] done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
