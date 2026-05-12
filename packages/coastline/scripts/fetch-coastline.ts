#!/usr/bin/env tsx
/**
 * Coastline data fetcher.
 *
 * NOTE on data source: the plan originally targets GSHHG (Global Self-consistent
 * Hierarchical High-resolution Geography) at l/i/h levels. At implementation time
 * the seas-of-yore/gshhg-geojson GitHub mirror was not verifiable and the NOAA
 * SOEST distribution is a shapefile zip (would require `shapefile` + `adm-zip`
 * deps + decode pipeline). To keep dependencies minimal and the v1 path simple,
 * this script pulls Natural Earth land polygons instead:
 *
 *   - `l` ← ne_110m_land   (~135 KB, very coarse, useful for global pruning)
 *   - `i` ← ne_50m_land    (~1.6 MB, ~50 km nominal scale)
 *   - `h` ← ne_10m_land    (~10 MB, highest Natural Earth resolution, ~10 km)
 *
 * Natural Earth gives slightly coarser detail than GSHHG `h` (which is sub-km)
 * but the file shape is identical: a FeatureCollection of MultiPolygon land
 * features. Downstream code in @g5000/coastline only needs the geometry, so
 * the data substitution is transparent at the API boundary. Swap LEVELS below
 * to a true GSHHG mirror if/when one is verified to host raw GeoJSON releases.
 *
 * Attribution: Natural Earth, https://www.naturalearthdata.com/ (public domain).
 * Source repo: https://github.com/nvkelso/natural-earth-vector
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

interface Level {
  name: 'l' | 'i' | 'h';
  url: string;
}

const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

const LEVELS: Level[] = [
  { name: 'l', url: `${NE_BASE}/ne_110m_land.geojson` },
  { name: 'i', url: `${NE_BASE}/ne_50m_land.geojson` },
  { name: 'h', url: `${NE_BASE}/ne_10m_land.geojson` },
];

function validateGeoJson(buf: Buffer, levelName: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw new Error(`level ${levelName}: response is not valid JSON (${(e as Error).message})`);
  }
  const obj = parsed as { type?: string; features?: unknown[] };
  if (obj.type !== 'FeatureCollection') {
    throw new Error(`level ${levelName}: expected FeatureCollection, got ${obj.type}`);
  }
  if (!Array.isArray(obj.features) || obj.features.length === 0) {
    throw new Error(`level ${levelName}: FeatureCollection has no features`);
  }
  const first = obj.features[0] as { geometry?: { type?: string } };
  const gt = first?.geometry?.type;
  if (gt !== 'Polygon' && gt !== 'MultiPolygon') {
    throw new Error(`level ${levelName}: first feature geometry is ${gt}, expected Polygon|MultiPolygon`);
  }
}

async function main() {
  await mkdir(DATA, { recursive: true });
  const force = process.argv.includes('--force');
  for (const lvl of LEVELS) {
    const out = join(DATA, `${lvl.name}.geojson`);
    if (existsSync(out) && !force) {
      console.log(`[skip] ${lvl.name} already present`);
      continue;
    }
    console.log(`[fetch] ${lvl.name} ← ${lvl.url}`);
    const res = await fetch(lvl.url);
    if (!res.ok) {
      throw new Error(`fetch ${lvl.url} → ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    validateGeoJson(buf, lvl.name);
    await writeFile(out, buf);
    console.log(`[ok]   ${lvl.name} (${(buf.length / 1024).toFixed(1)} KB)`);
  }
  console.log('done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
