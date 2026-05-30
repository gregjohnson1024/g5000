# Chart Route Context Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A right-click context menu on `/chart` that edits the in-progress route (add/remove/insert/set-start/set-end/delete waypoints), driven by a single shared ordered `routeWaypointIds` list.

**Architecture:** Unify the in-progress route into one ordered `string[]` of waypoint IDs (`useRoutePlan`) shared by `RoutePlanPanel` and a new `ChartContextMenu`. Pure array mutators + a pure hit-target resolver are unit-tested; the menu, the map `contextmenu` handler, and the per-segment connector are verified by `next build` + manual smoke. New points reuse the existing `dropWaypointAt` create flow.

**Tech Stack:** TypeScript (ESM, strict), Vitest, Next.js 16 / React 19, MapLibre GL. Spec: `docs/superpowers/specs/2026-05-30-chart-route-context-menu-design.md`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/web/src/lib/route-plan.ts` | Pure ordered-id mutators + derived start/end/via | Create |
| `packages/web/src/lib/route-plan.test.ts` | Mutator tests | Create |
| `packages/web/src/app/chart/use-route-plan.ts` | React hook wrapping the mutators around state | Create |
| `packages/web/src/lib/route-hit-test.ts` | Pure: queryRenderedFeatures result → context target | Create |
| `packages/web/src/lib/route-hit-test.test.ts` | Hit-test tests | Create |
| `packages/web/src/components/RouteConnector.tsx` | Per-segment features w/ `segIndex` | Modify |
| `packages/web/src/components/Map.tsx` | `contextmenu` handler + `onContextMenu` prop | Modify |
| `packages/web/src/app/chart/ChartContextMenu.tsx` | The menu popover | Create |
| `packages/web/src/app/chart/RoutePlanPanel.tsx` | Drive off shared `ids` + mutators | Modify |
| `packages/web/src/app/chart/page.tsx` | useRoutePlan, contextmenu handler, mount menu, createWaypointAt | Modify |

---

## Task 1: Pure route mutators

**Files:** Create `packages/web/src/lib/route-plan.ts`, `packages/web/src/lib/route-plan.test.ts`

- [ ] **Step 1: Write the failing test** — `route-plan.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { append, removeId, removeAt, insertAt, setStart, setEnd, startOf, endOf, viaOf } from './route-plan.js';

describe('route-plan mutators', () => {
  it('append adds to the end', () => {
    expect(append(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });
  it('removeId removes the first occurrence, no-op if absent', () => {
    expect(removeId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(removeId(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });
  it('removeAt removes by index', () => {
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
  it('insertAt inserts at a clamped index', () => {
    expect(insertAt(['a', 'c'], 1, 'b')).toEqual(['a', 'b', 'c']);
    expect(insertAt(['a'], 9, 'b')).toEqual(['a', 'b']);
    expect(insertAt(['a'], -3, 'b')).toEqual(['b', 'a']);
  });
  it('setStart moves an existing id to front, else prepends', () => {
    expect(setStart(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(setStart(['a', 'b'], 'z')).toEqual(['z', 'a', 'b']);
  });
  it('setEnd moves an existing id to last, else appends', () => {
    expect(setEnd(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(setEnd(['a', 'b'], 'z')).toEqual(['a', 'b', 'z']);
  });
  it('derived start/end/via', () => {
    expect(startOf(['a', 'b', 'c'])).toBe('a');
    expect(endOf(['a', 'b', 'c'])).toBe('c');
    expect(viaOf(['a', 'b', 'c'])).toEqual(['b']);
    expect(viaOf(['a', 'b'])).toEqual([]);
    expect(viaOf(['a'])).toEqual([]);
    expect(viaOf([])).toEqual([]);
    expect(startOf([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/web/src/lib/route-plan.test.ts` (module not found).

- [ ] **Step 3: Implement** — `route-plan.ts`

```ts
/** Pure mutators over an ordered list of waypoint IDs: [start, ...via, end].
 *  Each returns a new array; callers feed the result back into state. */
export function append(ids: string[], id: string): string[] {
  return [...ids, id];
}
export function removeId(ids: string[], id: string): string[] {
  const i = ids.indexOf(id);
  return i === -1 ? ids : removeAt(ids, i);
}
export function removeAt(ids: string[], index: number): string[] {
  if (index < 0 || index >= ids.length) return ids;
  return [...ids.slice(0, index), ...ids.slice(index + 1)];
}
export function insertAt(ids: string[], index: number, id: string): string[] {
  const i = Math.max(0, Math.min(index, ids.length));
  return [...ids.slice(0, i), id, ...ids.slice(i)];
}
export function setStart(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)];
}
export function setEnd(ids: string[], id: string): string[] {
  return [...ids.filter((x) => x !== id), id];
}
export function startOf(ids: string[]): string | undefined {
  return ids[0];
}
export function endOf(ids: string[]): string | undefined {
  return ids[ids.length - 1];
}
export function viaOf(ids: string[]): string[] {
  return ids.slice(1, -1);
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run packages/web/src/lib/route-plan.test.ts` (all pass).

- [ ] **Step 5: Commit**
```bash
git add packages/web/src/lib/route-plan.ts packages/web/src/lib/route-plan.test.ts
git commit -m "$(printf 'feat(web): pure ordered-waypoint route mutators (#21)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: `useRoutePlan` hook + unify panel/page state

This is the refactor that lets the panel and the context menu share one route. Verified by `next build` (no DOM harness). READ `RoutePlanPanel.tsx` and the relevant `page.tsx` regions first.

**Files:** Create `packages/web/src/app/chart/use-route-plan.ts`; Modify `RoutePlanPanel.tsx`, `page.tsx`.

- [ ] **Step 1: Create the hook** — `use-route-plan.ts`

```ts
import { useState, useCallback } from 'react';
import * as rp from '../../lib/route-plan';

export interface RoutePlan {
  ids: string[];
  setIds: (ids: string[]) => void;
  append: (id: string) => void;
  removeId: (id: string) => void;
  insertAt: (index: number, id: string) => void;
  setStart: (id: string) => void;
  setEnd: (id: string) => void;
  clear: () => void;
}

/** Single source of truth for the in-progress route's ordered waypoint IDs. */
export function useRoutePlan(): RoutePlan {
  const [ids, setIds] = useState<string[]>([]);
  return {
    ids,
    setIds,
    append: useCallback((id) => setIds((cur) => rp.append(cur, id)), []),
    removeId: useCallback((id) => setIds((cur) => rp.removeId(cur, id)), []),
    insertAt: useCallback((index, id) => setIds((cur) => rp.insertAt(cur, index, id)), []),
    setStart: useCallback((id) => setIds((cur) => rp.setStart(cur, id)), []),
    setEnd: useCallback((id) => setIds((cur) => rp.setEnd(cur, id)), []),
    clear: useCallback(() => setIds([]), []),
  };
}
```

- [ ] **Step 2: Rewire `page.tsx` state**

(a) Add import near the other chart imports:
```ts
import { useRoutePlan } from './use-route-plan';
import { startOf, endOf } from '../../lib/route-plan';
```
(b) REPLACE the two lines `const [routeStartId, setRouteStartId] = useState('');` and `const [routeEndId, setRouteEndId] = useState('');` with:
```ts
  const routePlan = useRoutePlan();
  const routeStartId = startOf(routePlan.ids) ?? '';
  const routeEndId = endOf(routePlan.ids) ?? '';
```
(c) DELETE the `routeWaypointPath` state line (`const [routeWaypointPath, setRouteWaypointPath] = useState<{ lat: number; lon: number }[]>([]);`) and DERIVE it instead — add after the `wpById`/waypoints are available (place near the connector effect):
```ts
  const routeWaypointPath = routePlan.ids
    .map((id) => waypoints.find((w) => w.id === id))
    .filter((w): w is (typeof waypoints)[number] => !!w)
    .map((w) => ({ lat: w.lat, lon: w.lon }));
```
The existing connector effect `attachRouteConnector(mapInstance, 'route-connector', routeWaypointPath)` now consumes this derived value (no change to the effect body; its dep array stays `[routeWaypointPath, mapInstance]`).

- [ ] **Step 3: Update the `<RoutePlanPanel>` mount in `page.tsx`**

Replace the props `startId`, `endId`, `onStartId`, `onEndId`, `onWaypointPath` with the shared plan. The new mount passes:
```tsx
        <RoutePlanPanel
          waypoints={waypoints}
          tz={tz}
          hasRoute={Object.keys(routes).length > 0}
          ids={routePlan.ids}
          onIdsChange={routePlan.setIds}
          colorMode={routeColorMode}
          onColorMode={setRouteColorMode}
          colorTwaDisabled={hasMotoring}
          onRouted={handleRouted}
          onClear={handleClearRoute}
          showIsochrones={showIsochrones}
          onShowIsochrones={setShowIsochrones}
          showRouteWind={showRouteWind}
          onShowRouteWind={setShowRouteWind}
        />
```
(`routeStartId`/`routeEndId` are still used elsewhere in page.tsx for the green/red mark badges — keep those references; they now read from the derived consts in Step 2b.)

- [ ] **Step 4: Refactor `RoutePlanPanel.tsx` to the shared list**

(a) Props: REMOVE `startId`, `endId`, `onStartId`, `onEndId`, `onWaypointPath`. ADD:
```ts
  ids: string[];
  onIdsChange: (ids: string[]) => void;
```
(b) Imports: add
```ts
import { append, removeId, removeAt, insertAt, setStart, setEnd, startOf, endOf, viaOf } from '../../lib/route-plan';
```
Keep the existing `reorder` import (used for via reordering) and `orderedPlanFromRoute`.

(c) REMOVE the internal `const [viaIds, setViaIds] = useState<string[]>([]);` and the `onWaypointPath` emit `useEffect` (the `waypointPath`/`waypointPathKey` block) — page.tsx now derives the connector path. REMOVE the badge-sync `useEffect` that calls `props.onStartId/onEndId` (badges now derive from the shared ids in page.tsx).

(d) REPLACE the `start`/`end`/`via` computation block with derivations from `props.ids` (waypoints-mode) or the saved route (route-mode), writing through `onIdsChange`:
```ts
  const wpById = new Map(waypoints.map((w) => [w.id, w]));
  const ids = props.ids;
  const startId = startOf(ids) ?? '';
  const endId = endOf(ids) ?? '';
  const viaIds = viaOf(ids);

  // Coordinates for the Plan request, resolved from the active selection.
  const resolve = (id: string) => {
    const w = wpById.get(id);
    return w ? { lat: w.lat, lon: w.lon } : undefined;
  };
  const start = resolve(startId);
  const end = resolve(endId);
  const via = viaIds.map(resolve).filter((p): p is { lat: number; lon: number } => !!p);
```
In **route mode**, selecting a saved route replaces the whole list — the route `<select>` onChange becomes:
```tsx
                onChange={(e) => {
                  setRouteId(e.target.value);
                  const r = routes.find((x) => x.id === e.target.value);
                  if (r) props.onIdsChange(r.waypointIds.filter((id) => wpById.has(id)));
                }}
```
(`orderedPlanFromRoute` is no longer needed here — selecting a route sets `ids` directly; you may drop that import if now unused.)

(e) In **waypoints mode**, rewire the pickers to mutators:
- Start `<WaypointSelect ... onChange={(id) => props.onIdsChange(setStart(ids, id))} />`
- End `<WaypointSelect ... onChange={(id) => props.onIdsChange(setEnd(ids, id))} />`
- Via list maps `viaIds` (display index `i` ↔ ids index `i + 1`):
  - change: `onChange={(v) => props.onIdsChange(ids.map((x, j) => (j === i + 1 ? v : x)))}`
  - move up: `onClick={() => props.onIdsChange(i > 0 ? reorder(ids, i + 1, i) : ids)}`
  - move down: `onClick={() => props.onIdsChange(i + 1 < viaIds.length ? reorder(ids, i + 1, i + 2) : ids)}`
  - remove: `onClick={() => props.onIdsChange(removeAt(ids, i + 1))}`
- "+ add via waypoint": insert a concrete first-available waypoint just before the end (no empty placeholder):
```tsx
              <button
                onClick={() => {
                  const candidate = waypoints.find((w) => !ids.includes(w.id))?.id ?? waypoints[0]?.id;
                  if (candidate) props.onIdsChange(insertAt(ids, Math.max(1, ids.length - 1), candidate));
                }}
                disabled={waypoints.length === 0}
                className="text-xs px-2 py-1 bg-slate-800 rounded disabled:opacity-40"
              >
                + add via waypoint
              </button>
```
(`startId`/`endId` `disabledId` props on the Start/End selects stay as before, referencing the new local `startId`/`endId`.)

- [ ] **Step 5: Verify** — rebuild + typecheck + web build:
```bash
npm run typecheck
npm run build --workspace @g5000/web
```
Expected: typecheck clean; `next build` exits 0. Fix type errors (most likely a missed `startId`/`endId` reference) until clean.

- [ ] **Step 6: Commit**
```bash
git add packages/web/src/app/chart/use-route-plan.ts packages/web/src/app/chart/RoutePlanPanel.tsx packages/web/src/app/chart/page.tsx
git commit -m "$(printf 'refactor(web): unify in-progress route into shared routeWaypointIds (#21)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: Per-segment route connector (for leg hit-testing)

**Files:** Modify `packages/web/src/components/RouteConnector.tsx`

- [ ] **Step 1: Change the geometry to one feature per segment, carrying `segIndex`.** Replace the single-LineString `data` construction in `attachRouteConnector` with a FeatureCollection:
```ts
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: points.slice(0, -1).map((p, i) => ({
      type: 'Feature',
      properties: { segIndex: i },
      geometry: {
        type: 'LineString',
        coordinates: [
          [p.lon, p.lat],
          [points[i + 1]!.lon, points[i + 1]!.lat],
        ],
      },
    })),
  };
```
Keep everything else (the `<2 points` clear guard, the `setData` update path, the dashed-white paint, `detachRouteConnector`) unchanged. The layer stays a single `line` layer over the multi-feature source — visual output is identical; only `queryRenderedFeatures` now returns a feature with `properties.segIndex`.

- [ ] **Step 2: Verify** — `npm run build --workspace @g5000/web` exits 0. Manual: connector still draws as before.

- [ ] **Step 3: Commit**
```bash
git add packages/web/src/components/RouteConnector.tsx
git commit -m "$(printf 'feat(web): per-segment route-connector features for leg hit-testing (#21)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: Map `contextmenu` handler

**Files:** Modify `packages/web/src/components/Map.tsx`

- [ ] **Step 1: Add an `onContextMenu` prop + ref + handler.** In the Map props type add:
```ts
  onContextMenu?: (e: { lat: number; lon: number; point: { x: number; y: number } }) => void;
```
Add a ref alongside the existing `onClickRef` pattern:
```ts
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;
```
And register the handler next to the existing `map.on('click', …)` (line ~148):
```ts
    map.on('contextmenu', (e) => {
      e.preventDefault();
      onContextMenuRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng, point: { x: e.point.x, y: e.point.y } });
    });
```
(Match the file's existing ref idiom — if onClick uses a `useEffect` to keep the ref current, mirror that for onContextMenu.)

- [ ] **Step 2: Verify** — `npm run build --workspace @g5000/web` exits 0.

- [ ] **Step 3: Commit**
```bash
git add packages/web/src/components/Map.tsx
git commit -m "$(printf 'feat(web): map contextmenu event → onContextMenu prop (#21)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: Pure hit-target resolver

**Files:** Create `packages/web/src/lib/route-hit-test.ts`, `packages/web/src/lib/route-hit-test.test.ts`

- [ ] **Step 1: Write the failing test** — `route-hit-test.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveTarget, type HitWaypoint } from './route-hit-test.js';

const wps: HitWaypoint[] = [
  { id: 'a', name: 'A', lat: 1, lon: 1 },
  { id: 'b', name: 'B', lat: 2, lon: 2 },
];
const byId = new Map(wps.map((w) => [w.id, w]));
const ctx = (routeIds: string[]) => ({ lat: 9, lon: 9, routeIds, waypointById: byId });

describe('resolveTarget', () => {
  it('waypoint hit, in route', () => {
    const t = resolveTarget([{ layer: { id: 'waypoints-dot' }, properties: { id: 'a' } }], ctx(['a', 'b']));
    expect(t).toEqual({ kind: 'waypoint', waypoint: wps[0], inRoute: true });
  });
  it('waypoint hit, not in route', () => {
    const t = resolveTarget([{ layer: { id: 'waypoints-dot' }, properties: { id: 'b' } }], ctx(['a']));
    expect(t).toEqual({ kind: 'waypoint', waypoint: wps[1], inRoute: false });
  });
  it('leg hit → insertIndex = segIndex + 1', () => {
    const t = resolveTarget([{ layer: { id: 'route-connector' }, properties: { segIndex: 2 } }], ctx(['a', 'b']));
    expect(t).toEqual({ kind: 'leg', lat: 9, lon: 9, insertIndex: 3 });
  });
  it('waypoint takes precedence over leg', () => {
    const t = resolveTarget(
      [
        { layer: { id: 'route-connector' }, properties: { segIndex: 0 } },
        { layer: { id: 'waypoints-dot' }, properties: { id: 'a' } },
      ],
      ctx(['a']),
    );
    expect(t.kind).toBe('waypoint');
  });
  it('empty water when nothing hit', () => {
    expect(resolveTarget([], ctx([]))).toEqual({ kind: 'empty', lat: 9, lon: 9 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/web/src/lib/route-hit-test.test.ts`.

- [ ] **Step 3: Implement** — `route-hit-test.ts`

```ts
export interface HitWaypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export type ContextTarget =
  | { kind: 'empty'; lat: number; lon: number }
  | { kind: 'waypoint'; waypoint: HitWaypoint; inRoute: boolean }
  | { kind: 'leg'; lat: number; lon: number; insertIndex: number };

interface HitFeature {
  layer?: { id?: string };
  properties?: Record<string, unknown> | null;
}

/** Resolve a right-click into a route-editing target. Waypoint markers take
 *  precedence over route legs, which take precedence over empty water. */
export function resolveTarget(
  features: HitFeature[],
  ctx: { lat: number; lon: number; routeIds: string[]; waypointById: Map<string, HitWaypoint> },
): ContextTarget {
  const wpFeat = features.find((f) => f.layer?.id === 'waypoints-dot');
  if (wpFeat) {
    const id = String(wpFeat.properties?.id ?? '');
    const wp = ctx.waypointById.get(id);
    if (wp) return { kind: 'waypoint', waypoint: wp, inRoute: ctx.routeIds.includes(id) };
  }
  const legFeat = features.find((f) => f.layer?.id === 'route-connector');
  if (legFeat) {
    const segIndex = Number(legFeat.properties?.segIndex ?? 0);
    return { kind: 'leg', lat: ctx.lat, lon: ctx.lon, insertIndex: segIndex + 1 };
  }
  return { kind: 'empty', lat: ctx.lat, lon: ctx.lon };
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**
```bash
git add packages/web/src/lib/route-hit-test.ts packages/web/src/lib/route-hit-test.test.ts
git commit -m "$(printf 'feat(web): pure context-menu hit-target resolver (#21)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: ChartContextMenu component + wiring

**Files:** Create `packages/web/src/app/chart/ChartContextMenu.tsx`; Modify `page.tsx`.

- [ ] **Step 1: `createWaypointAt` returns the new id.** In `page.tsx`, change `dropWaypointAt` to return the created id (or null). Update its body so the success branch does `return wp.id;` after `setWaypoints(...)`, the failure branches `return null;`, and the signature becomes `async ({ lat, lon }): Promise<string | null>`. Existing callers (drop-mode click, long-press) ignore the return value — unaffected.

- [ ] **Step 2: Create `ChartContextMenu.tsx`**

```tsx
'use client';
import { useEffect } from 'react';
import type { ContextTarget, HitWaypoint } from '../../lib/route-hit-test';

export interface ChartContextMenuProps {
  target: ContextTarget;
  screen: { x: number; y: number };
  onClose: () => void;
  onAddToRoute: (id: string) => void;
  onRemoveFromRoute: (id: string) => void;
  onSetStart: (id: string) => void;
  onSetEnd: (id: string) => void;
  onDeleteWaypoint: (wp: HitWaypoint) => void;
  onAddHere: (lat: number, lon: number) => void;
  onRouteToHere: (lat: number, lon: number) => void;
  onInsertHere: (lat: number, lon: number, insertIndex: number) => void;
  onClearRoute: () => void;
}

const ITEM = 'w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700 whitespace-nowrap';

export function ChartContextMenu(p: ChartContextMenuProps): React.ReactElement {
  // Close on Escape or any outside interaction.
  useEffect(() => {
    const close = () => p.onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', close, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', close, { capture: true });
    };
  }, [p]);

  const t = p.target;
  const items: React.ReactNode[] = [];
  const item = (label: string, fn: () => void) =>
    items.push(
      <button
        key={label}
        className={ITEM}
        onClick={() => {
          fn();
          p.onClose();
        }}
      >
        {label}
      </button>,
    );

  if (t.kind === 'waypoint') {
    const w = t.waypoint;
    if (t.inRoute) item(`Remove ${w.name} from route`, () => p.onRemoveFromRoute(w.id));
    else item(`Add ${w.name} to route`, () => p.onAddToRoute(w.id));
    item(`Set ${w.name} as start`, () => p.onSetStart(w.id));
    item(`Set ${w.name} as destination`, () => p.onSetEnd(w.id));
    item(`Delete ${w.name}`, () => p.onDeleteWaypoint(w));
  } else if (t.kind === 'leg') {
    item('Insert waypoint here', () => p.onInsertHere(t.lat, t.lon, t.insertIndex));
  } else {
    item('Add waypoint here', () => p.onAddHere(t.lat, t.lon));
    item('Route to here', () => p.onRouteToHere(t.lat, t.lon));
    item('Clear route', () => p.onClearRoute());
  }

  return (
    <div
      className="absolute z-50 bg-slate-900 border border-slate-700 rounded shadow-lg py-1"
      style={{ left: p.screen.x, top: p.screen.y }}
      // Stop the capture-phase outside-close from firing on our own clicks.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items}
    </div>
  );
}
```

- [ ] **Step 3: Wire the menu into `page.tsx`.**

(a) Imports:
```ts
import { ChartContextMenu } from './ChartContextMenu';
import { resolveTarget, type ContextTarget, type HitWaypoint } from '../../lib/route-hit-test';
import { insertAt as insertAtId } from '../../lib/route-plan';
```
(b) State for the open menu:
```ts
  const [ctxMenu, setCtxMenu] = useState<{ target: ContextTarget; screen: { x: number; y: number } } | null>(null);
```
(c) The handler passed to `<Map onContextMenu={...}>`:
```ts
  const handleContextMenu = useCallback(
    (e: { lat: number; lon: number; point: { x: number; y: number } }) => {
      if (!mapInstance) return;
      const feats = mapInstance.queryRenderedFeatures([e.point.x, e.point.y], {
        layers: ['waypoints-dot', 'route-connector'].filter((id) => mapInstance.getLayer(id)),
      });
      const byId = new Map<string, HitWaypoint>(
        waypoints.map((w) => [w.id, { id: w.id, name: w.name, lat: w.lat, lon: w.lon }]),
      );
      const target = resolveTarget(feats as never, {
        lat: e.lat,
        lon: e.lon,
        routeIds: routePlan.ids,
        waypointById: byId,
      });
      setCtxMenu({ target, screen: { x: e.point.x, y: e.point.y } });
    },
    [mapInstance, waypoints, routePlan.ids],
  );
```
Add `onContextMenu={handleContextMenu}` to the `<Map ... />` element.

(d) Render the menu inside the map container `<div>` (which must be `relative`; the chart's map wrapper already is — confirm and add `relative` if missing), after `<Map />`:
```tsx
        {ctxMenu && (
          <ChartContextMenu
            target={ctxMenu.target}
            screen={ctxMenu.screen}
            onClose={() => setCtxMenu(null)}
            onAddToRoute={(id) => routePlan.append(id)}
            onRemoveFromRoute={(id) => routePlan.removeId(id)}
            onSetStart={(id) => routePlan.setStart(id)}
            onSetEnd={(id) => routePlan.setEnd(id)}
            onDeleteWaypoint={(w) => void handleDeleteWaypoint(w.id)}
            onAddHere={(lat, lon) => void dropWaypointAt({ lat, lon }).then((id) => id && routePlan.append(id))}
            onRouteToHere={(lat, lon) => void dropWaypointAt({ lat, lon }).then((id) => id && routePlan.setEnd(id))}
            onInsertHere={(lat, lon, idx) =>
              void dropWaypointAt({ lat, lon }).then((id) => id && routePlan.setIds(insertAtId(routePlan.ids, idx, id)))
            }
            onClearRoute={() => routePlan.clear()}
          />
        )}
```
(e) `handleDeleteWaypoint(id)`: reuse the existing waypoint-delete logic in page.tsx (the flow around line ~951 that DELETEs and `setWaypoints(prev => prev.filter(...))`). Extract it into a function `handleDeleteWaypoint(id: string)` if it isn't already callable, and ALSO drop the id from the route: `routePlan.removeId(id)`. (The existing delete already removes from `waypoints`; add the route removal.)

- [ ] **Step 4: Verify**
```bash
npm run build --workspace @g5000/web
```
Expected: exits 0. Then manual smoke (dev server): right-click empty water → "Add waypoint here" drops a waypoint and connects it; right-click a waypoint → name-specific Add/Remove/Set-start/Set-destination/Delete; right-click a route leg → "Insert waypoint here" splits the leg.

- [ ] **Step 5: Commit**
```bash
git add packages/web/src/app/chart/ChartContextMenu.tsx packages/web/src/app/chart/page.tsx
git commit -m "$(printf 'feat(web): right-click context menu for chart route editing (#21)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification

- [ ] `npm run typecheck` — clean.
- [ ] `npm test` — new `route-plan` + `route-hit-test` tests pass; failures limited to the documented baseline (`api/position` ConfigStore; ecmwf-cache is flaky under parallel load). See CLAUDE.md §Test layout.
- [ ] `npm run lint` — touched files pass `prettier --check` (`npm run format` if needed).
- [ ] `npm run build --workspace @g5000/web` — exits 0.
- [ ] Manual chart smoke of all three right-click targets (above).
