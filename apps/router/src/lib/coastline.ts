import { loadCoastlineFromGeojson } from '@g5000/coastline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadDefaultCoastline() {
  const path = resolve(here, '../../../../packages/coastline/data/i.geojson');
  return loadCoastlineFromGeojson(path, 'i');
}
