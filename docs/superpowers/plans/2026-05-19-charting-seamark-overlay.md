# OpenSeaMap seamark overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render OpenSeaMap seamark raster tiles on `/chart` as a toggleable overlay, served via a same-origin tile proxy that caches PNGs to disk.

**Architecture:** Same-origin Next.js route proxies `tiles.openseamap.org`, caching to `~/.g5000-router/seamark-cache/{z}/{x}/{y}.png` (mirrors the existing OSM proxy at `/api/tiles`). A React layer component manages the MapLibre source/layer. A chart-page popover toggles visibility; state persisted in `localStorage`.

**Tech Stack:** Next.js 16 App Router · React 19 · MapLibre GL JS · TypeScript (strict, `noUncheckedIndexedAccess`) · Vitest.

**Spec:** `docs/superpowers/specs/2026-05-19-charting-seamark-overlay-design.md`

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.ts` | Same-origin OpenSeaMap tile proxy with disk cache | new |
| `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.test.ts` | Vitest covering cache miss, hit, 404 passthrough, bad coords | new |
| `packages/web/src/components/SeamarkLayer.tsx` | MapLibre source + raster layer; visibility prop | new |
| `packages/web/src/app/chart/LayersControl.tsx` | Top-right popover with the Seamarks toggle | new |
| `packages/web/src/app/chart/page.tsx` | Mount `<SeamarkLayer/>` + `<LayersControl/>`; localStorage state | modified |

The seamark **layer component** lives under `packages/web/src/components/` to match the pattern of `GulfStreamLayer`, `WindOverlay`, `CurrentOverlay`, `LaylinesLayer`, etc. — those are reusable layer wrappers.

The **LayersControl popover** lives under `packages/web/src/app/chart/` because it is chart-page UI, not a reusable component.

---

## Task 1: Tile proxy route (`/api/seamark-tiles/[z]/[x]/[y]`)

**Files:**
- Create: `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.ts`
- Test: `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.test.ts`

Mirrors the production OSM proxy at `packages/web/src/app/api/tiles/[z]/[x]/[y]/route.ts` — same headers, same 30-day cache window, same best-effort write, same coord validation regex. The only differences are the upstream URL and cache subdirectory.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TMP_ROOT: string;
let GET: (req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) => Promise<Response>;

function makeCtx(z: string, x: string, y: string) {
  return { params: Promise.resolve({ z, x, y }) };
}

beforeEach(async () => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), 'g5000-seamark-'));
  process.env.G5000_ROUTER_ROOT = TMP_ROOT;
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
  delete process.env.G5000_ROUTER_ROOT;
});

describe('seamark-tiles route', () => {
  it('fetches from upstream on a cache miss and writes the tile to disk', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(pngBytes, { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    const res = await GET(new Request('http://x/api/seamark-tiles/12/1234/5678'), makeCtx('12', '1234', '5678'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const upstreamUrl = fetchSpy.mock.calls[0]?.[0];
    expect(String(upstreamUrl)).toBe('https://tiles.openseamap.org/seamark/12/1234/5678.png');

    // wait a tick for the best-effort disk write to flush
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'seamark-cache', '12', '1234', '5678.png'))).toBe(true);
  });

  it('serves from disk on a cache hit without calling fetch', async () => {
    const tileDir = join(TMP_ROOT, 'seamark-cache', '12', '1234');
    mkdirSync(tileDir, { recursive: true });
    writeFileSync(join(tileDir, '5678.png'), Buffer.from([1, 2, 3]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await GET(new Request('http://x/api/seamark-tiles/12/1234/5678'), makeCtx('12', '1234', '5678'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([1, 2, 3]);
  });

  it('does not cache when upstream returns 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const res = await GET(new Request('http://x/api/seamark-tiles/12/1234/5678'), makeCtx('12', '1234', '5678'));
    expect(res.status).toBe(404);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(join(TMP_ROOT, 'seamark-cache', '12', '1234', '5678.png'))).toBe(false);
  });

  it('rejects bad tile coords', async () => {
    const res = await GET(new Request('http://x/api/seamark-tiles/abc/1/1'), makeCtx('abc', '1', '1'));
    expect(res.status).toBe(400);
  });

  it('accepts a .png suffix on y', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([0x89]), { status: 200 }));
    const res = await GET(new Request('http://x/api/seamark-tiles/12/1234/5678.png'), makeCtx('12', '1234', '5678.png'));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx vitest run packages/web/src/app/api/seamark-tiles/\[z\]/\[x\]/\[y\]/route.test.ts
```

Expected: fail with `Cannot find module './route'` or similar — the route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `packages/web/src/app/api/seamark-tiles/[z]/[x]/[y]/route.ts`:

```ts
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT } from '../../../../../../lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * On-disk OpenSeaMap seamark tile cache.
 *
 * Mounted at /api/seamark-tiles/{z}/{x}/{y}(.png) so the chart's
 * maplibre source can point at a same-origin URL. On a miss we fetch
 * from `tiles.openseamap.org/seamark/{z}/{x}/{y}.png`, persist to disk,
 * and stream the response back. Subsequent requests for the same
 * (z,x,y) serve from disk and never hit the network.
 *
 * Cache location: `${G5000_ROUTER_ROOT}/seamark-cache/{z}/{x}/{y}.png`.
 * Defaults to `~/.g5000-router/seamark-cache`. Same root that already
 * holds tile-cache, grib-cache, etc.
 *
 * Mirrors the OSM proxy at /api/tiles. OpenSeaMap data is CC-BY-SA;
 * attribution is provided via the MapLibre source's `attribution`
 * property in `SeamarkLayer.tsx`.
 */

const SEAMARK_CACHE_ROOT = join(ROOT, 'seamark-cache');
const MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';

function tilePath(z: string, x: string, y: string): string {
  const yBase = y.replace(/\.png$/, '');
  return join(SEAMARK_CACHE_ROOT, z, x, `${yBase}.png`);
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
  z: string,
  x: string,
  y: string,
  diskPath: string,
): Promise<Response> {
  const yBase = y.replace(/\.png$/, '');
  const url = `https://tiles.openseamap.org/seamark/${z}/${x}/${yBase}.png`;
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
      /* serving the response is more important than caching */
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
  const path = tilePath(z, x, y);
  const fromDisk = await serveFromDisk(path);
  if (fromDisk) return fromDisk;
  return fetchAndCache(z, x, y, path);
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run packages/web/src/app/api/seamark-tiles/\[z\]/\[x\]/\[y\]/route.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 5: Run typecheck for the web package**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: no errors. (If the orchestrated `tsc -b` from the workspace root flags the pre-existing `apps/router` reference, ignore — that gotcha is documented in CLAUDE.md.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/seamark-tiles
git commit -m "feat(web): /api/seamark-tiles proxy with disk cache

Mirrors /api/tiles for OpenSeaMap. Caches PNGs under
~/.g5000-router/seamark-cache/{z}/{x}/{y}.png, 30-day max age,
best-effort writes. Sets the foundation for the seamark overlay
on /chart."
```

---

## Task 2: SeamarkLayer React component

**Files:**
- Create: `packages/web/src/components/SeamarkLayer.tsx`

Manages the MapLibre source and raster layer. Adds the layer once when `map` is available; flips visibility via `setLayoutProperty` when the `visible` prop changes. Drawn below the `__above-wind__` z-order sentinel so AIS, route, range rings, and laylines render on top of it.

This task has no automated test — same as `GulfStreamLayer`, `WindOverlay`, `CurrentOverlay`, etc. The component is a thin wrapper around MapLibre; manual chart verification covers it.

- [ ] **Step 1: Create the component**

```tsx
'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'osm-seamark';
const LAYER_ID = 'osm-seamark-layer';

/**
 * OpenSeaMap seamark raster overlay. Renders buoys, lit aids, harbour
 * limits, anchorages, soundings, and similar nautical chart features
 * on top of the OSM basemap.
 *
 * Tiles come from the same-origin /api/seamark-tiles proxy so they're
 * cached on disk under ~/.g5000-router/seamark-cache and survive
 * offline use once warmed.
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by
 * Map.tsx, so wind / AIS / route / range-rings / laylines all sit
 * above the seamark layer.
 */
export function SeamarkLayer({
  map,
  visible,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
}) {
  useEffect(() => {
    if (!map) return;
    const ensure = (): void => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'raster',
          tiles: ['/api/seamark-tiles/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenSeaMap (CC-BY-SA)',
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
    };
    if (map.isStyleLoaded()) ensure();
    else map.once('load', ensure);
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
git add packages/web/src/components/SeamarkLayer.tsx
git commit -m "feat(web): SeamarkLayer — OpenSeaMap raster overlay

Adds the maplibre source + raster layer for /api/seamark-tiles and
manages visibility via the layout property. Sits beneath the
__above-wind__ z-order sentinel so AIS / route / range-rings render
on top."
```

---

## Task 3: LayersControl popover

**Files:**
- Create: `packages/web/src/app/chart/LayersControl.tsx`

A small button anchored top-right of the chart canvas. Click opens a popover with a vertical list of toggle rows. v1 has one row: Seamarks. Designed to add more rows later (ENC, ROI flag, etc.) without structural changes — the popover renders a list from a static config array inside the file.

No automated test — same convention as other chart-page UI bits.

- [ ] **Step 1: Create the component**

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';

export interface LayersState {
  seamarks: boolean;
}

const LAYERS: { key: keyof LayersState; label: string }[] = [
  { key: 'seamarks', label: 'Seamarks' },
];

/**
 * Top-right popover on /chart for toggling map overlay layers.
 *
 * Designed to grow: adding a new row is one entry in the LAYERS
 * array plus a key on LayersState. v1 ships with just Seamarks
 * (OpenSeaMap buoys / lights / harbour limits).
 *
 * The caller owns state and persistence (chart/page.tsx writes to
 * localStorage under `chart:layers`).
 */
export function LayersControl({
  state,
  onToggle,
}: {
  state: LayersState;
  onToggle: (key: keyof LayersState) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div
      ref={ref}
      className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1"
    >
      <button
        type="button"
        aria-label="Layers"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded bg-zinc-900/85 text-zinc-100 border border-zinc-700 hover:bg-zinc-800 flex items-center justify-center"
      >
        {/* Stacked-layers glyph */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </button>
      {open && (
        <div className="min-w-[140px] rounded bg-zinc-900/95 text-zinc-100 border border-zinc-700 shadow-lg p-2">
          {LAYERS.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-zinc-800 rounded"
            >
              <input
                type="checkbox"
                checked={state[key]}
                onChange={() => onToggle(key)}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/chart/LayersControl.tsx
git commit -m "feat(web): LayersControl popover for /chart

Top-right popover toggle that hosts overlay layer switches. v1 has
one row (Seamarks); structure is set up to add ENC / ROI / etc.
rows later without restructuring. Caller owns state."
```

---

## Task 4: Wire into `/chart`

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`

Add localStorage-backed state for the layers object, mount `<SeamarkLayer/>` keyed off the map instance, and mount `<LayersControl/>` as a sibling of the `<Map/>` inside a positioned wrapper.

- [ ] **Step 1: Add imports near the existing component imports in `page.tsx`**

Add these two lines alongside the other component imports near the top of the file (after `import { CogExtension } from '../../components/CogExtension';`):

```ts
import { SeamarkLayer } from '../../components/SeamarkLayer';
import { LayersControl, type LayersState } from './LayersControl';
```

- [ ] **Step 2: Add localStorage state inside `ChartPage`**

Insert this block alongside the other `useState` declarations near the top of the `ChartPage` component (where `mapInstance` and the other camera/settings hooks already live). Use a synchronous initializer so SSR returns the default and hydration matches.

```tsx
const [layers, setLayers] = useState<LayersState>(() => {
  if (typeof window === 'undefined') return { seamarks: true };
  try {
    const raw = window.localStorage.getItem('chart:layers');
    if (!raw) return { seamarks: true };
    const parsed = JSON.parse(raw) as Partial<LayersState>;
    return { seamarks: parsed.seamarks ?? true };
  } catch {
    return { seamarks: true };
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

- [ ] **Step 3: Mount the layer and control around the `<Map/>` element**

Locate the existing `<Map ... />` element (around line 417 in the current file). Wrap it in a relative-positioned div so the popover can be absolute-positioned inside, and mount the layer + control:

Before:

```tsx
<Map
  center={...}
  zoom={...}
  onClick={onMapClick}
  onLoad={(m) => {
    setMapInstance(m);
    // ...existing handlers
  }}
/>
```

After:

```tsx
<div className="relative w-full h-full">
  <Map
    center={...}
    zoom={...}
    onClick={onMapClick}
    onLoad={(m) => {
      setMapInstance(m);
      // ...existing handlers (unchanged)
    }}
  />
  <SeamarkLayer map={mapInstance} visible={layers.seamarks} />
  <LayersControl
    state={layers}
    onToggle={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
  />
</div>
```

Do NOT change the existing `<Map/>` props. If the `<Map/>` is already inside a relative-positioned wrapper, reuse it rather than nesting another.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. No new tests beyond Task 1's; we're confirming nothing else broke.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): mount seamark overlay + layers control on /chart

Wires SeamarkLayer through a chart:layers localStorage object,
defaults to on. LayersControl popover sits top-right; click to
toggle. Closes the operational gap left by coastline-only chart."
```

---

## Task 5: Manual verification

**Files:**
- Modify: none.

End-to-end smoke before declaring this done. None of these need automation — they're the kinds of checks the spec lists as Manual.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev --workspace @g5000/autopilot-server
```

This launches the autopilot-server on `:3000` with Next.js mounted; the chart is at `http://localhost:3000/chart`.

- [ ] **Step 2: Fresh-profile check**

In an incognito window (or after clearing `localStorage` for `localhost:3000`), load `/chart`. Confirm seamark symbols are visible without any toggling. Pan/zoom to Newport, RI (zoom 13+) to see a dense cluster of lit buoys and harbour limits.

- [ ] **Step 3: Toggle + persistence check**

Click the layers button (top-right of the map). Uncheck Seamarks. Confirm symbols disappear. Refresh the page. Confirm they remain hidden. Toggle back on. Confirm they reappear and survive another refresh.

- [ ] **Step 4: Cache check**

Browse a few different areas. Then list `~/.g5000-router/seamark-cache/`:

```bash
find ~/.g5000-router/seamark-cache -name '*.png' | head -20
```

Expect a tree of `{z}/{x}/{y}.png` files reflecting what you panned over.

- [ ] **Step 5: Z-order check**

Pan to an area with AIS targets. Confirm AIS triangles draw above seamark symbols (not occluded). If a route or range-rings are visible, they should also draw on top.

- [ ] **Step 6: Offline check (optional but valuable)**

Disable your wifi. Reload `/chart`. The basemap and previously-cached seamarks should still render. New tiles for areas you haven't browsed will fail silently (transparent).

- [ ] **Step 7: Done — no further commit required**

The work is shippable from Task 4's commit. Stop here unless verification surfaced a bug.

---

## Self-review

**Spec coverage:**

- Same-origin tile proxy with disk cache → Task 1 ✓
- Cache root `~/.g5000-router/seamark-cache/` → Task 1 ✓
- Models existing `/api/tiles` proxy → Task 1 ✓
- MapLibre raster source/layer with attribution → Task 2 ✓
- Layer below AIS / route / range-rings, above coastline → Task 2 (uses `__above-wind__` sentinel) ✓
- Visibility flipped via `setLayoutProperty` → Task 2 ✓
- Layers popover anchored top-right → Task 3 ✓
- One row (Seamarks), designed to extend → Task 3 ✓
- localStorage key `chart:layers`, object shape → Task 4 ✓
- Default to seamarks on for new installs → Task 4 ✓
- Vitest covering miss / hit / 404 / bad coords → Task 1 ✓
- Manual verification list from spec → Task 5 ✓

**Placeholder scan:** none — every step includes the actual code or command.

**Type consistency:**

- `LayersState` is defined in Task 3's component file and imported in Task 4. Property name `seamarks` is consistent.
- `keyof LayersState` is the same type referenced in both LayersControl props and the chart page's `onToggle`.
- `SOURCE_ID` / `LAYER_ID` are local to `SeamarkLayer.tsx` and don't leak — the chart page never names the MapLibre ids directly.
