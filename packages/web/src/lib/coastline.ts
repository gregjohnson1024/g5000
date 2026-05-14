import { loadCoastlineFromGeojson } from '@g5000/coastline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// In-process cache: the coastline parse + rbush build is ~50 ms and the
// data is read-only, so loading it once and reusing the result keeps
// per-route overhead at zero.
let cached: Awaited<ReturnType<typeof loadCoastlineFromGeojson>> | null = null;

// Level 'l' (Natural Earth 110m, 135 KB) over 'i' (50m, 1.6 MB):
//   - intersectsLand is the dominant cost of route planning (each propagate
//     does an rbush query + line-polygon intersection). Switching from 'i'
//     to 'l' takes a 168 h trans-Atlantic plan from ~5 minutes to under a
//     minute by an order of magnitude reduction in polygon-vertex count.
//   - 'l' resolves the continents accurately enough that an open-ocean
//     routing won't accidentally cut through Bermuda or Iceland. Where it
//     fails is sub-50 km coastal features — fjords, narrow channels, small
//     islands. Switch to 'i' for harbor approach / archipelago planning.
export async function loadDefaultCoastline() {
  if (cached) return cached;
  const path = resolve(here, '../../../../packages/coastline/data/l.geojson');
  cached = await loadCoastlineFromGeojson(path, 'l');
  return cached;
}
