import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachePath, cacheHas, cacheStore, cacheRead, bboxHash } from './cache.js';
import type { Bbox } from './types.js';

const BBOX: Bbox = { latMin: 30, latMax: 40, lonMin: -75, lonMax: -65 };
const RUN = 1715500800;

describe('cache', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grib-cache-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('bboxHash is stable for equal bboxes and differs for different bboxes', () => {
    const h1 = bboxHash(BBOX);
    const h2 = bboxHash({ ...BBOX });
    const h3 = bboxHash({ ...BBOX, lonMax: -64 });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('cachePath builds the canonical layout', () => {
    const p = cachePath(root, { model: 'gfs', runTime: RUN, bbox: BBOX, variable: 'u10' });
    expect(p.startsWith(root)).toBe(true);
    expect(p).toContain('gfs');
    expect(p).toContain(String(RUN));
    expect(p).toContain(bboxHash(BBOX));
    expect(p.endsWith('u10.grb2')).toBe(true);
  });

  it('cacheStore writes and cacheHas/cacheRead recover', async () => {
    const key = { model: 'gfs' as const, runTime: RUN, bbox: BBOX, variable: 'u10' as const };
    expect(cacheHas(root, key)).toBe(false);
    await cacheStore(root, key, Buffer.from('hello'));
    expect(cacheHas(root, key)).toBe(true);
    const buf = await cacheRead(root, key);
    expect(buf.toString()).toBe('hello');
  });
});
