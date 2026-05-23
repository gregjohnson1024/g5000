# NOAA ENC raster overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single top-right NOAA toggle to `/chart` that switches the basemap between OSM and NOAA's NCDS paper-chart tiles, dropping the seamarks mount along the way.

**Architecture:** New same-origin tile proxy translates MapLibre's standard XYZ tiles to NOAA's ArcGIS endpoint (zoom shift `−2`, row/col order swap). New raster layer component manages the source/layer. LayersControl is rewritten as a single toggle button — popover removed.

**Tech Stack:** Next.js 16 App Router · React 19 · MapLibre GL JS · TypeScript strict (`noUncheckedIndexedAccess`) · Vitest.

**Spec:** `docs/superpowers/specs/2026-05-19-noaa-enc-overlay-design.md`

---

## File Structure

| File                                                           | Purpose                                                              | Status    |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | --------- |
| `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.ts`      | XYZ → NOAA proxy with disk cache and transparent z-clamp             | new       |
| `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.test.ts` | Vitest: MISS / HIT / EMPTY (z-clamp) / bad coords / ArcGIS URL shape | new       |
| `packages/web/src/components/EncLayer.tsx`                     | MapLibre raster source + layer; visibility prop                      | new       |
| `packages/web/src/app/chart/LayersControl.tsx`                 | Rewrite — single button, no popover; `LayersState = { enc }`         | modified  |
| `packages/web/src/app/chart/page.tsx`                          | Drop SeamarkLayer import+mount, swap state shape, mount EncLayer     | modified  |
| `packages/web/src/components/SeamarkLayer.tsx`                 | Untouched — left in tree, unmounted                                  | preserved |
| `packages/web/src/app/api/seamark-tiles/*`                     | Untouched — left in tree, unrequested                                | preserved |

---

## Task 1: Tile proxy (`/api/enc-tiles/[z]/[x]/[y]`)

**Files:**

- Create: `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.ts`
- Test: `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.test.ts`

Translates the standard XYZ tile coords MapLibre sends into NOAA's ArcGIS conventions: `noaa_z = z - 2`, ArcGIS uses `/tile/{z}/{y}/{x}` (row/col), and zooms outside `[2,18]` return a transparent 1×1 PNG with `x-cache: EMPTY` (avoids MapLibre logging 404 noise outside coverage).

The 1×1 transparent PNG byte sequence — a 67-byte minimal PNG — is a known constant. Use the exact bytes shown in the implementation step so the test can assert it without re-encoding.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let GET: (
  req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) => Promise<Response>;

function makeCtx(z: string, x: string, y: string) {
  return { params: Promise.resolve({ z, x, y }) };
}

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-enc-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('enc-tiles route', () => {
  it('translates std XYZ to NOAA z-2 with ArcGIS y/x order on cache miss', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff]);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } }),
      );

    const res = await GET(
      new Request('http://x/api/enc-tiles/15/9892/12226'),
      makeCtx('15', '9892', '12226'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const upstreamUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(upstreamUrl).toBe(
      'https://gis.charttools.noaa.gov/arcgis/rest/services/MarineChart_Services/NOAACharts/MapServer/tile/13/12226/9892',
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'enc-cache', '15', '9892', '12226.png'))).toBe(true);
  });

  it('serves from disk on a cache hit without calling fetch', async () => {
    const tileDir = join(TMP_ROOT, 'enc-cache', '15', '9892');
    mkdirSync(tileDir, { recursive: true });
    writeFileSync(join(tileDir, '12226.png'), Buffer.from([1, 2, 3]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(
      new Request('http://x/api/enc-tiles/15/9892/12226'),
      makeCtx('15', '9892', '12226'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([1, 2, 3]);
  });

  it('returns transparent 1x1 PNG with x-cache EMPTY for z<2', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(new Request('http://x/api/enc-tiles/1/0/0'), makeCtx('1', '0', '0'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('EMPTY');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    // PNG signature
    expect(Array.from(body.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('returns transparent 1x1 PNG for z>18', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(new Request('http://x/api/enc-tiles/19/0/0'), makeCtx('19', '0', '0'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('EMPTY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects bad tile coords with 400', async () => {
    const res = await GET(new Request('http://x/api/enc-tiles/abc/1/1'), makeCtx('abc', '1', '1'));
    expect(res.status).toBe(400);
  });

  it('accepts a .png suffix on y', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89]), { status: 200 }),
    );
    const res = await GET(
      new Request('http://x/api/enc-tiles/15/9892/12226.png'),
      makeCtx('15', '9892', '12226.png'),
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx vitest run packages/web/src/app/api/enc-tiles/\[z\]/\[x\]/\[y\]/route.test.ts
```

Expected: fail with `Cannot find module './route'` or similar.

- [ ] **Step 3: Implement the route**

Create `packages/web/src/app/api/enc-tiles/[z]/[x]/[y]/route.ts`:

```ts
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from '../../../../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk NOAA NCDS chart tile cache.
 *
 * Mounted at /api/enc-tiles/{z}/{x}/{y}(.png) so the chart's maplibre
 * source can point at a same-origin URL. The browser sends standard
 * XYZ coordinates; we translate to NOAA's ArcGIS conventions:
 *
 *   - NOAA's z=0 is 1/4 the resolution of standard XYZ z=0, so
 *     `noaa_z = standard_z - 2`. NOAA covers noaa_z=0..16, i.e.
 *     standard_z=2..18. Outside that band we serve a transparent
 *     1x1 PNG (status 200, x-cache=EMPTY) to keep MapLibre quiet.
 *
 *   - ArcGIS uses `/tile/{z}/{row}/{col}` — i.e. y BEFORE x — so the
 *     upstream URL swaps the order of our incoming {x}/{y} params.
 *
 * Cache location: `${G5000_ROUTER_ROOT}/enc-cache/{z}/{x}/{y}.png`
 * using the standard XYZ coords (so cache keys match MapLibre's
 * requests one-to-one). Defaults to `~/.g5000-router/enc-cache`.
 *
 * NOAA NCDS data is public domain. Attribution is provided via the
 * MapLibre source's `attribution` property in `EncLayer.tsx`.
 */

const ENC_CACHE_ROOT = join(ROOT, 'enc-cache');
const MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';

const MIN_Z = 2;
const MAX_Z = 18;

// Minimal 1x1 fully-transparent PNG (67 bytes). Pre-encoded as a
// constant so we never re-encode at request time.
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function tilePath(z: string, x: string, y: string): string {
  // Strip any `.png` suffix Next.js might pass through, then re-add.
  const yBase = y.replace(/\.png$/, '');
  return join(ENC_CACHE_ROOT, z, x, `${yBase}.png`);
}

function emptyResponse(): Response {
  return new Response(new Uint8Array(TRANSPARENT_PNG), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=2592000',
      'x-cache': 'EMPTY',
    },
  });
}

async function serveFromDisk(path: string): Promise<Response | null> {
  try {
    const s = await stat(path);
    if (Date.now() - s.mtimeMs > MAX_AGE_MS) return null;
    const buf = await readFile(path);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=2592000',
        'x-cache': 'HIT',
      },
    });
  } catch {
    return null;
  }
}

async function fetchAndCache(
  zNum: number,
  x: string,
  y: string,
  diskPath: string,
): Promise<Response> {
  const yBase = y.replace(/\.png$/, '');
  const noaaZ = zNum - 2;
  const url =
    `https://gis.charttools.noaa.gov/arcgis/rest/services/` +
    `MarineChart_Services/NOAACharts/MapServer/tile/${noaaZ}/${yBase}/${x}`;
  const r = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    return new Response(`upstream tile ${url} → ${r.status}`, {
      status: r.status === 404 ? 404 : 502,
    });
  }
  const buf = Buffer.from(await r.arrayBuffer());
  void (async () => {
    try {
      await mkdir(dirname(diskPath), { recursive: true });
      await writeFile(diskPath, buf);
    } catch {
      /* ignore — serving the response is more important than caching */
    }
  })();
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=2592000',
      'x-cache': 'MISS',
    },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const { z, x, y } = await ctx.params;
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}(\.png)?$/.test(y)) {
    return new Response('bad tile coords', { status: 400 });
  }
  const zNum = Number(z);
  if (zNum < MIN_Z || zNum > MAX_Z) {
    return emptyResponse();
  }
  const path = tilePath(z, x, y);
  const fromDisk = await serveFromDisk(path);
  if (fromDisk) return fromDisk;
  return fetchAndCache(zNum, x, y, path);
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run packages/web/src/app/api/enc-tiles/\[z\]/\[x\]/\[y\]/route.test.ts
```

Expected: 6 passing tests.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: no errors. If you see stale-dist errors mentioning `@g5000/db` or `@g5000/core`, run:

```bash
npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib packages/routing packages/coastline
```

then re-run the typecheck.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/enc-tiles
git commit -m "feat(web): /api/enc-tiles proxy for NOAA NCDS chart tiles

Translates standard XYZ tile coords to NOAA's ArcGIS conventions
(noaa_z = std_z - 2; /tile/{z}/{y}/{x} row/col order). Caches PNGs
under ~/.g5000-router/enc-cache/{z}/{x}/{y}.png with 30-day max-age.
Outside NOAA's z=2..18 coverage, returns a transparent 1x1 PNG with
x-cache: EMPTY so MapLibre stops logging 404s on off-coverage tiles."
```

---

## Task 2: EncLayer React component

**Files:**

- Create: `packages/web/src/components/EncLayer.tsx`

Thin wrapper around a MapLibre raster source + layer. Same shape as the (already-shipped) `SeamarkLayer` after its `isStyleLoaded`-free fix. No automated test — consistent with other layer components.

- [ ] **Step 1: Create the component**

```tsx
'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'noaa-enc';
const LAYER_ID = 'noaa-enc-layer';

/**
 * NOAA NCDS paper-chart raster overlay. Opaque tiles covering the
 * OSM basemap with the full nautical chart rendering — depth
 * contours, lit aids with characteristic, harbour limits, dredged
 * channels, anchorages.
 *
 * Tiles come from the same-origin /api/enc-tiles proxy, which
 * handles the XYZ → NOAA z-2 translation and disk caches under
 * ~/.g5000-router/enc-cache.
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by
 * Map.tsx, so wind / AIS / route / range-rings render on top.
 *
 * Coverage is US waters and territories only. NOAA's tile grid
 * tops out at standard XYZ z=18 (their z=16) — minzoom/maxzoom
 * on the source keep MapLibre from requesting outside that band.
 */
export function EncLayer({ map, visible }: { map: maplibregl.Map | null; visible: boolean }) {
  useEffect(() => {
    if (!map) return;
    // Same pattern as SeamarkLayer's post-fix form: do NOT gate on
    // map.isStyleLoaded() (it can stay false indefinitely while other
    // sources are loading). The chart page hands us `map` from inside
    // Map.tsx's `onLoad`, so the style is already initialized and
    // addSource/addLayer are safe. Wrap in try/catch to survive an
    // HMR race where the map has been torn down between renders.
    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: 'raster',
            tiles: ['/api/enc-tiles/{z}/{x}/{y}.png'],
            tileSize: 256,
            minzoom: 2,
            maxzoom: 18,
            attribution: 'NOAA / Office of Coast Survey',
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
        /* style torn down mid-render; the next styledata event retries */
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
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/EncLayer.tsx
git commit -m "feat(web): EncLayer — NOAA NCDS raster overlay

MapLibre source + raster layer for /api/enc-tiles. Opaque tiles
covering the OSM basemap; sits beneath the __above-wind__ z-order
sentinel so AIS / route / range-rings render on top. Drops the
isStyleLoaded() gate (mirrors the SeamarkLayer fix); wraps
addSource/addLayer in try/catch with styledata as the retry
signal."
```

---

## Task 3: Rewrite LayersControl as a single toggle button

**Files:**

- Modify: `packages/web/src/app/chart/LayersControl.tsx`

Replace the popover-with-checkboxes with a single rectangular toggle button labeled "NOAA". Same public prop shape so the chart-page wire-up only needs a state-shape swap.

- [ ] **Step 1: Replace the file contents**

Overwrite `packages/web/src/app/chart/LayersControl.tsx` with:

```tsx
'use client';

export interface LayersState {
  enc: boolean;
}

/**
 * Top-right toggle button on /chart for the NOAA NCDS chart overlay.
 *
 * When `state.enc` is true, the button shows a filled background to
 * indicate the NOAA chart is on top of the OSM basemap. When false,
 * it's outlined and the chart shows plain OSM.
 *
 * This was previously a popover hosting a Seamarks row plus the
 * NOAA row. The seamarks layer turned out not to be useful in
 * practice, so the popover collapsed to a single toggle. If a
 * second toggle ever lands again, this component goes back to the
 * popover shape — for now, single button is the right scope.
 *
 * The caller (chart/page.tsx) owns state and persists it to
 * localStorage under `chart:layers`.
 */
export function LayersControl({
  state,
  onToggle,
}: {
  state: LayersState;
  onToggle: (key: keyof LayersState) => void;
}) {
  const on = state.enc;
  return (
    <button
      type="button"
      aria-label="Toggle NOAA chart overlay"
      aria-pressed={on}
      onClick={() => onToggle('enc')}
      className={
        'absolute top-2 right-2 z-10 px-3 h-9 rounded border text-sm font-medium ' +
        (on
          ? 'bg-zinc-100 text-zinc-900 border-zinc-100 hover:bg-zinc-200'
          : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
      }
    >
      NOAA
    </button>
  );
}
```

- [ ] **Step 2: Run typecheck (expect a chart/page.tsx error — that's fine)**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: errors in `packages/web/src/app/chart/page.tsx` because that file still references the old `LayersState.seamarks` shape. Those are fixed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/chart/LayersControl.tsx
git commit -m "refactor(web): LayersControl is a single NOAA toggle button

The popover-with-checkboxes collapses to one rectangular toggle
button now that seamarks are dropped from /chart. Same prop
signature (state, onToggle) so the chart-page wire-up is a state-
shape swap. LayersState narrows to { enc }. Chart-page still
references the old { seamarks } shape; that fix is Task 4."
```

---

## Task 4: Wire chart page — drop SeamarkLayer, swap state, mount EncLayer

**Files:**

- Modify: `packages/web/src/app/chart/page.tsx`

Three edits in `page.tsx`:

1. Drop the `SeamarkLayer` import on line 23.
2. Replace the `layers` state initializer (lines 349–367) so it reads/writes the `{ enc }` shape.
3. Inside the chart wrapper around line 553, drop the `<SeamarkLayer/>` mount and add `<EncLayer/>` instead.

- [ ] **Step 1: Add the EncLayer import and drop the SeamarkLayer import**

In `packages/web/src/app/chart/page.tsx`, near the top component imports, replace:

```ts
import { SeamarkLayer } from '../../components/SeamarkLayer';
```

with:

```ts
import { EncLayer } from '../../components/EncLayer';
```

Leave the `LayersControl` / `LayersState` import on line 25 unchanged — those names are stable; only the underlying `LayersState` shape has changed.

- [ ] **Step 2: Replace the `layers` state block**

Find the existing block starting at "Layer visibility — which chart overlays are currently on. Seamarks default on so..." (around line 347). Replace it entirely with:

```tsx
// Layer visibility — only the NOAA chart toggle in v1. Default off
// so first-time visitors see the OSM basemap. Persists to
// localStorage so the choice survives reloads.
const [layers, setLayers] = useState<LayersState>(() => {
  if (typeof window === 'undefined') return { enc: false };
  try {
    const raw = window.localStorage.getItem('chart:layers');
    if (!raw) return { enc: false };
    const parsed = JSON.parse(raw) as Partial<LayersState>;
    return { enc: parsed.enc ?? false };
  } catch {
    return { enc: false };
  }
});
useEffect(() => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('chart:layers', JSON.stringify(layers));
  } catch {
    /* private-mode / quota exceeded — ignore */
  }
}, [layers]);
```

- [ ] **Step 3: Swap the SeamarkLayer mount for EncLayer**

Find the existing `<SeamarkLayer map={mapInstance} visible={layers.seamarks} />` line (around line 553). Replace it with:

```tsx
<EncLayer map={mapInstance} visible={layers.enc} />
```

Leave the surrounding `<LayersControl ... />` block untouched — its props are unchanged.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass (including the 6 new enc-tiles tests). Pre-existing environmental failures (missing wgrib2 binary, ConfigStore-not-booted-in-test-context) are acceptable; flag any test that wasn't failing before.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: clean. (If lint flags pre-existing issues elsewhere in the repo, ignore — only flag issues introduced by this change.)

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): mount NOAA chart toggle on /chart, drop seamarks

Drops the SeamarkLayer mount + import (component file preserved
in the tree, just unmounted), narrows LayersState in the chart
page to { enc }, and mounts EncLayer keyed off the new state.
First-time visitors see the OSM basemap; toggle the NOAA button
top-right to overlay the NOAA NCDS chart."
```

---

## Task 5: Manual verification

**Files:**

- Modify: none.

End-to-end smoke on the local dev server before declaring this done.

- [ ] **Step 1: Stop any dev server already on port 3000 and start fresh from this worktree**

```bash
lsof -ti :3000 2>/dev/null | xargs -r kill -9
cd /Users/gregjohnson/code/g5000/.worktrees/gh-11-enc
npm run dev --workspace @g5000/autopilot-server
```

Wait for `[autopilot] web UI on http://0.0.0.0:3000` in the log.

- [ ] **Step 2: Smoke the proxy endpoints**

In another shell:

```bash
# Newport at std z=15 — expect a real PNG (~5 kB+)
curl -sSI http://localhost:3000/api/enc-tiles/15/9892/12226.png | head -6
# Same request — expect x-cache: HIT
curl -sSI http://localhost:3000/api/enc-tiles/15/9892/12226.png | head -6
# z=1 — expect x-cache: EMPTY
curl -sSI http://localhost:3000/api/enc-tiles/1/0/0.png | head -6
# z=20 — expect x-cache: EMPTY
curl -sSI http://localhost:3000/api/enc-tiles/20/0/0.png | head -6
```

- [ ] **Step 3: Fresh-profile browser check**

In an incognito window, navigate to `http://localhost:3000/chart`. Confirm:

- The chart loads with the plain OSM basemap.
- A `NOAA` toggle button is visible top-right of the map (outlined; not pressed).
- No `<SeamarkLayer>` button or popover is present.

- [ ] **Step 4: Toggle on**

Click the NOAA button. Confirm:

- The button fills (light background, dark text).
- The OSM basemap is replaced by the NOAA chart rendering.
- Newport entrance shows depth soundings, lit-buoy symbols with light characteristic labels, and harbour limits.

- [ ] **Step 5: Persistence**

Refresh the page. Confirm the NOAA layer is still on after reload (state survives via `chart:layers`).

- [ ] **Step 6: Toggle off**

Click the NOAA button again. Confirm the OSM basemap returns and the button switches to its outlined state.

- [ ] **Step 7: Cache populated**

```bash
find ~/.g5000-router/enc-cache -name '*.png' | head -5
ls -la ~/.g5000-router/enc-cache/15/ 2>/dev/null | head -10
```

Expect a tree of `{z}/{x}/{y}.png` files reflecting where the browser panned.

- [ ] **Step 8: Done — no further commit required**

The work is shippable from Task 4's commit. Stop here unless verification surfaced a bug.

---

## Self-review

**Spec coverage:**

- Same-origin tile proxy with disk cache → Task 1 ✓
- Cache root `~/.g5000-router/enc-cache/` → Task 1 ✓
- XYZ → NOAA z-2 translation → Task 1 ✓
- ArcGIS row/col order in upstream URL → Task 1 ✓
- Transparent 1×1 PNG with `x-cache: EMPTY` for z<2 and z>18 → Task 1 ✓
- 30-day cache window, best-effort write → Task 1 ✓
- MapLibre raster source + layer with attribution → Task 2 ✓
- Layer below AIS / route / range-rings (via `__above-wind__` sentinel) → Task 2 ✓
- `isStyleLoaded`-free pattern + `try/catch` + `styledata` retry → Task 2 ✓
- Visibility flipped via `setLayoutProperty` → Task 2 ✓
- Single toggle button (no popover) → Task 3 ✓
- `LayersState = { enc: boolean }` → Task 3 ✓
- Drop `<SeamarkLayer/>` mount and import → Task 4 ✓
- localStorage migration handled implicitly (read `parsed.enc ?? false`) → Task 4 ✓
- Mount `<EncLayer/>` keyed off `layers.enc` → Task 4 ✓
- Vitest coverage of all proxy branches → Task 1 ✓
- Manual verification list from spec → Task 5 ✓

**Placeholder scan:** none — every step includes either the actual code or the exact command + expected output.

**Type consistency:**

- `LayersState` is defined in Task 3 (`{ enc: boolean }`) and used in Task 4. The Task 4 initializer reads `parsed.enc` (matching) and writes `{ enc }` (matching).
- `EncLayer` props in Task 2 (`{ map: maplibregl.Map | null; visible: boolean }`) match the call site in Task 4 (`<EncLayer map={mapInstance} visible={layers.enc} />`).
- `SOURCE_ID` / `LAYER_ID` in Task 2 are local to `EncLayer.tsx`; the chart page never names them.
- `MIN_Z=2`, `MAX_Z=18` in Task 1 align with `minzoom: 2, maxzoom: 18` in Task 2 — MapLibre won't request outside the supported band, AND the proxy returns transparent if anything slips through (safe in both directions).
