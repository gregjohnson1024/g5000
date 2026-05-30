# Leg-by-leg Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan a route that passes through an ordered list of intermediate waypoints, chaining each segment's departure to the previous segment's arrival ETA.

**Architecture:** A thin orchestrator `planVia()` in `@g5000/routing` calls the existing single-leg `plan()` once per consecutive waypoint pair and concatenates the legs (dropping the duplicated waypoint vertex). `plan()` is untouched. The `/api/route/plan` route gains an optional ordered `via` list and widens its forecast bbox to enclose all points. The chart plan panel can build `via` from a saved route or from ad-hoc intermediate waypoints.

**Tech Stack:** TypeScript (ESM, strict), Vitest, Next.js 16 App Router, React 19. Spec: `docs/superpowers/specs/2026-05-30-leg-by-leg-routing-design.md`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/routing/src/types.ts` | Route type | Modify: add `incompleteVia?` |
| `packages/routing/src/plan-via.ts` | `planVia` orchestrator | Create |
| `packages/routing/src/plan-via.test.ts` | Engine tests | Create |
| `packages/routing/src/index.ts` | Package exports | Modify: export `planVia` |
| `packages/web/src/lib/route-bbox.ts` | Pure bbox-from-N-points helper | Create |
| `packages/web/src/lib/route-bbox.test.ts` | Bbox helper test | Create |
| `packages/web/src/app/api/route/plan/route.ts` | Plan API | Modify: accept `via`, widen bbox, dispatch to `planVia` |
| `packages/web/src/lib/plan-via.ts` | Pure saved-route → ordered-points resolver | Create |
| `packages/web/src/lib/plan-via.test.ts` | Resolver test | Create |
| `packages/web/src/components/PlanControls.tsx` | Plan controls | Modify: `via` in `PlanParams`, thread through |
| `packages/web/src/app/chart/RoutePlanPanel.tsx` | Chart plan panel | Modify: mode switch, saved-route + ad-hoc via, send `via` |

---

## Task 1: `planVia` engine + types

**Files:**
- Modify: `packages/routing/src/types.ts`
- Create: `packages/routing/src/plan-via.ts`
- Create: `packages/routing/src/plan-via.test.ts`
- Modify: `packages/routing/src/index.ts`

- [ ] **Step 1: Add the `incompleteVia` field to the `Route` type**

In `packages/routing/src/types.ts`, inside `interface Route`, add after the `reason?` line (currently line 51):

```ts
  /** Path-segment index (0 = start→first waypoint) that failed to complete.
   *  Set only when a multi-leg plan (planVia) returns incomplete. */
  incompleteVia?: number;
```

- [ ] **Step 2: Write the failing tests**

Create `packages/routing/src/plan-via.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';
import type { Coastline } from '@g5000/coastline';
import type { LatLon, PlanInput } from './types.js';
import { plan } from './plan.js';
import { planVia } from './plan-via.js';

const NO_COAST = { level: 'i', polygons: [], index: undefined } as unknown as Coastline;
const DEP = 1_768_000_000;

// Constant boat speed regardless of wind ⇒ deterministic, always-completing routes.
const UNIFORM_POLAR: PolarTable = {
  twsBins: [0, 100],
  twaBins: [0, Math.PI],
  boatSpeed: [
    [5.144, 5.144],
    [5.144, 5.144],
  ],
};

function uniformWind(): WindField {
  const lats = [36, 38, 40, 42];
  const lons = [-66, -64, -62, -60];
  const times = [DEP, DEP + 168 * 3600];
  const u = times.map(() => lats.map(() => lons.map(() => 5)));
  const v = times.map(() => lats.map(() => lons.map(() => 0)));
  return { lats, lons, times, u, v, source: 'GFS', runTime: DEP };
}

const START: LatLon = { lat: 38, lon: -64 };
const MID: LatLon = { lat: 39, lon: -63 };
const END: LatLon = { lat: 40, lon: -62 };

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    start: START,
    end: END,
    departure: DEP,
    wind: uniformWind(),
    polar: UNIFORM_POLAR,
    polarId: 'uniform',
    coastline: NO_COAST,
    options: { avoidLand: false },
    ...overrides,
  };
}

describe('planVia', () => {
  it('with no intermediates equals plan()', () => {
    const direct = plan(baseInput());
    const via = planVia(baseInput(), []);
    expect(via.legs).toEqual(direct.legs);
    expect(via.distance).toBeCloseTo(direct.distance, 6);
    expect(via.end).toBe(direct.end);
    expect(via.incomplete).toBeUndefined();
  });

  it('chains two segments: total distance sums, ETA continues, vertex deduped', () => {
    const seg0 = plan(baseInput({ end: MID }));
    const seg1 = plan(baseInput({ start: MID, departure: seg0.end }));
    const full = planVia(baseInput(), [MID]);

    expect(full.start).toBe(DEP);
    expect(full.end).toBe(seg1.end); // seg1 departed at seg0.end ⇒ ETA chain
    expect(full.distance).toBeCloseTo(seg0.distance + seg1.distance, 0);
    // Vertex dedup: seg1's synthetic start leg (== MID) is dropped.
    expect(full.legs.length).toBe(seg0.legs.length + seg1.legs.length - 1);
    const seam = full.legs[seg0.legs.length - 1]!;
    expect(seam.lat).toBeCloseTo(MID.lat, 6);
    expect(seam.lon).toBeCloseTo(MID.lon, 6);
  });

  it('enforces maxHours as a TOTAL budget across segments', () => {
    const seg0 = plan(baseInput({ end: MID }));
    const seg1 = plan(baseInput({ start: MID, departure: seg0.end }));
    const t0h = (seg0.end - seg0.start) / 3600;
    const t1h = (seg1.end - seg1.start) / 3600;

    // Budget below the first segment ⇒ fails at via index 0.
    const r0 = planVia(baseInput({ options: { avoidLand: false, maxHours: t0h / 2 } }), [MID]);
    expect(r0.incomplete).toBe(true);
    expect(r0.incompleteVia).toBe(0);

    // Budget covers segment 0 but not segment 1 ⇒ fails at via index 1.
    // (Proves the budget is shared, not per-segment.)
    const r1 = planVia(
      baseInput({ options: { avoidLand: false, maxHours: t0h + t1h / 2 } }),
      [MID],
    );
    expect(r1.incomplete).toBe(true);
    expect(r1.incompleteVia).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/routing/src/plan-via.test.ts`
Expected: FAIL — `planVia` is not exported / module `./plan-via.js` not found.

- [ ] **Step 4: Implement `planVia`**

Create `packages/routing/src/plan-via.ts`:

```ts
import type { PlanInput, Route, RouteLeg, LatLon } from './types.js';
import { plan } from './plan.js';

/**
 * Plan a path through an ordered list of intermediate waypoints. The full path
 * is [input.start, ...intermediates, input.end]. Each consecutive pair is an
 * independent plan() call; the next segment departs at the previous segment's
 * arrival ETA. Legs are concatenated, dropping the duplicated waypoint vertex
 * between segments. `maxHours` is a TOTAL budget shared across segments.
 *
 * planVia(input, []) is identical to plan(input).
 */
export function planVia(input: PlanInput, intermediates: LatLon[]): Route {
  if (intermediates.length === 0) return plan(input);

  const path: LatLon[] = [input.start, ...intermediates, input.end];
  const totalMaxHours = input.options?.maxHours ?? 168;

  const legs: RouteLeg[] = [];
  let distance = 0;
  let departure = input.departure;
  let remainingHours = totalMaxHours;

  for (let i = 0; i < path.length - 1; i++) {
    const seg = plan({
      ...input,
      start: path[i]!,
      end: path[i + 1]!,
      departure,
      // Per-segment isochrone capture is meaningless for a multi-leg route.
      options: { ...input.options, maxHours: remainingHours, captureIsochrones: false },
    });

    // Drop the duplicated vertex: segment i>0's first leg is the synthetic
    // start node sitting on the previous segment's final waypoint.
    legs.push(...(i === 0 ? seg.legs : seg.legs.slice(1)));
    distance += seg.distance;

    if (seg.incomplete) {
      return {
        legs,
        start: input.departure,
        end: legs[legs.length - 1]!.t,
        distance,
        model: seg.model,
        usedCurrents: seg.usedCurrents,
        polarId: seg.polarId,
        incomplete: true,
        ...(seg.reason ? { reason: seg.reason } : {}),
        incompleteVia: i,
      };
    }

    departure = seg.end;
    remainingHours -= (seg.end - seg.start) / 3600;
  }

  return {
    legs,
    start: input.departure,
    end: legs[legs.length - 1]!.t,
    distance,
    model: input.wind.source,
    usedCurrents: !!(input.options?.useCurrents && input.currents),
    polarId: input.polarId,
  };
}
```

- [ ] **Step 5: Export `planVia` from the package root**

In `packages/routing/src/index.ts`, add after the `export { plan } from './plan.js';` line:

```ts
export { planVia } from './plan-via.js';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/routing/src/plan-via.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/routing/src/types.ts packages/routing/src/plan-via.ts \
        packages/routing/src/plan-via.test.ts packages/routing/src/index.ts
git commit -m "feat(routing): planVia() — leg-by-leg routing through waypoints (#21)"
```

---

## Task 2: API `via` support + bbox helper

**Files:**
- Create: `packages/web/src/lib/route-bbox.ts`
- Create: `packages/web/src/lib/route-bbox.test.ts`
- Modify: `packages/web/src/app/api/route/plan/route.ts`

- [ ] **Step 1: Write the failing bbox test**

Create `packages/web/src/lib/route-bbox.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { boundingBoxFor } from './route-bbox.js';

describe('boundingBoxFor', () => {
  it('encloses a single start/end pair with the buffer', () => {
    const b = boundingBoxFor([{ lat: 38, lon: -64 }, { lat: 40, lon: -62 }], 2);
    expect(b).toEqual({ latMin: 36, latMax: 42, lonMin: -66, lonMax: -60 });
  });

  it('expands to enclose intermediate waypoints off the direct line', () => {
    // A via point west of both endpoints must widen lonMin.
    const b = boundingBoxFor(
      [{ lat: 38, lon: -64 }, { lat: 41, lon: -71 }, { lat: 40, lon: -62 }],
      2,
    );
    expect(b.latMin).toBe(36);
    expect(b.latMax).toBe(43);
    expect(b.lonMin).toBe(-73);
    expect(b.lonMax).toBe(-60);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web/src/lib/route-bbox.test.ts`
Expected: FAIL — module `./route-bbox.js` not found.

- [ ] **Step 3: Implement the helper**

Create `packages/web/src/lib/route-bbox.ts`:

```ts
export interface LatLonLike {
  lat: number;
  lon: number;
}

export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/** Smallest lat/lon box enclosing all points, padded by `bufferDeg` on each side. */
export function boundingBoxFor(points: LatLonLike[], bufferDeg: number): Bbox {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    latMin: Math.min(...lats) - bufferDeg,
    latMax: Math.max(...lats) + bufferDeg,
    lonMin: Math.min(...lons) - bufferDeg,
    lonMax: Math.max(...lons) + bufferDeg,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/src/lib/route-bbox.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `via` + the bbox helper into the plan route**

In `packages/web/src/app/api/route/plan/route.ts`:

(a) Update the imports at the top — change the routing import and add the bbox helper:

```ts
import { plan, planVia } from '@g5000/routing';
```
```ts
import { boundingBoxFor } from '../../../../lib/route-bbox';
```

(b) Add `via` to the `Body` interface (after the `useCurrents?` line):

```ts
  via?: { lat: number; lon: number }[];
```

(c) Replace the `bboxAround` function (currently lines 27-35) with a call to the shared helper. Delete `bboxAround` and, inside `POST`, replace `const bbox = bboxAround(b.start, b.end);` with:

```ts
    const bbox = boundingBoxFor([b.start, ...(b.via ?? []), b.end], 2);
```

(d) In `validate`, reject a malformed `via` (add before `return true;`):

```ts
  if (o.via !== undefined) {
    if (
      !Array.isArray(o.via) ||
      !o.via.every(
        (p) =>
          !!p &&
          typeof p === 'object' &&
          typeof (p as { lat?: unknown }).lat === 'number' &&
          typeof (p as { lon?: unknown }).lon === 'number',
      )
    ) {
      return false;
    }
  }
```

(e) Replace the `const route = plan({ ... });` call with a dispatch on `via`:

```ts
    const planInput = {
      start: b.start,
      end: b.end,
      departure: b.departure,
      wind,
      polar,
      polarId: 'active',
      coastline,
      currents,
      options: {
        ...resolved,
        useCurrents: !!b.useCurrents,
        captureIsochrones: !!b.options?.captureIsochrones,
      },
    };
    const route =
      b.via && b.via.length > 0 ? planVia(planInput, b.via) : plan(planInput);
```

- [ ] **Step 6: Rebuild routing dist + typecheck + web build**

The web build resolves `@g5000/routing` through its compiled `dist/` (stale-dist trap — see CLAUDE.md §Deployment), so `planVia` must be built before `next build` sees it.

Run:
```bash
npx tsc -b packages/routing
npm run typecheck
npm run build --workspace @g5000/web
```
Expected: tsc clean; typecheck clean; web build completes with no type errors on `/api/route/plan`.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/route-bbox.ts packages/web/src/lib/route-bbox.test.ts \
        packages/web/src/app/api/route/plan/route.ts
git commit -m "feat(web): /api/route/plan accepts ordered via waypoints (#21)"
```

---

## Task 3: Pure saved-route → ordered-points resolver

**Files:**
- Create: `packages/web/src/lib/plan-via.ts`
- Create: `packages/web/src/lib/plan-via.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/plan-via.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orderedPlanFromRoute } from './plan-via.js';

const WPS = [
  { id: 'a', lat: 38, lon: -64 },
  { id: 'b', lat: 39, lon: -63 },
  { id: 'c', lat: 40, lon: -62 },
];

describe('orderedPlanFromRoute', () => {
  it('splits a saved route into start / via / end', () => {
    const r = orderedPlanFromRoute({ id: 'r1', name: 'R', waypointIds: ['a', 'b', 'c'] }, WPS);
    expect(r).toEqual({
      start: { lat: 38, lon: -64 },
      via: [{ lat: 39, lon: -63 }],
      end: { lat: 40, lon: -62 },
    });
  });

  it('a two-waypoint route has no intermediates', () => {
    const r = orderedPlanFromRoute({ id: 'r1', name: 'R', waypointIds: ['a', 'c'] }, WPS);
    expect(r).toEqual({ start: { lat: 38, lon: -64 }, via: [], end: { lat: 40, lon: -62 } });
  });

  it('skips waypoint ids that no longer resolve', () => {
    const r = orderedPlanFromRoute(
      { id: 'r1', name: 'R', waypointIds: ['a', 'gone', 'c'] },
      WPS,
    );
    expect(r?.via).toEqual([]); // 'gone' dropped ⇒ just start + end
  });

  it('returns null when fewer than two waypoints resolve', () => {
    expect(orderedPlanFromRoute({ id: 'r1', name: 'R', waypointIds: ['a', 'gone'] }, WPS)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/web/src/lib/plan-via.test.ts`
Expected: FAIL — module `./plan-via.js` not found.

- [ ] **Step 3: Implement the resolver**

Create `packages/web/src/lib/plan-via.ts`:

```ts
export interface WaypointLite {
  id: string;
  lat: number;
  lon: number;
}

export interface SavedRouteLite {
  id: string;
  name: string;
  waypointIds: string[];
}

export interface OrderedPlan {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  via: { lat: number; lon: number }[];
}

/**
 * Resolve a saved route's waypointIds into ordered coordinates, split into
 * start / intermediates (via) / end. Unresolvable ids (deleted waypoints) are
 * skipped. Returns null if fewer than two waypoints resolve.
 */
export function orderedPlanFromRoute(
  route: SavedRouteLite,
  waypoints: WaypointLite[],
): OrderedPlan | null {
  const byId = new Map(waypoints.map((w) => [w.id, w]));
  const pts = route.waypointIds
    .map((id) => byId.get(id))
    .filter((w): w is WaypointLite => w !== undefined);
  if (pts.length < 2) return null;
  return {
    start: { lat: pts[0]!.lat, lon: pts[0]!.lon },
    end: { lat: pts[pts.length - 1]!.lat, lon: pts[pts.length - 1]!.lon },
    via: pts.slice(1, -1).map((w) => ({ lat: w.lat, lon: w.lon })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/web/src/lib/plan-via.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/plan-via.ts packages/web/src/lib/plan-via.test.ts
git commit -m "feat(web): pure resolver for saved-route → ordered plan points (#21)"
```

---

## Task 4: Plan-panel UI — mode switch, saved-route + ad-hoc via

No DOM test harness exists for `packages/web` (#19), so this task is verified by `next build` plus a manual smoke check. The testable logic was extracted into the pure helpers in Tasks 2–3.

**Files:**
- Modify: `packages/web/src/components/PlanControls.tsx`
- Modify: `packages/web/src/app/chart/RoutePlanPanel.tsx`

- [ ] **Step 1: Add `via` to `PlanParams` and thread it through PlanControls**

In `packages/web/src/components/PlanControls.tsx`:

(a) Add `via` to the `PlanParams` interface (after the `end` field, ~line 14):

```ts
  /** Ordered intermediate waypoints between start and end. Empty = direct. */
  via?: { lat: number; lon: number }[];
```

(b) Add a `via` prop to `PlanControls` (in its props object type, after `end?`):

```ts
  via?: { lat: number; lon: number }[];
```

(c) In `onSubmit`, include `via` in the `props.onPlan({ ... })` call (add after `end: props.end,`):

```ts
      via: props.via,
```

- [ ] **Step 2: Add the source mode + ad-hoc via state to RoutePlanPanel**

In `packages/web/src/app/chart/RoutePlanPanel.tsx`:

(a) Add the imports at the top (after the existing imports):

```ts
import { reorder } from '../routes/reorder';
import { orderedPlanFromRoute, type SavedRouteLite } from '../../lib/plan-via';
```

(b) Inside `RoutePlanPanel`, after the existing `const [summary, setSummary] = ...` line, add state for the mode, saved routes, the selected route, and the ad-hoc intermediate list:

```ts
  const [mode, setMode] = useState<'waypoints' | 'route'>('waypoints');
  const [routes, setRoutes] = useState<SavedRouteLite[]>([]);
  const [routeId, setRouteId] = useState<string>('');
  const [viaIds, setViaIds] = useState<string[]>([]); // ad-hoc intermediates

  useEffect(() => {
    void fetch('/api/routes')
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && Array.isArray(j.routes)) setRoutes(j.routes as SavedRouteLite[]);
      })
      .catch(() => {});
  }, []);
```

Add `useEffect` to the React import at the top of the file:

```ts
import { useState, useRef, useEffect } from 'react';
```

- [ ] **Step 3: Compute start/end/via for the current mode**

In `RoutePlanPanel`, replace the existing `const start = ...` / `const end = ...` lines with a mode-aware computation:

```ts
  const wpById = new Map(waypoints.map((w) => [w.id, w]));

  // Resolve the ordered plan (start/end/via) for the active mode.
  let start: { lat: number; lon: number } | undefined;
  let end: { lat: number; lon: number } | undefined;
  let via: { lat: number; lon: number }[] = [];
  if (mode === 'route') {
    const route = routes.find((r) => r.id === routeId);
    const ordered = route ? orderedPlanFromRoute(route, waypoints) : null;
    if (ordered) {
      start = ordered.start;
      end = ordered.end;
      via = ordered.via;
    }
  } else {
    const s = wpById.get(startId);
    const e = wpById.get(endId);
    start = s ? { lat: s.lat, lon: s.lon } : undefined;
    end = e ? { lat: e.lat, lon: e.lon } : undefined;
    via = viaIds
      .map((id) => wpById.get(id))
      .filter((w): w is Wp => !!w)
      .map((w) => ({ lat: w.lat, lon: w.lon }));
  }
```

- [ ] **Step 4: Send `via` in the plan request**

In `RoutePlanPanel`, inside `onPlan`, add `via` to the POST body (after `departure: params.departure,`):

```ts
              via: params.via,
```

- [ ] **Step 5: Render the mode switch + per-mode pickers**

In `RoutePlanPanel`'s JSX, replace the two `<WaypointSelect ... />` Start/End blocks with the mode switch and conditional pickers:

```tsx
          <div className="flex gap-2 text-xs">
            {(['waypoints', 'route'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2 py-1 rounded ${mode === m ? 'bg-emerald-700' : 'bg-slate-800'}`}
              >
                {m === 'waypoints' ? 'Pick waypoints' : 'Saved route'}
              </button>
            ))}
          </div>

          {mode === 'route' ? (
            <label className="block text-sm">
              Route
              <select
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                className={selectClass}
              >
                <option value="">— select route —</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <WaypointSelect
                label="Start"
                value={startId}
                waypoints={waypoints}
                disabledId={endId}
                onChange={props.onStartId}
              />
              {viaIds.map((id, i) => (
                <div key={`${id}-${i}`} className="flex items-end gap-1">
                  <div className="flex-1">
                    <WaypointSelect
                      label={`Via ${i + 1}`}
                      value={id}
                      waypoints={waypoints}
                      disabledId=""
                      onChange={(v) => setViaIds((xs) => xs.map((x, j) => (j === i ? v : x)))}
                    />
                  </div>
                  <button
                    onClick={() => setViaIds((xs) => (i > 0 ? reorder(xs, i, i - 1) : xs))}
                    className="px-2 py-1 text-xs bg-slate-800 rounded"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => setViaIds((xs) => xs.filter((_, j) => j !== i))}
                    className="px-2 py-1 text-xs bg-slate-800 rounded"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => setViaIds((xs) => [...xs, waypoints[0]?.id ?? ''])}
                disabled={waypoints.length === 0}
                className="text-xs px-2 py-1 bg-slate-800 rounded disabled:opacity-40"
              >
                + add via waypoint
              </button>
              <WaypointSelect
                label="End"
                value={endId}
                waypoints={waypoints}
                disabledId={startId}
                onChange={props.onEndId}
              />
            </>
          )}
```

- [ ] **Step 6: Pass `via` to PlanControls**

In `RoutePlanPanel`'s `<PlanControls ... />` element, add the `via` prop (after `end={...}`):

```tsx
            via={via}
```

- [ ] **Step 7: Verify with a web build**

Run:
```bash
npm run build --workspace @g5000/web
```
Expected: build completes, no type errors. (`PlanParams.via`, the new state, and the resolver all typecheck.)

- [ ] **Step 8: Manual smoke check**

Start dev (`npm run dev --workspace @g5000/app`), open `/chart`, drop ≥3 waypoints. In the Route planner:
- "Pick waypoints" mode: choose Start + End, add a Via waypoint, Plan → route bends through the via point; the summary shows distance/duration.
- "Saved route" mode: pick a saved route → route chains through its waypoints.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/components/PlanControls.tsx \
        packages/web/src/app/chart/RoutePlanPanel.tsx
git commit -m "feat(web): leg-by-leg plan UI — saved route + ad-hoc via waypoints (#21)"
```

---

## Task 5 (optional polish): mark waypoint vertices on the drawn route

Skip unless wanted. Adds small dots at the via vertices on the chart polyline.

**Files:**
- Modify: `packages/web/src/components/RoutePolyline.tsx`

- [ ] **Step 1:** Identify the via-vertex legs (a leg whose `lat`/`lon` matches a requested via point) and render a small circle layer at those coordinates, styled distinctly from the start (green) / end (red) marks. Verify with `npm run build --workspace @g5000/web` and a manual check. Commit:

```bash
git commit -am "feat(web): mark via-waypoint vertices on the planned route (#21)"
```

---

## Final verification

- [ ] `npm run typecheck` — clean.
- [ ] `npm test` — the new engine + lib tests pass; failures limited to the documented baseline (`api/position/route.test.ts` ConfigStore, coastline/grib env tests). See CLAUDE.md §Test layout.
- [ ] `npm run lint` — touched files pass `prettier --check` (run `npm run format` if needed).
- [ ] `npm run build --workspace @g5000/web` — clean (stricter route/component type-checking than tsc).
