# Chart Toolbar Icon Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chart's standalone Layers button + `+ marker` pill with a vertical top-right rail of three identical `w-9 h-9` icon buttons — Layers (existing popover), Annotation (the existing track AnnotationDropper as an icon), and Waypoint (a click-to-drop mode that creates an auto-named waypoint).

**Architecture:** A new `ChartToolbar` lays out the three controls in an `absolute top-2 right-2 flex flex-col gap-2 items-end` rail; each control's panel opens to the LEFT so it doesn't displace the icons. `AnnotationDropper` gains a `variant: 'pill' | 'icon'` prop (default `pill` keeps `/helm` unchanged). `LayersControl` (chart-only) is repositioned to sit in the rail with a left-opening popover. Waypoint-drop mode reuses the already-present-but-unused `<Map onClick>` prop, gated so normal clicks stay inert.

**Tech Stack:** TypeScript (ESM, strict), Next.js 16 App Router, React 19, MapLibre, Tailwind 4, vitest. Spec: `docs/superpowers/specs/2026-05-23-chart-toolbar-icons-design.md`.

**Current structure (locate by symbol — lines shift):**
- `LayersControl.tsx`: wrapper `absolute top-2 right-2 z-10`; popover `mt-2 w-44 …` (opens below); props `{ state, onToggle, onSelectModel, onRefreshNoaa }`; chart-only consumer.
- `AnnotationDropper.tsx` (243 lines): root `<div className={`absolute ${position} z-20 flex flex-col items-end gap-2`}>`; `position` prop (default `'top-2 right-2'`); collapsed pill button label `pillLabel` (`'+ marker'` or `'⏺ open period — N min'`, amber when a period is open); expanded panel below. Consumers: `/chart` (pill) AND `/helm` (`position="top-2 right-2"`, pill).
- `chart/page.tsx`: mounts `<LayersControl .../>` and `<AnnotationDropper .../>` separately; `<Map>` mounted (no `onClick` passed); `mapInstance` state; `waypoints` state + `setWaypoints`; fetches `/api/waypoints` on mount into `waypoints`.

---

## File structure

**Create:**
- `packages/web/src/app/chart/waypoint-name.ts` — `nextWaypointName()` pure helper.
- `packages/web/src/app/chart/waypoint-name.test.ts`
- `packages/web/src/app/chart/ChartToolbar.tsx` — the icon rail + the Waypoint toggle button.

**Modify:**
- `packages/web/src/components/AnnotationDropper.tsx` — add `variant: 'pill' | 'icon'`.
- `packages/web/src/app/chart/LayersControl.tsx` — relative wrapper + left-opening popover.
- `packages/web/src/app/chart/page.tsx` — mount `<ChartToolbar>`; add waypoint-drop state + handler + `<Map onClick>` gating + Esc.

---

## Task 1: `nextWaypointName` pure helper

**Files:**
- Create: `packages/web/src/app/chart/waypoint-name.ts`
- Test: `packages/web/src/app/chart/waypoint-name.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/src/app/chart/waypoint-name.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { nextWaypointName } from './waypoint-name';

describe('nextWaypointName', () => {
  it('starts at WP 1 for an empty list', () => {
    expect(nextWaypointName([])).toBe('WP 1');
  });
  it('increments past the highest existing WP n', () => {
    expect(nextWaypointName(['WP 1', 'WP 2'])).toBe('WP 3');
    expect(nextWaypointName(['WP 3', 'WP 1'])).toBe('WP 4');
  });
  it('ignores names that are not WP n', () => {
    expect(nextWaypointName(['Newport', 'Block Island'])).toBe('WP 1');
    expect(nextWaypointName(['Newport', 'WP 5', 'Fuel'])).toBe('WP 6');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/chart/waypoint-name.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`packages/web/src/app/chart/waypoint-name.ts`:
```ts
/**
 * Auto-name for a chart-dropped waypoint: "WP N" where N is one past the
 * highest existing "WP <n>" name. Names that don't match "WP <n>" are ignored.
 */
export function nextWaypointName(existingNames: string[]): string {
  let max = 0;
  for (const name of existingNames) {
    const m = /^WP (\d+)$/.exec(name.trim());
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `WP ${max + 1}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/app/chart/waypoint-name.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/waypoint-name.ts packages/web/src/app/chart/waypoint-name.test.ts
git commit -m "feat(web): nextWaypointName helper for chart waypoint drop"
```

---

## Task 2: AnnotationDropper `variant` prop (icon mode)

**Files:**
- Modify: `packages/web/src/components/AnnotationDropper.tsx`

**Goal:** add `variant?: 'pill' | 'icon'` (default `'pill'`). `'pill'` is exactly today's behavior (so `/helm` and the current `/chart` mount are unchanged). `'icon'` renders a `w-9 h-9` icon trigger, a `relative` root (so a parent flex-col positions it), and opens the panel to the LEFT.

- [ ] **Step 1: Add the prop + branch the root/trigger**

READ `AnnotationDropper.tsx` first. Add `variant` to the props:
```ts
export function AnnotationDropper({
  position = 'top-2 right-2',
  variant = 'pill',
}: {
  position?: string;
  variant?: 'pill' | 'icon';
}): React.ReactElement {
```

Root wrapper: in `'pill'` mode keep `absolute ${position} z-20 flex flex-col items-end gap-2`; in `'icon'` mode use `relative` (the toolbar positions it) — e.g.:
```tsx
  const rootClass =
    variant === 'icon'
      ? 'relative'
      : `absolute ${position} z-20 flex flex-col items-end gap-2`;
  return <div className={rootClass}>{/* … */}</div>;
```

Collapsed trigger: in `'pill'` mode keep the existing pill button (`pillLabel`). In `'icon'` mode render a `w-9 h-9` icon button matching the Layers button style, with a small amber dot badge when a period is open (`open_` / `minutesOpen > 0`). Use a marker/flag glyph. Example icon button:
```tsx
  // when collapsed:
  variant === 'icon' ? (
    <button
      type="button"
      aria-label={open_ ? `Annotations — open period ${minutesOpen} min` : 'Annotations'}
      title="Track annotations"
      onClick={() => setOpen(true)}
      className={
        'relative w-9 h-9 rounded border flex items-center justify-center ' +
        (open_
          ? 'bg-amber-500 text-zinc-900 border-amber-600 hover:bg-amber-400'
          : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
      }
    >
      <MarkerIcon />
      {open_ ? (
        <span aria-hidden className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-700" />
      ) : null}
    </button>
  ) : (
    /* existing pill button unchanged */
  )
```
Add a small `MarkerIcon` SVG helper (a map-pin/flag). Match the `LayersIcon` SVG conventions (18×18, stroke currentColor).

Expanded panel: in `'icon'` mode position it absolute to the LEFT of the button so it doesn't push the toolbar: wrap the panel with `absolute right-full mr-2 top-0` (instead of the in-flow stacking used by the pill). In `'pill'` mode keep the current below-stacking. Keep ALL panel contents + the post/poll/period logic unchanged.

- [ ] **Step 2: Typecheck + verify pill mode unchanged**

Run: `npm run typecheck --workspace @g5000/web` → passes.
Smoke: `curl -s -o /dev/null -w "/helm %{http_code}\n" http://localhost:3000/helm` → 200 (helm still uses the default `pill`). `curl … /chart` → 200 (chart still mounts the pill until Task 3).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/AnnotationDropper.tsx
git commit -m "feat(web): AnnotationDropper icon variant (pill stays default for /helm)"
```

---

## Task 3: ChartToolbar + LayersControl reposition + chart mount swap

**Files:**
- Create: `packages/web/src/app/chart/ChartToolbar.tsx`
- Modify: `packages/web/src/app/chart/LayersControl.tsx`
- Modify: `packages/web/src/app/chart/page.tsx`

**Goal:** render the three controls as one vertical rail. LayersControl is chart-only, so reposition it AND swap the chart mount in the same task (no broken intermediate). The Waypoint button is a toggle only here; its drop behavior lands in Task 4.

- [ ] **Step 1: LayersControl — relative wrapper + left-opening popover**

In `LayersControl.tsx`: change the outer wrapper from `absolute top-2 right-2 z-10` to `relative` (the toolbar positions it). Change the popover container from `mt-2 w-44 …` to `absolute right-full mr-2 top-0 w-44 …` so it opens to the LEFT as an overlay (doesn't push the rail). Keep everything else (toggles, model radio, badge, refresh button).

- [ ] **Step 2: Create ChartToolbar**

`packages/web/src/app/chart/ChartToolbar.tsx`:
```tsx
'use client';
import { LayersControl, type LayersState } from './LayersControl';
import type { ChartModel } from './model-layer';
import { AnnotationDropper } from '../../components/AnnotationDropper';

export interface ChartToolbarProps {
  layers: LayersState;
  onToggleLayer: (key: 'osm' | 'enc' | 'buoys' | 'tileGrid') => void;
  onSelectModel: (model: ChartModel) => void;
  onRefreshNoaa?: () => void;
  /** Waypoint-drop mode is active (button highlighted). */
  waypointDropActive: boolean;
  onToggleWaypointDrop: () => void;
}

export function ChartToolbar({
  layers,
  onToggleLayer,
  onSelectModel,
  onRefreshNoaa,
  waypointDropActive,
  onToggleWaypointDrop,
}: ChartToolbarProps): React.ReactElement {
  return (
    <div className="absolute top-2 right-2 z-10 flex flex-col gap-2 items-end">
      <LayersControl
        state={layers}
        onToggle={onToggleLayer}
        onSelectModel={onSelectModel}
        onRefreshNoaa={onRefreshNoaa}
      />
      <AnnotationDropper variant="icon" />
      <button
        type="button"
        aria-pressed={waypointDropActive}
        aria-label={waypointDropActive ? 'Cancel waypoint drop' : 'Drop a waypoint'}
        title={waypointDropActive ? 'Click the map to drop a waypoint (Esc to cancel)' : 'Drop a waypoint on the chart'}
        onClick={onToggleWaypointDrop}
        className={
          'w-9 h-9 rounded border flex items-center justify-center ' +
          (waypointDropActive
            ? 'bg-amber-500 text-zinc-900 border-amber-600 hover:bg-amber-400'
            : 'bg-zinc-900/85 text-zinc-100 border-zinc-700 hover:bg-zinc-800')
        }
      >
        <WaypointIcon />
      </button>
    </div>
  );
}

function WaypointIcon(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10z" />
      <circle cx="12" cy="11" r="2" />
    </svg>
  );
}
```
> `LayersControl`'s wrapper is now `relative`, so inside the toolbar's `flex flex-col` it stacks as a normal item and its left-opening popover overlays without disturbing the column. `AnnotationDropper variant="icon"` is also `relative` and behaves the same.

- [ ] **Step 3: Wire chart/page.tsx**

In `chart/page.tsx`:
- Add state near the other chart state: `const [waypointDropActive, setWaypointDropActive] = useState(false);`
- REMOVE the separate `<LayersControl .../>` mount and the separate `<AnnotationDropper .../>` mount.
- In their place mount the toolbar (keep it a sibling of `<Map>` inside the relative map-column div, same place LayersControl was):
```tsx
<ChartToolbar
  layers={layers}
  onToggleLayer={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
  onSelectModel={(model) => setLayers((prev) => ({ ...prev, model }))}
  onRefreshNoaa={() => refreshEncTiles(mapInstance)}
  waypointDropActive={waypointDropActive}
  onToggleWaypointDrop={() => setWaypointDropActive((v) => !v)}
/>
```
Use the ACTUAL existing handlers the old `<LayersControl>` used for `onToggle`/`onSelectModel`/`onRefreshNoaa` (copy them verbatim from the old mount). Add the `ChartToolbar` import. Remove the now-unused `LayersControl` and `AnnotationDropper` imports from page.tsx (they're now imported by ChartToolbar).

- [ ] **Step 4: Typecheck + browser verify the rail**

Run: `npm run typecheck --workspace @g5000/web` → passes.
Smoke: `curl … /chart` → 200; `curl … /helm` → 200 (helm AnnotationDropper still pill).
Browser (Playwright, 1440×900): load `/chart`, screenshot — confirm three identical `w-9 h-9` icons stack vertically at top-right (Layers, Annotation, Waypoint); open the Layers popover and the Annotation panel and confirm they open to the LEFT without shoving the icons. The Waypoint button toggles highlight (drop behavior is Task 4).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/ChartToolbar.tsx packages/web/src/app/chart/LayersControl.tsx packages/web/src/app/chart/page.tsx
git commit -m "feat(web): chart toolbar icon rail (Layers + Annotation + Waypoint)"
```

---

## Task 4: Waypoint drop behavior

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`

**Goal:** when `waypointDropActive`, set a crosshair cursor and arm `<Map onClick>`; a click auto-names via `nextWaypointName`, POSTs `/api/waypoints`, adds the pin to the chart's `waypoints` state, and exits the mode. Esc cancels.

- [ ] **Step 1: Add the drop handler + cursor + Map onClick gating**

In `chart/page.tsx`:
- Import the helper: `import { nextWaypointName } from './waypoint-name';`
- Crosshair cursor effect (set while active, restore on exit):
```tsx
useEffect(() => {
  if (!mapInstance) return;
  const canvas = mapInstance.getCanvas();
  canvas.style.cursor = waypointDropActive ? 'crosshair' : '';
  return () => {
    canvas.style.cursor = '';
  };
}, [mapInstance, waypointDropActive]);
```
- The drop handler (uses the latest `waypoints` for naming):
```tsx
const handleDropClick = async ({ lat, lon }: { lat: number; lon: number }) => {
  const name = nextWaypointName(waypoints.map((w) => w.name));
  setWaypointDropActive(false); // one per activation
  try {
    const res = await fetch('/api/waypoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, lat, lon }),
    });
    const j = (await res.json()) as { ok: boolean; waypoint?: { id: string; name: string; lat: number; lon: number } };
    if (res.ok && j.ok && j.waypoint) {
      setWaypoints((prev) => [...prev, j.waypoint!]);
    } else {
      setError(`waypoint drop failed`);
    }
  } catch {
    setError('waypoint drop failed');
  }
};
```
> `waypoints` state shape is `{ id, name, lat, lon }[]`; confirm `setWaypoints` accepts the POST's returned waypoint (the API returns `{ id, name, lat, lon, notes?, createdAt }` — map to the chart's shape if narrower).
- Pass the gated handler to `<Map>`:
```tsx
<Map
  /* …existing props… */
  onClick={waypointDropActive ? handleDropClick : undefined}
/>
```
> Because `<Map>` binds its click listener once and reads `onClickRef.current`, passing `undefined` when inactive makes normal clicks inert; passing the handler when active routes the next click to the drop. (No re-mount needed — Map updates the ref each render.)

- [ ] **Step 2: Esc cancels**

Add an effect: when `waypointDropActive`, a `keydown` listener for `Escape` calls `setWaypointDropActive(false)`:
```tsx
useEffect(() => {
  if (!waypointDropActive) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setWaypointDropActive(false);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [waypointDropActive]);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @g5000/web` → passes.

- [ ] **Step 4: Browser verify the drop**

Browser (Playwright): load `/chart`; click the Waypoint icon (it highlights, cursor → crosshair); click a point on the map; confirm a new amber waypoint pin appears at that spot and the icon un-highlights (mode exited). Press the icon again then Esc → mode cancels with no waypoint created. Optionally confirm via `curl -s localhost:3000/api/waypoints` that a `WP N` waypoint now exists; clean up by `DELETE /api/waypoints/wp-N`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): chart waypoint-drop mode (click map → auto-named WP N)"
```

---

## Task 5: Verification

- [ ] **Step 1: Tests + typecheck**

`npx vitest run packages/web/src/app/chart/waypoint-name.test.ts` → 3 pass.
`npm run typecheck --workspace @g5000/web` → clean.
`npm run typecheck` (orchestrated) → clean.

- [ ] **Step 2: Regression smoke**

`curl` 200 for `/chart`, `/helm`. Confirm `/helm`'s annotation control is still the `+ marker` pill (default `variant='pill'`), unchanged.

- [ ] **Step 3: Full browser pass (Playwright, 1440×900)**

Screenshot `/chart`: three identical icons stacked top-right; Layers popover + Annotation panel open left; waypoint drop creates a pin. Screenshot `/helm`: annotation pill unchanged.

- [ ] **Step 4: Format if needed**

`npm run format`; if it changed files, `git add -A && git commit -m "chore: format"`.

---

## Self-review notes

- **Spec coverage:** rail layout + left-opening panels (T3); annotation reuses track AnnotationDropper as icon, pill preserved for helm (T2); waypoint auto-named click-to-drop reusing `<Map onClick>` + Esc/re-click cancel (T1 helper, T4); cursor crosshair (T4); add-to-waypoints-state so pin shows immediately (T4). All spec sections mapped.
- **Type consistency:** `ChartModel` from `model-layer.ts`; `LayersState`/`onToggle` key `'osm'|'enc'|'buoys'|'tileGrid'` matches the LayersControl signature; `nextWaypointName(string[])` used in T4; `ChartToolbarProps` field names consistent T3↔T4.
- **No broken intermediate:** LayersControl reposition + chart mount swap are the same task (T3); AnnotationDropper variant defaults to `pill` so /helm and the pre-T3 chart are unaffected; waypoint button is a no-op toggle after T3, given behavior in T4.
- **Soft spot flagged:** the chart's `waypoints` state shape vs the `/api/waypoints` POST response shape — map fields if narrower (T4 step 1 notes it).
