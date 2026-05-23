# NOAA vector charts on /chart — v1 (buoys) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire NOAA's online vector ENC services into `/chart` as a togglable buoy layer, alongside the existing NOAA raster overlay.

**Architecture:** A same-origin proxy at `/api/enc-features` queries the four buoy feature layers on NOAA's `encdirect/enc_coastal` ArcGIS MapServer in parallel, merges the GeoJSON results, normalises the S-57 `COLOUR` attribute into a numeric `colourCode`, and serves the result with a small in-memory cache. A new `<EncBuoyLayer/>` MapLibre component watches the map's `moveend` events (debounced, zoom-gated), fetches the current viewport's buoys, and renders coloured circles via a `match` paint expression on `colourCode`. The existing single-button `LayersControl` is rebuilt as a popover with two checkboxes ("NOAA chart" and "Buoys") per the CLAUDE.md guidance.

**Tech Stack:** Next.js 16 App Router route handler · MapLibre GL JS · TypeScript (strict) · Vitest with `vi.spyOn(globalThis, 'fetch')` pattern · Tailwind 4 for the popover.

---

## Background

This plan implements **Path A** from `docs/ops/noaa-vector-charts.md`, scoped to a single feature class (buoys) for v1. The doc describes the verified ArcGIS query shape and the four buoy sub-layers in the Coastal band. The accompanying design exploration in `docs/design/waypoints-routes-feature-notes.md` is unrelated — do not conflate.

Verified facts the plan depends on:

- Service root: `https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer`.
- Buoy feature layer ids in Coastal band:
  - `4` = `Coastal.Buoy_Isolated_Danger_point`
  - `5` = `Coastal.Buoy_Lateral_point`
  - `6` = `Coastal.Buoy_Safe_Water_point`
  - `7` = `Coastal.Buoy_Special_Purpose_General_point`
- Query shape (URL-encoded GET): `/{layerId}/query?where=1=1&geometry={lonMin},{latMin},{lonMax},{latMax}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=1000&f=geojson`.
- Response is a GeoJSON `FeatureCollection` with WGS84 geometry. `properties` includes S-57 attributes — for buoys: `OBJL`, `BOYSHP`, `COLOUR`, `COLPAT`, `CONRAD`, `MARSYS`, `NATCON`, `OBJNAM`, `VERACC`, `VERLEN`, `INFORM`. The `COLOUR` value can be a single S-57 colour code (e.g. `"3"`) or a comma-separated list (e.g. `"3,1,3"`). S-57 codes: 1=white, 2=black, 3=red, 4=green, 5=blue, 6=yellow, 7=grey, 8=brown, 9=amber, 10=violet, 11=orange, 12=magenta, 13=pink.
- The five usage bands have separate MapServers (`enc_overview`/`enc_general`/`enc_coastal`/`enc_approach`/`enc_harbour`/`enc_berthing`); v1 uses **only** `enc_coastal`. Band-by-zoom switching is deferred.

Verified non-goals for v1:

- No click-to-identify popup.
- No band-by-zoom switching (Coastal only).
- No disk cache; in-memory only (Map keyed by `${class}:${bboxKey}`, 5-minute TTL).
- No additional feature classes — buoys only. Lights, depth contours, restricted areas land in follow-up plans.
- No replacement of the existing raster `<EncLayer/>` — both overlays remain independently toggleable.

## File structure

| File                                                  | Action | Responsibility                                                                                                                                                                                                   |
| ----------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/enc-features-bbox.ts`           | create | `parseBbox(raw)`, `quantizeBbox(b)`, `bboxKey(b)` — pure helpers for parsing the `?bbox=` query string and producing a stable cache key.                                                                         |
| `packages/web/src/lib/enc-features-bbox.test.ts`      | create | Vitest unit tests for the parsing/quantising helpers.                                                                                                                                                            |
| `packages/web/src/lib/enc-colours.ts`                 | create | `parsePrimaryColour(raw)` — extracts the leading numeric token from an S-57 COLOUR string, returns 0 if absent/invalid.                                                                                          |
| `packages/web/src/lib/enc-colours.test.ts`            | create | Vitest unit tests for COLOUR parsing.                                                                                                                                                                            |
| `packages/web/src/app/api/enc-features/route.ts`      | create | The GET route handler: validates `class` + `bbox`, fans out to the four Coastal buoy layers in parallel, merges features, attaches `colourCode`, returns a `FeatureCollection`. In-memory cache.                 |
| `packages/web/src/app/api/enc-features/route.test.ts` | create | Vitest covering: bad params (400), happy path (200 with merged features), cache hit (no upstream fetch), upstream 5xx (502).                                                                                     |
| `packages/web/src/components/EncBuoyLayer.tsx`        | create | MapLibre source/layer pair. Watches `moveend`, debounces 250 ms, zoom-gates ≥ 9, fetches `/api/enc-features?class=buoys&bbox=...`, updates the GeoJSON source. Paint expression colours circles by `colourCode`. |
| `packages/web/src/app/chart/LayersControl.tsx`        | modify | Rebuild as a popover ("Layers" button + panel with two checkbox rows: NOAA chart, Buoys). `LayersState` becomes `{ enc: boolean; buoys: boolean }`.                                                              |
| `packages/web/src/app/chart/page.tsx`                 | modify | Add `buoys` to `LayersState` shape, update the `chart:layers` localStorage migration, mount `<EncBuoyLayer map={mapInstance} visible={layers.buoys}/>` next to `<EncLayer/>`.                                    |

## Tasks

### Task 1: bbox parser + cache-key helpers

**Files:**

- Create: `packages/web/src/lib/enc-features-bbox.ts`
- Test: `packages/web/src/lib/enc-features-bbox.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/src/lib/enc-features-bbox.test.ts
import { describe, it, expect } from 'vitest';
import { parseBbox, quantizeBbox, bboxKey } from './enc-features-bbox';

describe('parseBbox', () => {
  it('parses a comma-separated lonMin,latMin,lonMax,latMax string', () => {
    expect(parseBbox('-71.5,41.3,-71.2,41.6')).toEqual({
      lonMin: -71.5,
      latMin: 41.3,
      lonMax: -71.2,
      latMax: 41.6,
    });
  });

  it('rejects malformed bboxes', () => {
    expect(parseBbox('')).toBeNull();
    expect(parseBbox('1,2,3')).toBeNull();
    expect(parseBbox('a,b,c,d')).toBeNull();
    expect(parseBbox('-71.5,41.3,-71.2,41.6,extra')).toBeNull();
  });

  it('rejects out-of-range or inverted bboxes', () => {
    // lonMin > lonMax
    expect(parseBbox('1,0,-1,1')).toBeNull();
    // latMin > latMax
    expect(parseBbox('-1,2,1,1')).toBeNull();
    // out of range
    expect(parseBbox('-181,0,1,1')).toBeNull();
    expect(parseBbox('0,91,1,92')).toBeNull();
  });

  it('rejects bboxes wider than 5° (guard against runaway queries)', () => {
    expect(parseBbox('-80,40,-70,42')).toBeNull(); // 10° wide
    expect(parseBbox('-80,40,-79,46')).toBeNull(); // 6° tall
    expect(parseBbox('-80,40,-75.5,44.5')).not.toBeNull(); // 4.5°×4.5° OK
  });
});

describe('quantizeBbox', () => {
  it('rounds each edge to 0.1° to make a stable cache key', () => {
    const q = quantizeBbox({ lonMin: -71.523, latMin: 41.317, lonMax: -71.184, latMax: 41.612 });
    expect(q).toEqual({ lonMin: -71.6, latMin: 41.3, lonMax: -71.1, latMax: 41.7 });
  });
});

describe('bboxKey', () => {
  it('produces a stable string from a quantised bbox', () => {
    expect(bboxKey({ lonMin: -71.6, latMin: 41.3, lonMax: -71.1, latMax: 41.7 })).toBe(
      '-71.6,41.3,-71.1,41.7',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/web/src/lib/enc-features-bbox.test.ts`
Expected: FAIL with "Failed to resolve import './enc-features-bbox'".

- [ ] **Step 3: Implement the helpers**

```ts
// packages/web/src/lib/enc-features-bbox.ts
export interface Bbox {
  lonMin: number;
  latMin: number;
  lonMax: number;
  latMax: number;
}

const MAX_SPAN_DEG = 5;

export function parseBbox(raw: string | null | undefined): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [lonMin, latMin, lonMax, latMax] = nums as [number, number, number, number];
  if (lonMin < -180 || lonMax > 180 || latMin < -90 || latMax > 90) return null;
  if (lonMin >= lonMax || latMin >= latMax) return null;
  if (lonMax - lonMin > MAX_SPAN_DEG || latMax - latMin > MAX_SPAN_DEG) return null;
  return { lonMin, latMin, lonMax, latMax };
}

export function quantizeBbox(b: Bbox): Bbox {
  return {
    lonMin: Math.floor(b.lonMin * 10) / 10,
    latMin: Math.floor(b.latMin * 10) / 10,
    lonMax: Math.ceil(b.lonMax * 10) / 10,
    latMax: Math.ceil(b.latMax * 10) / 10,
  };
}

export function bboxKey(b: Bbox): string {
  return `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/web/src/lib/enc-features-bbox.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/enc-features-bbox.ts packages/web/src/lib/enc-features-bbox.test.ts
git commit -m "feat(web): bbox parse/quantize helpers for NOAA vector feature queries"
```

### Task 2: S-57 COLOUR parser

**Files:**

- Create: `packages/web/src/lib/enc-colours.ts`
- Test: `packages/web/src/lib/enc-colours.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/web/src/lib/enc-colours.test.ts
import { describe, it, expect } from 'vitest';
import { parsePrimaryColour } from './enc-colours';

describe('parsePrimaryColour', () => {
  it('extracts a single S-57 colour code as a number', () => {
    expect(parsePrimaryColour('3')).toBe(3);
    expect(parsePrimaryColour('1')).toBe(1);
    expect(parsePrimaryColour('13')).toBe(13);
  });

  it('returns the first token of a comma-separated list', () => {
    expect(parsePrimaryColour('3,1,3')).toBe(3);
    expect(parsePrimaryColour('4,1')).toBe(4);
    expect(parsePrimaryColour('2,1,2,1')).toBe(2);
  });

  it('returns 0 for missing / unparseable / out-of-range input', () => {
    expect(parsePrimaryColour(null)).toBe(0);
    expect(parsePrimaryColour(undefined)).toBe(0);
    expect(parsePrimaryColour('')).toBe(0);
    expect(parsePrimaryColour('abc')).toBe(0);
    expect(parsePrimaryColour('0')).toBe(0);
    expect(parsePrimaryColour('14')).toBe(0); // outside S-57 1..13
    expect(parsePrimaryColour('-1')).toBe(0);
  });

  it('trims surrounding whitespace from each token', () => {
    expect(parsePrimaryColour(' 3 , 1 ')).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/web/src/lib/enc-colours.test.ts`
Expected: FAIL with "Failed to resolve import './enc-colours'".

- [ ] **Step 3: Implement the parser**

```ts
// packages/web/src/lib/enc-colours.ts

/**
 * Parse the S-57 COLOUR attribute (which may be a single code or
 * comma-separated list, e.g. "3" or "3,1,3") and return the leading
 * numeric code. Returns 0 when the input is missing or unparseable
 * — callers paint with a default colour in that case.
 *
 * Valid S-57 codes are 1..13 (white, black, red, green, blue, yellow,
 * grey, brown, amber, violet, orange, magenta, pink).
 */
export function parsePrimaryColour(raw: string | null | undefined): number {
  if (!raw) return 0;
  const head = raw.split(',')[0]?.trim();
  if (!head) return 0;
  const n = Number(head);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 13) return 0;
  return n;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/web/src/lib/enc-colours.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/enc-colours.ts packages/web/src/lib/enc-colours.test.ts
git commit -m "feat(web): S-57 COLOUR attribute parser"
```

### Task 3: enc-features route handler (single-class happy path)

**Files:**

- Create: `packages/web/src/app/api/enc-features/route.ts`
- Test: `packages/web/src/app/api/enc-features/route.test.ts`

This task establishes the route shape and the parallel multi-layer fetch. Cache, error handling, and edge cases come in Tasks 4 and 5.

- [ ] **Step 1: Write the failing test for the happy path**

```ts
// packages/web/src/app/api/enc-features/route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let GET: (req: Request) => Promise<Response>;

const BUOY_LAYER_IDS = [4, 5, 6, 7];

function makeFeature(id: number, lon: number, lat: number, colour: string): unknown {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { OBJECTID: id, OBJL: 17, BOYSHP: 4, COLOUR: colour, OBJNAM: `buoy-${id}` },
  };
}

function mockUpstream(featuresByLayer: Record<number, unknown[]>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const layerMatch = url.match(/\/encdirect\/enc_coastal\/MapServer\/(\d+)\/query/);
    if (!layerMatch) throw new Error(`unexpected upstream URL ${url}`);
    const layerId = Number(layerMatch[1]);
    const features = featuresByLayer[layerId] ?? [];
    return new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

beforeEach(async () => {
  vi.resetModules();
  ({ GET } = await import('./route'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enc-features route — happy path', () => {
  it('merges features from all four Coastal buoy layers', async () => {
    const fetchSpy = mockUpstream({
      4: [makeFeature(40, -71.4, 41.4, '3,1,3')], // isolated danger
      5: [makeFeature(50, -71.45, 41.45, '3'), makeFeature(51, -71.46, 41.46, '4')], // lateral
      6: [makeFeature(60, -71.5, 41.5, '3,1')], // safe water
      7: [makeFeature(70, -71.3, 41.3, '6')], // special purpose
    });

    const res = await GET(
      new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/geo\+json|application\/json/);
    const body = (await res.json()) as {
      type: string;
      features: { properties: { colourCode: number } }[];
    };
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(5);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    // Each feature carries a numeric colourCode derived from COLOUR.
    const codes = body.features.map((f) => f.properties.colourCode).sort();
    expect(codes).toEqual([3, 3, 3, 4, 6]);

    // All four layers were queried with the same bbox.
    for (const id of BUOY_LAYER_IDS) {
      const called = fetchSpy.mock.calls.some((c) =>
        String(c[0]).includes(`/MapServer/${id}/query`),
      );
      expect(called, `layer ${id} should be queried`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web/src/app/api/enc-features/route.test.ts`
Expected: FAIL with "Failed to resolve import './route'".

- [ ] **Step 3: Implement the minimal route handler**

```ts
// packages/web/src/app/api/enc-features/route.ts
import { parseBbox, type Bbox } from '../../../lib/enc-features-bbox';
import { parsePrimaryColour } from '../../../lib/enc-colours';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ENC_DIRECT_BASE =
  'https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer';
const BUOY_LAYER_IDS = [4, 5, 6, 7] as const;
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';
const FETCH_TIMEOUT_MS = 12_000;

interface GeoJsonFeature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, unknown> & { colourCode?: number };
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

function buildQueryUrl(layerId: number, bbox: Bbox): string {
  const geom = `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}`;
  const params = new URLSearchParams({
    where: '1=1',
    geometry: geom,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '1000',
    f: 'geojson',
  });
  return `${ENC_DIRECT_BASE}/${layerId}/query?${params.toString()}`;
}

async function fetchLayer(layerId: number, bbox: Bbox): Promise<GeoJsonFeature[]> {
  const url = buildQueryUrl(layerId, bbox);
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`upstream layer ${layerId} → ${res.status}`);
  }
  const body = (await res.json()) as Partial<FeatureCollection>;
  return Array.isArray(body.features) ? (body.features as GeoJsonFeature[]) : [];
}

function annotate(features: GeoJsonFeature[]): GeoJsonFeature[] {
  return features.map((f) => {
    const raw = f.properties?.COLOUR;
    const colourCode = parsePrimaryColour(typeof raw === 'string' ? raw : undefined);
    return { ...f, properties: { ...f.properties, colourCode } };
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const klass = url.searchParams.get('class');
  if (klass !== 'buoys') {
    return new Response(JSON.stringify({ error: 'unknown class' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const bbox = parseBbox(url.searchParams.get('bbox'));
  if (!bbox) {
    return new Response(JSON.stringify({ error: 'bad bbox' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const layers = await Promise.all(BUOY_LAYER_IDS.map((id) => fetchLayer(id, bbox)));
  const features = annotate(layers.flat());
  const body: FeatureCollection = { type: 'FeatureCollection', features };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/geo+json',
      'cache-control': 'public, max-age=300',
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/src/app/api/enc-features/route.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/enc-features/route.ts packages/web/src/app/api/enc-features/route.test.ts
git commit -m "feat(web): /api/enc-features proxy — Coastal buoys (4 layers, parallel fan-out)"
```

### Task 4: In-memory cache with TTL

**Files:**

- Modify: `packages/web/src/app/api/enc-features/route.ts`
- Modify: `packages/web/src/app/api/enc-features/route.test.ts`

- [ ] **Step 1: Add the failing cache test**

Append inside `describe('enc-features route — happy path', ...)`:

```ts
it('serves a cache hit without hitting upstream on a repeat request', async () => {
  const fetchSpy = mockUpstream({ 4: [], 5: [], 6: [], 7: [] });

  const req = () => new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6');

  const first = await GET(req());
  expect(first.headers.get('x-cache')).toBe('MISS');
  expect(fetchSpy).toHaveBeenCalledTimes(4); // 4 layers

  fetchSpy.mockClear();
  const second = await GET(req());
  expect(second.status).toBe(200);
  expect(second.headers.get('x-cache')).toBe('HIT');
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('uses the same cache entry for slightly-different bboxes that quantise the same', async () => {
  const fetchSpy = mockUpstream({ 4: [], 5: [], 6: [], 7: [] });

  const first = await GET(
    new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6'),
  );
  expect(first.headers.get('x-cache')).toBe('MISS');
  fetchSpy.mockClear();

  // Same 0.1° quantised bounds (lonMin floors to -71.5, latMin floors to 41.3,
  // lonMax ceils to -71.1, latMax ceils to 41.7).
  const second = await GET(
    new Request('http://x/api/enc-features?class=buoys&bbox=-71.499,41.31,-71.18,41.61'),
  );
  expect(second.headers.get('x-cache')).toBe('HIT');
  expect(fetchSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests; verify the new ones fail**

Run: `npx vitest run packages/web/src/app/api/enc-features/route.test.ts`
Expected: The original happy-path test passes; the two new ones FAIL ("expected 'MISS' to be 'MISS'" / "expected 'undefined' to be 'HIT'").

- [ ] **Step 3: Add an in-memory cache to the route**

Modify `packages/web/src/app/api/enc-features/route.ts`:

Add the cache primitives near the top (after the constants block):

```ts
import { quantizeBbox, bboxKey } from '../../../lib/enc-features-bbox';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  ts: number;
  body: FeatureCollection;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(klass: string, bbox: Bbox): string {
  return `${klass}:${bboxKey(quantizeBbox(bbox))}`;
}
```

Replace the body of the `GET` handler (the lines from `const layers = await Promise.all…` through the final `return`) with:

```ts
const key = cacheKey(klass, bbox);
const hit = cache.get(key);
if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
  return new Response(JSON.stringify(hit.body), {
    status: 200,
    headers: {
      'content-type': 'application/geo+json',
      'cache-control': 'public, max-age=300',
      'x-cache': 'HIT',
    },
  });
}
const layers = await Promise.all(BUOY_LAYER_IDS.map((id) => fetchLayer(id, quantizeBbox(bbox))));
const features = annotate(layers.flat());
const body: FeatureCollection = { type: 'FeatureCollection', features };
cache.set(key, { ts: Date.now(), body });
return new Response(JSON.stringify(body), {
  status: 200,
  headers: {
    'content-type': 'application/geo+json',
    'cache-control': 'public, max-age=300',
    'x-cache': 'MISS',
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/web/src/app/api/enc-features/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/enc-features/route.ts packages/web/src/app/api/enc-features/route.test.ts
git commit -m "feat(web): in-memory cache (5 min TTL, 0.1° bbox quantisation) for /api/enc-features"
```

### Task 5: Input validation and upstream error handling

**Files:**

- Modify: `packages/web/src/app/api/enc-features/route.test.ts`
- Modify: `packages/web/src/app/api/enc-features/route.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the bottom of the test file:

```ts
describe('enc-features route — validation and errors', () => {
  it('returns 400 for an unknown class', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(
      new Request('http://x/api/enc-features?class=lights&bbox=-71.5,41.3,-71.2,41.6'),
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing or malformed bbox', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res1 = await GET(new Request('http://x/api/enc-features?class=buoys'));
    expect(res1.status).toBe(400);
    const res2 = await GET(new Request('http://x/api/enc-features?class=buoys&bbox=garbage'));
    expect(res2.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 502 when any upstream layer fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Layer 5 fails; others succeed empty.
      if (url.includes('/MapServer/5/')) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const res = await GET(
      new Request('http://x/api/enc-features?class=buoys&bbox=-71.5,41.3,-71.2,41.6'),
    );
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run the tests to confirm pass/fail status**

Run: `npx vitest run packages/web/src/app/api/enc-features/route.test.ts`
Expected: The two 400 tests pass (already handled in Task 3); the 502 test FAILS — current code lets the rejected `Promise.all` bubble up as an unhandled exception that Next.js converts to 500, not 502.

- [ ] **Step 3: Catch upstream errors and translate to 502**

Wrap the `Promise.all` in a `try/catch` inside `GET`:

```ts
let layers: GeoJsonFeature[][];
try {
  layers = await Promise.all(BUOY_LAYER_IDS.map((id) => fetchLayer(id, quantizeBbox(bbox))));
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return new Response(JSON.stringify({ error: 'upstream', detail: msg }), {
    status: 502,
    headers: { 'content-type': 'application/json' },
  });
}
```

(Replace the existing un-wrapped `const layers = await Promise.all(...)` line.)

- [ ] **Step 4: Run the tests to verify they all pass**

Run: `npx vitest run packages/web/src/app/api/enc-features/route.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/enc-features/route.ts packages/web/src/app/api/enc-features/route.test.ts
git commit -m "feat(web): /api/enc-features validation + 502 on upstream error"
```

### Task 6: EncBuoyLayer — skeleton

**Files:**

- Create: `packages/web/src/components/EncBuoyLayer.tsx`

This task adds the component with empty source + paint scaffolding, mounted but not yet fetching. Fetching is added in Task 7. We do **not** write a unit test for this component — MapLibre's runtime objects are hard to mock and the existing `EncLayer.tsx` (and `SeamarkLayer.tsx`) have no unit tests either. Coverage is via the manual chart-page verification in Task 10.

- [ ] **Step 1: Create the component file**

```tsx
// packages/web/src/components/EncBuoyLayer.tsx
'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';

const SOURCE_ID = 'noaa-vector-buoys';
const LAYER_ID = 'noaa-vector-buoys-layer';

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * NOAA vector overlay — buoys (Coastal usage band only).
 *
 * Reads features from /api/enc-features?class=buoys&bbox=…, normalised
 * upstream so each feature carries `colourCode` (numeric S-57 colour 1..13,
 * or 0 when unknown). Renders one circle per buoy, coloured via the
 * MapLibre `match` paint expression below.
 *
 * Drawn beneath the `__above-wind__` z-order sentinel installed by Map.tsx,
 * so wind / AIS / route / range-rings render on top.
 *
 * v1 scope: no fetching yet — see EncBuoyLayer-fetch in the follow-up task.
 */
export function EncBuoyLayer({
  map,
  visible,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
}): null {
  useEffect(() => {
    if (!map) return;

    const ensure = (): void => {
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY_COLLECTION });
        }
        if (!map.getLayer(LAYER_ID)) {
          const beforeId = map.getLayer('__above-wind__') ? '__above-wind__' : undefined;
          map.addLayer(
            {
              id: LAYER_ID,
              type: 'circle',
              source: SOURCE_ID,
              paint: {
                'circle-radius': 5,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000',
                // S-57 colour codes: 1=white, 2=black, 3=red, 4=green,
                // 5=blue, 6=yellow, 7=grey, 8=brown, 9=amber, 10=violet,
                // 11=orange, 12=magenta, 13=pink. Anything else falls
                // through to a neutral grey.
                'circle-color': [
                  'match',
                  ['get', 'colourCode'],
                  1,
                  '#f5f5f5',
                  2,
                  '#222222',
                  3,
                  '#dd2222',
                  4,
                  '#22aa22',
                  5,
                  '#1166cc',
                  6,
                  '#e6c200',
                  7,
                  '#888888',
                  8,
                  '#7a4d22',
                  9,
                  '#dd9933',
                  10,
                  '#8855aa',
                  11,
                  '#ee7722',
                  12,
                  '#c33388',
                  13,
                  '#dd88aa',
                  '#888888',
                ],
              },
              layout: { visibility: visible ? 'visible' : 'none' },
            },
            beforeId,
          );
        }
      } catch {
        /* style torn down mid-render; styledata retry handles it */
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

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck --workspace @g5000/web`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/EncBuoyLayer.tsx
git commit -m "feat(web): EncBuoyLayer skeleton (empty source, S-57 colour paint)"
```

### Task 7: EncBuoyLayer — bbox-driven fetch with debounce + zoom gate

**Files:**

- Modify: `packages/web/src/components/EncBuoyLayer.tsx`

- [ ] **Step 1: Add the fetch effect to the component**

Add a third `useEffect` after the visibility effect:

```tsx
useEffect(() => {
  if (!map) return;
  if (!visible) return;

  const MIN_ZOOM = 9;
  const DEBOUNCE_MS = 250;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let aborter: AbortController | null = null;

  const refresh = async (): Promise<void> => {
    if (map.getZoom() < MIN_ZOOM) {
      const src = map.getSource(SOURCE_ID);
      if (src && 'setData' in src && typeof src.setData === 'function') {
        src.setData(EMPTY_COLLECTION);
      }
      return;
    }
    aborter?.abort();
    aborter = new AbortController();
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
      .map((n) => n.toFixed(3))
      .join(',');
    try {
      const r = await fetch(`/api/enc-features?class=buoys&bbox=${bbox}`, {
        signal: aborter.signal,
      });
      if (!r.ok) return;
      const data = (await r.json()) as GeoJSON.FeatureCollection;
      const src = map.getSource(SOURCE_ID);
      if (src && 'setData' in src && typeof src.setData === 'function') {
        src.setData(data);
      }
    } catch {
      /* aborted or upstream blip — leave previous data in place */
    }
  };

  const schedule = (): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(refresh, DEBOUNCE_MS);
  };

  schedule();
  map.on('moveend', schedule);

  return () => {
    map.off('moveend', schedule);
    if (pending) clearTimeout(pending);
    aborter?.abort();
  };
}, [map, visible]);
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck --workspace @g5000/web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/EncBuoyLayer.tsx
git commit -m "feat(web): EncBuoyLayer fetches /api/enc-features on moveend (debounced, z>=9)"
```

### Task 8: LayersControl — popover with two toggles

**Files:**

- Modify: `packages/web/src/app/chart/LayersControl.tsx`

Replaces the single-button NOAA control with a popover, per CLAUDE.md: _"If this ever grows to 2+ overlays again, revert to a popover layout."_

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `packages/web/src/app/chart/LayersControl.tsx`:

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';

export interface LayersState {
  enc: boolean;
  buoys: boolean;
}

/**
 * Top-right popover for chart overlays. The button shows "Layers" plus
 * a tally of how many overlays are on; the panel reveals one row per
 * toggle. Two toggles today: NOAA raster chart, and the NOAA vector
 * buoys layer.
 *
 * If the panel ever drops back to a single toggle, collapse this back
 * to a single button — same logic that drove the previous single-button
 * shape.
 *
 * State lives in chart/page.tsx and persists to `chart:layers`.
 */
export function LayersControl({
  state,
  onToggle,
}: {
  state: LayersState;
  onToggle: (key: keyof LayersState) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const onCount = (state.enc ? 1 : 0) + (state.buoys ? 1 : 0);

  return (
    <div ref={wrapRef} className="absolute top-2 right-2 z-10">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          'px-3 h-9 rounded border text-sm font-medium ' +
          (onCount > 0
            ? 'bg-zinc-100 text-zinc-900 border-zinc-100 hover:bg-zinc-200'
            : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
        }
      >
        Layers {onCount > 0 ? `(${onCount})` : ''}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Chart layers"
          className="mt-2 w-44 rounded border border-zinc-700 bg-zinc-900/95 text-zinc-100 p-2 shadow-lg"
        >
          <Row label="NOAA chart" pressed={state.enc} onClick={() => onToggle('enc')} />
          <Row label="Buoys" pressed={state.buoys} onClick={() => onToggle('buoys')} />
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm ' +
        (pressed ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-200 hover:bg-zinc-800')
      }
    >
      <span>{label}</span>
      <span aria-hidden="true" className={pressed ? 'opacity-100' : 'opacity-30'}>
        ●
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck --workspace @g5000/web`
Expected: PASS — note this will surface the `LayersState`-shape mismatch in `chart/page.tsx` which Task 9 fixes.

If typecheck fails with a `chart/page.tsx` error about `buoys`, that's the expected breakage — move on to Task 9.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/chart/LayersControl.tsx
git commit -m "feat(web): LayersControl popover with NOAA chart + Buoys toggles"
```

### Task 9: Chart page wire-up

**Files:**

- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: Update the layers-state initializer**

Find the `useState<LayersState>(() => { ... })` block near the top of `ChartPageInner` (the one that reads `chart:layers` from localStorage). Replace its body with:

```tsx
const [layers, setLayers] = useState<LayersState>(() => {
  if (typeof window === 'undefined') return { enc: false, buoys: false };
  try {
    const raw = window.localStorage.getItem('chart:layers');
    if (!raw) return { enc: false, buoys: false };
    const parsed = JSON.parse(raw) as Partial<LayersState>;
    return { enc: parsed.enc ?? false, buoys: parsed.buoys ?? false };
  } catch {
    return { enc: false, buoys: false };
  }
});
```

- [ ] **Step 2: Import EncBuoyLayer**

Find the existing `import { EncLayer } from '../../components/EncLayer';` line. Add the new import directly under it:

```tsx
import { EncBuoyLayer } from '../../components/EncBuoyLayer';
```

- [ ] **Step 3: Mount EncBuoyLayer next to EncLayer**

Find the existing `<EncLayer map={mapInstance} visible={layers.enc} />` line. Add the new component directly under it:

```tsx
<EncBuoyLayer map={mapInstance} visible={layers.buoys} />
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck --workspace @g5000/web`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): mount EncBuoyLayer + buoys layer state on /chart"
```

### Task 10: Full-stack verification

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All previously-passing tests still pass; the four new tests under `enc-features-bbox`, `enc-colours`, and `enc-features` are green. The known-baseline failures from `CLAUDE.md` (the routing integration test, the position route test, the grib integration tests) remain — those are not regressions. Total: same pass count as before plus the new tests; no new red.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Start the dev server**

Run: `npm run dev --workspace @g5000/autopilot-server`

Wait for the line indicating Next is ready on port 3000.

- [ ] **Step 4: Open /chart in a browser and verify**

Navigate to `http://localhost:3000/chart`.

Manually confirm each of the following:

1. The top-right "Layers" button is visible and outlined (no overlays on).
2. Click "Layers" → a popover appears with two rows: "NOAA chart" and "Buoys", both with dim dots.
3. Click "Buoys" → the dot fills in and the button label becomes "Layers (1)".
4. Pan the chart to the Newport, RI area (around `41 25.000n 71 21.000w`). Zoom to z ≥ 9.
5. Coloured circles appear at known buoy positions — at minimum the red/green channel buoys leading into Narragansett Bay.
6. In DevTools → Network: a `GET /api/enc-features?class=buoys&bbox=...` request fires after each pan-end, with status 200 and `x-cache: MISS` on the first request, `HIT` on a re-pan over the same area.
7. Zoom out below z=9 → buoys disappear (zoom gate).
8. Toggle "NOAA chart" on alongside Buoys → the NOAA raster paints under the vector buoys; vector circles draw on top.
9. Reload the page → both layer states persist (whichever combination was last set).
10. Pan to a non-US area (e.g., south of Bermuda) with Buoys on → request still fires but returns an empty FeatureCollection; no buoys render; no console errors.

- [ ] **Step 5: Stop the dev server**

Press Ctrl-C in the dev terminal.

- [ ] **Step 6: Final wrap-up commit (if anything needs tidying)**

If steps 1–10 surfaced any issue, fix it now and add a commit. Otherwise this task is a no-op — nothing to commit.

```bash
git status
# If clean: nothing to do. If not:
git add <files>
git commit -m "fix(web): <specific issue from manual verification>"
```

## Self-Review

**Spec coverage:** The plan implements Path A scoped exactly to v1 (buoys-only, Coastal-only, in-memory cache). The doc's "non-goals" (S-52 symbology, S-101, click-to-identify, band-by-zoom, disk cache) are explicitly out of scope. The doc's "sanity-check #1" (curl probe) was already done during recon and is not a code task. The doc's "sanity-check #2" (one-off `<EncBuoyLayer/>`) is what Tasks 6+7 build, but production-shaped rather than throwaway — appropriate scope drift now that we have committed to Path A.

**Placeholder scan:** All code blocks contain literal, runnable code. No "TBD", "add validation", or "similar to" references. Each test contains the actual assertions and inputs. Each commit message is concrete.

**Type consistency:** `LayersState` is `{ enc: boolean; buoys: boolean }` everywhere (Task 8 defines it, Task 9 consumes it). The S-57 colour numeric is `colourCode` everywhere (Task 2 produces it via `parsePrimaryColour`, Task 3 attaches it server-side, Task 6 reads it in the MapLibre paint expression). The bbox helper interface is `Bbox` with `lonMin/latMin/lonMax/latMax` consistently. The `BUOY_LAYER_IDS` constant is `[4, 5, 6, 7]` in both the route handler (Task 3) and the test mock (Task 3).

**Cross-cutting notes:**

- Existing `EncLayer` and `SeamarkLayer` patterns are mirrored exactly: `try/catch` around add\*, `styledata` retry, beforeId `__above-wind__`. The component placement and useEffect shape match.
- The route handler matches the project's `enc-tiles` test style — `vi.spyOn(globalThis, 'fetch')`, `vi.resetModules()`, dynamic import inside `beforeEach`. No new test infrastructure.
- The CLAUDE.md zone-of-responsibility rule (chart-page localStorage keys, `__above-wind__` sentinel, popover-when-2+) is honoured.
- Risk: zero new dependencies, zero changes to `next.config.ts`, zero changes to `serverExternalPackages`. The proxy is a leaf API route. Reverting is `git revert` of the nine commits — no schema or persistence changes to roll back.
