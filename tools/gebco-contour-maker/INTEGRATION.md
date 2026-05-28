# Integrating the PMTiles into g5000

This note describes how to switch g5000's chart from the per-viewport GMRT
fetch to the precomputed PMTiles. **It is a separate change on a separate
branch — this `gebco-contour-maker` branch only produces the artifact.** Do not
edit the runtime files below here.

## 1. Place the file

Host the PMTiles under the router cache, alongside the other tile caches:

```
~/.g5000-router/bathy-pmtiles/world.pmtiles
```

Pre-warm it on shore like the OSM/satellite caches. It never expires
(bathymetry is static).

## 2. Serve it same-origin with HTTP Range support

The pmtiles protocol reads a single file with HTTP **range** requests, so the
server must honour `Range` and return `206 Partial Content`. Add a route that
streams the cached file — mirror the existing tile proxies
(`packages/web/src/app/api/sat-tiles/[z]/[x]/[y]/route.ts`) and reuse `ROOT`
from `packages/web/src/lib/paths`:

```ts
// packages/web/src/app/api/bathy-pmtiles/route.ts  (sketch — build on the other branch)
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../../lib/paths';

export const runtime = 'nodejs';
const FILE = join(ROOT, 'bathy-pmtiles', 'world.pmtiles');

export function GET(req: Request): Response {
  const { size } = statSync(FILE);
  const range = req.headers.get('range');
  const base = { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes' };
  if (!range) {
    return new Response(createReadStream(FILE) as unknown as ReadableStream, {
      headers: { ...base, 'content-length': String(size) },
    });
  }
  const m = /bytes=(\d+)-(\d*)/.exec(range)!;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : size - 1;
  return new Response(createReadStream(FILE, { start, end }) as unknown as ReadableStream, {
    status: 206,
    headers: {
      ...base,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': String(end - start + 1),
    },
  });
}
```

## 3. Register the pmtiles protocol with MapLibre

Add the `pmtiles` dependency to `@g5000/web` and register the protocol once,
module-scope, before any map is created (e.g. top of
`packages/web/src/components/Map.tsx`):

```ts
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);
```

## 4. Rewrite `BathyLayer` as a vector source

`packages/web/src/components/BathyLayer.tsx` today adds a `geojson` source and
refetches `/api/bathy/contours` on every (debounced) `moveend`. Replace that
whole fetch/debounce/AbortController machinery with a static `vector` source —
the tiles already carry per-feature minzoom, so MapLibre handles all the
zoom-gating:

```tsx
const SOURCE_ID = 'bathy-contours';
const LINE_LAYER_ID = 'bathy-contour-line';

map.addSource(SOURCE_ID, {
  type: 'vector',
  // pmtiles:// expects an absolute URL; build it from the page origin.
  url: `pmtiles://${window.location.origin}/api/bathy-pmtiles`,
});
map.addLayer({
  id: LINE_LAYER_ID,
  type: 'line',
  source: SOURCE_ID,
  'source-layer': 'depth_contours', // = config tippecanoe.layer
  layout: { 'line-join': 'round' },
  paint: {
    // keep the existing depth-graduated cyan -> navy ramp
    'line-color': ['step', ['get', 'depth'], '#7dd3fc', 50, '#38bdf8', 200, '#2563eb', 1000, '#1e3a8a'],
    // thicker for major isobaths
    'line-width': ['case', ['>=', ['get', 'depth'], 200], 1.6, 0.8],
    'line-opacity': ['case', ['>=', ['get', 'depth'], 200], 0.9, 0.6],
  },
});
```

Notes:
- The `ensure()` + `styledata` retry + visibility-toggle pattern stays; only the
  source type and the data plumbing change.
- **Per-feature minzoom is already in the tiles**, so you don't need a zoom
  filter for thinning. If you want to further restrict by tier, filter on
  `['get', 'rank']` (values: `major`/`deep`/`shelf`/`fine`).
- Drop `resForZoom`, `refresh`, `onMoveEnd`, the debounce timer and the
  `AbortController` — all gone.
- Keep the **no text labels** rule: the base style ships no `glyphs` source, so
  a `symbol`/`text-field` layer can't render. Depth is conveyed by colour/width.
- Keep the layer's z-order (mounted beneath AIS/routes/waypoints) and the
  existing `Depth (GEBCO)` toggle + `localStorage['chart:layers'].bathy`.

## 5. Keep the caveat

Leave the **NOT FOR NAVIGATION** note visible wherever the layer is toggled —
the same wording is in the PMTiles `description` metadata.

## 6. Clean up the old path

Once the vector layer is verified in the browser, the per-viewport route and
its libs can be removed on that branch:

- `packages/web/src/app/api/bathy/contours/route.ts`
- `packages/web/src/lib/bathy/{esriascii,contours,bbox}.ts` (+ tests)
- the `~/.g5000-router/bathy-cache/` GeoJSON cache
