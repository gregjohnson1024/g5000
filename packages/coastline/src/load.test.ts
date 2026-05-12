import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCoastlineFromGeojson } from './load.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../test/fixtures/bahamas-l.geojson');

describe('loadCoastlineFromGeojson', () => {
  it('reads polygons including MultiPolygon expansion', async () => {
    const c = await loadCoastlineFromGeojson(FIXTURE, 'l');
    expect(c.level).toBe('l');
    expect(c.polygons.length).toBe(3); // 1 + 2 from multipolygon
    for (const p of c.polygons) {
      expect(p.kind).toBe('land');
      expect(p.ring[0]).toEqual(p.ring[p.ring.length - 1]); // closed
      expect(p.bbox.length).toBe(4);
    }
  });

  it('builds an R-tree that finds the right polygon for a query bbox', async () => {
    const c = await loadCoastlineFromGeojson(FIXTURE, 'l');
    const hits = c.index.search({
      minX: -76.5, minY: 24.2, maxX: -76.3, maxY: 24.4,
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.polygon.bbox).toEqual([-77, 24, -76, 25]);
  });
});
