import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, writeFile, utimes, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCacheStats, pruneCache, CAP_BYTES, PROTECT_MAX_ZOOM } from './sat-cache';

let root: string;

// Write a tile of `size` bytes at z/x/y with mtime `ageDays` in the past.
async function tile(z: number, x: number, y: number, size: number, ageDays = 0): Promise<void> {
  const dir = join(root, String(z), String(x));
  await mkdir(dir, { recursive: true });
  const p = join(dir, `${y}.jpg`);
  await writeFile(p, Buffer.alloc(size, 1));
  const when = new Date(Date.now() - ageDays * 24 * 3600 * 1000);
  await utimes(p, when, when);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sat-cache-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readCacheStats', () => {
  it('totals bytes and tiles, broken down by zoom', async () => {
    await tile(5, 1, 1, 100);
    await tile(12, 1, 1, 1000);
    await tile(12, 1, 2, 500);
    const s = await readCacheStats(root);
    expect(s.totalBytes).toBe(1600);
    expect(s.tileCount).toBe(3);
    expect(s.capBytes).toBe(CAP_BYTES);
    expect(s.byZoom[5]).toEqual({ bytes: 100, tiles: 1 });
    expect(s.byZoom[12]).toEqual({ bytes: 1500, tiles: 2 });
  });

  it('returns zeros for a missing cache dir', async () => {
    const s = await readCacheStats(join(root, 'does-not-exist'));
    expect(s.totalBytes).toBe(0);
    expect(s.tileCount).toBe(0);
  });
});

describe('pruneCache', () => {
  it('never deletes tiles at or below the protected base zoom', async () => {
    await tile(PROTECT_MAX_ZOOM, 1, 1, 1000, 999); // very old but protected
    const r = await pruneCache(root, { olderThanDays: 1 });
    expect(r.removedTiles).toBe(0);
    expect((await readCacheStats(root)).tileCount).toBe(1);
  });

  it('olderThanDays removes only stale high-zoom tiles', async () => {
    await tile(15, 1, 1, 100, 100); // unused 100 days → evict
    await tile(15, 1, 2, 100, 10); // recently viewed → keep
    const r = await pruneCache(root, { olderThanDays: 90 });
    expect(r.removedTiles).toBe(1);
    expect(r.removedBytes).toBe(100);
    const s = await readCacheStats(root);
    expect(s.tileCount).toBe(1);
  });

  it('maxBytes evicts oldest-first until under budget', async () => {
    await tile(16, 1, 1, 1000, 30); // oldest
    await tile(16, 1, 2, 1000, 20);
    await tile(16, 1, 3, 1000, 10); // newest
    const r = await pruneCache(root, { maxBytes: 2500 });
    expect(r.removedTiles).toBe(1); // drop the single oldest to get to 2000
    expect(r.totalBytesAfter).toBe(2000);
  });
});
