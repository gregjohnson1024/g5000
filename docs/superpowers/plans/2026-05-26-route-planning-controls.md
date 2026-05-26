# Route Planning Controls, Auto-Motor, Dual-Model Compare & Playback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the chart plan GFS + ECMWF routes together (colour-coded), expose planning parameters (frontier size, step length, fan, horizon, land-check) as Settings defaults with per-plan chart overrides, add an auto-motor speed policy, and replay a ghost boat per route through time with a SOG/COG/HDG/BSP readout. Drop the isochrone fan.

**Architecture:** Routing engine gains a per-step auto-motor floor and a stored ground-course (`cog`) on each leg. `/api/route/plan` merges `settings.planning` defaults under per-request overrides and stops forcing isochrone capture. The chart fires one plan per selected model, draws each route as a colour-coded line, and a new client-side playback scrubber walks ghost boats along the routes using a pure interpolation lib.

**Tech Stack:** TypeScript (ESM, strict), vitest, Next.js 16 App Router + React 19, MapLibre GL, Drizzle/JSON settings via `lib/persistence`.

**Spec:** `docs/superpowers/specs/2026-05-26-route-planning-controls-design.md`

**Baseline test note:** `npm test` has ~4 known-failing env tests (coastline data / wgrib2 / ConfigStore). Treat those as the baseline; only new failures are blocking.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/routing/src/types.ts` | add `autoMotor` to `PlanOptions`, `cog` to `RouteLeg` |
| `packages/routing/src/prune.ts` | add `cog` to `FrontierNode` |
| `packages/routing/src/plan.ts` | auto-motor floor in `propagate`; populate `cog`; thread through start/final nodes |
| `packages/routing/src/auto-motor.test.ts` | **new** — engine tests for auto-motor + cog |
| `packages/web/src/lib/planning-settings.ts` | **new** — planning defaults + merge helper (knots↔m/s) |
| `packages/web/src/lib/planning-settings.test.ts` | **new** — merge tests |
| `packages/web/src/app/api/route/plan/route.ts` | merge settings.planning; honour `captureIsochrones`; accept `autoMotor` |
| `packages/web/src/app/settings/page.tsx` | new Planning section |
| `packages/web/src/components/PlanControls.tsx` | multi-model, auto-motor, advanced overrides |
| `packages/web/src/app/chart/RoutePlanPanel.tsx` | fire N plans, store routes by model, per-model status |
| `packages/web/src/components/RoutePolyline.tsx` | drop isochrone helpers |
| `packages/web/src/lib/route-playback.ts` | **new** — interpolate position + leg state at time T |
| `packages/web/src/lib/route-playback.test.ts` | **new** — playback lib tests |
| `packages/web/src/app/chart/PlaybackScrubber.tsx` | **new** — time control + tick loop |
| `packages/web/src/app/chart/RouteDetailsBox.tsx` | **new** — per-route SOG/COG/HDG/BSP |
| `packages/web/src/app/chart/page.tsx` | routes-by-model state, colour-coded draw, mount scrubber + boxes, remove isochrone animation |

---

## Phase A — Routing engine: auto-motor + cog

### Task 1: Add `cog` to RouteLeg and `autoMotor` to PlanOptions

**Files:**
- Modify: `packages/routing/src/types.ts`
- Modify: `packages/routing/src/prune.ts`
- Modify: `packages/routing/src/plan.ts`
- Test: `packages/routing/src/auto-motor.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/routing/src/auto-motor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';
import type { Coastline } from '@g5000/coastline';
import { plan } from './index.js';
import type { LatLon } from './index.js';

const NO_COAST = { level: 'i', polygons: [], index: undefined } as unknown as Coastline;
const DEP = 1_768_000_000;

// Flat polar that returns a constant 1.5 m/s everywhere (slow — below a 3 kn
// = 1.5432 m/s auto-motor threshold, so auto-motor should kick in).
const SLOW_POLAR: PolarTable = {
  twsBins: [0, 100],
  twaBins: [0, Math.PI],
  boatSpeed: [
    [1.5, 1.5],
    [1.5, 1.5],
  ],
};

function uniformWind(): WindField {
  const lats = [30, 35, 40, 45];
  const lons = [-70, -65, -60, -55];
  const times = [DEP, DEP + 168 * 3600];
  const u = times.map(() => lats.map(() => lons.map(() => 5)));
  const v = times.map(() => lats.map(() => lons.map(() => 0)));
  return { lats, lons, times, u, v, source: 'GFS', runTime: DEP };
}

const START: LatLon = { lat: 38, lon: -64 };
const END: LatLon = { lat: 40, lon: -62 };

it('auto-motor floors boat speed when polar speed is below the threshold', () => {
  const r = plan({
    start: START,
    end: END,
    departure: DEP,
    wind: uniformWind(),
    polar: SLOW_POLAR,
    polarId: 'slow',
    coastline: NO_COAST,
    options: { avoidLand: false, autoMotor: { minSail: 1.5432, motor: 2.572 } }, // 3 kn / 5 kn
  });
  // Every leg's bsp should be the motor speed (2.572), not the 1.5 polar speed.
  const sailLegs = r.legs.filter((l) => l.bsp > 0 && Math.abs(l.bsp - 1.5) < 0.01);
  expect(sailLegs.length).toBe(0);
  expect(r.legs.some((l) => Math.abs(l.bsp - 2.572) < 0.01)).toBe(true);
});

it('without autoMotor the polar speed is used unchanged', () => {
  const r = plan({
    start: START,
    end: END,
    departure: DEP,
    wind: uniformWind(),
    polar: SLOW_POLAR,
    polarId: 'slow',
    coastline: NO_COAST,
    options: { avoidLand: false },
  });
  expect(r.legs.some((l) => Math.abs(l.bsp - 1.5) < 0.01)).toBe(true);
});

it('cog is populated and equals heading when currents are off', () => {
  const r = plan({
    start: START,
    end: END,
    departure: DEP,
    wind: uniformWind(),
    polar: SLOW_POLAR,
    polarId: 'slow',
    coastline: NO_COAST,
    options: { avoidLand: false, autoMotor: { minSail: 1.5432, motor: 2.572 } },
  });
  // Skip the synthetic start leg (heading 0). For real legs, cog ≈ heading.
  const moving = r.legs.filter((l) => l.bsp > 0).slice(1);
  expect(moving.length).toBeGreaterThan(0);
  for (const l of moving) {
    expect(Math.abs(l.cog - l.heading)).toBeLessThan(1e-6);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/routing/src/auto-motor.test.ts`
Expected: FAIL — `autoMotor` not in `PlanOptions` type (tsc) and `l.cog` undefined.

- [ ] **Step 3: Add the types**

In `packages/routing/src/types.ts`, add to `RouteLeg` (after `heading`):

```ts
  /** Course over ground (water+current), radians true. Equals heading with
   *  currents off. */
  cog: number;
```

Add to `PlanOptions` (after `motorSpeed`):

```ts
  /** Auto-motor: when the polar through-water speed falls below `minSail`
   *  (m/s), substitute `motor` (m/s) for that leg. Evaluated per step because
   *  wind varies along the route. Independent of `motor` (which ignores the
   *  polar entirely). */
  autoMotor?: { minSail: number; motor: number };
```

- [ ] **Step 4: Add `cog` to FrontierNode**

In `packages/routing/src/prune.ts`, add to the `FrontierNode` interface (after `heading`):

```ts
  cog: number;
```

- [ ] **Step 5: Populate cog and apply auto-motor in plan.ts**

In `packages/routing/src/plan.ts`:

In `propagate()`, replace the bsp line:

```ts
  const bsp = o.motor ? o.motorSpeed : interpolatePolarSpeed(input.polar, tws, Math.abs(twa));
```

with:

```ts
  const bspRaw = o.motor ? o.motorSpeed : interpolatePolarSpeed(input.polar, tws, Math.abs(twa));
  const bsp = o.autoMotor && bspRaw < o.autoMotor.minSail ? o.autoMotor.motor : bspRaw;
```

In `propagate()`, the returned node — add `cog: groundBearing` (the `groundBearing` const already exists above the return):

```ts
  return {
    pos: newPos,
    t: n.t + stepSec,
    parent: n,
    heading,
    cog: groundBearing,
    twa: Math.abs(twa),
    tws,
    bsp,
    sogGround,
    distFromStart: n.distFromStart + distance,
  };
```

In `plan()`, the `startNode` literal — add `cog: 0,` after `heading: 0,`.

In `plan()`, the `finalLeg` literal (termination branch) — add `cog: finalHeading,` after `heading: finalHeading,`.

In `assembleRoute()`, the `legs.push({...})` — add `cog: cur.cog,` after `heading: cur.heading,`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/routing/src/auto-motor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Run the routing suite for regressions**

Run: `npx vitest run packages/routing/src`
Expected: all pass (synthetic, prune, plan, property, geometry, fan, wind). The `cog` addition is additive; existing tests don't assert leg shape exhaustively.

- [ ] **Step 8: Typecheck + commit**

Run: `npx tsc -b packages/routing`
Then:

```bash
git add packages/routing/src/types.ts packages/routing/src/prune.ts packages/routing/src/plan.ts packages/routing/src/auto-motor.test.ts
git commit -m "feat(routing): per-step auto-motor speed floor and leg cog"
```

---

## Phase B — API: settings merge + isochrone option + auto-motor units

### Task 2: Planning-settings merge helper

**Files:**
- Create: `packages/web/src/lib/planning-settings.ts`
- Test: `packages/web/src/lib/planning-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/planning-settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PLANNING_DEFAULTS, resolvePlanOptions } from './planning-settings.js';

const KN = 0.514444;

it('returns engine defaults when settings and overrides are empty', () => {
  const o = resolvePlanOptions(undefined, undefined);
  expect(o.stepMinutes).toBe(PLANNING_DEFAULTS.stepMinutes);
  expect(o.avoidLand).toBe(true);
  expect(o.captureIsochrones).toBe(false);
  expect(o.autoMotor).toBeUndefined();
});

it('settings override defaults, request overrides settings', () => {
  const settings = { pruneBucketDeg: 5, avoidLand: true, autoMotor: { enabled: true, minSailKt: 3, motorKt: 6 } };
  const o = resolvePlanOptions(settings, { avoidLand: false, maxHours: 48 });
  expect(o.pruneBucketDeg).toBe(5); // from settings
  expect(o.avoidLand).toBe(false); // request wins
  expect(o.maxHours).toBe(48); // request
});

it('converts auto-motor knots to m/s and only when enabled', () => {
  const on = resolvePlanOptions({ autoMotor: { enabled: true, minSailKt: 3, motorKt: 5 } }, undefined);
  expect(on.autoMotor!.minSail).toBeCloseTo(3 * KN, 5);
  expect(on.autoMotor!.motor).toBeCloseTo(5 * KN, 5);
  const off = resolvePlanOptions({ autoMotor: { enabled: false, minSailKt: 3, motorKt: 5 } }, undefined);
  expect(off.autoMotor).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/planning-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `packages/web/src/lib/planning-settings.ts`:

```ts
const KN_TO_MS = 0.514444;

export interface PlanningSettings {
  stepMinutes?: number;
  pruneBucketDeg?: number;
  headingFanDeg?: number;
  headingResolutionDeg?: number;
  maxHours?: number;
  avoidLand?: boolean;
  autoMotor?: { enabled: boolean; minSailKt: number; motorKt: number };
}

export const PLANNING_DEFAULTS = {
  stepMinutes: 30,
  pruneBucketDeg: 2,
  headingFanDeg: 90,
  headingResolutionDeg: 5,
  maxHours: 168,
  avoidLand: true,
  autoMotor: { enabled: false, minSailKt: 3, motorKt: 5 },
} as const;

/** Plain numeric/boolean PlanOptions plus the m/s autoMotor the engine wants. */
export interface ResolvedPlanOptions {
  stepMinutes: number;
  pruneBucketDeg: number;
  headingFanDeg: number;
  headingResolutionDeg: number;
  maxHours: number;
  avoidLand: boolean;
  captureIsochrones: false;
  autoMotor?: { minSail: number; motor: number };
}

/** Merge engine defaults < settings.planning < per-request overrides. */
export function resolvePlanOptions(
  settings: PlanningSettings | undefined,
  request: Partial<Omit<ResolvedPlanOptions, 'autoMotor' | 'captureIsochrones'>> & {
    autoMotor?: { minSail: number; motor: number };
  } | undefined,
): ResolvedPlanOptions {
  const s = settings ?? {};
  const r = request ?? {};
  const pick = <K extends keyof typeof PLANNING_DEFAULTS>(k: K, rv: unknown): number | boolean =>
    (rv ?? s[k as keyof PlanningSettings] ?? PLANNING_DEFAULTS[k]) as number | boolean;

  const am = s.autoMotor;
  const settingsAutoMotor =
    am && am.enabled ? { minSail: am.minSailKt * KN_TO_MS, motor: am.motorKt * KN_TO_MS } : undefined;

  return {
    stepMinutes: pick('stepMinutes', r.stepMinutes) as number,
    pruneBucketDeg: pick('pruneBucketDeg', r.pruneBucketDeg) as number,
    headingFanDeg: pick('headingFanDeg', r.headingFanDeg) as number,
    headingResolutionDeg: pick('headingResolutionDeg', r.headingResolutionDeg) as number,
    maxHours: pick('maxHours', r.maxHours) as number,
    avoidLand: pick('avoidLand', r.avoidLand) as boolean,
    captureIsochrones: false,
    autoMotor: r.autoMotor ?? settingsAutoMotor,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/planning-settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/planning-settings.ts packages/web/src/lib/planning-settings.test.ts
git commit -m "feat(web): planning-settings merge helper (defaults<settings<request)"
```

### Task 3: Wire the merge into /api/route/plan

**Files:**
- Modify: `packages/web/src/app/api/route/plan/route.ts`

- [ ] **Step 1: Read settings + use the merge**

In `packages/web/src/app/api/route/plan/route.ts`:

Add imports at top:

```ts
import { readJson } from '../../../../lib/persistence';
import { SETTINGS } from '../../../../lib/paths';
import { resolvePlanOptions, type PlanningSettings } from '../../../../lib/planning-settings';
```

Extend the `Body` interface to allow an `autoMotor` in m/s passed from the client and the override fields:

```ts
interface Body {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  useCurrents?: boolean;
  options?: Record<string, unknown> & { autoMotor?: { minSail: number; motor: number } };
}
```

Replace the `plan({...})` `options` construction. Currently:

```ts
      options: { ...(b.options ?? {}), useCurrents: !!b.useCurrents, captureIsochrones: true },
```

with:

```ts
      options: (() => {
        const settings = ((await readJson(SETTINGS)) ?? {}) as { planning?: PlanningSettings };
        const resolved = resolvePlanOptions(settings.planning, b.options as never);
        return { ...resolved, useCurrents: !!b.useCurrents };
      })(),
```

Note: this requires the `options` value to be computed before the `plan()` call. Since `readJson` is async, hoist it above the `plan()` call instead of using an inline IIFE if cleaner:

```ts
    const settings = ((await readJson(SETTINGS)) ?? {}) as { planning?: PlanningSettings };
    const resolved = resolvePlanOptions(settings.planning, b.options as never);
    const route = plan({
      start: b.start,
      end: b.end,
      departure: b.departure,
      wind,
      polar,
      polarId: 'active',
      coastline,
      currents,
      options: { ...resolved, useCurrents: !!b.useCurrents },
    });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b packages/web`
Expected: clean (note: `packages/web` typecheck may take a while; if the project uses `npm run typecheck`, run that).

- [ ] **Step 3: Manual smoke (server running)**

With the dev server up, plan a route via curl (motor off, no isochrones expected):

```bash
DEP=$(( $(date +%s) + 3600 ))
curl -s -X POST http://localhost:3000/api/route/plan -H 'content-type: application/json' \
  -d '{"start":{"lat":40.88,"lon":-69.35},"end":{"lat":36.73,"lon":-65.45},"departure":'$DEP',"model":"GFS","useCurrents":false,"options":{"avoidLand":false,"autoMotor":{"minSail":99,"motor":2.572}}}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['route']; print('legs',len(r['legs']),'iso',len(r.get('isochrones',[])),'cog0',r['legs'][1]['cog'])"
```
Expected: `iso 0` (isochrones dropped), legs present, `cog` field exists. A `minSail:99` (m/s) auto-motor forces motoring everywhere → near-straight route.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/api/route/plan/route.ts
git commit -m "feat(web): /api/route/plan merges settings.planning, drops forced isochrones"
```

---

## Phase C — Settings UI: Planning section

### Task 4: Add a Planning section to Settings

**Files:**
- Modify: `packages/web/src/app/settings/page.tsx`

- [ ] **Step 1: Inspect the page structure**

Run: `grep -n "useState\|/api/settings\|<section\|<h2\|function " packages/web/src/app/settings/page.tsx | head -40`
Identify how the page reads/writes `/api/settings` (it may already load a settings object). Follow the existing pattern for a new section. If the page does not already fetch `/api/settings`, add a `useEffect` that GETs it on mount and a save handler that PUTs the merged object.

- [ ] **Step 2: Add the Planning section component**

Add this section to the settings page JSX (inside the main settings container). It manages a local `planning` object seeded from the loaded settings and PUTs the merged settings on save. Use `PLANNING_DEFAULTS` from the helper:

```tsx
// at top of file:
import { PLANNING_DEFAULTS, type PlanningSettings } from '../../lib/planning-settings';

// component (place near other section components in this file):
function PlanningSection() {
  const [p, setP] = useState<Required<PlanningSettings>>({
    stepMinutes: PLANNING_DEFAULTS.stepMinutes,
    pruneBucketDeg: PLANNING_DEFAULTS.pruneBucketDeg,
    headingFanDeg: PLANNING_DEFAULTS.headingFanDeg,
    headingResolutionDeg: PLANNING_DEFAULTS.headingResolutionDeg,
    maxHours: PLANNING_DEFAULTS.maxHours,
    avoidLand: PLANNING_DEFAULTS.avoidLand,
    autoMotor: { ...PLANNING_DEFAULTS.autoMotor },
  });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.settings?.planning) setP((prev) => ({ ...prev, ...j.settings.planning, autoMotor: { ...prev.autoMotor, ...(j.settings.planning.autoMotor ?? {}) } }));
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setStatus('Saving…');
    const cur = await fetch('/api/settings').then((r) => r.json()).catch(() => ({ settings: {} }));
    const merged = { ...(cur.settings ?? {}), planning: p };
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(merged) });
    setStatus(res.ok ? 'Saved' : 'Save failed');
    setTimeout(() => setStatus(null), 2500);
  };

  const num = (label: string, hint: string, key: keyof PlanningSettings, step = 1, min = 0) => (
    <label className="block text-sm">
      {label}
      <input type="number" min={min} step={step} value={p[key] as number}
        onChange={(e) => setP((s) => ({ ...s, [key]: Number(e.target.value) }))}
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-28 ml-2" />
      <span className="block text-[11px] text-slate-500">{hint}</span>
    </label>
  );

  return (
    <section className="space-y-3 border border-slate-800 rounded p-3">
      <h2 className="text-lg font-semibold">Planning</h2>
      {num('Frontier size (°)', 'Smaller = denser frontier, slower but finer.', 'pruneBucketDeg', 0.5, 0.5)}
      {num('Isochrone length (min)', 'Time between isochrones / planner step.', 'stepMinutes', 5, 5)}
      {num('Heading fan (±°)', 'Search width around bearing-to-destination.', 'headingFanDeg', 5, 5)}
      {num('Heading resolution (°)', 'Headings tried per fan.', 'headingResolutionDeg', 1, 1)}
      {num('Max hours', 'Planning horizon cap.', 'maxHours', 12, 12)}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={p.avoidLand}
          onChange={(e) => setP((s) => ({ ...s, avoidLand: e.target.checked }))} />
        Avoid land (uncheck to skip the land check on open-ocean routes — faster)
      </label>
      <fieldset className="border border-slate-800 rounded p-2 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.autoMotor.enabled}
            onChange={(e) => setP((s) => ({ ...s, autoMotor: { ...s.autoMotor, enabled: e.target.checked } }))} />
          Auto-motor
        </label>
        <div className="text-sm pl-6">
          motor when slower than
          <input type="number" min={0} step={0.5} value={p.autoMotor.minSailKt}
            onChange={(e) => setP((s) => ({ ...s, autoMotor: { ...s.autoMotor, minSailKt: Number(e.target.value) } }))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-16 mx-1" /> kn,
          at
          <input type="number" min={0} step={0.5} value={p.autoMotor.motorKt}
            onChange={(e) => setP((s) => ({ ...s, autoMotor: { ...s.autoMotor, motorKt: Number(e.target.value) } }))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-16 mx-1" /> kn
        </div>
        <p className="text-[11px] text-slate-500 pl-6">Set the threshold high to always motor.</p>
      </fieldset>
      <div className="flex items-center gap-3">
        <button onClick={save} className="bg-emerald-700 px-3 py-1 rounded text-sm">Save planning</button>
        <button onClick={() => setP({ stepMinutes: PLANNING_DEFAULTS.stepMinutes, pruneBucketDeg: PLANNING_DEFAULTS.pruneBucketDeg, headingFanDeg: PLANNING_DEFAULTS.headingFanDeg, headingResolutionDeg: PLANNING_DEFAULTS.headingResolutionDeg, maxHours: PLANNING_DEFAULTS.maxHours, avoidLand: PLANNING_DEFAULTS.avoidLand, autoMotor: { ...PLANNING_DEFAULTS.autoMotor } })}
          className="bg-slate-700 px-3 py-1 rounded text-sm">Reset to defaults</button>
        {status && <span className="text-sm text-slate-400">{status}</span>}
      </div>
    </section>
  );
}
```

Mount `<PlanningSection />` in the page's section list. Ensure `useState`/`useEffect` are imported.

- [ ] **Step 3: Typecheck + prettier**

Run: `npx tsc -b packages/web && npx prettier --write packages/web/src/app/settings/page.tsx`
Expected: clean.

- [ ] **Step 4: Manual check**

Open `/settings`, find Planning, change Frontier size to 5, Save, reload — value persists. `GET /api/settings` shows the `planning` block.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/settings/page.tsx
git commit -m "feat(web): Settings/Planning section for planner defaults"
```

---

## Phase D — Chart Route planner: multi-model, auto-motor, advanced overrides

### Task 5: Rework PlanControls for multi-model + auto-motor + advanced

**Files:**
- Modify: `packages/web/src/components/PlanControls.tsx`

- [ ] **Step 1: Update the PlanRequest type and props**

In `packages/web/src/components/PlanControls.tsx`, change `PlanRequest` so a single submit yields the shared parameters and a list of models (the panel fans out to one request per model):

```ts
export interface PlanParams {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  models: Array<'GFS' | 'ECMWF'>;
  useCurrents: boolean;
  options: {
    avoidLand?: boolean;
    pruneBucketDeg?: number;
    stepMinutes?: number;
    maxHours?: number;
    autoMotor?: { minSail: number; motor: number };
  };
}
```

Replace `onPlan: (req: PlanRequest) => void` prop with `onPlan: (params: PlanParams) => void`.

- [ ] **Step 2: Replace model select + motor checkbox with multi-model + auto-motor + advanced**

Remove the single `<select>` model picker and the "Motor (ignore polar…)" checkbox + motor speed. Add:

- Two model checkboxes (GFS, ECMWF), state `models: { gfs: boolean; ecmwf: boolean }` default both true; require at least one.
- Auto-motor group seeded from `/api/settings` planning (enable + minSailKt + motorKt) — same controls as the Settings section.
- A collapsible "Advanced" `<details>` with: avoidLand checkbox, pruneBucketDeg, stepMinutes, maxHours — all seeded from `/api/settings` planning defaults, each optional (only sent if changed from the loaded default; simplest: always send them).

Seed defaults on mount:

```tsx
useEffect(() => {
  void fetch('/api/settings').then((r) => r.json()).then((j) => {
    const pl = j?.settings?.planning;
    if (pl) {
      if (pl.autoMotor) setAuto({ enabled: !!pl.autoMotor.enabled, minSailKt: pl.autoMotor.minSailKt ?? 3, motorKt: pl.autoMotor.motorKt ?? 5 });
      setAdv((a) => ({ ...a, avoidLand: pl.avoidLand ?? a.avoidLand, pruneBucketDeg: pl.pruneBucketDeg ?? a.pruneBucketDeg, stepMinutes: pl.stepMinutes ?? a.stepMinutes, maxHours: pl.maxHours ?? a.maxHours }));
    }
  }).catch(() => {});
}, []);
```

Use a single model-selection state: `const [models, setModels] = useState({ gfs: true, ecmwf: true });` with two checkboxes bound to `models.gfs` / `models.ecmwf`.

`onSubmit` builds `PlanParams`:

```ts
const KN = 0.514444;
const selected = [models.gfs && 'GFS', models.ecmwf && 'ECMWF'].filter(Boolean) as Array<'GFS' | 'ECMWF'>;
props.onPlan({
  start: props.start!, end: props.end!, departure: Math.floor(departureAnchor),
  models: selected,
  useCurrents,
  options: {
    avoidLand: adv.avoidLand,
    pruneBucketDeg: adv.pruneBucketDeg,
    stepMinutes: adv.stepMinutes,
    maxHours: adv.maxHours,
    autoMotor: auto.enabled ? { minSail: auto.minSailKt * KN, motor: auto.motorKt * KN } : undefined,
  },
});
```

The Plan button is disabled when `!start || !end || models.length === 0 || loading`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b packages/web`
Expected: clean (RoutePlanPanel will be updated in Task 6 to match the new `onPlan` signature — until then tsc fails there; that's fine to fix together. Do Tasks 5 and 6 in one commit if tsc cross-references.)

- [ ] **Step 4: Commit (with Task 6)**

Hold the commit until Task 6 compiles together.

### Task 6: RoutePlanPanel fans out one plan per model, stores routes by model

**Files:**
- Modify: `packages/web/src/app/chart/RoutePlanPanel.tsx`

- [ ] **Step 1: Update onPlan to fire N requests**

Replace the single-fetch `onPlan` with one that loops models, fetching in parallel, and reports a `Record<model, Route>` plus per-model status. New prop shape:

```ts
export function RoutePlanPanel(props: {
  waypoints: Wp[];
  tz: TzMode;
  hasRoute: boolean;
  onRouted: (routes: Partial<Record<'GFS' | 'ECMWF', Route>>) => void;
  onClear: () => void;
}) {
```

Implementation of the handler passed to PlanControls:

```ts
const onPlan = async (params: PlanParams): Promise<void> => {
  setLoading(true);
  setError(null);
  setSummary(null);
  props.onClear();
  const results: Partial<Record<'GFS' | 'ECMWF', Route>> = {};
  const errs: string[] = [];
  await Promise.all(
    params.models.map(async (model) => {
      try {
        const res = await fetch('/api/route/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            start: params.start, end: params.end, departure: params.departure,
            model, useCurrents: params.useCurrents, options: params.options,
          }),
        });
        const j = (await res.json()) as { ok: boolean; route?: Route; error?: { message?: string } };
        if (!j.ok || !j.route) errs.push(`${model}: ${j.error?.message ?? 'plan failed'}`);
        else results[model] = j.route;
      } catch (e) {
        errs.push(`${model}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  setLoading(false);
  if (errs.length) setError(errs.join(' · '));
  if (Object.keys(results).length) {
    const parts = (Object.entries(results) as Array<['GFS' | 'ECMWF', Route]>).map(
      ([m, r]) => `${m}: ${(r.distance / 1852).toFixed(0)} NM / ${((r.end - r.start) / 3600).toFixed(1)} h${r.incomplete ? ' (incomplete)' : ''}`,
    );
    setSummary(parts.join(' · '));
    props.onRouted(results);
  }
};
```

Pass the existing Start/End selects and `<PlanControls .../>` through unchanged except the new `onPlan`.

- [ ] **Step 2: Typecheck both files**

Run: `npx tsc -b packages/web`
Expected: clean.

- [ ] **Step 3: Prettier + commit (Tasks 5 + 6 together)**

```bash
npx prettier --write packages/web/src/components/PlanControls.tsx packages/web/src/app/chart/RoutePlanPanel.tsx
git add packages/web/src/components/PlanControls.tsx packages/web/src/app/chart/RoutePlanPanel.tsx
git commit -m "feat(web): plan GFS+ECMWF together with auto-motor and advanced overrides"
```

---

## Phase E — Chart drawing: colour-coded routes, drop isochrones

### Task 7: Routes-by-model state + colour-coded draw; remove isochrone animation

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`
- Modify: `packages/web/src/components/RoutePolyline.tsx`

- [ ] **Step 1: Simplify RoutePolyline (remove isochrones)**

In `packages/web/src/components/RoutePolyline.tsx`: delete `attachIsochronesUpTo`, `attachIsochrones`, the `ISOCHRONE_*` constants, and the isochrone branches. `attachRoute(map, id, route, color)` should just set/add the line source+layer and `detachRoute(map, id)` removes that line layer+source. Final `attachRoute`:

```ts
export function attachRoute(map: maplibregl.Map, id: string, route: Route, color = '#000000'): void {
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.legs.map((l) => [l.lon, l.lat]) } }],
  };
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (src) { src.setData(data); if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', color); }
  else { map.addSource(id, { type: 'geojson', data }); map.addLayer({ id, type: 'line', source: id, paint: { 'line-color': color, 'line-width': 3 } }); }
  try { map.moveLayer(id); } catch { /* style not ready */ }
}

export function detachRoute(map: maplibregl.Map, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}
```

- [ ] **Step 2: page.tsx — routes-by-model state + colour-coded draw**

In `packages/web/src/app/chart/page.tsx`:

- Replace `const [route, setRoute] = useState<Route | undefined>();` with:

```ts
const [routes, setRoutes] = useState<Partial<Record<'GFS' | 'ECMWF', Route>>>({});
const ROUTE_COLOR: Record<'GFS' | 'ECMWF', string> = { GFS: '#f59e0b', ECMWF: '#22d3ee' };
const ROUTE_LAYER: Record<'GFS' | 'ECMWF', string> = { GFS: 'route-gfs', ECMWF: 'route-ecmwf' };
```

- Remove the `animateNextRef` and the isochrone-animation effect. Replace the route-draw effect with a static colour-coded draw + cleanup of unused layers:

```ts
useEffect(() => {
  const map = mapInstance;
  if (!map) return;
  (['GFS', 'ECMWF'] as const).forEach((m) => {
    const r = routes[m];
    if (r) attachRoute(map, ROUTE_LAYER[m], r, ROUTE_COLOR[m]);
    else detachRoute(map, ROUTE_LAYER[m]);
  });
}, [routes, mapInstance]);
```

- Update localStorage restore/persist to use `routes` (strip isochrones is moot now). Persist `{ routes }`; restore into `setRoutes`.

- `handleRouted` becomes:

```ts
const handleRouted = (next: Partial<Record<'GFS' | 'ECMWF', Route>>): void => {
  setRoutes(next);
  const map = mapInstance;
  if (!map) return;
  if (camera.follow) camera.toggleFollow();
  const pts: Array<{ lat: number; lon: number }> = [];
  for (const r of Object.values(next)) if (r) for (const l of r.legs) pts.push({ lat: l.lat, lon: l.lon });
  if (pts.length >= 2) {
    let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
    for (const p of pts) { latMin = Math.min(latMin, p.lat); latMax = Math.max(latMax, p.lat); lonMin = Math.min(lonMin, p.lon); lonMax = Math.max(lonMax, p.lon); }
    try { map.fitBounds([[lonMin, latMin], [lonMax, latMax]], { padding: 60, duration: 800 }); } catch {}
  }
};
```

- `handleClearRoute`:

```ts
const handleClearRoute = (): void => {
  setRoutes({});
  if (mapInstance) (['GFS','ECMWF'] as const).forEach((m) => detachRoute(mapInstance, ROUTE_LAYER[m]));
};
```

- Update the `<RoutePlanPanel>` props: `hasRoute={Object.keys(routes).length > 0}`, `onRouted={handleRouted}`, `onClear={handleClearRoute}`.

- Update the import: `import { attachRoute, detachRoute } from '../../components/RoutePolyline';` (drop the isochrone helpers).

- [ ] **Step 3: Typecheck + prettier**

Run: `npx tsc -b packages/web && npx prettier --write packages/web/src/app/chart/page.tsx packages/web/src/components/RoutePolyline.tsx`
Expected: clean.

- [ ] **Step 4: Manual check**

Plan both models on `/chart` (land-check off). Expect two lines — GFS amber, ECMWF cyan — and no isochrone fan. Clear removes both.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/page.tsx packages/web/src/components/RoutePolyline.tsx
git commit -m "feat(web): colour-coded GFS/ECMWF route lines; remove isochrone fan"
```

---

## Phase F — Playback: lib + scrubber + per-route details

### Task 8: route-playback interpolation lib

**Files:**
- Create: `packages/web/src/lib/route-playback.ts`
- Test: `packages/web/src/lib/route-playback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/route-playback.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stateAtTime, type PlaybackRoute } from './route-playback.js';

const route: PlaybackRoute = {
  start: 1000,
  end: 1000 + 3600, // two legs, 1800 s each
  legs: [
    { t: 1000, lat: 40, lon: -60, heading: 0, cog: 0, tws: 5, bsp: 2, sogGround: 2 },
    { t: 2800, lat: 41, lon: -60, heading: 0, cog: 0.1, tws: 6, bsp: 3, sogGround: 3 },
    { t: 4600, lat: 42, lon: -60, heading: 0, cog: 0.2, tws: 7, bsp: 4, sogGround: 4 },
  ],
};

it('interpolates position proportionally between two legs', () => {
  const s = stateAtTime(route, 1900); // halfway through leg 0→1
  expect(s.lat).toBeCloseTo(40.5, 3);
  expect(s.lon).toBeCloseTo(-60, 6);
});

it('clamps to start before route.start', () => {
  const s = stateAtTime(route, 0);
  expect(s.lat).toBeCloseTo(40, 6);
  expect(s.atEnd).toBe(false);
  expect(s.beforeStart).toBe(true);
});

it('clamps to destination after route.end', () => {
  const s = stateAtTime(route, 9999);
  expect(s.lat).toBeCloseTo(42, 6);
  expect(s.atEnd).toBe(true);
});

it('reports the active leg state (sog/cog/hdg/bsp)', () => {
  const s = stateAtTime(route, 1900);
  expect(s.sog).toBe(2);
  expect(s.bsp).toBe(2);
  expect(s.hdg).toBe(0);
  expect(s.cog).toBe(0); // active leg is leg index 0
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/lib/route-playback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/web/src/lib/route-playback.ts`:

```ts
export interface PlaybackLeg {
  t: number; // unix seconds at start of leg
  lat: number;
  lon: number;
  heading: number; // rad
  cog: number; // rad
  tws: number; // m/s
  bsp: number; // m/s
  sogGround: number; // m/s
}

export interface PlaybackRoute {
  start: number;
  end: number;
  legs: PlaybackLeg[];
}

export interface PlaybackState {
  lat: number;
  lon: number;
  hdg: number;
  cog: number;
  sog: number;
  bsp: number;
  beforeStart: boolean;
  atEnd: boolean;
}

/** Position + active-leg state at wall-clock time `t`. Clamps outside the
 *  route's [start, end]. Position is linearly interpolated between the two
 *  bracketing legs; SOG/COG/HDG/BSP come from the active (earlier) leg. */
export function stateAtTime(route: PlaybackRoute, t: number): PlaybackState {
  const legs = route.legs;
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  if (t <= first.t) {
    return { lat: first.lat, lon: first.lon, hdg: first.heading, cog: first.cog, sog: first.sogGround, bsp: first.bsp, beforeStart: true, atEnd: false };
  }
  if (t >= last.t) {
    return { lat: last.lat, lon: last.lon, hdg: last.heading, cog: last.cog, sog: last.sogGround, bsp: last.bsp, beforeStart: false, atEnd: true };
  }
  let i = 0;
  for (; i < legs.length - 1; i++) if (t >= legs[i]!.t && t < legs[i + 1]!.t) break;
  const a = legs[i]!;
  const b = legs[i + 1]!;
  const f = (t - a.t) / (b.t - a.t);
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    hdg: a.heading,
    cog: a.cog,
    sog: a.sogGround,
    bsp: a.bsp,
    beforeStart: false,
    atEnd: false,
  };
}

/** Forecast hour (offset from runTime) nearest wall-clock `t`, clamped to the
 *  available hours. */
export function nearestForecastHour(runTime: number, t: number, availableHours: number[]): number | null {
  if (availableHours.length === 0) return null;
  const target = (t - runTime) / 3600;
  let best = availableHours[0]!;
  let bestD = Math.abs(target - best);
  for (const h of availableHours) {
    const d = Math.abs(target - h);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/lib/route-playback.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/route-playback.ts packages/web/src/lib/route-playback.test.ts
git commit -m "feat(web): route-playback interpolation lib"
```

### Task 9: RouteDetailsBox component

**Files:**
- Create: `packages/web/src/app/chart/RouteDetailsBox.tsx`

- [ ] **Step 1: Implement the box**

Create `packages/web/src/app/chart/RouteDetailsBox.tsx`:

```tsx
'use client';
import type { PlaybackState } from '../../lib/route-playback';

const MS_TO_KN = 1.94384;
const RAD_TO_DEG = 180 / Math.PI;
const deg = (rad: number): string => `${Math.round(((rad * RAD_TO_DEG) % 360 + 360) % 360)}° T`;
const kn = (ms: number): string => `${(ms * MS_TO_KN).toFixed(1)} kn`;

export function RouteDetailsBox(props: { model: string; color: string; state: PlaybackState | null }) {
  const s = props.state;
  return (
    <div className="text-xs border rounded p-2 space-y-0.5" style={{ borderColor: props.color }}>
      <div className="font-semibold" style={{ color: props.color }}>
        {props.model}
        {s?.atEnd ? ' · arrived' : s?.beforeStart ? ' · pre-start' : ''}
      </div>
      <div className="font-mono grid grid-cols-2 gap-x-3">
        <span>SOG {s ? kn(s.sog) : '—'}</span>
        <span>BSP {s ? kn(s.bsp) : '—'}</span>
        <span>COG {s ? deg(s.cog) : '—'}</span>
        <span>HDG {s ? deg(s.hdg) : '—'}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + prettier + commit**

```bash
npx tsc -b packages/web && npx prettier --write packages/web/src/app/chart/RouteDetailsBox.tsx
git add packages/web/src/app/chart/RouteDetailsBox.tsx
git commit -m "feat(web): per-route SOG/COG/HDG/BSP details box"
```

### Task 10: PlaybackScrubber + ghost boats + wire into the chart

**Files:**
- Create: `packages/web/src/app/chart/PlaybackScrubber.tsx`
- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: Implement the scrubber + ghost markers**

Create `packages/web/src/app/chart/PlaybackScrubber.tsx`. It owns the playback clock, renders a ghost marker per route via MapLibre markers, drives the wind-hour callback, and reports each route's `PlaybackState` to the parent for the detail boxes.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Route } from '@g5000/routing';
import { stateAtTime, type PlaybackRoute, type PlaybackState } from '../../lib/route-playback';

const MODELS = ['GFS', 'ECMWF'] as const;
type Model = (typeof MODELS)[number];
const COLOR: Record<Model, string> = { GFS: '#f59e0b', ECMWF: '#22d3ee' };
const SPEEDS = [1, 4, 16];

function toPlayback(r: Route): PlaybackRoute {
  return { start: r.start, end: r.end, legs: r.legs };
}

export function PlaybackScrubber(props: {
  map: maplibregl.Map | null;
  routes: Partial<Record<Model, Route>>;
  onStates: (states: Partial<Record<Model, PlaybackState>>) => void;
  onWindHour: (hour: number) => void; // wall-clock-driven; parent maps to overlay
}) {
  const entries = MODELS.filter((m) => props.routes[m]).map((m) => [m, toPlayback(props.routes[m]!)] as const);
  const tMin = entries.length ? Math.min(...entries.map(([, r]) => r.start)) : 0;
  const tMax = entries.length ? Math.max(...entries.map(([, r]) => r.end)) : 0;

  const [t, setT] = useState(tMin);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const markers = useRef<Partial<Record<Model, maplibregl.Marker>>>({});
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);

  // Reset to start whenever the routes change.
  useEffect(() => { setT(tMin); setPlaying(false); }, [tMin, tMax]);

  // Animation loop.
  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt * speed * 60; // 1 real-sec = speed minutes of sim
        if (next >= tMax) { setPlaying(false); return tMax; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed, tMax]);

  // On every t change: move ghosts, push states + wind hour.
  useEffect(() => {
    const map = props.map;
    const states: Partial<Record<Model, PlaybackState>> = {};
    for (const [m, r] of entries) {
      const s = stateAtTime(r, t);
      states[m] = s;
      if (map) {
        let mk = markers.current[m];
        if (!mk) {
          const el = document.createElement('div');
          el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${COLOR[m]};border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,.5)`;
          mk = new maplibregl.Marker({ element: el });
          markers.current[m] = mk;
        }
        mk.setLngLat([s.lon, s.lat]).addTo(map);
      }
    }
    props.onStates(states);
    props.onWindHour(t); // parent maps wall-clock → overlay hour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, props.map, props.routes]);

  // Cleanup markers on unmount / no routes.
  useEffect(() => {
    return () => { for (const m of MODELS) { markers.current[m]?.remove(); markers.current[m] = undefined; } };
  }, []);

  if (entries.length === 0) return null;
  const fmt = (unix: number): string => new Date(unix * 1000).toISOString().slice(11, 16) + 'Z';

  return (
    <section className="space-y-2 bg-slate-900/60 border border-slate-800 rounded p-2">
      <div className="flex items-center gap-2">
        <button onClick={() => setPlaying((p) => !p)} className="px-2 py-1 text-sm bg-slate-700 rounded w-16">
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="text-xs font-mono">{fmt(t)}</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="bg-slate-900 border border-slate-700 rounded text-xs ml-auto">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
      <input type="range" min={tMin} max={tMax} step={60} value={t}
        onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
        className="w-full" />
    </section>
  );
}
```

- [ ] **Step 2: Wire into page.tsx**

In `packages/web/src/app/chart/page.tsx`:

- Add state: `const [playbackStates, setPlaybackStates] = useState<Partial<Record<'GFS'|'ECMWF', PlaybackState>>>({});`
- Map wall-clock → wind hour using the existing `latestRunAt` + `availableHours` and `nearestForecastHour` from the lib; when playback reports a time, set `windHours` (and `setWindLockNow(false)`):

```tsx
import { PlaybackScrubber } from './PlaybackScrubber';
import { RouteDetailsBox } from './RouteDetailsBox';
import { nearestForecastHour } from '../../lib/route-playback';
// ...
const onWindHour = (t: number) => {
  const model = mv.windModel ?? 'gfs';
  const run = latestRunAt[model];
  if (run == null) return;
  const h = nearestForecastHour(run, t, availableHours[model]);
  if (h != null) { setWindLockNow(false); setWindHours(h); }
};
```

- In the sidebar (after `<RoutePlanPanel/>`), mount the scrubber + boxes when routes exist:

```tsx
{Object.keys(routes).length > 0 && (
  <>
    <PlaybackScrubber map={mapInstance} routes={routes} onStates={setPlaybackStates} onWindHour={onWindHour} />
    {(['GFS','ECMWF'] as const).filter((m) => routes[m]).map((m) => (
      <RouteDetailsBox key={m} model={m} color={ROUTE_COLOR[m]} state={playbackStates[m] ?? null} />
    ))}
  </>
)}
```

- [ ] **Step 3: Typecheck + prettier**

Run: `npx tsc -b packages/web && npx prettier --write packages/web/src/app/chart/PlaybackScrubber.tsx packages/web/src/app/chart/page.tsx`
Expected: clean.

- [ ] **Step 4: Manual check (browser)**

Plan both models. A playback panel + two colour-keyed detail boxes appear. Press Play: two ghost dots walk their routes, SOG/COG/HDG/BSP update, the wind overlay steps with time, ghosts park at their destinations. Scrubbing the slider scrubs both. Clear route hides scrubber + boxes + ghosts.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/chart/PlaybackScrubber.tsx packages/web/src/app/chart/page.tsx
git commit -m "feat(web): route playback scrubber with ghost boats and per-route readouts"
```

---

## Final verification

- [ ] **Engine + lib tests:** `npx vitest run packages/routing/src packages/web/src/lib/planning-settings.test.ts packages/web/src/lib/route-playback.test.ts` → all pass.
- [ ] **Typecheck whole repo:** `npm run typecheck` → clean.
- [ ] **Prettier:** `npm run lint` → clean (or `npm run format`).
- [ ] **Browser end-to-end:** Settings/Planning change persists and is honoured by a plan; dual-model plan draws two colour-coded routes with no isochrones; auto-motor high-threshold forces a motor route; playback walks both ghosts with live SOG/COG/HDG/BSP and steps the wind overlay.
