# Chart Model Layers + Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chart's `windOn` checkbox + GFS/ECMWF/CMEMS `<select>` with a single mutually-exclusive model-layer selector (None|GFS|ECMWF|CMEMS, default None) in `LayersControl`; remove the load-a-plan widgets (keep `?plan=` display); remove the Gulf Stream boundary drawing.

**Architecture:** A pure `modelLayerView(model)` helper maps the 4-way enum to overlay visibility + the wind-model param. `LayersControl` gains a radio group writing `model` into the `chart:layers` state. `chart/page.tsx` derives all overlay/ROI/timeline/manifest-poll gating from `model` via the helper, dropping `windOn`/`displayModel`/`windModel` state.

**Tech Stack:** TypeScript (ESM, strict), Next.js 16 App Router, React 19, MapLibre, vitest. Spec: `docs/superpowers/specs/2026-05-23-chart-model-layers-design.md`.

**Key current line refs in `packages/web/src/app/chart/page.tsx` (968 lines — will shift as you edit; locate by symbol):**
- state: `windModel` (63), `windOn` (66), `displayModel` (101)
- `chart:settings` hydrate/persist (175–207)
- `route`/`attachRoute` (212, 221); `chart:planState` (327, 343); `?plan=` loader → `setRoute` (424)
- manifest poll effect (253; deps line 303)
- `chart:layers` hydrate/persist (363, 381)
- `ForecastRoi hidden={!windOn}` (466); `GulfStreamLayer` mount (468)
- `WindOverlay model={windModel} hidden={!windOn || displayModel === 'CMEMS'}` (477–483)
- `CurrentOverlay hidden={!windOn || displayModel !== 'CMEMS'}` (499–501)
- `LayersControl` mount (523)
- "Model display" checkbox (`checked={windOn}` 559); `displayModel` `<select>` (569)
- Refresh-CMEMS block `displayModel === 'CMEMS'` (593–638)
- forecast timeline `displayModel !== 'CMEMS'` (646–752); windGrid (753), windStatus (772) panels
- `SavedPlanLoader` mount (784) + definition (859–917); `RouteTimeline` mount (796)

---

## File structure

**Create:**
- `packages/web/src/app/chart/model-layer.ts` — `ChartModel` type + `modelLayerView()` pure helper.
- `packages/web/src/app/chart/model-layer.test.ts`

**Modify:**
- `packages/web/src/app/chart/LayersControl.tsx` — add `model` to `LayersState`, a radio group, `onSelectModel`, badge count.
- `packages/web/src/app/chart/page.tsx` — rewire gating to `model`; remove `windOn`/`displayModel`/`windModel`; remove plan widgets; remove GulfStreamLayer mount.

**Leave in tree, unmounted:** `GulfStreamLayer.tsx`, `RouteTimeline.tsx`, the `SavedPlanLoader` source.

---

## Task 1: `modelLayerView` pure helper

**Files:**
- Create: `packages/web/src/app/chart/model-layer.ts`
- Test: `packages/web/src/app/chart/model-layer.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/src/app/chart/model-layer.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { modelLayerView } from './model-layer';

describe('modelLayerView', () => {
  it('none → everything hidden, no wind model', () => {
    expect(modelLayerView('none')).toEqual({
      windHidden: true,
      currentHidden: true,
      roiHidden: true,
      isWindModel: false,
      isCurrent: false,
      windModel: null,
    });
  });
  it('gfs → wind shown, windModel gfs', () => {
    const v = modelLayerView('gfs');
    expect(v.windHidden).toBe(false);
    expect(v.roiHidden).toBe(false);
    expect(v.currentHidden).toBe(true);
    expect(v.isWindModel).toBe(true);
    expect(v.isCurrent).toBe(false);
    expect(v.windModel).toBe('gfs');
  });
  it('ecmwf → wind shown, windModel ecmwf', () => {
    const v = modelLayerView('ecmwf');
    expect(v.windHidden).toBe(false);
    expect(v.windModel).toBe('ecmwf');
    expect(v.currentHidden).toBe(true);
  });
  it('cmems → current shown, no wind', () => {
    const v = modelLayerView('cmems');
    expect(v.windHidden).toBe(true);
    expect(v.roiHidden).toBe(true);
    expect(v.currentHidden).toBe(false);
    expect(v.isCurrent).toBe(true);
    expect(v.isWindModel).toBe(false);
    expect(v.windModel).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/chart/model-layer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`packages/web/src/app/chart/model-layer.ts`:
```ts
/** The single mutually-exclusive chart model overlay selection. */
export type ChartModel = 'none' | 'gfs' | 'ecmwf' | 'cmems';

export interface ModelLayerView {
  /** WindOverlay hidden unless a wind model (gfs/ecmwf) is selected. */
  windHidden: boolean;
  /** CurrentOverlay hidden unless CMEMS is selected. */
  currentHidden: boolean;
  /** ForecastRoi hidden unless a wind model is selected. */
  roiHidden: boolean;
  /** True when gfs/ecmwf — gates the forecast timeline + manifest poll. */
  isWindModel: boolean;
  /** True when cmems — gates the Refresh CMEMS button. */
  isCurrent: boolean;
  /** The wind-model param for WindOverlay when active, else null. */
  windModel: 'gfs' | 'ecmwf' | null;
}

export function modelLayerView(model: ChartModel): ModelLayerView {
  const isWindModel = model === 'gfs' || model === 'ecmwf';
  const isCurrent = model === 'cmems';
  return {
    windHidden: !isWindModel,
    currentHidden: !isCurrent,
    roiHidden: !isWindModel,
    isWindModel,
    isCurrent,
    windModel: isWindModel ? model : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/app/chart/model-layer.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/model-layer.ts packages/web/src/app/chart/model-layer.test.ts
git commit -m "feat(web): modelLayerView helper for chart model layers"
```

---

## Task 2: LayersControl model radio group

**Files:**
- Modify: `packages/web/src/app/chart/LayersControl.tsx`

- [ ] **Step 1: Extend `LayersState` + props**

Add `model` to the interface and a `ChartModel` import:
```ts
import type { ChartModel } from './model-layer';

export interface LayersState {
  osm: boolean;
  enc: boolean;
  buoys: boolean;
  tileGrid: boolean;
  /** Mutually-exclusive forecast/current overlay. 'none' = no model overlay. */
  model: ChartModel;
}
```

Add an `onSelectModel` prop to the component signature (alongside `state`, `onToggle`, `onRefreshNoaa`):
```ts
  onSelectModel,
}: {
  state: LayersState;
  onToggle: (key: 'osm' | 'enc' | 'buoys' | 'tileGrid') => void;
  onSelectModel: (model: ChartModel) => void;
  onRefreshNoaa?: () => void;
```
> Note: `onToggle`'s key is narrowed to the four booleans (model is set via `onSelectModel`, not toggled). Update the page's `onToggle` call site accordingly in Task 3.

- [ ] **Step 2: Count the active model in the badge**

Change the count so an active model counts as one enabled layer:
```ts
const onCount =
  (state.enc ? 1 : 0) + (state.buoys ? 1 : 0) + (state.model !== 'none' ? 1 : 0);
```

- [ ] **Step 3: Add the radio group to the popover**

Inside the popover `<div role="dialog">`, after the existing `Row` toggles (the Tile-grid row) and before the Refresh-NOAA button, add a mutually-exclusive model group using a small local `ModelRow` (radio-style: only one pressed):
```tsx
          <div className="mt-1 pt-1 border-t border-zinc-700">
            <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-zinc-400">
              Model overlay
            </div>
            <ModelRow label="None" active={state.model === 'none'} onClick={() => onSelectModel('none')} />
            <ModelRow label="GFS (wind)" active={state.model === 'gfs'} onClick={() => onSelectModel('gfs')} />
            <ModelRow label="ECMWF (wind)" active={state.model === 'ecmwf'} onClick={() => onSelectModel('ecmwf')} />
            <ModelRow label="CMEMS (currents)" active={state.model === 'cmems'} onClick={() => onSelectModel('cmems')} />
          </div>
```
And add the `ModelRow` component (mirror `Row`, but render a radio dot and use `aria-checked`/`role="radio"`):
```tsx
function ModelRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={
        'w-full flex items-center justify-between px-2 py-1.5 rounded text-sm ' +
        (active ? 'bg-zinc-700 text-zinc-50' : 'text-zinc-200 hover:bg-zinc-800')
      }
    >
      <span>{label}</span>
      <span aria-hidden="true" className={active ? 'opacity-100' : 'opacity-30'}>
        {active ? '◉' : '○'}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: passes. (The page's `onToggle`/`onSelectModel` wiring lands in Task 3; if typecheck flags the page here, that's expected and fixed in Task 3 — but LayersControl.tsx itself must be internally consistent.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/LayersControl.tsx
git commit -m "feat(web): LayersControl model overlay radio group"
```

---

## Task 3: Rewire chart page gating to `model`

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`

This is the core change, all in one file. Locate edits by symbol (line refs in the header are hints).

- [ ] **Step 1: Add `model` to chart:layers state + persistence; import the helper**

- Add import: `import { modelLayerView, type ChartModel } from './model-layer';`
- In the `chart:layers` state default object (near line 354), add `model: 'none' as ChartModel`. The `LayersState` type now includes `model` (from Task 2).
- In the `chart:layers` hydrate block (≈363), accept a persisted `model`: if `j.model` is one of `'none'|'gfs'|'ecmwf'|'cmems'`, set it. The persist effect (≈381) already stringifies the whole `layers` object, so `model` persists automatically.

- [ ] **Step 2: Derive the view + remove old model state**

- Right after `layers` is available, compute: `const mv = modelLayerView(layers.model);`
- DELETE the `windModel` state (63), `windOn` state (66), and `displayModel` state (101).
- In the `chart:settings` hydrate (175–196) remove the `windOn`/`windModel`/`displayModel` reads; in the persist (201–202, 207) remove `windOn`, `windModel`, `displayModel` from the object + deps — keep `windHours`, `showIsochrones`.

- [ ] **Step 3: Rewire overlay gating**

- `ForecastRoi`: `hidden={!windOn}` → `hidden={mv.roiHidden}`.
- `WindOverlay`: `model={windModel}` → `model={mv.windModel ?? 'gfs'}` (the `'gfs'` is inert while hidden); `hidden={!windOn || displayModel === 'CMEMS'}` → `hidden={mv.windHidden}`.
- `CurrentOverlay`: `hidden={!windOn || displayModel !== 'CMEMS'}` → `hidden={mv.currentHidden}`.

- [ ] **Step 4: Gate the manifest poll + timeline + CMEMS refresh on the model**

- Manifest poll effect (≈253): add an early `if (!mv.isWindModel) return;` at the top of the effect body so it does NOT poll `/api/forecast/manifest` when the model isn't a wind model. Add `layers.model` to the effect deps (replace the now-removed `windModel` dep with `mv.windModel`/`layers.model`).
- Everywhere the old code used `windModel`, use `mv.windModel ?? 'gfs'` (e.g. the `availableHours[windModel]` / `latestRunAt[windModel]` reads in the timeline, ≈648/664).
- Forecast timeline block guarded by `displayModel !== 'CMEMS'` (≈646) → guard by `mv.isWindModel`.
- windGrid panel (≈753) and windStatus panel (≈772) guarded by `displayModel !== 'CMEMS'` → `mv.isWindModel`.
- Refresh-CMEMS block guarded by `displayModel === 'CMEMS'` (≈593) → `mv.isCurrent`.

- [ ] **Step 5: Remove the old "Model display" checkbox + the `<select>`; wire LayersControl**

- DELETE the "Model display" checkbox UI (`checked={windOn}` block, ≈554–563) and the `displayModel` `<select>` block (≈565–592) entirely.
- Update the `<LayersControl .../>` mount (≈523): keep `state={layers}`; narrow `onToggle` to the four booleans (its calls already pass a key — ensure the key type matches the narrowed signature); add `onSelectModel={(model) => setLayers((prev) => ({ ...prev, model }))}`.

- [ ] **Step 6: Typecheck + fix dangling refs**

Run: `npm run typecheck --workspace @g5000/web`
Expected: passes. Fix every dangling reference the removals expose (any leftover `windOn`/`windModel`/`displayModel`/`setWindOn`/`setDisplayModel`/`setWindModel` usage). Search the file for those identifiers and ensure none remain.

- [ ] **Step 7: Smoke + commit**

Smoke (dev server on :3000):
- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/chart` → 200.

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): chart model layers — None|GFS|ECMWF|CMEMS exclusive selector"
```

---

## Task 4: Remove load-a-plan widgets (keep `?plan=` display)

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: Remove the widgets**

- DELETE the `<SavedPlanLoader onLoad={...} />` mount (≈784) and the entire `SavedPlanLoader` function definition (≈859–917).
- DELETE the `{route && <RouteTimeline route={route} />}` mount (≈796) and the `RouteTimeline` import (line 8).
- DELETE the plan-info sidebar panel that shows ETA/distance/model/incomplete for a loaded route (the block around ≈786–795).
- If `PlanRecord` type is now unused after removing `SavedPlanLoader`, remove its import/definition too.

- [ ] **Step 2: KEEP the display path — verify these remain**

- KEEP: the `?plan=<id>` loader effect (≈408–429) and its `setRoute(j.plan.route)`.
- KEEP: `route`/`setRoute` state (212), `attachRoute(...)` + `RoutePolyline` import (7, 221), `chart:planState` read/write (327, 343), and the `{error && ...}` line.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: passes (no unused-symbol errors for `route`, `attachRoute`, `setError`, which are all still used by the kept loader path). Fix anything dangling.

- [ ] **Step 4: Smoke + commit**

- `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/chart` → 200.
- Find a plan id (`curl -s localhost:3000/api/plans`); if one exists, `curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/chart?plan=<id>"` → 200.

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "refactor(web): remove load-a-plan widgets from chart (keep ?plan= display)"
```

---

## Task 5: Remove the Gulf Stream boundary drawing

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: Unmount it**

- DELETE the `<GulfStreamLayer map={mapInstance} />` mount (≈468) and the `GulfStreamLayer` import (line 13).
- Leave `packages/web/src/components/GulfStreamLayer.tsx` and the `/api/gulf-stream/north-wall` route in the tree (unmounted, per the preserved-but-unmounted convention).

- [ ] **Step 2: Typecheck + smoke + commit**

Run: `npm run typecheck --workspace @g5000/web` → passes (no leftover `GulfStreamLayer` ref).
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/chart` → 200.

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "refactor(web): remove Gulf Stream boundary drawing from chart"
```

---

## Task 6: Verification

- [ ] **Step 1: Helper test + typecheck**

Run: `npx vitest run packages/web/src/app/chart/model-layer.test.ts` → 4 pass.
Run: `npm run typecheck --workspace @g5000/web` → clean.
Run: `npm run typecheck` (orchestrated) → clean.

- [ ] **Step 2: Targeted regression scan**

`git grep -n "windOn\|displayModel\|\\bwindModel\\b" packages/web/src/app/chart/page.tsx` → expect NO matches (all removed). `GulfStreamLayer`, `SavedPlanLoader`, `RouteTimeline` → expect no matches in page.tsx (mounts removed); the component files still exist.

- [ ] **Step 3: Manual smoke (dev server :3000, in a browser)**

- `/chart` loads; Layers popover shows the Model overlay radio (None default).
- Select GFS → wind overlay + ROI + forecast timeline appear; ECMWF → same with ECMWF data; CMEMS → current overlay + "Refresh CMEMS" button; None → clean basemap, no ROI/timeline, and the network tab shows no `/api/forecast/manifest` polling.
- Gulf Stream boundary no longer renders.
- No SavedPlanLoader / plan-info / RouteTimeline widgets; `/chart?plan=<id>` still draws a route polyline.

- [ ] **Step 4: Format if needed**

`npm run format`; if it changed files, `git add -A && git commit -m "chore: format"` (only formatting).

---

## Self-review notes

- **Spec coverage:** widgets-only plan removal keeping `?plan=` (T4); GS removal (T5); 4-way None|GFS|ECMWF|CMEMS in LayersControl (T2) gating overlays/ROI/timeline/manifest/RefreshCMEMS (T3); `model` in `chart:layers`, drop `windOn`/`displayModel` (T3 + persistence); "don't poll manifest when no wind model" (T3 step 4); testing via pure helper + smoke (T1, T6). All spec sections mapped.
- **Type consistency:** `ChartModel` defined once in `model-layer.ts`, imported by both `LayersControl.tsx` and `page.tsx`. `modelLayerView` field names (`windHidden`/`currentHidden`/`roiHidden`/`isWindModel`/`isCurrent`/`windModel`) used consistently in T3. `onToggle` narrowed to the 4 booleans + new `onSelectModel` for the model — call sites updated in T3 step 5.
- **No placeholders:** every code step has concrete code; chart-page edits are find-and-replace against named symbols with hint line numbers.
