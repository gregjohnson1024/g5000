# Satellite Imagery Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global Esri World Imagery satellite raster overlay to the `/chart` page, with an offline disk cache that accumulates coverage over time and a `/settings` admin UI to prune unused tiles.

**Architecture:** Mirror the existing NOAA ENC overlay — a same-origin disk-caching tile proxy (`/api/sat-tiles`) feeds a MapLibre raster layer (`SatelliteLayer`) toggled from `LayersControl`. A shared `lib/sat-cache.ts` provides cache stats + LRU pruning, consumed by both an admin API (`/api/sat-cache`, surfaced on `/settings`) and CLI scripts (`sat-seed`, `sat-cache`). The proxy bumps tile mtime on each HIT so "unused" means least-recently-viewed.

**Tech Stack:** Next.js 16 App Router (route handlers, `runtime='nodejs'`), React 19, MapLibre GL, Vitest (`pool: 'forks'`), TypeScript (strict, ESM), `tsx` for standalone scripts.

**Spec:** `docs/superpowers/specs/2026-05-23-satellite-imagery-layer-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/web/src/lib/sat-cache.ts` (new) | Cache stats + prune core; one source of truth |
| `packages/web/src/lib/sat-cache.test.ts` (new) | Unit tests for the above |
| `packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.ts` (new) | Esri tile proxy + disk cache + mtime-on-HIT |
| `packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.test.ts` (new) | Proxy route tests |
| `packages/web/src/components/SatelliteLayer.tsx` (new) | MapLibre raster layer + `refreshSatTiles` |
| `packages/web/src/app/chart/LayersControl.tsx` (edit) | Add Satellite toggle + refresh button |
| `packages/web/src/app/chart/page.tsx` (edit) | Mount layer, state, refresh wiring |
| `packages/web/src/app/api/sat-cache/route.ts` (new) | GET cache stats |
| `packages/web/src/app/api/sat-cache/prune/route.ts` (new) | POST prune |
| `packages/web/src/app/api/sat-cache/prune/route.test.ts` (new) | Prune route test |
| `packages/web/src/app/settings/SatelliteCachePanel.tsx` (new) | Admin UI panel (child component) |
| `packages/web/src/app/settings/page.tsx` (edit) | Render the panel |
| `scripts/sat-seed.ts` (new) | Pre-warm: `regions` + `global` |
| `scripts/sat-cache.ts` (new) | CLI: `report` + `prune` |

---

## Task 1: Cache stats + prune library

**Files:**
- Create: `packages/web/src/lib/sat-cache.ts`
- Test: `packages/web/src/lib/sat-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/sat-cache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/sat-cache.test.ts`
Expected: FAIL — `Failed to resolve import "./sat-cache"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/lib/sat-cache.ts`:

```ts
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Disk cap for the satellite tile cache, tailored to the Pi (29 GB card,
 * 14 GB free). Nothing is auto-deleted — callers pass this to pruneCache. */
export const CAP_BYTES = 8 * 1024 ** 3;
/** Tiles at this zoom or below are never evicted: the cheap, high-value
 * global / regional base. Only z > PROTECT_MAX_ZOOM is a prune candidate. */
export const PROTECT_MAX_ZOOM = 8;

export interface ZoomStat {
  bytes: number;
  tiles: number;
}
export interface CacheStats {
  totalBytes: number;
  tileCount: number;
  capBytes: number;
  byZoom: Record<number, ZoomStat>;
}

interface TileFile {
  path: string;
  z: number;
  bytes: number;
  mtimeMs: number;
}

async function walk(root: string): Promise<TileFile[]> {
  const out: TileFile[] = [];
  let zDirs: string[];
  try {
    zDirs = await readdir(root);
  } catch {
    return out; // missing cache dir → empty
  }
  for (const zName of zDirs) {
    const z = Number(zName);
    if (!Number.isInteger(z)) continue;
    const zPath = join(root, zName);
    let xDirs: string[];
    try {
      xDirs = await readdir(zPath);
    } catch {
      continue;
    }
    for (const xName of xDirs) {
      const xPath = join(zPath, xName);
      let yFiles: string[];
      try {
        yFiles = await readdir(xPath);
      } catch {
        continue;
      }
      for (const yName of yFiles) {
        const p = join(xPath, yName);
        try {
          const s = await stat(p);
          if (!s.isFile()) continue;
          out.push({ path: p, z, bytes: s.size, mtimeMs: s.mtimeMs });
        } catch {
          /* race: file removed between readdir and stat */
        }
      }
    }
  }
  return out;
}

export async function readCacheStats(root: string): Promise<CacheStats> {
  const files = await walk(root);
  const byZoom: Record<number, ZoomStat> = {};
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.bytes;
    const zs = byZoom[f.z] ?? { bytes: 0, tiles: 0 };
    zs.bytes += f.bytes;
    zs.tiles += 1;
    byZoom[f.z] = zs;
  }
  return { totalBytes, tileCount: files.length, capBytes: CAP_BYTES, byZoom };
}

export interface PruneOptions {
  maxBytes?: number;
  olderThanDays?: number;
  /** Override "now" for testing. */
  now?: number;
}
export interface PruneResult {
  removedTiles: number;
  removedBytes: number;
  totalBytesAfter: number;
}

export async function pruneCache(root: string, opts: PruneOptions = {}): Promise<PruneResult> {
  const now = opts.now ?? Date.now();
  const files = await walk(root);
  const totalBefore = files.reduce((a, f) => a + f.bytes, 0);

  // Only tiles above the protected base zoom can be evicted, oldest first.
  const candidates = files
    .filter((f) => f.z > PROTECT_MAX_ZOOM)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  const toRemove: TileFile[] = [];
  const removing = new Set<string>();

  // Age-based ("unused"): evict candidates not viewed within olderThanDays.
  if (opts.olderThanDays !== undefined) {
    const cutoff = now - opts.olderThanDays * 24 * 3600 * 1000;
    for (const f of candidates) {
      if (f.mtimeMs < cutoff) {
        toRemove.push(f);
        removing.add(f.path);
      }
    }
  }

  // Budget-based: evict oldest remaining candidates until under maxBytes.
  if (opts.maxBytes !== undefined) {
    let running = totalBefore - toRemove.reduce((a, f) => a + f.bytes, 0);
    for (const f of candidates) {
      if (running <= opts.maxBytes) break;
      if (removing.has(f.path)) continue;
      toRemove.push(f);
      removing.add(f.path);
      running -= f.bytes;
    }
  }

  let removedBytes = 0;
  for (const f of toRemove) {
    try {
      await unlink(f.path);
      removedBytes += f.bytes;
    } catch {
      /* already gone */
    }
  }
  return {
    removedTiles: toRemove.length,
    removedBytes,
    totalBytesAfter: totalBefore - removedBytes,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/sat-cache.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/sat-cache.ts packages/web/src/lib/sat-cache.test.ts
git commit -m "feat(web): sat-cache stats + LRU prune library"
```

---

## Task 2: Esri tile proxy route

**Files:**
- Create: `packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.ts`
- Test: `packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let GET: (req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) => Promise<Response>;
let root: string;

function params(z: string, x: string, y: string) {
  return { params: Promise.resolve({ z, x, y }) };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sat-tiles-test-'));
  process.env.G5000_ROUTER_ROOT = root;
  vi.resetModules();
  ({ GET } = await import('./route'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  delete process.env.G5000_ROUTER_ROOT;
});

describe('sat-tiles proxy', () => {
  it('rejects bad coordinates with 400', async () => {
    const res = await GET(new Request('http://x'), params('abc', '1', '1'));
    expect(res.status).toBe(400);
  });

  it('serves a transparent EMPTY tile outside the zoom band', async () => {
    const res = await GET(new Request('http://x'), params('25', '1', '1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('EMPTY');
  });

  it('serves a fresh disk tile as HIT and bumps its mtime', async () => {
    const dir = join(root, 'sat-cache', '12', '5');
    await mkdir(dir, { recursive: true });
    const file = join(dir, '7.jpg');
    await writeFile(file, Buffer.from([1, 2, 3]));
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);

    const res = await GET(new Request('http://x'), params('12', '5', '7'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    // mtime bump is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 20));
    const s = await stat(file);
    expect(s.mtimeMs).toBeGreaterThan(old.getTime());
  });

  it('fetches Esri on MISS, passes content-type through, writes disk', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    );
    const res = await GET(new Request('http://x'), params('10', '3', '4'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    // ArcGIS row/col order (y before x), no zoom offset.
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/tile/10/4/3');
  });

  it('falls back to a transparent tile on upstream error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const res = await GET(new Request('http://x'), params('10', '3', '4'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('TIMEOUT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/api/sat-tiles`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.ts`:

```ts
import { mkdir, readFile, writeFile, stat, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from '../../../../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk Esri World Imagery tile cache.
 *
 * Mounted at /api/sat-tiles/{z}/{x}/{y}(.jpg) so the chart's maplibre source
 * can point at a same-origin URL. The browser sends standard XYZ; Esri's
 * ArcGIS MapServer uses the SAME web-mercator zoom (no offset, unlike NOAA)
 * but ArcGIS row/col order — `/tile/{z}/{row}/{col}` = y BEFORE x.
 *
 * Cache: `${G5000_ROUTER_ROOT}/sat-cache/{z}/{x}/{y}.jpg`. Imagery is static,
 * so the freshness TTL is long (365 d). On a disk HIT we bump mtime so a
 * tile's mtime is its last-served time — that's what the prune guard treats
 * as "unused".
 */
const SAT_CACHE_ROOT = join(ROOT, 'sat-cache');
const MAX_AGE_MS = 365 * 24 * 3600 * 1000;
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';
const MIN_Z = 0;
const MAX_Z = 19;

// 67-byte fully-transparent 1x1 PNG.
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function tilePath(z: string, x: string, y: string): string {
  const yBase = y.replace(/\.jpg$/, '');
  return join(SAT_CACHE_ROOT, z, x, `${yBase}.jpg`);
}

function emptyResponse(): Response {
  return new Response(new Uint8Array(TRANSPARENT_PNG), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=2592000',
      'x-cache': 'EMPTY',
      'access-control-allow-origin': '*',
    },
  });
}

async function serveFromDisk(path: string): Promise<Response | null> {
  try {
    const s = await stat(path);
    if (Date.now() - s.mtimeMs > MAX_AGE_MS) return null;
    const buf = await readFile(path);
    // Bump mtime → last-served time (LRU). Fire-and-forget; never block.
    const now = new Date();
    void utimes(path, now, now).catch(() => {});
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=2592000',
        'x-cache': 'HIT',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return null;
  }
}

function transparent(xCache: string): Response {
  return new Response(new Uint8Array(TRANSPARENT_PNG), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=60',
      'x-cache': xCache,
      'access-control-allow-origin': '*',
    },
  });
}

async function fetchAndCache(zNum: number, x: string, y: string, diskPath: string): Promise<Response> {
  const yBase = y.replace(/\.jpg$/, '');
  // ArcGIS row/col order: {z}/{y}/{x}. No zoom offset.
  const url =
    `https://server.arcgisonline.com/ArcGIS/rest/services/` +
    `World_Imagery/MapServer/tile/${zNum}/${yBase}/${x}`;
  let r: Response;
  try {
    r = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return transparent('TIMEOUT');
  }
  if (!r.ok) {
    if (r.status === 404) {
      return new Response(`upstream tile ${url} → 404`, {
        status: 404,
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    return transparent('UPSTREAM-5XX');
  }
  const contentType = r.headers.get('content-type') ?? 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  void (async () => {
    try {
      await mkdir(dirname(diskPath), { recursive: true });
      await writeFile(diskPath, buf);
    } catch {
      /* serving beats caching */
    }
  })();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=2592000',
      'x-cache': 'MISS',
      'access-control-allow-origin': '*',
    },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const { z, x, y } = await ctx.params;
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}(\.jpg)?$/.test(y)) {
    return new Response('bad tile coords', {
      status: 400,
      headers: { 'access-control-allow-origin': '*' },
    });
  }
  const zNum = Number(z);
  if (zNum < MIN_Z || zNum > MAX_Z) return emptyResponse();
  const path = tilePath(z, x, y);
  const fromDisk = await serveFromDisk(path);
  if (fromDisk) return fromDisk;
  return fetchAndCache(zNum, x, y, path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/app/api/sat-tiles`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/sat-tiles
git commit -m "feat(web): /api/sat-tiles Esri imagery proxy with disk cache"
```

---

## Task 3: SatelliteLayer component

**Files:**
- Create: `packages/web/src/components/SatelliteLayer.tsx`

No unit test (MapLibre is hard to unit-test — matches `EncLayer`'s convention). Verified in Task 5's manual check.

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/SatelliteLayer.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'esri-satellite';
const LAYER_ID = 'esri-satellite-layer';

/**
 * Esri World Imagery satellite raster overlay. Opaque global imagery served
 * via the same-origin /api/sat-tiles proxy (disk-cached for offline use).
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by Map.tsx.
 * IMPORTANT: mount this AFTER <EncLayer> in chart/page.tsx so satellite
 * stacks on top of the NOAA chart but below the vector buoys + annotations.
 */
export function SatelliteLayer({
  map,
  visible,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
}) {
  useEffect(() => {
    if (!map) return;
    // Do NOT gate on map.isStyleLoaded(); the chart page hands us `map` from
    // Map.tsx's onLoad, so add* is safe. try/catch survives an HMR teardown.
    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: 'raster',
            tiles: ['/api/sat-tiles/{z}/{x}/{y}'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution: 'Esri, Maxar, Earthstar Geographics',
          });
        }
        if (!map.getLayer(LAYER_ID)) {
          const beforeId = map.getLayer('__above-wind__') ? '__above-wind__' : undefined;
          map.addLayer(
            {
              id: LAYER_ID,
              type: 'raster',
              source: SOURCE_ID,
              layout: { visibility: visible ? 'visible' : 'none' },
            },
            beforeId,
          );
        }
      } catch {
        /* style torn down mid-render; next styledata retries */
      }
    };

    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
    };
  }, [map, visible]);

  useEffect(() => {
    if (!map) return;
    if (!map.getLayer(LAYER_ID)) return;
    map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
  }, [map, visible]);

  return null;
}

/**
 * Drop MapLibre's in-memory tile cache for the satellite layer and re-fetch
 * visible tiles from disk. Use after seeding. The proxy ignores the `?v=`
 * param, so the disk cache benefit is preserved. Mirrors refreshEncTiles.
 */
export function refreshSatTiles(map: maplibregl.Map | null): boolean {
  if (!map) return false;
  try {
    const src = map.getSource(SOURCE_ID);
    if (src && 'setTiles' in src && typeof src.setTiles === 'function') {
      src.setTiles([`/api/sat-tiles/{z}/{x}/{y}?v=${Date.now()}`]);
      return true;
    }
  } catch {
    /* map torn down mid-call */
  }
  return false;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: no errors from `SatelliteLayer.tsx`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/SatelliteLayer.tsx
git commit -m "feat(web): SatelliteLayer MapLibre raster component"
```

---

## Task 4: Satellite toggle in LayersControl

**Files:**
- Modify: `packages/web/src/app/chart/LayersControl.tsx`

- [ ] **Step 1: Add `satellite` to `LayersState`**

In the `LayersState` interface, add the field after `enc`:

```ts
export interface LayersState {
  /** OSM raster basemap. Defaults true. Off → pure black underneath (handy
   * for NOAA-only or night use). */
  osm: boolean;
  enc: boolean;
  /** Esri World Imagery. Opaque; stacks on top of NOAA when both on. */
  satellite: boolean;
  buoys: boolean;
  /** Debug: draw the boundary + z/x/y label of every visible tile. */
  tileGrid: boolean;
}
```

- [ ] **Step 2: Add the refresh prop**

Change the component props to add `onRefreshSatellite`:

```ts
export function LayersControl({
  state,
  onToggle,
  onRefreshNoaa,
  onRefreshSatellite,
}: {
  state: LayersState;
  onToggle: (key: keyof LayersState) => void;
  /** Optional handler for the "Refresh NOAA tiles" action — invalidates
   * MapLibre's in-memory tile cache so newly-seeded disk tiles render. */
  onRefreshNoaa?: () => void;
  /** Same, for the satellite layer. */
  onRefreshSatellite?: () => void;
}): React.ReactElement {
```

- [ ] **Step 3: Count satellite in the on-tally**

Change the `onCount` line:

```ts
  const onCount =
    (state.enc ? 1 : 0) + (state.satellite ? 1 : 0) + (state.buoys ? 1 : 0);
```

- [ ] **Step 4: Add the Satellite row and refresh button**

In the popover, add a `Satellite` row after the `NOAA chart` row, and a refresh button after the NOAA one:

```tsx
          <Row label="OSM base" pressed={state.osm} onClick={() => onToggle('osm')} />
          <Row label="NOAA chart" pressed={state.enc} onClick={() => onToggle('enc')} />
          <Row label="Satellite" pressed={state.satellite} onClick={() => onToggle('satellite')} />
          <Row label="Buoys" pressed={state.buoys} onClick={() => onToggle('buoys')} />
          <Row
            label="Tile grid (debug)"
            pressed={state.tileGrid}
            onClick={() => onToggle('tileGrid')}
          />
          {onRefreshNoaa && state.enc ? (
            <button
              type="button"
              onClick={onRefreshNoaa}
              className="w-full mt-1 px-2 py-1.5 rounded text-xs text-zinc-300 border border-zinc-700 hover:bg-zinc-800"
              title="Drop MapLibre's tile cache and re-fetch NOAA tiles from disk"
            >
              ↻ Refresh NOAA tiles
            </button>
          ) : null}
          {onRefreshSatellite && state.satellite ? (
            <button
              type="button"
              onClick={onRefreshSatellite}
              className="w-full mt-1 px-2 py-1.5 rounded text-xs text-zinc-300 border border-zinc-700 hover:bg-zinc-800"
              title="Drop MapLibre's tile cache and re-fetch satellite tiles from disk"
            >
              ↻ Refresh satellite tiles
            </button>
          ) : null}
```

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck --workspace @g5000/web`
Expected: errors only in `chart/page.tsx` (the `satellite` key isn't supplied yet — fixed in Task 5). `LayersControl.tsx` itself is clean.

```bash
git add packages/web/src/app/chart/LayersControl.tsx
git commit -m "feat(web): Satellite toggle + refresh in LayersControl"
```

---

## Task 5: Mount SatelliteLayer on the chart page

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: Import the component**

After the `EncLayer` import (line ~23), add:

```ts
import { SatelliteLayer, refreshSatTiles } from '../../components/SatelliteLayer';
```

- [ ] **Step 2: Add `satellite` to default state**

In the `useState<LayersState>({ ... })` default (line ~362), add `satellite: false`:

```ts
  const [layers, setLayers] = useState<LayersState>({
    osm: true,
    enc: false,
    satellite: false,
    buoys: false,
    tileGrid: false,
  });
```

- [ ] **Step 3: Add `satellite` to the hydration parse**

In the `setLayers({ ... })` inside the localStorage hydration effect (line ~374), add:

```ts
        setLayers({
          osm: parsed.osm ?? true,
          enc: parsed.enc ?? false,
          satellite: parsed.satellite ?? false,
          buoys: parsed.buoys ?? false,
          tileGrid: parsed.tileGrid ?? false,
        });
```

- [ ] **Step 4: Mount the layer between EncLayer and EncBuoyLayer**

At line ~598, insert `<SatelliteLayer>` directly after `<EncLayer>` (so NOAA → satellite → buoys):

```tsx
        <EncLayer map={mapInstance} visible={layers.enc} />
        <SatelliteLayer map={mapInstance} visible={layers.satellite} />
        <EncBuoyLayer map={mapInstance} visible={layers.buoys} />
```

- [ ] **Step 5: Wire the refresh handler**

In the `<LayersControl>` props (line ~601), add `onRefreshSatellite`:

```tsx
        <LayersControl
          state={layers}
          onToggle={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
          onRefreshNoaa={() => refreshEncTiles(mapInstance)}
          onRefreshSatellite={() => refreshSatTiles(mapInstance)}
        />
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: PASS (no errors).

- [ ] **Step 7: Manual browser check**

Run: `npm run dev --workspace @g5000/app` (boots web at :3000; use `DEMO_MODE=1` if no hardware).
In the browser at `http://localhost:3000/chart`:
- Open the Layers popover (top-right), toggle **Satellite** on → imagery renders over OSM.
- Toggle **NOAA chart** on too → satellite is visible on top of NOAA; toggle satellite off → NOAA shows.
- Confirm AIS/route/boat-marker annotations still draw above satellite.
- Reload → the Satellite toggle state persists.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): mount SatelliteLayer on the chart page"
```

---

## Task 6: Cache admin API

**Files:**
- Create: `packages/web/src/app/api/sat-cache/route.ts`
- Create: `packages/web/src/app/api/sat-cache/prune/route.ts`
- Test: `packages/web/src/app/api/sat-cache/prune/route.test.ts`

- [ ] **Step 1: Write the failing prune-route test**

Create `packages/web/src/app/api/sat-cache/prune/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let POST: (req: Request) => Promise<Response>;

const pruneCache = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  pruneCache.mockReset();
  pruneCache.mockResolvedValue({ removedTiles: 2, removedBytes: 2048, totalBytesAfter: 1000 });
  // Mock the shared lib so the route test stays pure (no real disk walk).
  vi.doMock('../../../../lib/sat-cache', () => ({
    pruneCache,
    CAP_BYTES: 8 * 1024 ** 3,
  }));
  vi.doMock('../../../../lib/paths', () => ({ ROOT: '/tmp/router' }));
  ({ POST } = await import('./route'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../../../../lib/sat-cache');
  vi.doUnmock('../../../../lib/paths');
});

describe('POST /api/sat-cache/prune', () => {
  it('passes olderThanDays through to pruneCache', async () => {
    const res = await POST(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ olderThanDays: 90 }) }),
    );
    expect(res.status).toBe(200);
    expect(pruneCache).toHaveBeenCalledWith('/tmp/router/sat-cache', { olderThanDays: 90 });
    const body = (await res.json()) as { removedTiles: number };
    expect(body.removedTiles).toBe(2);
  });

  it('converts maxGb to bytes', async () => {
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ maxGb: 8 }) }));
    expect(pruneCache).toHaveBeenCalledWith('/tmp/router/sat-cache', { maxBytes: 8 * 1024 ** 3 });
  });

  it('400s when neither option is provided', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
    expect(pruneCache).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/api/sat-cache/prune`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 3: Write the GET stats route**

Create `packages/web/src/app/api/sat-cache/route.ts`:

```ts
import { join } from 'node:path';
import { ROOT } from '../../../lib/paths';
import { readCacheStats } from '../../../lib/sat-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const stats = await readCacheStats(join(ROOT, 'sat-cache'));
  return Response.json(stats);
}
```

- [ ] **Step 4: Write the POST prune route**

Create `packages/web/src/app/api/sat-cache/prune/route.ts`:

```ts
import { join } from 'node:path';
import { ROOT } from '../../../../lib/paths';
import { pruneCache } from '../../../../lib/sat-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  let body: { maxGb?: number; olderThanDays?: number } = {};
  try {
    body = (await req.json()) as { maxGb?: number; olderThanDays?: number };
  } catch {
    /* empty / invalid body → handled by the guard below */
  }
  const opts: { maxBytes?: number; olderThanDays?: number } = {};
  if (typeof body.maxGb === 'number' && body.maxGb > 0) {
    opts.maxBytes = body.maxGb * 1024 ** 3;
  }
  if (typeof body.olderThanDays === 'number' && body.olderThanDays > 0) {
    opts.olderThanDays = body.olderThanDays;
  }
  if (opts.maxBytes === undefined && opts.olderThanDays === undefined) {
    return new Response('provide maxGb or olderThanDays', { status: 400 });
  }
  const result = await pruneCache(join(ROOT, 'sat-cache'), opts);
  return Response.json(result);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/web/src/app/api/sat-cache/prune`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/sat-cache
git commit -m "feat(web): /api/sat-cache stats + prune endpoints"
```

---

## Task 7: Satellite cache admin panel on /settings

**Files:**
- Create: `packages/web/src/app/settings/SatelliteCachePanel.tsx`
- Modify: `packages/web/src/app/settings/page.tsx`

No unit test (page-level React; verified in browser). Kept as a child component so the panel's state is self-contained.

- [ ] **Step 1: Create the panel component**

Create `packages/web/src/app/settings/SatelliteCachePanel.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';

interface ZoomStat {
  bytes: number;
  tiles: number;
}
interface CacheStats {
  totalBytes: number;
  tileCount: number;
  capBytes: number;
  byZoom: Record<number, ZoomStat>;
}
interface PruneResult {
  removedTiles: number;
  removedBytes: number;
  totalBytesAfter: number;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function SatelliteCachePanel(): React.ReactElement {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [days, setDays] = useState<string>('90');
  const [busy, setBusy] = useState<boolean>(false);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sat-cache');
      if (!res.ok) throw new Error(`stats ${res.status}`);
      setStats((await res.json()) as CacheStats);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load cache stats');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const prune = useCallback(
    async (payload: { olderThanDays?: number; maxGb?: number }) => {
      setBusy(true);
      setStatus(undefined);
      setError(undefined);
      try {
        const res = await fetch('/api/sat-cache/prune', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`prune ${res.status}`);
        const r = (await res.json()) as PruneResult;
        setStatus(`Freed ${fmtBytes(r.removedBytes)} (${r.removedTiles} tiles)`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'prune failed');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const overBudget = stats ? stats.totalBytes > stats.capBytes : false;
  const pct = stats && stats.capBytes > 0 ? Math.min(100, (stats.totalBytes / stats.capBytes) * 100) : 0;
  const zooms = stats ? Object.keys(stats.byZoom).map(Number).sort((a, b) => a - b) : [];

  return (
    <section className="rounded border border-zinc-700 bg-zinc-900/50 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">Satellite tile cache</h2>
      {stats ? (
        <>
          <p className="mt-1 text-xs text-zinc-400">
            {fmtBytes(stats.totalBytes)} of {fmtBytes(stats.capBytes)} · {stats.tileCount} tiles
          </p>
          <div className="mt-2 h-2 w-full rounded bg-zinc-800">
            <div
              className={'h-2 rounded ' + (overBudget ? 'bg-red-500' : 'bg-emerald-500')}
              style={{ width: `${pct}%` }}
            />
          </div>
          {zooms.length > 0 ? (
            <table className="mt-3 w-full text-xs text-zinc-300">
              <thead>
                <tr className="text-zinc-500">
                  <th className="text-left font-normal">zoom</th>
                  <th className="text-right font-normal">tiles</th>
                  <th className="text-right font-normal">size</th>
                </tr>
              </thead>
              <tbody>
                {zooms.map((z) => (
                  <tr key={z}>
                    <td>z{z}</td>
                    <td className="text-right">{stats.byZoom[z]!.tiles}</td>
                    <td className="text-right">{fmtBytes(stats.byZoom[z]!.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">Loading…</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs text-zinc-400">
          Remove tiles not viewed in
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="mx-1 w-16 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-zinc-100"
          />
          days
        </label>
        <button
          type="button"
          disabled={busy || !days}
          onClick={() => void prune({ olderThanDays: Number(days) })}
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          Prune unused tiles
        </button>
        {overBudget ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void prune({ maxGb: stats!.capBytes / 1024 ** 3 })}
            className="rounded border border-red-700 px-2 py-1 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-40"
          >
            Prune to cap
          </button>
        ) : null}
      </div>

      {status ? <p className="mt-2 text-xs text-emerald-400">{status}</p> : null}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </section>
  );
}
```

- [ ] **Step 2: Render the panel on the settings page**

In `packages/web/src/app/settings/page.tsx`, add the import near the top:

```ts
import { SatelliteCachePanel } from './SatelliteCachePanel';
```

Then render `<SatelliteCachePanel />` within the page's returned JSX, alongside the other sections (place it near the forecast / cache-root settings block — exact location is cosmetic). Example:

```tsx
        <SatelliteCachePanel />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: PASS.

- [ ] **Step 4: Manual browser check**

With `npm run dev --workspace @g5000/app` running, open `http://localhost:3000/settings`:
- The "Satellite tile cache" panel loads and shows usage (0 B initially, or current size).
- After seeding (Task 8) and reloading, the per-zoom table populates.
- Entering a day count and clicking **Prune unused tiles** shows a "Freed …" message and the readout refreshes.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/settings/SatelliteCachePanel.tsx packages/web/src/app/settings/page.tsx
git commit -m "feat(web): satellite tile-cache admin panel on /settings"
```

---

## Task 8: Pre-warm script (sat-seed)

**Files:**
- Create: `scripts/sat-seed.ts`

- [ ] **Step 1: Create the script**

Create `scripts/sat-seed.ts`:

```ts
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
```

- [ ] **Step 2: Smoke test (tiny global seed)**

Run: `npx tsx scripts/sat-seed.ts global --max-zoom=2`
Expected: logs `z=0`, `z=1`, `z=2` seeding a handful of tiles; creates `~/.g5000-router/sat-cache/`. Rerun → all `cached`, no new fetches (idempotent).

- [ ] **Step 3: Smoke test (region starter file)**

Run: `npx tsx scripts/sat-seed.ts regions`
Expected: on first run writes `~/.g5000-router/sat-seed-regions.json` and prints the "edit and rerun" message. Rerun → seeds the Bermuda + Narragansett bboxes.

- [ ] **Step 4: Commit**

```bash
git add scripts/sat-seed.ts
git commit -m "feat(scripts): sat-seed pre-warm (regions + global) for satellite cache"
```

---

## Task 9: Cache CLI (sat-cache)

**Files:**
- Create: `scripts/sat-cache.ts`

- [ ] **Step 1: Create the script**

Create `scripts/sat-cache.ts`:

```ts
/**
 * Inspect and prune the Esri satellite tile cache from the command line
 * (headless / ssh). Shares the prune + stats core with the /settings admin
 * UI via packages/web/src/lib/sat-cache.ts — single source of truth.
 *
 *   npx tsx scripts/sat-cache.ts report
 *   npx tsx scripts/sat-cache.ts prune --older-than-days=90
 *   npx tsx scripts/sat-cache.ts prune --max-gb=8
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readCacheStats, pruneCache, CAP_BYTES } from '../packages/web/src/lib/sat-cache';

const CACHE_ROOT = join(
  process.env.G5000_ROUTER_ROOT ?? join(homedir(), '.g5000-router'),
  'sat-cache',
);

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function parseArg(flag: string): string | undefined {
  return process.argv.find((x) => x.startsWith(flag + '='))?.split('=')[1];
}

async function report(): Promise<void> {
  const s = await readCacheStats(CACHE_ROOT);
  console.log(`cache: ${CACHE_ROOT}`);
  console.log(`total: ${gb(s.totalBytes)} of ${gb(s.capBytes)} cap · ${s.tileCount} tiles`);
  for (const z of Object.keys(s.byZoom).map(Number).sort((a, b) => a - b)) {
    console.log(`  z${z}: ${s.byZoom[z]!.tiles} tiles, ${gb(s.byZoom[z]!.bytes)}`);
  }
  if (s.totalBytes > s.capBytes) console.warn('WARNING: over cap — run `prune`.');
  else if (s.totalBytes > s.capBytes * 0.9) console.warn('NOTE: within 10% of cap.');
}

async function prune(): Promise<void> {
  const olderRaw = parseArg('--older-than-days');
  const maxGbRaw = parseArg('--max-gb');
  const opts: { olderThanDays?: number; maxBytes?: number } = {};
  if (olderRaw !== undefined) opts.olderThanDays = Number(olderRaw);
  // Default to the 8 GB cap when no flag is given.
  opts.maxBytes = (maxGbRaw !== undefined ? Number(maxGbRaw) : CAP_BYTES / 1024 ** 3) * 1024 ** 3;
  const r = await pruneCache(CACHE_ROOT, opts);
  console.log(`pruned ${r.removedTiles} tiles, freed ${gb(r.removedBytes)}; now ${gb(r.totalBytesAfter)}`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'report') await report();
  else if (cmd === 'prune') await prune();
  else {
    console.error('usage: sat-cache <report|prune> [--older-than-days=N] [--max-gb=N]');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test**

Run: `npx tsx scripts/sat-cache.ts report`
Expected: prints the cache root, total vs cap, and per-zoom rows (populated from Task 8's seed).

Run: `npx tsx scripts/sat-cache.ts prune --older-than-days=3650`
Expected: `pruned 0 tiles` (nothing is that old yet), confirming protected-zoom + age logic don't over-delete.

- [ ] **Step 3: Commit**

```bash
git add scripts/sat-cache.ts
git commit -m "feat(scripts): sat-cache report + prune CLI"
```

---

## Task 10: Full verification

- [ ] **Step 1: Typecheck the whole web workspace**

Run: `npm run typecheck --workspace @g5000/web`
Expected: PASS.

- [ ] **Step 2: Run the new tests together**

Run: `npx vitest run packages/web/src/lib/sat-cache.test.ts packages/web/src/app/api/sat-tiles packages/web/src/app/api/sat-cache`
Expected: all PASS (Task 1: 5, Task 2: 5, Task 6: 3 = 13 tests).

- [ ] **Step 3: Confirm baseline is unchanged**

Run: `npm test`
Expected: the known ~4 environmental failures (coastline, ConfigStore route tests, GRIB integration) only — no new failures from this work.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS (prettier clean). If not, run `npm run format` and amend.

- [ ] **Step 5: Final manual pass**

With `npm run dev --workspace @g5000/app`: seed a small area (`npx tsx scripts/sat-seed.ts regions` after editing the region file to a place you can verify), open `/chart`, toggle Satellite, confirm imagery + z-order vs NOAA + offline serve (stop wifi, reload, tiles still render from disk). Open `/settings`, confirm the cache panel reflects the seeded tiles and a prune frees space.

---

## Notes for the implementer

- **ESM imports need no file extension** in `packages/web` (bundler resolution); the standalone `scripts/*.ts` import the web lib by relative path and run via `npx tsx`, which resolves TS across the repo. If a script import fails at runtime, the fallback is to copy the two small functions into the script — but try the import first.
- **Do not reorder `<EncLayer>` and `<SatelliteLayer>`** in `chart/page.tsx` — satellite must mount after NOAA to win the z-order (both use `beforeId='__above-wind__'`).
- **Before opening the PR:** `git rebase develop` (this worktree was cut from `origin/main`, which is behind `develop`). No chart-code conflict expected.
</content>
