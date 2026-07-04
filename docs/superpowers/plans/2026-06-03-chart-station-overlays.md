# Chart Station Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlay clickable tide-station and tidal-current-station icons on the MapLibre chart so the user can find and select a station graphically — tap → on-chart popup with a live summary + an "Open" button that deep-links into `/tide` or `/currents` with that station pre-selected.

**Architecture:** One pure summary module (`station-summary.ts`, unit-tested) feeds one reusable, kind-parameterized MapLibre overlay (`StationsOverlay.tsx`) that builds a clustered GeoJSON source, droplet/arrow icons (via `map.addImage`), and a tap→popup→deep-link flow. Two persisted toggles in the existing Layers control conditionally mount the overlays. The `/tide` and `/currents` pages gain a `?station=` (tide also `?source=`) entry point read from `window.location.search`.

**Tech Stack:** Next.js 16 / React 19 client components, MapLibre GL 4.7.1, TypeScript (strict, composite refs), Vitest (node env, pure-logic only), `@g5000/tide` pure helpers.

---

## Background the engineer needs

- **Repo:** `/Users/gregjohnson/code/g5000`. Work on branch `feature/chart-station-overlays` (branched from `develop`). Do NOT push or deploy.
- **Build gates** (run from repo root unless noted):
  - Web typecheck: `cd packages/web && npx tsc --noEmit`
  - Whole-workspace typecheck: `npx tsc -b` (must exit 0)
  - Tests: `npx vitest run packages/web` (the new pure tests live under `packages/web/src/lib/`)
  - Web build: `cd packages/web && npm run build`
- **Vitest scope:** the root `vitest.config.ts` includes `packages/*/src/**/*.test.{ts,tsx}`, so `packages/web/src/lib/station-summary.test.ts` runs. There are many existing examples under `packages/web/src/lib/*.test.ts`.
- **`@g5000/tide` is a built dependency of `packages/web`** (resolves to `packages/tide/dist`). It is already built; if an import can't resolve, run `npx tsc -b` once. Relevant exports (all pure):
  - `tideSnapshot(events, nowMs) → { heightNowM: number | null; state: TideState | null; next: TidalEvent | null }`
  - `currentNow(preds, nowMs) → { speedKn: number; dirDeg: number } | null`
  - `nextCurrentEvent(events, nowMs) → CurrentEvent | null`
  - Types: `TidalEvent { type:'HW'|'LW'; timeMs:number; heightM:number }`, `TideState = 'rising'|'falling'|'stand'`, `CurrentPrediction { timeMs:number; speedKn:number; dirDeg:number }`, `CurrentEvent { timeMs:number; speedKn:number; kind:CurrentEventKind }`, `CurrentEventKind = 'slack'|'flood'|'ebb'`.
- **Routes (already exist, do not modify):**
  - `GET /api/tide/stations` → `{ ok: true, sources: Record<string, Station[]> }` (sourceId → stations).
  - `GET /api/tide/events?stationId=&source=` → `{ ok: true, events: TidalEvent[] }` | `{ ok:false, error }` (400/502/503). Note the param is `source`, not `sourceId`.
  - `GET /api/currents/stations` → `{ ok: true, stations: CurrentStation[] }` (`{id,name,lat,lon}`).
  - `GET /api/currents/predictions?stationId=` → `{ ok: true, predictions: CurrentPrediction[], events: CurrentEvent[] }` | `{ ok:false }` (400/502).
- **MapLibre idiom in this repo:** `import maplibregl from 'maplibre-gl';`. Overlay components take `map: maplibregl.Map | null`. The canonical clickable-points component to mirror is `packages/web/src/components/AisTargets.tsx` (GeoJSON source + layer + `map.on('click', LAYER_ID, handler)` + DOM `maplibregl.Popup` + guarded cleanup). MapLibre 4.7.1's `GeoJSONSource.getClusterExpansionZoom(clusterId)` returns a `Promise<number>`.
- **Visibility model for this feature:** conditional mount (the AIS idiom). The chart renders `{layers.tideStations && <StationsOverlay .../>}`; toggling off unmounts → cleanup removes layers/source/listeners. Station lists are server-cached, so the re-fetch on re-enable is cheap.

---

## File structure

- **Create** `packages/web/src/lib/station-summary.ts` — pure: turn route data into structured summaries + small deterministic formatters. (Task 1)
- **Create** `packages/web/src/lib/station-summary.test.ts` — vitest. (Task 1)
- **Create** `packages/web/src/components/StationsOverlay.tsx` — the kind-parameterized MapLibre overlay. (Task 2)
- **Modify** `packages/web/src/app/chart/LayersControl.tsx` — `LayersState` + `onToggle` union + two Misc rows. (Task 3)
- **Modify** `packages/web/src/app/chart/ChartToolbar.tsx` — widen `onToggleLayer` union. (Task 3)
- **Modify** `packages/web/src/app/chart/page.tsx` — defaults + hydrate + conditional-mount the overlays. (Task 3)
- **Modify** `packages/web/src/app/currents/page.tsx` — `?station=` pre-selection. (Task 4)
- **Modify** `packages/web/src/app/tide/page.tsx` — `?source=&station=` pre-selection (single-precedence, race-free). (Task 4)

---

## Task 1: Pure station-summary module (TDD)

**Files:**

- Create: `packages/web/src/lib/station-summary.ts`
- Test: `packages/web/src/lib/station-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/station-summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtSetDeg, summarizeCurrent, summarizeTide, CURRENT_KIND_LABEL } from './station-summary';
import type { CurrentPrediction, CurrentEvent, TidalEvent } from '@g5000/tide';

describe('fmtSetDeg', () => {
  it('zero-pads to 3 digits with a degree sign', () => {
    expect(fmtSetDeg(54)).toBe('054°');
    expect(fmtSetDeg(5)).toBe('005°');
    expect(fmtSetDeg(123)).toBe('123°');
  });
  it('wraps 360 and negatives into [0,360)', () => {
    expect(fmtSetDeg(360)).toBe('000°');
    expect(fmtSetDeg(-1)).toBe('359°');
    expect(fmtSetDeg(359.6)).toBe('000°'); // rounds to 360 → 000
  });
});

describe('CURRENT_KIND_LABEL', () => {
  it('maps kinds to display labels', () => {
    expect(CURRENT_KIND_LABEL.slack).toBe('Slack');
    expect(CURRENT_KIND_LABEL.flood).toBe('Max flood');
    expect(CURRENT_KIND_LABEL.ebb).toBe('Max ebb');
  });
});

describe('summarizeCurrent', () => {
  const preds: CurrentPrediction[] = [
    { timeMs: 1000, speedKn: 2, dirDeg: 50 },
    { timeMs: 3000, speedKn: 4, dirDeg: 70 },
  ];
  const events: CurrentEvent[] = [{ timeMs: 5000, speedKn: 0, kind: 'slack' }];

  it('interpolates set/drift at now and returns the next event', () => {
    const s = summarizeCurrent(preds, events, 2000);
    expect(s).not.toBeNull();
    expect(s!.speedKn).toBeCloseTo(3, 6);
    expect(s!.dirDeg).toBeCloseTo(60, 6);
    expect(s!.next?.kind).toBe('slack');
  });
  it('normalizes direction into [0,360)', () => {
    const wrap: CurrentPrediction[] = [
      { timeMs: 1000, speedKn: 1, dirDeg: 350 },
      { timeMs: 3000, speedKn: 1, dirDeg: 370 }, // i.e. 10°
    ];
    const s = summarizeCurrent(wrap, [], 2000);
    expect(s).not.toBeNull();
    expect(s!.dirDeg).toBeGreaterThanOrEqual(0);
    expect(s!.dirDeg).toBeLessThan(360);
  });
  it('returns null when there is no bracketing pair', () => {
    expect(summarizeCurrent(preds, events, 9999)).toBeNull();
    expect(summarizeCurrent([], events, 2000)).toBeNull();
  });
});

describe('summarizeTide', () => {
  // LW at t=0 (0.5 m), HW at t=6h (3.5 m). Midpoint t=3h.
  const events: TidalEvent[] = [
    { type: 'LW', timeMs: 0, heightM: 0.5 },
    { type: 'HW', timeMs: 21_600_000, heightM: 3.5 },
  ];
  it('returns interpolated height-now, state, and next event', () => {
    const s = summarizeTide(events, 10_800_000); // 3h, the cosine midpoint
    expect(s).not.toBeNull();
    expect(s!.heightNowM).toBeCloseTo(2.0, 6);
    expect(s!.next?.type).toBe('HW');
  });
  it('returns null when there is no bracketing pair', () => {
    expect(summarizeTide([], 1000)).toBeNull();
    expect(summarizeTide(events, 99_999_999_999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/lib/station-summary.test.ts`
Expected: FAIL — `Cannot find module './station-summary'`.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/lib/station-summary.ts`:

```ts
import {
  tideSnapshot,
  currentNow,
  nextCurrentEvent,
  type TidalEvent,
  type TideState,
  type CurrentPrediction,
  type CurrentEvent,
  type CurrentEventKind,
} from '@g5000/tide';

/** Set/drift now (direction normalized to [0,360)) plus the next current event. */
export interface CurrentSummary {
  speedKn: number;
  dirDeg: number;
  next: CurrentEvent | null;
}

/** Height-now (m above CD) plus tide state and the next HW/LW. */
export interface TideSummary {
  heightNowM: number;
  state: TideState | null;
  next: TidalEvent | null;
}

export const CURRENT_KIND_LABEL: Record<CurrentEventKind, string> = {
  slack: 'Slack',
  flood: 'Max flood',
  ebb: 'Max ebb',
};

/** 3-digit zero-padded compass string, wrap-safe across 0/360 ("054°"). */
export function fmtSetDeg(dirDeg: number): string {
  const norm = ((Math.round(dirDeg) % 360) + 360) % 360;
  return String(norm).padStart(3, '0') + '°';
}

/** Compose the current-station popup summary, or null when un-interpolatable. */
export function summarizeCurrent(
  preds: ReadonlyArray<CurrentPrediction>,
  events: ReadonlyArray<CurrentEvent>,
  nowMs: number,
): CurrentSummary | null {
  const now = currentNow(preds, nowMs);
  if (!now) return null;
  const dirDeg = ((now.dirDeg % 360) + 360) % 360;
  return { speedKn: now.speedKn, dirDeg, next: nextCurrentEvent(events, nowMs) };
}

/** Compose the tide-station popup summary, or null when outside the curve window. */
export function summarizeTide(
  events: ReadonlyArray<TidalEvent>,
  nowMs: number,
): TideSummary | null {
  const snap = tideSnapshot(events, nowMs);
  if (snap.heightNowM == null) return null;
  return { heightNowM: snap.heightNowM, state: snap.state, next: snap.next };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web/src/lib/station-summary.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/lib/station-summary.ts packages/web/src/lib/station-summary.test.ts
git commit -m "feat(web): pure station-summary helpers for chart station popups

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: StationsOverlay component

**Files:**

- Create: `packages/web/src/components/StationsOverlay.tsx`

No unit test — this is MapLibre/React integration (the repo has no React test harness; vitest is node-only). Verified by typecheck + build in this task and manual smoke at the end.

- [ ] **Step 1: Write the component**

Create `packages/web/src/components/StationsOverlay.tsx`:

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import {
  summarizeTide,
  summarizeCurrent,
  fmtSetDeg,
  CURRENT_KIND_LABEL,
} from '../lib/station-summary';

type Kind = 'tide' | 'current';

export interface StationsOverlayProps {
  /** Map instance from `<Map onLoad>`. Pass null until ready. */
  map: maplibregl.Map | null;
  kind: Kind;
}

interface StationFeatureProps {
  id: string;
  name: string;
  sourceId?: string;
}

/** Local clock label, e.g. "14:02". Not pure (locale/tz) — kept out of station-summary. */
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Cyan teardrop (tide) / magenta double-chevron (current) drawn to a canvas.
 *  Returns ImageData for map.addImage — no glyphs/sprite dependency. */
function makeStationIcon(kind: Kind): { data: ImageData; pixelRatio: number } | null {
  const pixelRatio = 2;
  const size = 18; // logical px
  const dim = size * pixelRatio;
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(pixelRatio, pixelRatio);
  if (kind === 'tide') {
    const cx = size / 2;
    const w = 5;
    ctx.beginPath();
    ctx.moveTo(cx, 2);
    ctx.bezierCurveTo(cx + w, 8, cx + w, 13, cx, 16);
    ctx.bezierCurveTo(cx - w, 13, cx - w, 8, cx, 2);
    ctx.closePath();
    ctx.fillStyle = '#22d3ee'; // cyan-400
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0b0e14';
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#e879f9'; // fuchsia-400
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const chevron = (ox: number): void => {
      ctx.beginPath();
      ctx.moveTo(ox, 4);
      ctx.lineTo(ox + 5, size / 2);
      ctx.lineTo(ox, size - 4);
      ctx.stroke();
    };
    chevron(5);
    chevron(10);
  }
  return { data: ctx.getImageData(0, 0, dim, dim), pixelRatio };
}

function deepLink(kind: Kind, p: StationFeatureProps): string {
  if (kind === 'tide') {
    return `/tide?source=${encodeURIComponent(p.sourceId ?? '')}&station=${encodeURIComponent(p.id)}`;
  }
  return `/currents?station=${encodeURIComponent(p.id)}`;
}

/** Fetch this station's live data and format the one-line popup summary. */
async function fetchSummaryLine(kind: Kind, p: StationFeatureProps): Promise<string> {
  try {
    if (kind === 'tide') {
      const r = await fetch(
        `/api/tide/events?stationId=${encodeURIComponent(p.id)}&source=${encodeURIComponent(p.sourceId ?? '')}`,
      );
      const j = (await r.json().catch(() => ({ ok: false }))) as {
        ok: boolean;
        events?: Parameters<typeof summarizeTide>[0];
      };
      if (!r.ok || !j.ok) return 'data unavailable';
      const s = summarizeTide(j.events ?? [], Date.now());
      if (!s) return 'outside forecast window';
      const next = s.next
        ? ` · → ${s.next.type} ${s.next.heightM.toFixed(1)} m ${fmtClock(s.next.timeMs)}`
        : '';
      return `Height ${s.heightNowM.toFixed(1)} m${s.state ? ` · ${s.state}` : ''}${next}`;
    }
    const r = await fetch(`/api/currents/predictions?stationId=${encodeURIComponent(p.id)}`);
    const j = (await r.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      predictions?: Parameters<typeof summarizeCurrent>[0];
      events?: Parameters<typeof summarizeCurrent>[1];
    };
    if (!r.ok || !j.ok) return 'data unavailable';
    const s = summarizeCurrent(j.predictions ?? [], j.events ?? [], Date.now());
    if (!s) return 'no current data';
    const next = s.next ? ` · → ${CURRENT_KIND_LABEL[s.next.kind]} ${fmtClock(s.next.timeMs)}` : '';
    return `Set ${fmtSetDeg(s.dirDeg)} · Drift ${s.speedKn.toFixed(1)} kn${next}`;
  } catch {
    return 'data unavailable';
  }
}

/**
 * Renders tide or tidal-current stations as clustered icons on the chart.
 * Tap a cluster to expand it; tap a station for a popup with a live summary
 * (height/set-drift now + next event) and an "Open" button that deep-links
 * into /tide or /currents with that station pre-selected. Static markers —
 * live data is fetched only on tap, never per marker.
 */
export function StationsOverlay({ map, kind }: StationsOverlayProps): null {
  // Captured in a ref so the imperatively-built popup's Open handler always
  // calls the latest router without re-running the map effect.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const srcId = `stations-${kind}`;
    const clusterLayerId = `stations-${kind}-cluster`;
    const stationLayerId = `stations-${kind}-point`;
    const iconId = `station-icon-${kind}`;
    const clusterColor = kind === 'tide' ? '#0e7490' : '#a21caf';

    const ensureIcon = (): void => {
      if (map.hasImage(iconId)) return;
      const icon = makeStationIcon(kind);
      if (icon) map.addImage(iconId, icon.data, { pixelRatio: icon.pixelRatio });
    };

    const ensureLayers = (data: GeoJSON.FeatureCollection): void => {
      ensureIcon();
      if (!map.getSource(srcId)) {
        map.addSource(srcId, {
          type: 'geojson',
          data,
          cluster: true,
          clusterRadius: 50,
          clusterMaxZoom: 11,
        });
      }
      if (!map.getLayer(clusterLayerId)) {
        map.addLayer({
          id: clusterLayerId,
          type: 'circle',
          source: srcId,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': clusterColor,
            'circle-opacity': 0.85,
            'circle-stroke-color': '#0b0e14',
            'circle-stroke-width': 1.5,
            'circle-radius': ['step', ['get', 'point_count'], 12, 25, 16, 100, 22],
          },
        });
      }
      if (!map.getLayer(stationLayerId)) {
        map.addLayer({
          id: stationLayerId,
          type: 'symbol',
          source: srcId,
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': iconId,
            'icon-size': 1,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        });
      }
    };

    // Re-add the icon if the style reloads (style reload drops images).
    const onStyleData = (): void => {
      if (map.isStyleLoaded()) ensureIcon();
    };
    map.on('styledata', onStyleData);

    const onClusterClick = (e: maplibregl.MapLayerMouseEvent): void => {
      const f = e.features?.[0];
      const clusterId = f?.properties?.cluster_id;
      if (clusterId == null) return;
      const src = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const coords = (f!.geometry as GeoJSON.Point).coordinates as [number, number];
      void src
        .getClusterExpansionZoom(clusterId as number)
        .then((zoom) => map.easeTo({ center: coords, zoom }))
        .catch(() => {
          /* cluster gone — ignore */
        });
    };

    const onStationClick = (e: maplibregl.MapLayerMouseEvent): void => {
      const f = e.features?.[0];
      if (!f) return;
      const props = f.properties as StationFeatureProps;
      const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];

      const root = document.createElement('div');
      root.className = 'text-xs font-mono';
      const title = document.createElement('div');
      title.textContent = props.name;
      title.style.fontWeight = '600';
      title.style.marginBottom = '2px';
      const line = document.createElement('div');
      line.textContent = 'Loading…';
      line.style.color = '#94a3b8';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Open';
      btn.style.cssText =
        'margin-top:6px;padding:2px 10px;border-radius:4px;border:none;' +
        'background:#0284c7;color:#fff;cursor:pointer;font:inherit;';
      btn.addEventListener('click', () => {
        popupRef.current?.remove();
        routerRef.current.push(deepLink(kind, props));
      });
      root.append(title, line, btn);

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 8 })
        .setLngLat(coords)
        .setDOMContent(root)
        .addTo(map);

      void fetchSummaryLine(kind, props).then((text) => {
        // Popup may have been closed/replaced before the fetch resolved.
        if (line.isConnected) line.textContent = text;
      });
    };

    const onEnter = (): void => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = (): void => {
      map.getCanvas().style.cursor = '';
    };

    const endpoint = kind === 'tide' ? '/api/tide/stations' : '/api/currents/stations';
    void (async () => {
      try {
        const r = await fetch(endpoint);
        const j = (await r.json().catch(() => null)) as {
          ok: boolean;
          sources?: Record<string, { id: string; name: string; lat: number; lon: number }[]>;
          stations?: { id: string; name: string; lat: number; lon: number }[];
        } | null;
        if (cancelled || !map || !r.ok || !j || !j.ok) return;

        const features: GeoJSON.Feature[] = [];
        if (kind === 'tide') {
          for (const [sourceId, arr] of Object.entries(j.sources ?? {})) {
            for (const s of arr) {
              if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
              features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
                properties: { id: s.id, name: s.name, sourceId },
              });
            }
          }
        } else {
          for (const s of j.stations ?? []) {
            if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
            features.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
              properties: { id: s.id, name: s.name },
            });
          }
        }

        if (!map.isStyleLoaded()) {
          await new Promise<void>((resolve) => map.once('idle', () => resolve()));
          if (cancelled) return;
        }
        ensureLayers({ type: 'FeatureCollection', features });

        map.on('click', clusterLayerId, onClusterClick);
        map.on('click', stationLayerId, onStationClick);
        for (const id of [clusterLayerId, stationLayerId]) {
          map.on('mouseenter', id, onEnter);
          map.on('mouseleave', id, onLeave);
        }
      } catch {
        /* outage — overlay renders nothing */
      }
    })();

    return () => {
      cancelled = true;
      map.off('styledata', onStyleData);
      map.off('click', clusterLayerId, onClusterClick);
      map.off('click', stationLayerId, onStationClick);
      for (const id of [clusterLayerId, stationLayerId]) {
        map.off('mouseenter', id, onEnter);
        map.off('mouseleave', id, onLeave);
      }
      popupRef.current?.remove();
      popupRef.current = null;
      for (const id of [clusterLayerId, stationLayerId]) {
        try {
          if (map.getLayer(id)) map.removeLayer(id);
        } catch {
          /* style torn down */
        }
      }
      try {
        if (map.getSource(srcId)) map.removeSource(srcId);
      } catch {
        /* style torn down */
      }
    };
  }, [map, kind]);

  return null;
}
```

- [ ] **Step 2: Web typecheck**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx tsc --noEmit`
Expected: clean (no output). If `GeoJSON.*` types are unresolved, they come from `@types/geojson` which MapLibre depends on; confirm the import compiles. If `useRouter()` typing complains about being called in a ref initializer, that's fine at runtime, but prefer the shown pattern (initialize ref with the first value, reassign each render).

- [ ] **Step 3: Workspace typecheck**

Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/components/StationsOverlay.tsx
git commit -m "feat(web): StationsOverlay — clustered tide/current station markers + tap popup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Layers toggles + chart wiring

**Files:**

- Modify: `packages/web/src/app/chart/LayersControl.tsx`
- Modify: `packages/web/src/app/chart/ChartToolbar.tsx`
- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: Extend `LayersState` and the toggle union in `LayersControl.tsx`**

In `packages/web/src/app/chart/LayersControl.tsx`, add two fields to the `LayersState` interface (after `aisCog`):

```ts
/** Tide-station markers overlay. Defaults false. */
tideStations: boolean;
/** Tidal-current-station markers overlay. Defaults false. */
currentStations: boolean;
```

Widen the `onToggle` prop type (it currently ends `... | 'ais' | 'aisCog'`):

```ts
  onToggle: (
    key:
      | 'osm'
      | 'enc'
      | 'satellite'
      | 'buoys'
      | 'bathy'
      | 'ais'
      | 'aisCog'
      | 'tideStations'
      | 'currentStations',
  ) => void;
```

- [ ] **Step 2: Add the two rows to the Misc section in `LayersControl.tsx`**

In the Misc `<div className="mt-1 pt-1 border-t border-zinc-700">` block, after the AIS rows (the `{state.ais ? (<Row label="AIS COG ext" .../>) : null}` line), add:

```tsx
            <Row
              label="Tide stations"
              pressed={state.tideStations}
              onClick={() => onToggle('tideStations')}
            />
            <Row
              label="Current stations"
              pressed={state.currentStations}
              onClick={() => onToggle('currentStations')}
            />
```

- [ ] **Step 3: Widen the `onToggleLayer` union in `ChartToolbar.tsx`**

In `packages/web/src/app/chart/ChartToolbar.tsx`, the props type has `onToggleLayer: (key: 'osm' | 'enc' | 'satellite' | 'buoys' | 'bathy' | 'ais' | 'aisCog') => void;`. Widen it to match LayersControl:

```ts
  onToggleLayer: (
    key:
      | 'osm'
      | 'enc'
      | 'satellite'
      | 'buoys'
      | 'bathy'
      | 'ais'
      | 'aisCog'
      | 'tideStations'
      | 'currentStations',
  ) => void;
```

(No other ChartToolbar change — it forwards `onToggleLayer` straight to `LayersControl`'s `onToggle`.)

- [ ] **Step 4: Defaults + hydrate in `chart/page.tsx`**

In `packages/web/src/app/chart/page.tsx`, add to the `useState<LayersState>({...})` default object (after `aisCog: true,`):

```ts
    tideStations: false,
    currentStations: false,
```

And in the hydrate effect's `setLayers({...})` block (after `aisCog: parsed.aisCog ?? true,`):

```ts
          tideStations: parsed.tideStations ?? false,
          currentStations: parsed.currentStations ?? false,
```

(The save effect serializes the whole `layers` object, so no change there. The generic `onToggleLayer={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}` already handles the new keys once the union is widened.)

- [ ] **Step 5: Import and conditionally mount the overlays in `chart/page.tsx`**

Add the import near the other component imports (e.g. by `AisTargets`):

```ts
import { StationsOverlay } from '../../components/StationsOverlay';
```

In the JSX, next to the existing `{layers.ais && (<AisTargets .../>)}` block, add:

```tsx
{
  layers.tideStations && <StationsOverlay map={mapInstance} kind="tide" />;
}
{
  layers.currentStations && <StationsOverlay map={mapInstance} kind="current" />;
}
```

- [ ] **Step 6: Typecheck (web + workspace)**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx tsc --noEmit`
Expected: clean.
Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b`
Expected: exit 0.

- [ ] **Step 7: Build**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npm run build`
Expected: build succeeds; `/chart` still in the route manifest.

- [ ] **Step 8: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/chart/LayersControl.tsx packages/web/src/app/chart/ChartToolbar.tsx packages/web/src/app/chart/page.tsx
git commit -m "feat(web): Tide/Current station layer toggles wired into the chart

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Deep-link pre-selection on /tide and /currents

**Files:**

- Modify: `packages/web/src/app/currents/page.tsx`
- Modify: `packages/web/src/app/tide/page.tsx`

Both pages are `'use client'` and render fully on the client, so read the query via `window.location.search` (a `useSearchParams` would force a `<Suspense>` refactor — avoid). Compute the selected station **once**, with explicit precedence, so the value never gets overwritten a tick later.

- [ ] **Step 1: Currents — `?station=` pre-selection**

In `packages/web/src/app/currents/page.tsx`, inside the stations mount effect, the default is the single line `setSelectedId(sorted[0]?.id ?? null);`. Replace it with query-takes-precedence logic:

```ts
const qid = new URLSearchParams(window.location.search).get('station');
const initialId = qid && sorted.some((s) => s.id === qid) ? qid : (sorted[0]?.id ?? null);
setSelectedId(initialId);
```

(The predictions effect is keyed on `selectedId`, so setting it once here triggers the fetch — no other change.)

- [ ] **Step 2: Tide — race-free `?source=&station=` pre-selection**

In `packages/web/src/app/tide/page.tsx`, the mount effect currently sets `selectedKey` in several branches (pinned-in-list else first, inside the `/api/tide/active` handling). Replace the body of that effect so selection is computed **once at the end** with precedence `query ?? pinned ?? first`. Use this exact structure (preserve the `setTideSource`/`setPinnedStationId`/`setPinnedSourceId` calls — `active` is still fetched for the source label and pin, just no longer used to set the selection directly):

```ts
// Mount: fetch stations + active, then choose the selected entry ONCE
// with precedence query-param > pinned > first. Computing it in one place
// avoids a late /api/tide/active callback overwriting a deep-link selection.
useEffect(() => {
  void (async () => {
    const r = await fetch('/api/tide/stations');
    const j = (await r.json().catch(() => ({ ok: false, sources: {} }))) as {
      ok: boolean;
      sources: Record<string, Station[]>;
    };

    const entries: PickerEntry[] = [];
    if (r.ok && j.ok) {
      for (const [srcId, stationArr] of Object.entries(j.sources)) {
        for (const station of stationArr) {
          entries.push({ sourceId: srcId as SourceId, station });
        }
      }
      entries.sort((a, b) => a.station.name.localeCompare(b.station.name));
    }
    setPickerList(entries);
    setStationsLoaded(true);

    // (1) Query-param selection (highest precedence).
    const params = new URLSearchParams(window.location.search);
    const qStation = params.get('station');
    const qSource = params.get('source');
    let queryKey: string | null = null;
    if (qStation) {
      const match = entries.find(
        (e) => e.station.id === qStation && (!qSource || e.sourceId === qSource),
      );
      if (match) queryKey = entryKey(match);
    }

    // (2) Pinned default — also drives the source label. Fetch regardless.
    let pinnedKey: string | null = null;
    const ar = await fetch('/api/tide/active');
    if (ar.ok) {
      const aj = (await ar.json()) as {
        ok: boolean;
        tideSource?: string;
        pinnedStationId?: string | null;
        pinnedSourceId?: string | null;
      };
      if (aj.ok) {
        setTideSource(aj.tideSource ?? null);
        const psId = aj.pinnedStationId ?? null;
        const pSrc = aj.pinnedSourceId ?? null;
        setPinnedStationId(psId);
        setPinnedSourceId(pSrc);
        if (psId && pSrc) {
          const pk = `${pSrc}:${psId}`;
          if (entries.some((e) => entryKey(e) === pk)) pinnedKey = pk;
        }
      }
    }

    // (3) First entry as the final fallback. Select once.
    const firstKey = entries[0] ? entryKey(entries[0]) : null;
    setSelectedKey(queryKey ?? pinnedKey ?? firstKey);
  })();
}, []);
```

> Note: match the existing identifiers in the file (`PickerEntry`, `SourceId`, `entryKey`, `Station`, the state setters). If any setter name differs from the extraction, keep the file's actual name — only the selection _logic_ changes.

- [ ] **Step 3: Typecheck (web + workspace)**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npx tsc --noEmit`
Expected: clean.
Run: `cd /Users/gregjohnson/code/g5000 && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Build**

Run: `cd /Users/gregjohnson/code/g5000/packages/web && npm run build`
Expected: succeeds; `/tide` and `/currents` in the manifest.

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000
git add packages/web/src/app/currents/page.tsx packages/web/src/app/tide/page.tsx
git commit -m "feat(web): /tide and /currents honor ?station= deep links from the chart

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `cd /Users/gregjohnson/code/g5000 && npx tsc -b` → exit 0.
- [ ] `cd /Users/gregjohnson/code/g5000 && npx vitest run packages/web` → all pass (incl. `station-summary.test.ts`).
- [ ] `cd /Users/gregjohnson/code/g5000/packages/web && npm run build` → succeeds.
- [ ] Manual smoke (recommended, not done by subagents): on `/chart`, open Layers → enable "Current stations" (Canadian waters) and "Tide stations"; confirm clustered markers (cyan droplets / magenta chevrons), tap a cluster to expand, tap a station → popup shows name + live summary + Open; Open lands on `/currents` or `/tide` with that station pre-selected.

## Notes / non-goals (carried from the spec)

- No live data baked into marker icons; live data is popup-only on tap.
- No numeric cluster-count labels (the map style has no glyphs URL); density is encoded by bubble size/color.
- Conditional-mount visibility (overlay unmounts when toggled off); station lists are server-cached so re-enable re-fetch is cheap.
- No changes to the `/api/*` routes, `@g5000/tide`, the gridded overlays, the bus, or ConfigStore.

```

```
