import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDepthField, writeDepthGrid, NODATA, type DepthTileMeta } from './depth-grid';

// 3×3 tile over lat 30..32, lon -70..-68 (1° spacing). Row 0 = south edge.
// Depths chosen so bilinear midpoints are easy to verify by hand.
const META: DepthTileMeta = {
  name: 't_30_-70',
  latMin: 30,
  lonMin: -70,
  dLat: 1,
  dLon: 1,
  rows: 3,
  cols: 3,
};
// prettier-ignore
const DATA = Int16Array.from([
  10, 20, 30,      // lat 30
  40, 50, NODATA,  // lat 31
  70, 80, 90,      // lat 32
]);

const BBOX = { latMin: 29, latMax: 33, lonMin: -71, lonMax: -67 };

describe('depth-grid store', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'depth-grid-'));
    await writeDepthGrid(dir, 3600, [{ meta: META, data: DATA }]);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when no manifest exists', async () => {
    expect(await loadDepthField(BBOX, join(dir, 'nope'))).toBeNull();
  });

  it('returns null when no tile overlaps the bbox', async () => {
    expect(await loadDepthField({ latMin: 0, latMax: 5, lonMin: 0, lonMax: 5 }, dir)).toBeNull();
  });

  it('samples exact grid nodes', async () => {
    const f = await loadDepthField(BBOX, dir);
    expect(f).not.toBeNull();
    expect(f!.depthAt(30, -70)).toBe(10);
    expect(f!.depthAt(30, -68)).toBe(30);
    expect(f!.depthAt(32, -70)).toBe(70);
    expect(f!.depthAt(32, -68)).toBe(90);
  });

  it('bilinearly interpolates between nodes', async () => {
    const f = await loadDepthField(BBOX, dir);
    // Midpoint of the SW cell: (10 + 20 + 40 + 50) / 4 = 30.
    expect(f!.depthAt(30.5, -69.5)).toBeCloseTo(30, 6);
    // Halfway along the south edge: (10 + 20) / 2 = 15.
    expect(f!.depthAt(30, -69.5)).toBeCloseTo(15, 6);
  });

  it('returns null when any bilinear corner is NODATA', async () => {
    const f = await loadDepthField(BBOX, dir);
    expect(f!.depthAt(31, -68)).toBeNull(); // the NODATA node itself
    expect(f!.depthAt(30.5, -68.5)).toBeNull(); // cell touching it
  });

  it('returns null outside tile coverage', async () => {
    const f = await loadDepthField(BBOX, dir);
    expect(f!.depthAt(29.5, -69)).toBeNull();
    expect(f!.depthAt(31, -71)).toBeNull();
  });

  it('degrades to unknown when a tile binary is corrupt', async () => {
    const dir2 = await mkdtemp(join(tmpdir(), 'depth-grid-'));
    try {
      await writeDepthGrid(dir2, 3600, [{ meta: META, data: DATA }]);
      await writeFile(join(dir2, `${META.name}.bin`), Buffer.alloc(4)); // wrong size
      const f = await loadDepthField(BBOX, dir2);
      expect(f).not.toBeNull(); // manifest says covered…
      expect(f!.depthAt(31, -69)).toBeNull(); // …but samples are honest nulls
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it('merges tiles into an existing manifest, replacing by name', async () => {
    const other: DepthTileMeta = { ...META, name: 't_40_-70', latMin: 40 };
    await writeDepthGrid(dir, 3600, [{ meta: other, data: DATA }]);
    // New tile is readable…
    const f2 = await loadDepthField({ latMin: 39, latMax: 43, lonMin: -71, lonMax: -67 }, dir);
    expect(f2!.depthAt(40, -70)).toBe(10);
    // …and the original tile survived the merge.
    const f1 = await loadDepthField(BBOX, dir);
    expect(f1!.depthAt(30, -70)).toBe(10);
    // Rewriting the same name replaces, not duplicates.
    const flat = Int16Array.from(DATA.map(() => 5));
    await writeDepthGrid(dir, 3600, [{ meta: META, data: flat }]);
    const f3 = await loadDepthField(BBOX, dir);
    expect(f3!.depthAt(30, -70)).toBe(5);
  });
});
