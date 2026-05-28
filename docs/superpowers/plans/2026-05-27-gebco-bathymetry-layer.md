# GEBCO Bathymetry Contour Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable depth-contour overlay to `/chart`, generated server-side from GMRT (GEBCO-based) bathymetry and cached on disk.

**Architecture:** A server route fetches a GMRT GridServer `esriascii` grid for a snapped viewport bbox, parses it (pure JS, no new deps), runs `d3-contour` (already a dependency) at fixed depth thresholds, and returns GeoJSON `MultiLineString` features carrying a `depth` property. Results cache to `~/.g5000-router/bathy-cache/` keyed by bbox+resolution — bathymetry is static, so the cache is effectively permanent. A client `BathyLayer` component requests contours for the current viewport (debounced) and renders them as MapLibre line + symbol layers, toggled from the existing layers popover.

**Tech Stack:** Next.js App Router route handlers (Node runtime), `d3-contour@4`, MapLibre GL, GMRT GridServer REST API, on-disk cache under `G5000_ROUTER_ROOT`.

---

## File Structure

- `packages/web/src/lib/bathy/esriascii.ts` (new) — parse an ESRI ASCII grid string into `{ ncols, nrows, xll, yll, cellsize, nodata, values: Float64Array }`.
- `packages/web/src/lib/bathy/esriascii.test.ts` (new) — unit test for the parser.
- `packages/web/src/lib/bathy/contours.ts` (new) — `depthContours(grid, thresholds)` → GeoJSON FeatureCollection of `MultiLineString` with `{ depth }` props; pure d3-contour over the grid.
- `packages/web/src/lib/bathy/contours.test.ts` (new) — unit test on a synthetic grid.
- `packages/web/src/lib/bathy/bbox.ts` (new) — `snapBbox` + `cacheKey` + `gmrtUrl` helpers (deterministic, network-free).
- `packages/web/src/lib/bathy/bbox.test.ts` (new) — unit test for snapping + cache key.
- `packages/web/src/app/api/bathy/contours/route.ts` (new) — GET route: snap bbox, serve cached GeoJSON or fetch GMRT → parse → contour → cache → return.
- `packages/web/src/components/BathyLayer.tsx` (new) — client overlay: fetch contours for viewport, render line + label layers.
- `packages/web/src/app/chart/LayersControl.tsx` (modify) — add a "Depth (GEBCO)" toggle row; widen the `onToggle` key union.
- `packages/web/src/app/chart/page.tsx` (modify) — add `bathy` to `LayersState` default + localStorage hydration; mount `<BathyLayer>`.

**Depth thresholds (metres, negative = below sea level):**
`[-10, -20, -50, -100, -200, -500, -1000, -2000, -3000, -4000, -5000]`

---

### Task 1: ESRI ASCII grid parser

**Files:**
- Create: `packages/web/src/lib/bathy/esriascii.ts`
- Test: `packages/web/src/lib/bathy/esriascii.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseEsriAscii } from './esriascii.js';

describe('parseEsriAscii', () => {
  it('parses header and row-major values (row 0 = north)', () => {
    const text = [
      'ncols 3',
      'nrows 2',
      'xllcorner -71.0',
      'yllcorner 40.0',
      'cellsize 0.5',
      'nodata_value -2147483648',
      '-10 -20 -30',
      '-2147483648 -50 -60',
    ].join('\n');
    const g = parseEsriAscii(text);
    expect(g.ncols).toBe(3);
    expect(g.nrows).toBe(2);
    expect(g.xll).toBeCloseTo(-71.0);
    expect(g.yll).toBeCloseTo(40.0);
    expect(g.cellsize).toBeCloseTo(0.5);
    // Row 0 is the northern row, stored first.
    expect(Array.from(g.values.slice(0, 3))).toEqual([-10, -20, -30]);
    // nodata is replaced with +9999 so it sits above all negative thresholds.
    expect(g.values[3]).toBe(9999);
    expect(g.values[4]).toBe(-50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/bathy/esriascii.test.ts`
Expected: FAIL — `parseEsriAscii` not found / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface EsriGrid {
  ncols: number;
  nrows: number;
  /** Lower-left corner longitude of the lower-left cell. */
  xll: number;
  /** Lower-left corner latitude of the lower-left cell. */
  yll: number;
  cellsize: number;
  /** Original nodata sentinel from the header. */
  nodata: number;
  /** Row-major, row 0 = northernmost. nodata replaced with +9999. */
  values: Float64Array;
}

/**
 * Parse an ESRI ASCII grid (as returned by GMRT GridServer
 * `format=esriascii`). The six header lines are case-insensitive
 * `key value` pairs; the body is `nrows` lines of `ncols` whitespace-
 * separated numbers, the first line being the northernmost row.
 *
 * nodata cells are replaced with +9999 (above every depth threshold) so
 * d3-contour, which can't represent NaN, never draws a spurious contour
 * across a data gap.
 */
export function parseEsriAscii(text: string): EsriGrid {
  const header: Record<string, number> = {};
  let bodyStart = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*([a-zA-Z_]+)\s+(-?[\d.eE+]+)\s*$/.exec(lines[i]!);
    if (!m) {
      bodyStart = i;
      break;
    }
    header[m[1]!.toLowerCase()] = Number(m[2]);
  }
  const ncols = header.ncols!;
  const nrows = header.nrows!;
  const nodata = header.nodata_value ?? -2147483648;
  const values = new Float64Array(ncols * nrows);
  let idx = 0;
  for (let r = 0; r < nrows; r++) {
    const row = lines[bodyStart + r]!.trim().split(/\s+/);
    for (let c = 0; c < ncols; c++) {
      const v = Number(row[c]);
      values[idx++] = v === nodata ? 9999 : v;
    }
  }
  return {
    ncols,
    nrows,
    xll: header.xllcorner!,
    yll: header.yllcorner!,
    cellsize: header.cellsize!,
    nodata,
    values,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/bathy/esriascii.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/bathy/esriascii.ts packages/web/src/lib/bathy/esriascii.test.ts
git commit -m "feat(web): ESRI ASCII grid parser for GMRT bathymetry"
```

---

### Task 2: Depth-contour generation

**Files:**
- Create: `packages/web/src/lib/bathy/contours.ts`
- Test: `packages/web/src/lib/bathy/contours.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { depthContours } from './contours.js';
import type { EsriGrid } from './esriascii.js';

describe('depthContours', () => {
  it('emits a MultiLineString feature per threshold that the field crosses', () => {
    // 4x4 grid sloping from -5 (shallow, north) to -120 (deep, south),
    // so the -10, -50, -100 contours all fall inside.
    const ncols = 4;
    const nrows = 4;
    const rows = [
      [-5, -5, -5, -5],
      [-40, -40, -40, -40],
      [-90, -90, -90, -90],
      [-120, -120, -120, -120],
    ];
    const values = new Float64Array(ncols * nrows);
    let i = 0;
    for (const row of rows) for (const v of row) values[i++] = v;
    const grid: EsriGrid = {
      ncols,
      nrows,
      xll: -71,
      yll: 40,
      cellsize: 1,
      nodata: -2147483648,
      values,
    };
    const fc = depthContours(grid, [-10, -50, -100, -200]);
    const depths = fc.features.map((f) => (f.properties as { depth: number }).depth).sort((a, b) => a - b);
    // -200 never reached (deepest is -120) → no feature for it.
    expect(depths).toEqual([10, 50, 100]);
    // Geometry is geographic: longitudes within the bbox, lats within [40,44].
    const f0 = fc.features[0]!;
    expect(f0.geometry.type).toBe('MultiLineString');
    const [lon, lat] = (f0.geometry as GeoJSON.MultiLineString).coordinates[0]![0]!;
    expect(lon).toBeGreaterThanOrEqual(-71);
    expect(lon).toBeLessThanOrEqual(-67);
    expect(lat).toBeGreaterThanOrEqual(40);
    expect(lat).toBeLessThanOrEqual(44);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/bathy/contours.test.ts`
Expected: FAIL — `depthContours` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { contours } from 'd3-contour';
import type { EsriGrid } from './esriascii.js';

/**
 * Generate depth contour lines from an ESRI grid.
 *
 * `thresholds` are signed elevations in metres (negative = below sea level),
 * e.g. -50 for the 50 m isobath. d3-contour treats the array row-major with
 * row 0 at the TOP; the grid is already north-first, so no flip is needed.
 * Grid coordinate (gx, gy) maps to geographic coordinates by uniform spacing:
 *   lon = xll + gx*cellsize
 *   lat = yll + (nrows - gy)*cellsize   (gy=0 is the north edge)
 *
 * Each output feature is a MultiLineString with `depth` = the positive depth
 * in metres (|threshold|).
 */
export function depthContours(grid: EsriGrid, thresholds: number[]): GeoJSON.FeatureCollection {
  const { ncols: W, nrows: H, xll, yll, cellsize, values } = grid;
  const gen = contours().size([W, H]).thresholds(thresholds)(Array.from(values));
  const toLonLat = (pt: number[]): number[] => {
    const gx = pt[0] ?? 0;
    const gy = pt[1] ?? 0;
    return [xll + gx * cellsize, yll + (H - gy) * cellsize];
  };
  const features: GeoJSON.Feature[] = [];
  for (const c of gen) {
    // d3 emits closed rings (polygons of "value and above"). For isobaths we
    // render their boundaries as lines. Skip empty bands.
    const lines: number[][][] = [];
    for (const poly of c.coordinates as number[][][][]) {
      for (const ring of poly) lines.push(ring.map(toLonLat));
    }
    if (lines.length === 0) continue;
    features.push({
      type: 'Feature',
      properties: { depth: Math.abs(c.value) },
      geometry: { type: 'MultiLineString', coordinates: lines },
    });
  }
  return { type: 'FeatureCollection', features };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/bathy/contours.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/bathy/contours.ts packages/web/src/lib/bathy/contours.test.ts
git commit -m "feat(web): depth-contour generation from bathymetry grid"
```

---

### Task 3: bbox snapping, cache key, GMRT URL helpers

**Files:**
- Create: `packages/web/src/lib/bathy/bbox.ts`
- Test: `packages/web/src/lib/bathy/bbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { snapBbox, cacheKey, gmrtUrl, type Bbox } from './bbox.js';

describe('bathy bbox helpers', () => {
  it('snaps outward to whole degrees and clamps span', () => {
    const snapped = snapBbox({ latMin: 40.3, latMax: 41.7, lonMin: -71.4, lonMax: -70.2 });
    expect(snapped).toEqual({ latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 });
  });

  it('clamps an over-large bbox to MAX_SPAN_DEG around its centre', () => {
    const snapped = snapBbox({ latMin: 0, latMax: 50, lonMin: -100, lonMax: -10 });
    expect(snapped.latMax - snapped.latMin).toBeLessThanOrEqual(20);
    expect(snapped.lonMax - snapped.lonMin).toBeLessThanOrEqual(20);
  });

  it('cacheKey is stable and resolution-aware', () => {
    const b: Bbox = { latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 };
    expect(cacheKey(b, 'low')).toBe('40_42_-72_-70_low');
    expect(cacheKey(b, 'high')).toBe('40_42_-72_-70_high');
  });

  it('gmrtUrl carries bbox + format + resolution', () => {
    const u = new URL(gmrtUrl({ latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 }, 'low'));
    expect(u.hostname).toBe('www.gmrt.org');
    expect(u.searchParams.get('format')).toBe('esriascii');
    expect(u.searchParams.get('minlatitude')).toBe('40');
    expect(u.searchParams.get('maxlongitude')).toBe('-70');
    expect(u.searchParams.get('resolution')).toBe('low');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/bathy/bbox.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export type BathyResolution = 'low' | 'medium' | 'high';

/** Largest bbox edge (deg) we'll ever request from GMRT, to bound grid size. */
export const MAX_SPAN_DEG = 20;

/**
 * Snap a viewport bbox outward to whole degrees so nearby pans reuse the same
 * cache entry, then clamp each span to MAX_SPAN_DEG about its centre so a
 * zoomed-way-out request can't ask GMRT for a continent-sized grid.
 */
export function snapBbox(b: Bbox): Bbox {
  let latMin = Math.floor(b.latMin);
  let latMax = Math.ceil(b.latMax);
  let lonMin = Math.floor(b.lonMin);
  let lonMax = Math.ceil(b.lonMax);
  if (latMax - latMin > MAX_SPAN_DEG) {
    const c = (latMin + latMax) / 2;
    latMin = Math.floor(c - MAX_SPAN_DEG / 2);
    latMax = latMin + MAX_SPAN_DEG;
  }
  if (lonMax - lonMin > MAX_SPAN_DEG) {
    const c = (lonMin + lonMax) / 2;
    lonMin = Math.floor(c - MAX_SPAN_DEG / 2);
    lonMax = lonMin + MAX_SPAN_DEG;
  }
  return { latMin, latMax, lonMin, lonMax };
}

export function cacheKey(b: Bbox, res: BathyResolution): string {
  return `${b.latMin}_${b.latMax}_${b.lonMin}_${b.lonMax}_${res}`;
}

export function gmrtUrl(b: Bbox, res: BathyResolution): string {
  const u = new URL('https://www.gmrt.org/services/GridServer');
  u.searchParams.set('minlatitude', String(b.latMin));
  u.searchParams.set('maxlatitude', String(b.latMax));
  u.searchParams.set('minlongitude', String(b.lonMin));
  u.searchParams.set('maxlongitude', String(b.lonMax));
  u.searchParams.set('format', 'esriascii');
  u.searchParams.set('resolution', res);
  return u.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/bathy/bbox.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/bathy/bbox.ts packages/web/src/lib/bathy/bbox.test.ts
git commit -m "feat(web): bbox snap + cache-key + GMRT URL helpers for bathymetry"
```

---

### Task 4: `/api/bathy/contours` route with disk cache

**Files:**
- Create: `packages/web/src/app/api/bathy/contours/route.ts`

This task is thin wiring over the three tested libs; the cache layout mirrors the existing sat-tiles cache (`packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.ts`). No new unit test — the parsing, contouring, and bbox logic are already covered. Verify by manual curl in Step 3.

- [ ] **Step 1: Write the route**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../../../../lib/paths';
import { parseEsriAscii } from '../../../../lib/bathy/esriascii';
import { depthContours } from '../../../../lib/bathy/contours';
import { snapBbox, cacheKey, gmrtUrl, type BathyResolution, type Bbox } from '../../../../lib/bathy/bbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BATHY_CACHE = join(ROOT, 'bathy-cache');
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';

// Signed elevations in metres (negative = below sea level).
const THRESHOLDS = [-10, -20, -50, -100, -200, -500, -1000, -2000, -3000, -4000, -5000];

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const latMin = num(sp.get('latMin'));
  const latMax = num(sp.get('latMax'));
  const lonMin = num(sp.get('lonMin'));
  const lonMax = num(sp.get('lonMax'));
  if (latMin == null || latMax == null || lonMin == null || lonMax == null) {
    return Response.json({ ok: false, error: { message: 'bbox required' } }, { status: 400 });
  }
  const resRaw = sp.get('res');
  const res: BathyResolution = resRaw === 'high' || resRaw === 'medium' ? resRaw : 'low';
  const bbox: Bbox = snapBbox({ latMin, latMax, lonMin, lonMax });
  const key = cacheKey(bbox, res);
  const file = join(BATHY_CACHE, `${key}.geojson`);

  // Serve from disk if present (bathymetry is static → no TTL).
  try {
    const cached = await readFile(file, 'utf8');
    return new Response(cached, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-cache': 'HIT' },
    });
  } catch {
    /* miss — fetch + build below */
  }

  let text: string;
  try {
    const r = await fetch(gmrtUrl(bbox, res), { headers: { 'user-agent': USER_AGENT } });
    if (!r.ok) {
      return Response.json(
        { ok: false, error: { message: `GMRT ${r.status}` } },
        { status: 502 },
      );
    }
    text = await r.text();
  } catch (e) {
    return Response.json({ ok: false, error: { message: String(e) } }, { status: 502 });
  }

  const grid = parseEsriAscii(text);
  const fc = depthContours(grid, THRESHOLDS);
  const body = JSON.stringify(fc);
  // Best-effort cache write; never block the response.
  void mkdir(BATHY_CACHE, { recursive: true })
    .then(() => writeFile(file, body))
    .catch(() => {});
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-cache': 'MISS' },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Manual smoke test against the running dev server**

Run:
```bash
curl -s "http://localhost:3000/api/bathy/contours?latMin=40&latMax=41&lonMin=-71&lonMax=-70&res=low" \
  -w "\nx-cache via headers above; feature count:\n" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['features']), 'features'); print(sorted({f['properties']['depth'] for f in d['features']}))"
```
Expected: a non-zero feature count and a sorted list of depths drawn from the threshold set (e.g. `[10, 20, 50, 100, ...]`). A second identical request should be served from disk (`x-cache: HIT`) — confirm with `curl -sD - ... -o /dev/null | grep -i x-cache`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/api/bathy/contours/route.ts
git commit -m "feat(web): /api/bathy/contours GMRT fetch + contour + disk cache"
```

---

### Task 5: `BathyLayer` client component

**Files:**
- Create: `packages/web/src/components/BathyLayer.tsx`

No unit test (MapLibre side-effects; verified in the browser in Task 7). Mirrors the effect-driven attach/detach + `styledata` retry pattern from `TrackOverlay.tsx` / `EncLayer.tsx`.

- [ ] **Step 1: Write the component**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';

const SOURCE_ID = 'bathy-contours';
const LINE_LAYER_ID = 'bathy-contour-line';
const LABEL_LAYER_ID = 'bathy-contour-label';

/** Debounce so a flurry of moveend events triggers one fetch. */
const DEBOUNCE_MS = 600;

function resForZoom(zoom: number): 'low' | 'medium' | 'high' {
  if (zoom >= 9) return 'high';
  if (zoom >= 6) return 'medium';
  return 'low';
}

/**
 * Depth-contour overlay sourced from /api/bathy/contours (GMRT/GEBCO). On
 * mount and on every (debounced) map move it requests contours for the
 * current viewport bbox and replaces the source data. Lines are blue,
 * thicker/darker for the major isobaths (200 m shelf edge and deeper);
 * labels show the positive depth in metres.
 *
 * NOT for navigation — GMRT/GEBCO is an interpolated ~450 m grid that smooths
 * out shoals and isolated dangers. Situational awareness only.
 */
export function BathyLayer({ map, visible }: { map: maplibregl.Map | null; visible: boolean }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!map) return;

    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }
        if (!map.getLayer(LINE_LAYER_ID)) {
          map.addLayer({
            id: LINE_LAYER_ID,
            type: 'line',
            source: SOURCE_ID,
            layout: { 'line-join': 'round' },
            paint: {
              'line-color': '#2563eb',
              // Major isobaths (>=200 m) thicker than the shallow set.
              'line-width': ['case', ['>=', ['get', 'depth'], 200], 1.6, 0.8],
              'line-opacity': ['case', ['>=', ['get', 'depth'], 200], 0.85, 0.5],
            },
          });
        }
        if (!map.getLayer(LABEL_LAYER_ID)) {
          map.addLayer({
            id: LABEL_LAYER_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
              'symbol-placement': 'line',
              'text-field': ['concat', ['to-string', ['get', 'depth']], ' m'],
              'text-size': 10,
              'symbol-spacing': 250,
            },
            paint: {
              'text-color': '#1e3a8a',
              'text-halo-color': '#e0f2fe',
              'text-halo-width': 1.2,
            },
          });
        }
        const vis = visible ? 'visible' : 'none';
        for (const id of [LINE_LAYER_ID, LABEL_LAYER_ID]) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
        }
      } catch {
        /* style not ready — styledata retry covers it */
      }
    };

    const refresh = (): void => {
      if (!visible) return;
      const b = map.getBounds();
      const params = new URLSearchParams({
        latMin: String(b.getSouth()),
        latMax: String(b.getNorth()),
        lonMin: String(b.getWest()),
        lonMax: String(b.getEast()),
        res: resForZoom(map.getZoom()),
      });
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      void fetch(`/api/bathy/contours?${params}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((fc: GeoJSON.FeatureCollection) => {
          const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (src && fc?.type === 'FeatureCollection') src.setData(fc);
        })
        .catch(() => {
          /* aborted or network error — leave prior contours in place */
        });
    };

    const onMoveEnd = (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(refresh, DEBOUNCE_MS);
    };

    ensure();
    if (visible) refresh();
    map.on('styledata', ensure);
    map.on('moveend', onMoveEnd);

    return () => {
      map.off('styledata', ensure);
      map.off('moveend', onMoveEnd);
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      try {
        for (const id of [LABEL_LAYER_ID, LINE_LAYER_ID]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map torn down */
      }
    };
  }, [map, visible]);

  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/BathyLayer.tsx
git commit -m "feat(web): BathyLayer depth-contour overlay component"
```

---

### Task 6: Wire the toggle into the layers popover + chart page

**Files:**
- Modify: `packages/web/src/app/chart/LayersControl.tsx`
- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: Add `bathy` to `LayersState` and the toggle key union**

In `packages/web/src/app/chart/LayersControl.tsx`, add the field to the interface (after `buoys`):

```ts
  buoys: boolean;
  /** GEBCO/GMRT depth contours. Off by default. */
  bathy: boolean;
```

Widen the `onToggle` prop type (currently `'osm' | 'enc' | 'satellite' | 'buoys' | 'ais' | 'aisCog'`) to include `'bathy'`:

```ts
  onToggle: (key: 'osm' | 'enc' | 'satellite' | 'buoys' | 'bathy' | 'ais' | 'aisCog') => void;
```

Add a toggle row immediately after the Buoys row:

```tsx
          <Row label="Buoys" pressed={state.buoys} onClick={() => onToggle('buoys')} />
          <Row label="Depth (GEBCO)" pressed={state.bathy} onClick={() => onToggle('bathy')} />
```

Add `bathy` to the `onCount` tally:

```ts
  const onCount =
    (state.enc ? 1 : 0) +
    (state.satellite ? 1 : 0) +
    (state.buoys ? 1 : 0) +
    (state.bathy ? 1 : 0) +
    (state.model !== 'none' ? 1 : 0);
```

- [ ] **Step 2: Default + hydrate `bathy` in chart page**

In `packages/web/src/app/chart/page.tsx`, add `bathy: false` to the initial `useState<LayersState>` default (after `buoys: false,`):

```tsx
    buoys: false,
    bathy: false,
```

And in the localStorage hydration `setLayers({ ... })` block, add:

```tsx
      buoys: parsed.buoys ?? false,
      bathy: parsed.bathy ?? false,
```

- [ ] **Step 3: Mount `<BathyLayer>`**

Add the import near the other component imports in `packages/web/src/app/chart/page.tsx`:

```tsx
import { BathyLayer } from '../../components/BathyLayer';
```

Mount it just after `<EncBuoyLayer ... />` (a raster-ish basemap overlay; placing it before the annotation layers keeps depth contours beneath AIS/routes/waypoints):

```tsx
        <EncBuoyLayer map={mapInstance} visible={layers.buoys} />
        <BathyLayer map={mapInstance} visible={layers.bathy} />
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (If it fails with "Property 'bathy' is missing", a `LayersState` literal somewhere wasn't updated — the only two are the default and the hydration block in page.tsx; fix whichever the error names.)

- [ ] **Step 5: Lint**

Run: `npx prettier --write packages/web/src/app/chart/LayersControl.tsx packages/web/src/app/chart/page.tsx packages/web/src/components/BathyLayer.tsx`
Expected: files reformatted/clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/chart/LayersControl.tsx packages/web/src/app/chart/page.tsx
git commit -m "feat(web): wire Depth (GEBCO) toggle into chart layers"
```

---

### Task 7: Browser verification

**Files:** none (manual verification).

- [ ] **Step 1: Ensure a clean dev server is running**

Run (if not already up): `SKIP_BRIDGE=1 DEMO_MODE=1 npm run dev --workspace @g5000/app` and wait for `/chart` to return 200.

- [ ] **Step 2: Verify in the browser**

- Open `/chart`, open the layers popover, toggle **Depth (GEBCO)** on.
- Confirm blue depth-contour lines appear over water with `N m` labels, thicker for the ≥200 m isobaths.
- Pan/zoom to a new area; after ~0.6 s the contours refill for the new viewport.
- Toggle off → contours disappear. Reload → toggle state restored from `localStorage['chart:layers']`.
- Confirm contours render **beneath** AIS targets, routes, and waypoints.

- [ ] **Step 3: Confirm the disk cache populated**

Run: `ls "${G5000_ROUTER_ROOT:-$HOME/.g5000-router}/bathy-cache/"`
Expected: one or more `*.geojson` files named by the snapped bbox + resolution.

---

## Self-Review

**Spec coverage:** GMRT fetch (Task 4) ✓; ESRI ASCII parse (Task 1) ✓; contour generation reusing d3-contour (Task 2) ✓; disk cache, static/no-TTL (Task 4) ✓; toggleable layer in popover + localStorage (Task 6) ✓; renders on /chart beneath annotations (Task 6 Step 3) ✓; browser verification (Task 7) ✓. The "not for navigation" caveat is documented in the `BathyLayer` docstring (Task 5).

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type consistency:** `EsriGrid` defined in Task 1 is imported in Tasks 2 & 4. `Bbox`/`BathyResolution`/`snapBbox`/`cacheKey`/`gmrtUrl` defined in Task 3, consumed in Task 4. `depthContours` (Task 2) and `parseEsriAscii` (Task 1) consumed in Task 4. `BathyLayer({ map, visible })` defined in Task 5, mounted in Task 6 with matching props. `LayersState.bathy` added in Task 6 Step 1 and consumed in Steps 2–3. Threshold list is identical in route (Task 4) and referenced by the same depth semantics in the component labels. ✓
