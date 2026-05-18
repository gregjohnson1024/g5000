# Sail-Crossover Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the operator which sail configuration is best for the current and forecasted wind, integrated with the existing routing engine — chart on /sails, live badge on /helm, forecast timeline on /sails, and wardrobe-aware route planning.

**Architecture:** Three new compute pieces (`computeCrossoverGrid` pure function, `startSailRecommendationPipeline` RxJS pipeline publishing to the shared bus, and a `plan()` expansion that picks the fastest config per node) feed four UI surfaces (live recommendation panel on /sails, crossover-chart heatmap on /sails, sail-recommendation tile on /helm, forecast timeline on /sails after a wardrobe-aware route plan). No new HTTP endpoints — the recommendation flows over the existing `/api/stream` SSE. No schema changes — `WardrobeSettings` is an optional field on the existing `SailWardrobe` with defaults applied on read. Config colors derive from a stable hash of `configId`.

**Tech Stack:** TypeScript (strict, ESM), RxJS 7, Next.js 16 App Router (UI), Vitest + fast-check (tests), Drizzle ORM (data, but no schema migration needed).

**Spec:** `docs/superpowers/specs/2026-05-18-sail-crossover-chart-design.md`

---

## Working environment

All work happens inside the worktree at `/Users/gregjohnson/code/g5000/.worktrees/issue-3-sail-crossover/`, on branch `issue-3-sail-crossover` (off `develop`). Commits push to `origin/issue-3-sail-crossover`. **Do not merge to main during implementation — the Pi runs main.** Integration happens via merging this branch into `develop` after all tasks are done; promote to `main` later when ready to deploy.

For composite-ref builds (Task 10 onward touches `@g5000/db` types consumed by `@g5000/routing` and `@g5000/web`), the rebuild order from CLAUDE.md applies: `tsc -b core db compute bridge grib` → autopilot-server build → web build.

---

## Task 1: Add `WardrobeSettings` type + defaults

**Files:**
- Modify: `packages/db/src/defaults.ts`

- [ ] **Step 1: Append the type and defaults below `SailWardrobe` in `defaults.ts`**

After the existing `SailWardrobe` interface (around line ~120-150 of `defaults.ts`), append:

```typescript
/**
 * Per-wardrobe user settings — only used for the sail-crossover chart and
 * the live-recommendation hysteresis threshold. Stored alongside the
 * wardrobe in the same DB row; defaults applied on read for older records
 * that don't carry a `settings` field.
 */
export interface WardrobeSettings {
  /** Live recommendation fires "change recommended" only when the winning
   *  config is this much faster than the active config (relative %). */
  hysteresisPercent: number;
  /** Crossover chart X-axis (TWS) upper bound in knots. Lower is always 0. */
  chartTwsMaxKn: number;
  /** Crossover chart Y-axis (TWA) lower bound in degrees. */
  chartTwaMinDeg: number;
  /** Crossover chart Y-axis (TWA) upper bound in degrees. */
  chartTwaMaxDeg: number;
  /** Forecast-timeline sample interval (minutes). */
  forecastIntervalMinutes: number;
  /** Forecast-timeline duration along the route (hours). */
  forecastDurationHours: number;
}

export const DEFAULT_WARDROBE_SETTINGS: WardrobeSettings = {
  hysteresisPercent: 3,
  chartTwsMaxKn: 30,
  chartTwaMinDeg: 30,
  chartTwaMaxDeg: 180,
  forecastIntervalMinutes: 30,
  forecastDurationHours: 12,
};

/**
 * Read-side default-merger. `SailWardrobe.settings` is optional on disk;
 * call this from every read path so consumers always see a complete
 * `WardrobeSettings`.
 */
export function wardrobeSettingsOf(w: SailWardrobe): WardrobeSettings {
  return { ...DEFAULT_WARDROBE_SETTINGS, ...(w.settings ?? {}) };
}
```

Then modify the `SailWardrobe` interface to add the optional field:

```typescript
export interface SailWardrobe {
  configs: SailConfig[];
  activeConfigId: string;
  /** Optional — defaults applied via wardrobeSettingsOf(). Schema not migrated;
   *  older records load with undefined and get defaults on read. */
  settings?: WardrobeSettings;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc -b packages/db`
Expected: exit 0, no output.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/defaults.ts
git commit -m "feat(db): WardrobeSettings type with defaults, optional on SailWardrobe"
```

---

## Task 2: Pure function `computeCrossoverGrid` + tests

**Files:**
- Create: `packages/compute/src/sail-crossover/compute.ts`
- Create: `packages/compute/src/sail-crossover/compute.test.ts`
- Create: `packages/compute/src/sail-crossover/index.ts`
- Modify: `packages/compute/src/index.ts` (re-export the module)

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/sail-crossover/compute.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARDROBE_SETTINGS,
  type PolarTable,
  type SailWardrobe,
} from '@g5000/db';
import { computeCrossoverGrid } from './compute.js';

// Tiny polar helper: constant boat speed everywhere, for predictable tests.
function flatPolar(speed: number): PolarTable {
  return {
    twsBins: [0, 5, 10, 15, 20, 25, 30],
    twaBins: [Math.PI / 6, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    boatSpeed: [0, 5, 10, 15, 20, 25, 30].map(() => [speed, speed, speed, speed, speed]),
  };
}

describe('computeCrossoverGrid', () => {
  it('returns the only config as the winner everywhere when the wardrobe has one entry', () => {
    const w: SailWardrobe = {
      configs: [{ id: 'only', name: 'Only', polar: flatPolar(5) }],
      activeConfigId: 'only',
    };
    const grid = computeCrossoverGrid(w, DEFAULT_WARDROBE_SETTINGS);
    for (const row of grid.cells) {
      for (const cell of row) {
        expect(cell.winningConfigId).toBe('only');
        expect(cell.winningSpeedKn).toBeGreaterThan(0);
        expect(cell.runnerUpConfigId).toBe(null);
      }
    }
  });

  it('picks the faster config in a two-config wardrobe', () => {
    const w: SailWardrobe = {
      configs: [
        { id: 'slow', name: 'Slow', polar: flatPolar(3) },
        { id: 'fast', name: 'Fast', polar: flatPolar(7) },
      ],
      activeConfigId: 'slow',
    };
    const grid = computeCrossoverGrid(w, DEFAULT_WARDROBE_SETTINGS);
    for (const row of grid.cells) {
      for (const cell of row) {
        expect(cell.winningConfigId).toBe('fast');
        expect(cell.runnerUpConfigId).toBe('slow');
      }
    }
  });

  it('produces a grid sized by settings + step opts', () => {
    const w: SailWardrobe = {
      configs: [{ id: 'a', name: 'A', polar: flatPolar(5) }],
      activeConfigId: 'a',
    };
    const grid = computeCrossoverGrid(w, DEFAULT_WARDROBE_SETTINGS, {
      twsStepKn: 5,
      twaStepDeg: 30,
    });
    // TWS 0..30 step 5 → 7 bins; TWA 30..180 step 30 → 6 bins.
    expect(grid.twsBins.length).toBe(7);
    expect(grid.twaBins.length).toBe(6);
    expect(grid.cells.length).toBe(7);
    expect(grid.cells[0]!.length).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/sail-crossover/compute.test.ts`
Expected: FAIL — `Cannot find module './compute.js'`.

- [ ] **Step 3: Implement `computeCrossoverGrid`**

Create `packages/compute/src/sail-crossover/compute.ts`:

```typescript
import type { SailWardrobe, WardrobeSettings } from '@g5000/db';
import { interpolatePolarSpeed } from '../polars/math.js';

export interface CrossoverCell {
  /** Config id that wins at this (TWS, TWA), or null if no config has data. */
  winningConfigId: string | null;
  /** Winner's boat speed at this cell, in knots. */
  winningSpeedKn: number | null;
  /** Second-best config id at this cell; null when only one config is present. */
  runnerUpConfigId: string | null;
  /** Second-best speed (knots); null when only one config is present. */
  runnerUpSpeedKn: number | null;
}

export interface CrossoverGrid {
  /** Ascending TWS bin centers, knots. */
  twsBins: number[];
  /** Ascending TWA bin centers, degrees. */
  twaBins: number[];
  /** cells[twsIdx][twaIdx]. */
  cells: CrossoverCell[][];
}

export interface CrossoverOpts {
  /** TWS bin width in knots. Default 1. */
  twsStepKn?: number;
  /** TWA bin width in degrees. Default 5. */
  twaStepDeg?: number;
}

const KN_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;
const MS_TO_KN = 1 / KN_TO_MS;

/**
 * For each (TWS, TWA) bin in the configured chart range, interpolate every
 * wardrobe config's polar and pick the fastest. Sharp boundaries — hysteresis
 * is a presentation/recommendation concern, not a grid-coloring one.
 *
 * Pure. Fast. ~30 × 30 × 5 configs ≈ 4500 lookups; well under 10 ms.
 */
export function computeCrossoverGrid(
  wardrobe: SailWardrobe,
  settings: WardrobeSettings,
  opts: CrossoverOpts = {},
): CrossoverGrid {
  const twsStep = opts.twsStepKn ?? 1;
  const twaStep = opts.twaStepDeg ?? 5;

  const twsBins: number[] = [];
  for (let v = 0; v <= settings.chartTwsMaxKn + 1e-9; v += twsStep) {
    twsBins.push(Number(v.toFixed(4)));
  }
  const twaBins: number[] = [];
  for (let v = settings.chartTwaMinDeg; v <= settings.chartTwaMaxDeg + 1e-9; v += twaStep) {
    twaBins.push(Number(v.toFixed(4)));
  }

  const cells: CrossoverCell[][] = twsBins.map((twsKn) =>
    twaBins.map((twaDeg) => {
      const twsMs = twsKn * KN_TO_MS;
      const twaRad = twaDeg * DEG_TO_RAD;
      let best: { id: string; kn: number } | null = null;
      let second: { id: string; kn: number } | null = null;
      for (const c of wardrobe.configs) {
        const bspMs = interpolatePolarSpeed(c.polar, twsMs, twaRad);
        if (!Number.isFinite(bspMs) || bspMs <= 0) continue;
        const kn = bspMs * MS_TO_KN;
        if (!best || kn > best.kn) {
          second = best;
          best = { id: c.id, kn };
        } else if (!second || kn > second.kn) {
          second = { id: c.id, kn };
        }
      }
      return {
        winningConfigId: best?.id ?? null,
        winningSpeedKn: best?.kn ?? null,
        runnerUpConfigId: second?.id ?? null,
        runnerUpSpeedKn: second?.kn ?? null,
      };
    }),
  );

  return { twsBins, twaBins, cells };
}
```

Create the barrel `packages/compute/src/sail-crossover/index.ts`:

```typescript
export * from './compute.js';
```

Add re-export at the bottom of `packages/compute/src/index.ts`:

```typescript
export * from './sail-crossover/index.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/sail-crossover/compute.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/sail-crossover/ packages/compute/src/index.ts
git commit -m "feat(compute): computeCrossoverGrid pure function + tests"
```

---

## Task 3: `getConfigColor` stable-hash helper + test

**Files:**
- Create: `packages/web/src/lib/config-color.ts`
- Create: `packages/web/src/lib/config-color.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/config-color.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getConfigColor } from './config-color';

describe('getConfigColor', () => {
  it('returns a stable HSL color for the same id', () => {
    const a = getConfigColor('full-j1');
    const b = getConfigColor('full-j1');
    expect(a).toBe(b);
    expect(a).toMatch(/^hsl\(/);
  });

  it('produces different colors for different ids in the same wardrobe', () => {
    const ids = ['full-j1', 'reef1-a2', 'storm-jib', 'code-0'];
    const colors = new Set(ids.map(getConfigColor));
    expect(colors.size).toBe(ids.length);
  });

  it('handles empty string safely', () => {
    const c = getConfigColor('');
    expect(c).toMatch(/^hsl\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/lib/config-color.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/web/src/lib/config-color.ts`:

```typescript
/**
 * Stable color for a sail-config id. Hue is derived from a tiny FNV-1a
 * hash of the id so the same id always yields the same hue, and unrelated
 * ids land at different hues. Saturation/lightness fixed for a coherent
 * palette across the chart, helm badge, and timeline.
 *
 * No schema change — the persisted color field is captured as a future
 * issue. v1: identifiers map deterministically to hues.
 */
export function getConfigColor(id: string): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Spread the hash across 360° of hue. Use the lower 16 bits modulo for
  // a flat distribution.
  const hue = ((h >>> 0) & 0xffff) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run src/lib/config-color.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/gregjohnson/code/g5000/.worktrees/issue-3-sail-crossover
git add packages/web/src/lib/config-color.ts packages/web/src/lib/config-color.test.ts
git commit -m "feat(web): getConfigColor stable-hash helper"
```

---

## Task 4: Live recommendation RxJS pipeline + tests

**Files:**
- Create: `packages/compute/src/sail-crossover/pipeline.ts`
- Create: `packages/compute/src/sail-crossover/pipeline.test.ts`
- Modify: `packages/compute/src/sail-crossover/index.ts` (re-export the new module)

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/sail-crossover/pipeline.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import {
  _resetSharedBusForTests,
  getSharedBus,
  type Sample,
} from '@g5000/core';
import {
  DEFAULT_WARDROBE_SETTINGS,
  type PolarTable,
  type SailWardrobe,
  type WardrobeSettings,
} from '@g5000/db';
import {
  startSailRecommendationPipeline,
  type SailRecommendation,
} from './pipeline.js';

const KN_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

function flatPolar(speedKn: number): PolarTable {
  const speedMs = speedKn * KN_TO_MS;
  return {
    twsBins: [0, 5, 10, 15, 20, 25, 30].map((k) => k * KN_TO_MS),
    twaBins: [30, 60, 90, 120, 150, 180].map((d) => d * DEG_TO_RAD),
    boatSpeed: [0, 5, 10, 15, 20, 25, 30].map(() => [speedMs, speedMs, speedMs, speedMs, speedMs, speedMs]),
  };
}

// Minimal stub matching the surface our pipeline needs from ConfigStore.
function makeStubStore(wardrobe: SailWardrobe, settings: WardrobeSettings) {
  return {
    sails$: new BehaviorSubject<SailWardrobe>(wardrobe),
    wardrobeSettings$: new BehaviorSubject<WardrobeSettings>(settings),
  };
}

describe('startSailRecommendationPipeline', () => {
  beforeEach(() => {
    _resetSharedBusForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function pubWind(twsKn: number, twaDeg: number): void {
    const bus = getSharedBus();
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: 'wind.true.speed',
      value: twsKn * KN_TO_MS,
      unit: 'm/s',
      source: 'test',
      t_ns: now_ns,
    } as Sample);
    bus.publish({
      channel: 'wind.true.angle',
      value: twaDeg * DEG_TO_RAD,
      unit: 'rad',
      source: 'test',
      t_ns: now_ns,
    } as Sample);
  }

  it('publishes the faster config as the winner', async () => {
    const w: SailWardrobe = {
      configs: [
        { id: 'slow', name: 'Slow', polar: flatPolar(3) },
        { id: 'fast', name: 'Fast', polar: flatPolar(7) },
      ],
      activeConfigId: 'slow',
    };
    const store = makeStubStore(w, DEFAULT_WARDROBE_SETTINGS);
    const bus = getSharedBus();
    const seen: SailRecommendation[] = [];
    const unsub = bus.subscribe('wardrobe.recommendation', (s) => {
      seen.push(s.value as SailRecommendation);
    });
    const stop = await startSailRecommendationPipeline({
      bus,
      configStore: store as never,
    });
    pubWind(12, 90);
    vi.advanceTimersByTime(600); // past auditTime(500)
    expect(seen.length).toBeGreaterThan(0);
    const r = seen[seen.length - 1]!;
    expect(r.recommendedConfigId).toBe('fast');
    expect(r.activeConfigId).toBe('slow');
    expect(r.shouldChange).toBe(true);
    unsub();
    await stop();
  });

  it('does not flag shouldChange below hysteresis threshold', async () => {
    const w: SailWardrobe = {
      configs: [
        { id: 'a', name: 'A', polar: flatPolar(6.0) },
        { id: 'b', name: 'B', polar: flatPolar(6.1) }, // 1.7% gap, under default 3%
      ],
      activeConfigId: 'a',
    };
    const store = makeStubStore(w, DEFAULT_WARDROBE_SETTINGS);
    const bus = getSharedBus();
    const seen: SailRecommendation[] = [];
    const unsub = bus.subscribe('wardrobe.recommendation', (s) => {
      seen.push(s.value as SailRecommendation);
    });
    const stop = await startSailRecommendationPipeline({
      bus,
      configStore: store as never,
    });
    pubWind(12, 90);
    vi.advanceTimersByTime(600);
    const r = seen[seen.length - 1]!;
    expect(r.recommendedConfigId).toBe('b');
    expect(r.shouldChange).toBe(false);
    unsub();
    await stop();
  });

  it('marks stale after 30 s of no wind', async () => {
    const w: SailWardrobe = {
      configs: [{ id: 'only', name: 'Only', polar: flatPolar(5) }],
      activeConfigId: 'only',
    };
    const store = makeStubStore(w, DEFAULT_WARDROBE_SETTINGS);
    const bus = getSharedBus();
    const seen: SailRecommendation[] = [];
    const unsub = bus.subscribe('wardrobe.recommendation', (s) => {
      seen.push(s.value as SailRecommendation);
    });
    const stop = await startSailRecommendationPipeline({
      bus,
      configStore: store as never,
    });
    pubWind(10, 90);
    vi.advanceTimersByTime(600);
    expect(seen.at(-1)?.stale).toBe(false);
    vi.advanceTimersByTime(31_000); // past 30 s stale window
    expect(seen.at(-1)?.stale).toBe(true);
    unsub();
    await stop();
  });

  it('returns a clean teardown', async () => {
    const w: SailWardrobe = {
      configs: [{ id: 'only', name: 'Only', polar: flatPolar(5) }],
      activeConfigId: 'only',
    };
    const store = makeStubStore(w, DEFAULT_WARDROBE_SETTINGS);
    const bus = getSharedBus();
    const stop = await startSailRecommendationPipeline({
      bus,
      configStore: store as never,
    });
    await expect(stop()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/sail-crossover/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pipeline**

Create `packages/compute/src/sail-crossover/pipeline.ts`:

```typescript
import { auditTime, firstValueFrom, Subject, Subscription, type Observable } from 'rxjs';
import type { Bus } from '@g5000/core';
import type {
  SailWardrobe,
  WardrobeSettings,
} from '@g5000/db';
import { interpolatePolarSpeed } from '../polars/math.js';

const MS_TO_KN = 1 / 0.514444;
const STALE_MS = 30_000;

export interface SailRecommendation {
  recommendedConfigId: string | null;
  recommendedSpeedKn: number | null;
  activeConfigId: string;
  activeSpeedKn: number | null;
  /** (recommendedSpeed − activeSpeed) / activeSpeed × 100. 0 when equal. */
  gapPercent: number;
  shouldChange: boolean;
  /** True when no fresh wind sample in STALE_MS; values are last known-good. */
  stale: boolean;
}

/**
 * Minimal store shape the pipeline depends on. Decoupled from ConfigStore's
 * full surface so tests can pass a tiny BehaviorSubject-based stub.
 */
export interface PipelineStore {
  sails$: Observable<SailWardrobe>;
  wardrobeSettings$: Observable<WardrobeSettings>;
}

export interface PipelineOpts {
  bus: Bus;
  configStore: PipelineStore;
}

interface LatestWind {
  tws_ms: number;
  twa_rad: number;
  t_ns: bigint;
}

/**
 * Subscribes to wind.true.speed + wind.true.angle, combines with the active
 * wardrobe + settings, computes per-tick argmax over the configs, and
 * publishes a SailRecommendation on the wardrobe.recommendation channel.
 *
 * Throttled with auditTime(500ms) — live wind can fire 10×/sec; the panel
 * doesn't need that. Stale-wind detection (no fresh sample in 30 s) flips
 * the `stale` flag but keeps publishing the last known-good values so the
 * UI can fall back gracefully.
 *
 * Pattern follows the existing `startPolarPipeline`: read the initial
 * wardrobe + settings via firstValueFrom (resolves synchronously for
 * BehaviorSubject-backed observables), then subscribe to update the cached
 * locals. The Bus's `subscribe(pattern, cb)` API doesn't return an
 * Observable, so we bridge wind samples into a local Subject and pipe
 * THAT through auditTime.
 */
export async function startSailRecommendationPipeline(
  opts: PipelineOpts,
): Promise<() => Promise<void>> {
  const { bus, configStore } = opts;
  let latestWind: LatestWind | null = null;
  let lastEmittedAt = 0;

  // Cache the current wardrobe + settings locally — same pattern as
  // packages/compute/src/polars/pipeline.ts.
  let wardrobe: SailWardrobe = await firstValueFrom(configStore.sails$);
  let settings: WardrobeSettings = await firstValueFrom(configStore.wardrobeSettings$);

  const busUnsubs: Array<() => void> = [];
  const rxSubs: Subscription[] = [];

  // Keep wardrobe + settings fresh as the user edits them via /sails.
  rxSubs.push(configStore.sails$.subscribe((w) => (wardrobe = w)));
  rxSubs.push(configStore.wardrobeSettings$.subscribe((s) => (settings = s)));

  // Wind sample bridge: Bus → local Subject (so we can pipe auditTime).
  const windTick$ = new Subject<void>();
  busUnsubs.push(
    bus.subscribe('wind.true.speed', (s) => {
      latestWind = {
        tws_ms: s.value as number,
        twa_rad: latestWind?.twa_rad ?? 0,
        t_ns: s.t_ns,
      };
      windTick$.next();
    }),
  );
  busUnsubs.push(
    bus.subscribe('wind.true.angle', (s) => {
      latestWind = {
        tws_ms: latestWind?.tws_ms ?? 0,
        twa_rad: s.value as number,
        t_ns: s.t_ns,
      };
      windTick$.next();
    }),
  );

  function recompute(stale: boolean): SailRecommendation | null {
    if (!latestWind) return null;

    const tws = latestWind.tws_ms;
    const twa = Math.abs(latestWind.twa_rad);
    let best: { id: string; kn: number } | null = null;
    let activeKn: number | null = null;
    for (const c of wardrobe.configs) {
      const bspMs = interpolatePolarSpeed(c.polar, tws, twa);
      if (!Number.isFinite(bspMs) || bspMs <= 0) continue;
      const kn = bspMs * MS_TO_KN;
      if (c.id === wardrobe.activeConfigId) activeKn = kn;
      if (!best || kn > best.kn) best = { id: c.id, kn };
    }
    const recommendedConfigId = best?.id ?? null;
    const recommendedSpeedKn = best?.kn ?? null;
    const activeConfigId = wardrobe.activeConfigId;
    const activeSpeedKn = activeKn;
    const gapPercent =
      recommendedSpeedKn !== null && activeSpeedKn && activeSpeedKn > 0
        ? ((recommendedSpeedKn - activeSpeedKn) / activeSpeedKn) * 100
        : 0;
    const shouldChange =
      recommendedConfigId !== null &&
      recommendedConfigId !== activeConfigId &&
      gapPercent > settings.hysteresisPercent;
    return {
      recommendedConfigId,
      recommendedSpeedKn,
      activeConfigId,
      activeSpeedKn,
      gapPercent,
      shouldChange,
      stale,
    };
  }

  function publish(rec: SailRecommendation): void {
    bus.publish({
      channel: 'wardrobe.recommendation',
      value: rec,
      unit: 'json',
      source: 'sail-crossover-pipeline',
      t_ns: BigInt(Date.now()) * 1_000_000n,
    });
    lastEmittedAt = Date.now();
  }

  // Audit-throttle: fire at most every 500 ms while wind ticks arrive.
  rxSubs.push(
    windTick$.pipe(auditTime(500)).subscribe(() => {
      const rec = recompute(false);
      if (rec) publish(rec);
    }),
  );

  // Stale watchdog — every 1 s, if last emit was > STALE_MS ago, re-emit
  // the last computed recommendation with stale: true so the UI can dim.
  const staleTimer = setInterval(() => {
    if (!lastEmittedAt) return;
    if (Date.now() - lastEmittedAt < STALE_MS) return;
    const rec = recompute(true);
    if (rec) publish(rec);
  }, 1000);

  return async () => {
    for (const u of busUnsubs) u();
    for (const s of rxSubs) s.unsubscribe();
    clearInterval(staleTimer);
  };
}
```

Append re-export to `packages/compute/src/sail-crossover/index.ts`:

```typescript
export * from './compute.js';
export * from './pipeline.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/sail-crossover/pipeline.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/sail-crossover/
git commit -m "feat(compute): live sail-recommendation pipeline publishing to bus"
```

---

## Task 5: ConfigStore exposes `wardrobeSettings$`

The pipeline test stubbed `wardrobeSettings$`. Add the real observable so the autopilot-server boot can wire the pipeline against the real ConfigStore in Task 6.

**Files:**
- Modify: `packages/db/src/config-store.ts`
- Modify: `packages/db/src/config-store.test.ts` (extend)

- [ ] **Step 1: Add failing test for the new observable**

Append to `packages/db/src/config-store.test.ts`:

```typescript
import {
  DEFAULT_WARDROBE_SETTINGS,
  wardrobeSettingsOf,
} from './defaults.js';
import { firstValueFrom } from 'rxjs';

describe('ConfigStore.wardrobeSettings$', () => {
  it('emits defaults when the wardrobe has no settings field', async () => {
    const store = await ConfigStore.open(':memory:');
    const got = await firstValueFrom(store.wardrobeSettings$);
    expect(got).toEqual(DEFAULT_WARDROBE_SETTINGS);
    await store.close();
  });

  it('emits merged settings when partial settings are persisted', async () => {
    const store = await ConfigStore.open(':memory:');
    const w = await firstValueFrom(store.sails$);
    await store.setSails({
      ...w,
      settings: { ...DEFAULT_WARDROBE_SETTINGS, hysteresisPercent: 10 },
    });
    const got = await firstValueFrom(store.wardrobeSettings$);
    expect(got.hysteresisPercent).toBe(10);
    expect(got.chartTwsMaxKn).toBe(DEFAULT_WARDROBE_SETTINGS.chartTwsMaxKn);
    await store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/src/config-store.test.ts`
Expected: FAIL — `wardrobeSettings$` undefined.

- [ ] **Step 3: Implement the derived observable**

In `packages/db/src/config-store.ts`, near the other `*$` getters, add:

```typescript
import { map } from 'rxjs/operators';
import { wardrobeSettingsOf, type WardrobeSettings } from './defaults.js';

// (inside class ConfigStore, alongside the other getters)

get wardrobeSettings$(): Observable<WardrobeSettings> {
  return this.subjects.sails.pipe(map(wardrobeSettingsOf));
}
```

If `map` is already imported, skip that line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/db/src/config-store.test.ts`
Expected: PASS — all ConfigStore tests including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/config-store.ts packages/db/src/config-store.test.ts
git commit -m "feat(db): ConfigStore.wardrobeSettings\$ derived observable"
```

---

## Task 6: Wire the recommendation pipeline into the autopilot-server boot

**Files:**
- Modify: `apps/autopilot-server/src/index.ts`

- [ ] **Step 1: Add the import + start call**

In `apps/autopilot-server/src/index.ts`, near the existing `startPolarPipeline` import, add:

```typescript
import {
  startTrueWindPipeline,
  startPolarPipeline,
  startSailRecommendationPipeline,
} from '@g5000/compute';
```

Then in `main()`, after `startPolarPipeline` is started (and `stops.push` registered), add:

```typescript
const stopSailRec = await startSailRecommendationPipeline({ bus, configStore: store });
stops.push(stopSailRec);
// eslint-disable-next-line no-console
console.log('[autopilot] sail-recommendation pipeline online');
```

- [ ] **Step 2: Build the affected packages**

Run: `npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib && npm run build --workspace @g5000/autopilot-server`
Expected: exit 0.

- [ ] **Step 3: Smoke-test by starting the dev server and curl-ing the recommendation channel**

Start the dev server in another shell: `npm run dev --workspace @g5000/autopilot-server`. Then in a terminal:

```bash
curl -sN -m 5 "http://localhost:3000/api/stream" | grep --line-buffered "wardrobe.recommendation" | head -1
```

Expected: One SSE line within ~1 second containing `"channel":"wardrobe.recommendation"` and a JSON `value` object with `recommendedConfigId`, `activeConfigId`, etc. If no live wind is publishing (Mac dev without YDWG/NGT-1), trigger demo mode: POST `{"mode":"demo"}` to `/api/source-mode`, then retry the curl.

- [ ] **Step 4: Commit**

```bash
git add apps/autopilot-server/src/index.ts
git commit -m "feat(autopilot-server): start sail-recommendation pipeline at boot"
```

---

## Task 7: `/sails` — Live Recommendation panel

**Files:**
- Create: `packages/web/src/app/sails/RecommendationPanel.tsx`
- Modify: `packages/web/src/app/sails/page.tsx`

- [ ] **Step 1: Implement the panel component**

Create `packages/web/src/app/sails/RecommendationPanel.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import type { SailWardrobe } from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

interface Recommendation {
  recommendedConfigId: string | null;
  recommendedSpeedKn: number | null;
  activeConfigId: string;
  activeSpeedKn: number | null;
  gapPercent: number;
  shouldChange: boolean;
  stale: boolean;
}

/** Subscribes to /api/stream filtered to wardrobe.recommendation. */
function useRecommendation(): Recommendation | null {
  const [rec, setRec] = useState<Recommendation | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const sample = JSON.parse(e.data) as { channel: string; value: unknown };
        if (sample.channel === 'wardrobe.recommendation') {
          setRec(sample.value as Recommendation);
        }
      } catch {
        /* ignore malformed lines */
      }
    };
    return () => es.close();
  }, []);
  return rec;
}

function nameOf(wardrobe: SailWardrobe, id: string | null): string {
  if (!id) return '—';
  return wardrobe.configs.find((c) => c.id === id)?.name ?? id;
}

export function RecommendationPanel({ wardrobe }: { wardrobe: SailWardrobe }) {
  const rec = useRecommendation();

  if (!rec) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-4">
        <div className="text-xs text-slate-500">SAIL RECOMMENDATION</div>
        <div className="mt-1 text-slate-400 italic">Waiting for live wind…</div>
      </div>
    );
  }

  const recName = nameOf(wardrobe, rec.recommendedConfigId);
  const actName = nameOf(wardrobe, rec.activeConfigId);
  const recColor = rec.recommendedConfigId ? getConfigColor(rec.recommendedConfigId) : '#888';
  const actColor = getConfigColor(rec.activeConfigId);

  let border = 'border-slate-700';
  let label = 'in sync';
  if (rec.stale) {
    border = 'border-slate-600 opacity-60';
    label = 'stale wind';
  } else if (rec.shouldChange) {
    border = 'border-rose-600';
    label = `change recommended (+${rec.gapPercent.toFixed(1)}%)`;
  } else if (rec.recommendedConfigId !== rec.activeConfigId) {
    border = 'border-amber-600';
    label = `under threshold (+${rec.gapPercent.toFixed(1)}%)`;
  }

  return (
    <div className={`rounded border ${border} bg-slate-900 p-4 space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">SAIL RECOMMENDATION</div>
        <div className="text-xs text-slate-400">{label}</div>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-slate-500">Active</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: actColor }} />
            <span className="font-mono text-slate-100">{actName}</span>
          </div>
          <div className="text-xs text-slate-400">
            {rec.activeSpeedKn !== null ? `${rec.activeSpeedKn.toFixed(2)} kn` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Recommended</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: recColor }} />
            <span className="font-mono text-slate-100">{recName}</span>
          </div>
          <div className="text-xs text-slate-400">
            {rec.recommendedSpeedKn !== null ? `${rec.recommendedSpeedKn.toFixed(2)} kn` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the panel on the /sails page**

Edit `packages/web/src/app/sails/page.tsx`. Add the import:

```typescript
import { RecommendationPanel } from './RecommendationPanel';
```

In the page render, immediately above the existing wardrobe content (after the error display), insert:

```tsx
{wardrobe && <RecommendationPanel wardrobe={wardrobe} />}
```

- [ ] **Step 3: Smoke-test in the browser**

Run dev server (`npm run dev --workspace @g5000/autopilot-server`). Open `http://localhost:3000/sails`. Expected: a new panel at the top of the page showing either "Waiting for live wind…" (no wind data) or "Active" + "Recommended" with config names. Switch to demo mode if needed.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/sails/RecommendationPanel.tsx packages/web/src/app/sails/page.tsx
git commit -m "feat(web,sails): live RecommendationPanel powered by SSE"
```

---

## Task 8: `/sails` — Crossover chart panel

**Files:**
- Create: `packages/web/src/app/sails/CrossoverChart.tsx`
- Modify: `packages/web/src/app/sails/page.tsx`

- [ ] **Step 1: Implement the chart component**

Create `packages/web/src/app/sails/CrossoverChart.tsx`:

```typescript
'use client';

import { useMemo, useState } from 'react';
import {
  computeCrossoverGrid,
  type CrossoverGrid,
} from '@g5000/compute';
import {
  type SailWardrobe,
  type WardrobeSettings,
  wardrobeSettingsOf,
} from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

const CELL_W = 16;
const CELL_H = 16;
const PAD_LEFT = 36;
const PAD_BOTTOM = 28;

export function CrossoverChart({ wardrobe }: { wardrobe: SailWardrobe }) {
  const settings: WardrobeSettings = useMemo(() => wardrobeSettingsOf(wardrobe), [wardrobe]);
  const grid: CrossoverGrid = useMemo(
    () => computeCrossoverGrid(wardrobe, settings, { twsStepKn: 1, twaStepDeg: 5 }),
    [wardrobe, settings],
  );
  const [hover, setHover] = useState<{ twsIdx: number; twaIdx: number } | null>(null);

  const width = PAD_LEFT + grid.twsBins.length * CELL_W;
  const height = PAD_BOTTOM + grid.twaBins.length * CELL_H;

  const cells: JSX.Element[] = [];
  for (let i = 0; i < grid.twsBins.length; i++) {
    for (let j = 0; j < grid.twaBins.length; j++) {
      const cell = grid.cells[i]![j]!;
      const color = cell.winningConfigId ? getConfigColor(cell.winningConfigId) : '#1e293b';
      cells.push(
        <rect
          key={`${i}-${j}`}
          x={PAD_LEFT + i * CELL_W}
          y={(grid.twaBins.length - 1 - j) * CELL_H}
          width={CELL_W - 1}
          height={CELL_H - 1}
          fill={color}
          onMouseEnter={() => setHover({ twsIdx: i, twaIdx: j })}
          onMouseLeave={() => setHover(null)}
        />,
      );
    }
  }

  const hovered = hover ? grid.cells[hover.twsIdx]![hover.twaIdx]! : null;
  const hoveredTws = hover ? grid.twsBins[hover.twsIdx]! : null;
  const hoveredTwa = hover ? grid.twaBins[hover.twaIdx]! : null;

  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-4 space-y-2">
      <div className="text-xs text-slate-500">CROSSOVER CHART (TWS × TWA → winning config)</div>
      <svg width={width} height={height} className="text-slate-400">
        {cells}
        {/* TWS axis labels */}
        {grid.twsBins
          .map((v, i) => ({ v, i }))
          .filter(({ i }) => i % 5 === 0)
          .map(({ v, i }) => (
            <text
              key={`xt-${i}`}
              x={PAD_LEFT + i * CELL_W + CELL_W / 2}
              y={grid.twaBins.length * CELL_H + 16}
              fontSize={10}
              textAnchor="middle"
              fill="currentColor"
            >
              {v.toFixed(0)}
            </text>
          ))}
        {/* TWA axis labels */}
        {grid.twaBins
          .map((v, j) => ({ v, j }))
          .filter(({ j }) => j % 3 === 0)
          .map(({ v, j }) => (
            <text
              key={`yt-${j}`}
              x={PAD_LEFT - 4}
              y={(grid.twaBins.length - 1 - j) * CELL_H + CELL_H / 2 + 3}
              fontSize={10}
              textAnchor="end"
              fill="currentColor"
            >
              {v.toFixed(0)}°
            </text>
          ))}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs">
        {wardrobe.configs.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: getConfigColor(c.id) }}
            />
            <span className="font-mono text-slate-300">{c.name}</span>
          </span>
        ))}
      </div>
      <div className="text-xs text-slate-400 font-mono min-h-[1.25rem]">
        {hovered && hoveredTws !== null && hoveredTwa !== null ? (
          <>
            TWS {hoveredTws.toFixed(0)} kn · TWA {hoveredTwa.toFixed(0)}°{' — '}
            {hovered.winningConfigId ? (
              <>
                <strong>{wardrobe.configs.find((c) => c.id === hovered.winningConfigId)?.name}</strong>
                {' '}@ {hovered.winningSpeedKn!.toFixed(2)} kn
                {hovered.runnerUpConfigId &&
                  ` (runner-up ${wardrobe.configs.find((c) => c.id === hovered.runnerUpConfigId)?.name} ${hovered.runnerUpSpeedKn!.toFixed(2)} kn)`}
              </>
            ) : (
              <em>no data</em>
            )}
          </>
        ) : (
          <em>hover a cell to inspect</em>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount on /sails**

In `packages/web/src/app/sails/page.tsx`, add the import:

```typescript
import { CrossoverChart } from './CrossoverChart';
```

After the `RecommendationPanel` mount, insert:

```tsx
{wardrobe && <CrossoverChart wardrobe={wardrobe} />}
```

- [ ] **Step 3: Smoke-test**

Reload `/sails`. Expected: the heatmap below the recommendation panel; a color legend showing each config; hovering a cell updates the bottom line with TWS/TWA + winner + runner-up.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/sails/CrossoverChart.tsx packages/web/src/app/sails/page.tsx
git commit -m "feat(web,sails): CrossoverChart heatmap panel"
```

---

## Task 9: `/sails` — settings drawer (collapsible)

**Files:**
- Create: `packages/web/src/app/sails/SettingsDrawer.tsx`
- Modify: `packages/web/src/app/sails/page.tsx`

- [ ] **Step 1: Implement the drawer**

Create `packages/web/src/app/sails/SettingsDrawer.tsx`:

```typescript
'use client';

import { useState } from 'react';
import {
  DEFAULT_WARDROBE_SETTINGS,
  type SailWardrobe,
  type WardrobeSettings,
  wardrobeSettingsOf,
} from '@g5000/db';

export function SettingsDrawer({
  wardrobe,
  onSave,
}: {
  wardrobe: SailWardrobe;
  onSave: (settings: WardrobeSettings) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WardrobeSettings>(wardrobeSettingsOf(wardrobe));
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs underline text-slate-400 hover:text-slate-200"
      >
        Chart settings
      </button>
    );
  }

  const set = <K extends keyof WardrobeSettings>(k: K, v: WardrobeSettings[K]) =>
    setDraft({ ...draft, [k]: v });

  return (
    <div className="rounded border border-slate-700 bg-slate-950 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500 uppercase tracking-wider">Chart settings</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">
          Hysteresis %
          <input
            type="number"
            step="0.1"
            value={draft.hysteresisPercent}
            onChange={(e) => set('hysteresisPercent', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Chart TWS max (kn)
          <input
            type="number"
            step="1"
            value={draft.chartTwsMaxKn}
            onChange={(e) => set('chartTwsMaxKn', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Chart TWA min (°)
          <input
            type="number"
            step="1"
            value={draft.chartTwaMinDeg}
            onChange={(e) => set('chartTwaMinDeg', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Chart TWA max (°)
          <input
            type="number"
            step="1"
            value={draft.chartTwaMaxDeg}
            onChange={(e) => set('chartTwaMaxDeg', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Forecast interval (min)
          <input
            type="number"
            step="5"
            value={draft.forecastIntervalMinutes}
            onChange={(e) => set('forecastIntervalMinutes', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
        <label className="block text-xs">
          Forecast duration (h)
          <input
            type="number"
            step="1"
            value={draft.forecastDurationHours}
            onChange={(e) => set('forecastDurationHours', Number(e.target.value))}
            className="block w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(draft);
            } finally {
              setBusy(false);
            }
          }}
          className="rounded bg-emerald-700 hover:bg-emerald-600 px-3 py-1 text-xs"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_WARDROBE_SETTINGS)}
          className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1 text-xs"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the drawer above the chart on /sails**

In `packages/web/src/app/sails/page.tsx`:

```typescript
import { SettingsDrawer } from './SettingsDrawer';
```

Inside the page render, immediately before the `CrossoverChart`, mount the drawer. The save handler should `PUT /api/sails` with the existing wardrobe but a new `settings` field, then call `reload`:

```tsx
{wardrobe && (
  <SettingsDrawer
    wardrobe={wardrobe}
    onSave={async (settings) => {
      const updated = { ...wardrobe, settings };
      await writeWardrobe(updated);
      await reload();
    }}
  />
)}
```

`writeWardrobe` is the existing helper at the top of `sails/page.tsx`. `reload` is the existing callback. No new state needed.

- [ ] **Step 3: Smoke-test**

Reload `/sails`, click "Chart settings", change `chartTwsMaxKn` to 20, click Save. Expected: the page reloads the wardrobe, the chart re-renders with a narrower TWS range.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/sails/SettingsDrawer.tsx packages/web/src/app/sails/page.tsx
git commit -m "feat(web,sails): collapsible chart settings drawer"
```

---

## Task 10: `/helm` — sail-recommendation tile

**Files:**
- Create: `packages/web/src/app/helm/SailRecommendationTile.tsx`
- Modify: `packages/web/src/app/helm/page.tsx`

- [ ] **Step 1: Implement the tile**

Create `packages/web/src/app/helm/SailRecommendationTile.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getConfigColor } from '../../lib/config-color';

interface Recommendation {
  recommendedConfigId: string | null;
  activeConfigId: string;
  shouldChange: boolean;
  gapPercent: number;
  stale: boolean;
}

function useRecommendation(): Recommendation | null {
  const [rec, setRec] = useState<Recommendation | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const sample = JSON.parse(e.data) as { channel: string; value: unknown };
        if (sample.channel === 'wardrobe.recommendation') {
          setRec(sample.value as Recommendation);
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);
  return rec;
}

export function SailRecommendationTile() {
  const rec = useRecommendation();
  const name = rec?.recommendedConfigId ?? '—';
  const color = rec?.recommendedConfigId ? getConfigColor(rec.recommendedConfigId) : '#475569';

  let border = 'border-slate-700';
  if (rec?.stale) border = 'border-slate-600 opacity-60';
  else if (rec?.shouldChange) border = 'border-rose-600';
  else if (rec && rec.recommendedConfigId !== rec.activeConfigId) border = 'border-amber-600';

  return (
    <Link
      href="/sails"
      className={`block rounded border ${border} bg-slate-900 p-3 hover:bg-slate-800`}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-500">SAIL</div>
      <div className="flex items-center gap-2 mt-1">
        <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
        <span className="font-mono text-slate-100 truncate">{name}</span>
      </div>
      {rec?.shouldChange && !rec.stale && (
        <div className="text-[10px] text-rose-400 mt-1">▲ change (+{rec.gapPercent.toFixed(1)}%)</div>
      )}
    </Link>
  );
}
```

- [ ] **Step 2: Mount on /helm**

In `packages/web/src/app/helm/page.tsx`, add the import:

```typescript
import { SailRecommendationTile } from './SailRecommendationTile';
```

In the helm tile grid (search for `<HelmTile` usages — the tiles are laid out in a grid section near the bottom of the file), add the new tile inside the tile grid. Place it after the SOG tile so it's visually adjacent to the other status:

```tsx
<SailRecommendationTile />
```

Visit the page in dev and confirm the tile lands in the grid alongside the others; tweak placement if it visually clashes.

- [ ] **Step 3: Smoke-test**

Reload `/helm`. Expected: a new small tile labeled "SAIL" with the recommended config name; tapping it navigates to `/sails`. In demo mode the tile color matches the chart's legend.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/helm/SailRecommendationTile.tsx packages/web/src/app/helm/page.tsx
git commit -m "feat(web,helm): SailRecommendationTile linking to /sails"
```

---

## Task 11: Routing — `PlanInput.wardrobe` + per-node config selection

**Files:**
- Modify: `packages/routing/src/types.ts`
- Modify: `packages/routing/src/plan.ts`
- Create: `packages/routing/src/plan.wardrobe.test.ts`

- [ ] **Step 1: Add the failing property test**

Create `packages/routing/src/plan.wardrobe.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { plan } from './plan.js';
import type { PlanInput } from './types.js';
import type { SailWardrobe, PolarTable } from '@g5000/db';
import type { WindField } from '@g5000/grib';

const KN_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

function flatPolar(speedKn: number): PolarTable {
  const ms = speedKn * KN_TO_MS;
  return {
    twsBins: [0, 5, 10, 15, 20, 25, 30].map((k) => k * KN_TO_MS),
    twaBins: [30, 60, 90, 120, 150, 180].map((d) => d * DEG_TO_RAD),
    boatSpeed: [0, 5, 10, 15, 20, 25, 30].map(() => [ms, ms, ms, ms, ms, ms]),
  };
}

function constWind(speedMs: number, dirRad: number): WindField {
  const lats = [30, 32, 34];
  const lons = [-70, -68, -66];
  const u = lats.map(() => lons.map(() => speedMs * Math.cos(dirRad)));
  const v = lats.map(() => lons.map(() => speedMs * Math.sin(dirRad)));
  return {
    lats,
    lons,
    times: [0, 86400],
    u: [u, u],
    v: [v, v],
    source: 'GFS',
    runTime: 0,
  };
}

function baseInput(wardrobe: SailWardrobe | null, polar: PolarTable | null): PlanInput {
  return {
    start: { lat: 30.5, lon: -69.5 },
    end: { lat: 32.0, lon: -67.0 },
    departure: 0,
    wind: constWind(8, Math.PI / 2),
    polar: polar ?? undefined as never,
    polarId: polar ? 'test-polar' : 'wardrobe',
    coastline: { tree: { search: () => [] } } as never,
    options: { maxHours: 48 },
    wardrobe: wardrobe ?? undefined,
  } as PlanInput;
}

describe('plan() wardrobe mode', () => {
  it('is never slower than the active-config-only plan', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.float({ min: 4, max: 8, noNaN: true }), fc.float({ min: 4, max: 8, noNaN: true })),
        ([sA, sB]) => {
          const w: SailWardrobe = {
            configs: [
              { id: 'a', name: 'A', polar: flatPolar(sA) },
              { id: 'b', name: 'B', polar: flatPolar(sB) },
            ],
            activeConfigId: 'a',
          };
          const wardrobeRoute = plan(baseInput(w, null));
          const activeOnlyRoute = plan(baseInput(null, flatPolar(sA)));
          const wTime = wardrobeRoute.end - wardrobeRoute.start;
          const aTime = activeOnlyRoute.end - activeOnlyRoute.start;
          return wTime <= aTime + 1; // 1s slack for fp noise
        },
      ),
      { numRuns: 25 },
    );
  });

  it('records configId on each leg in wardrobe mode', () => {
    const w: SailWardrobe = {
      configs: [
        { id: 'slow', name: 'Slow', polar: flatPolar(3) },
        { id: 'fast', name: 'Fast', polar: flatPolar(7) },
      ],
      activeConfigId: 'slow',
    };
    const r = plan(baseInput(w, null));
    expect(r.legs.length).toBeGreaterThan(0);
    for (const leg of r.legs) {
      expect(leg.configId).toBeDefined();
    }
    // With flat polars the faster config wins everywhere.
    expect(r.legs.every((l) => l.configId === 'fast')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/routing/src/plan.wardrobe.test.ts`
Expected: FAIL — `wardrobe` field unknown / `leg.configId` undefined.

- [ ] **Step 3: Update the types**

In `packages/routing/src/types.ts`:

```typescript
import type { PolarTable, SailWardrobe } from '@g5000/db';

export interface RouteLeg {
  // existing fields ...
  /** Present only in wardrobe-aware routes. */
  configId?: string;
}

export interface PlanInput {
  start: LatLon;
  end: LatLon;
  departure: number;
  wind: WindField;
  /** Single-polar mode. Mutually exclusive with `wardrobe`. */
  polar?: PolarTable;
  polarId: string;
  coastline: Coastline;
  currents?: CurrentField;
  options?: PlanOptions;
  /** Wardrobe-aware mode: per-node argmax over the wardrobe's configs. */
  wardrobe?: SailWardrobe;
}

export interface Route {
  // existing fields ...
  /** Present only in wardrobe-aware routes. Populated by the sailTimeline
   *  post-process (Task 12). For now this field is declared but not yet
   *  filled in — Task 11 only records per-leg configIds. */
  sailTimeline?: SailTimelineSegment[];
}

export interface SailTimelineSegment {
  fromLegIdx: number;
  toLegIdx: number;
  configId: string;
  startTime: number;
  endTime: number;
  durationHours: number;
}
```

- [ ] **Step 4: Implement the per-node config selection**

In `packages/routing/src/plan.ts`, find the inner loop where each node's boat speed is computed from `input.polar` (look for the call to `interpolatePolarSpeed`). Replace with:

```typescript
import { interpolatePolarSpeed } from '@g5000/compute';
import type { SailWardrobe, PolarTable } from '@g5000/db';

// Helper that picks the best polar (and id) at a given (TWS, TWA).
function pickPolarAt(
  input: PlanInput,
  twsMs: number,
  twaRad: number,
): { polar: PolarTable; configId?: string; bsp: number } {
  if (input.wardrobe) {
    const w: SailWardrobe = input.wardrobe;
    let best: { id: string; polar: PolarTable; bsp: number } | null = null;
    for (const c of w.configs) {
      const bsp = interpolatePolarSpeed(c.polar, twsMs, twaRad);
      if (!Number.isFinite(bsp) || bsp <= 0) continue;
      if (!best || bsp > best.bsp) best = { id: c.id, polar: c.polar, bsp };
    }
    if (!best) {
      // No config produced a positive speed at this point — fall back to
      // the active config so the planner still makes forward progress.
      const active = w.configs.find((c) => c.id === w.activeConfigId);
      if (!active) {
        throw new Error('plan: wardrobe has no active config');
      }
      const bsp = interpolatePolarSpeed(active.polar, twsMs, twaRad);
      return { polar: active.polar, configId: active.id, bsp };
    }
    return { polar: best.polar, configId: best.id, bsp: best.bsp };
  }
  if (input.polar) {
    return { polar: input.polar, bsp: interpolatePolarSpeed(input.polar, twsMs, twaRad) };
  }
  throw new Error('plan: PlanInput must have either `polar` or `wardrobe`');
}
```

Replace existing in-loop `interpolatePolarSpeed(input.polar, tws, twa)` calls with `const { bsp, configId } = pickPolarAt(input, tws, twa);` and store `configId` on the emitted leg when present.

If `wardrobe` and `polar` are both set, prefer wardrobe and log a one-shot warning:

```typescript
if (input.wardrobe && input.polar) {
  // eslint-disable-next-line no-console
  console.warn('plan: both wardrobe and polar provided — using wardrobe');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/routing`
Expected: all routing tests pass including the 2 new wardrobe tests. Note: the existing single-polar property test should still pass (it doesn't pass `wardrobe`).

- [ ] **Step 6: Commit**

```bash
git add packages/routing/src/types.ts packages/routing/src/plan.ts packages/routing/src/plan.wardrobe.test.ts
git commit -m "feat(routing): PlanInput.wardrobe + per-node configId selection"
```

---

## Task 12: Routing — `sailTimeline` post-process

**Files:**
- Create: `packages/routing/src/sail-timeline.ts`
- Create: `packages/routing/src/sail-timeline.test.ts`
- Modify: `packages/routing/src/plan.ts` (call the post-process)
- Modify: `packages/routing/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing test**

Create `packages/routing/src/sail-timeline.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeSailTimeline } from './sail-timeline.js';
import type { RouteLeg } from './types.js';

function leg(t: number, configId: string): RouteLeg {
  return {
    t,
    lat: 30,
    lon: -70,
    heading: 0,
    twa: 0,
    tws: 0,
    bsp: 5,
    sogGround: 5,
    configId,
  };
}

describe('computeSailTimeline', () => {
  it('returns one segment when all legs share a config', () => {
    const legs = [leg(0, 'a'), leg(3600, 'a'), leg(7200, 'a')];
    const timeline = computeSailTimeline(legs);
    expect(timeline.length).toBe(1);
    expect(timeline[0]!.configId).toBe('a');
  });

  it('merges adjacent same-config legs and emits one segment per run', () => {
    const legs = [
      leg(0, 'a'),
      leg(3600, 'a'),
      leg(7200, 'b'),
      leg(10800, 'b'),
      leg(14400, 'a'),
    ];
    const timeline = computeSailTimeline(legs);
    expect(timeline.map((s) => s.configId)).toEqual(['a', 'b', 'a']);
  });

  it('absorbs runs shorter than 15 minutes into the surrounding segment', () => {
    const legs = [
      leg(0, 'a'),
      leg(60 * 60, 'a'),         // 'a' from 0-60min
      leg(60 * 65, 'b'),         // 'b' for 5 min (absorbed)
      leg(60 * 70, 'a'),         // 'a' continues
      leg(60 * 130, 'a'),
    ];
    const timeline = computeSailTimeline(legs);
    expect(timeline.map((s) => s.configId)).toEqual(['a']);
  });

  it('returns empty array when no leg has a configId', () => {
    const legs: RouteLeg[] = [
      { t: 0, lat: 0, lon: 0, heading: 0, twa: 0, tws: 0, bsp: 5, sogGround: 5 },
    ];
    expect(computeSailTimeline(legs)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/routing/src/sail-timeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the post-process**

Create `packages/routing/src/sail-timeline.ts`:

```typescript
import type { RouteLeg, SailTimelineSegment } from './types.js';

const SHORT_SEGMENT_SEC = 15 * 60;

/**
 * Collapse a leg sequence into segments by `configId`. Two passes:
 *
 *   1. Merge adjacent same-config legs into segments.
 *   2. Absorb segments shorter than 15 min into whichever neighbour
 *      (left or right) is the longer of the two — defaulting to the
 *      left if tied. This kills "sail thrash" in the recommended
 *      timeline without burdening the router itself with sail-change
 *      costs.
 *
 * The 15-min threshold is a constant for now. Promote to a setting only
 * if real routes show it's a problem.
 */
export function computeSailTimeline(legs: RouteLeg[]): SailTimelineSegment[] {
  if (!legs.some((l) => l.configId)) return [];

  // Pass 1: merge.
  type Pending = { fromIdx: number; toIdx: number; configId: string };
  const merged: Pending[] = [];
  for (let i = 0; i < legs.length; i++) {
    const id = legs[i]!.configId;
    if (!id) continue;
    const last = merged[merged.length - 1];
    if (last && last.configId === id) {
      last.toIdx = i;
    } else {
      merged.push({ fromIdx: i, toIdx: i, configId: id });
    }
  }

  if (merged.length === 0) return [];

  // Pass 2: absorb short runs.
  const durOf = (p: Pending): number => {
    const start = legs[p.fromIdx]!.t;
    const endLeg = p.toIdx < legs.length - 1 ? legs[p.toIdx + 1]! : legs[p.toIdx]!;
    return endLeg.t - start;
  };

  let absorbed: Pending[] = [...merged];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < absorbed.length; i++) {
      if (durOf(absorbed[i]!) >= SHORT_SEGMENT_SEC) continue;
      // Pick the longer neighbour.
      const leftDur = i > 0 ? durOf(absorbed[i - 1]!) : -1;
      const rightDur = i < absorbed.length - 1 ? durOf(absorbed[i + 1]!) : -1;
      if (leftDur < 0 && rightDur < 0) break; // singleton
      if (leftDur >= rightDur && i > 0) {
        absorbed[i - 1]!.toIdx = absorbed[i]!.toIdx;
        absorbed.splice(i, 1);
      } else if (i < absorbed.length - 1) {
        absorbed[i + 1]!.fromIdx = absorbed[i]!.fromIdx;
        absorbed.splice(i, 1);
      }
      changed = true;
      break;
    }
  }

  // Pass 3: after absorption, adjacent runs may share the same configId. Re-merge.
  const remerged: Pending[] = [];
  for (const p of absorbed) {
    const last = remerged[remerged.length - 1];
    if (last && last.configId === p.configId) {
      last.toIdx = p.toIdx;
    } else {
      remerged.push({ ...p });
    }
  }

  return remerged.map((p) => {
    const startTime = legs[p.fromIdx]!.t;
    const endTime =
      p.toIdx < legs.length - 1 ? legs[p.toIdx + 1]!.t : legs[p.toIdx]!.t;
    return {
      fromLegIdx: p.fromIdx,
      toLegIdx: p.toIdx,
      configId: p.configId,
      startTime,
      endTime,
      durationHours: (endTime - startTime) / 3600,
    };
  });
}
```

In `packages/routing/src/plan.ts`, at the end of the function (just before returning the Route), call the post-process when in wardrobe mode:

```typescript
import { computeSailTimeline } from './sail-timeline.js';

// just before `return route;`
if (input.wardrobe) {
  route.sailTimeline = computeSailTimeline(route.legs);
}
```

Re-export from `packages/routing/src/index.ts`:

```typescript
export { computeSailTimeline } from './sail-timeline.js';
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/routing`
Expected: PASS — all tests, new and existing.

- [ ] **Step 5: Commit**

```bash
git add packages/routing/src/sail-timeline.ts packages/routing/src/sail-timeline.test.ts packages/routing/src/plan.ts packages/routing/src/index.ts
git commit -m "feat(routing): sailTimeline post-process with short-run absorption"
```

---

## Task 13: `/api/route/plan` accepts wardrobe

**Files:**
- Modify: `packages/web/src/app/api/route/plan/route.ts`

- [ ] **Step 1: Extend the request body and validation**

In `packages/web/src/app/api/route/plan/route.ts`, change the `Body` interface and `validate` function:

```typescript
import type { PolarTable, SailWardrobe } from '@g5000/db';

interface Body {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  /** Single-polar mode. Mutually exclusive with `wardrobe`. */
  polar?: PolarTable;
  polarId: string;
  useCurrents?: boolean;
  options?: Record<string, unknown>;
  /** Wardrobe mode: server runs the wardrobe-aware planner. */
  wardrobe?: SailWardrobe;
}

function validate(b: unknown): b is Body {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (!o.start || !o.end || typeof o.departure !== 'number') return false;
  if (typeof o.model !== 'string' || !['GFS', 'ECMWF'].includes(o.model)) return false;
  if (!o.polarId) return false;
  const hasPolar = !!o.polar;
  const hasWardrobe = !!o.wardrobe;
  if (!hasPolar && !hasWardrobe) return false;
  return true;
}
```

Pass `wardrobe` through to `plan()`:

```typescript
const route = plan({
  start: b.start,
  end: b.end,
  departure: b.departure,
  wind,
  polar: b.polar,
  polarId: b.polarId,
  coastline,
  currents,
  wardrobe: b.wardrobe,
  options: { ...(b.options ?? {}), useCurrents: !!b.useCurrents, captureIsochrones: true },
});
```

- [ ] **Step 2: Smoke-test by curling the route endpoint with a wardrobe payload**

Start the dev server. Then:

```bash
curl -sS -X POST -H "Content-Type: application/json" -d '{
  "start": {"lat": 30.5, "lon": -69.5},
  "end": {"lat": 32.0, "lon": -67.0},
  "departure": 1716000000,
  "model": "GFS",
  "polarId": "wardrobe-test",
  "wardrobe": {
    "configs": [
      {"id": "a", "name": "A", "polar": {"twsBins": [0,5,10,15,20], "twaBins": [0.5,1.0,1.5,2.0,2.5,3.0], "boatSpeed": [[2,2,2,2,2,2],[3,3,3,3,3,3],[4,4,4,4,4,4],[5,5,5,5,5,5],[6,6,6,6,6,6]]}},
      {"id": "b", "name": "B", "polar": {"twsBins": [0,5,10,15,20], "twaBins": [0.5,1.0,1.5,2.0,2.5,3.0], "boatSpeed": [[3,3,3,3,3,3],[4,4,4,4,4,4],[5,5,5,5,5,5],[6,6,6,6,6,6],[7,7,7,7,7,7]]}}
    ],
    "activeConfigId": "a"
  }
}' http://localhost:3000/api/route/plan | head -c 500
```

Expected: a `{"ok":true,"route":{...,"sailTimeline":[...],"legs":[{...,"configId":"b"}]}}` payload. If forecast cache is empty, the route may fall back or fail loudly — that's a separate problem; for this test you may need to pre-warm by hitting `/api/forecast/refresh` first.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/route/plan/route.ts
git commit -m "feat(web,api): /api/route/plan accepts wardrobe payload"
```

---

## Task 14: `/sails` — Forecast timeline panel

**Files:**
- Create: `packages/web/src/app/sails/ForecastTimeline.tsx`
- Modify: `packages/web/src/app/sails/page.tsx`

- [ ] **Step 1: Implement the timeline component**

Create `packages/web/src/app/sails/ForecastTimeline.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import type { SailWardrobe } from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

interface SailTimelineSegment {
  fromLegIdx: number;
  toLegIdx: number;
  configId: string;
  startTime: number;
  endTime: number;
  durationHours: number;
}

interface PlanRecord {
  id: string;
  name: string;
  createdAt: number;
  route: { distance: number; model: string; sailTimeline?: SailTimelineSegment[] };
}

export function ForecastTimeline({ wardrobe }: { wardrobe: SailWardrobe }) {
  const [latestPlan, setLatestPlan] = useState<PlanRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/plans', { cache: 'no-store' });
        const j = (await r.json()) as { ok: boolean; items?: PlanRecord[]; error?: { message: string } };
        if (!j.ok) {
          setErr(j.error?.message ?? 'failed to load plans');
          return;
        }
        const sorted = [...(j.items ?? [])].sort((a, b) => b.createdAt - a.createdAt);
        setLatestPlan(sorted[0] ?? null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (err) {
    return (
      <div className="rounded border border-rose-700 bg-rose-900/20 p-3 text-xs text-rose-300">
        Forecast timeline: {err}
      </div>
    );
  }

  if (!latestPlan) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400 italic">
        Plan a route on /chart with the wardrobe enabled to see forecasted sail recommendations.
      </div>
    );
  }

  const timeline = latestPlan.route.sailTimeline;
  if (!timeline || timeline.length === 0) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400 italic">
        Latest plan ({latestPlan.name}) is single-config. Re-plan with the wardrobe to enable the timeline.
      </div>
    );
  }

  const totalHours = timeline.reduce((acc, s) => acc + s.durationHours, 0);
  const pxPerHour = Math.max(20, Math.min(80, Math.floor(800 / totalHours)));

  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-3 space-y-1">
      <div className="text-xs text-slate-500 uppercase tracking-wider">
        FORECAST TIMELINE — {latestPlan.name}
      </div>
      <div className="flex overflow-x-auto text-[10px]">
        {timeline.map((seg, i) => {
          const name = wardrobe.configs.find((c) => c.id === seg.configId)?.name ?? seg.configId;
          return (
            <div
              key={i}
              style={{
                width: `${seg.durationHours * pxPerHour}px`,
                background: getConfigColor(seg.configId),
              }}
              className="px-2 py-2 border-r border-slate-800 text-slate-900 whitespace-nowrap font-mono"
              title={`${name} · ${seg.durationHours.toFixed(1)}h · ${new Date(seg.startTime * 1000).toISOString()}`}
            >
              {name} · {seg.durationHours.toFixed(1)}h
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-500">
        Total {totalHours.toFixed(1)} h · {timeline.length} segments. Click any segment to focus the chart (not yet implemented).
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount on /sails**

In `packages/web/src/app/sails/page.tsx`:

```typescript
import { ForecastTimeline } from './ForecastTimeline';
```

Below the `CrossoverChart` mount, insert:

```tsx
{wardrobe && <ForecastTimeline wardrobe={wardrobe} />}
```

- [ ] **Step 3: Smoke-test**

If a wardrobe-aware plan exists in the saved plans (Task 13's smoke-test would have created one if the curl succeeded and the response was POSTed to `/api/plans` — that's a separate flow on /chart, not part of this plan), reload `/sails`. Expected: a horizontal strip of colored segments below the chart, sized by duration. Without a saved plan you should see the "Plan a route on /chart with the wardrobe enabled…" message.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/sails/ForecastTimeline.tsx packages/web/src/app/sails/page.tsx
git commit -m "feat(web,sails): ForecastTimeline panel reading the latest plan's sailTimeline"
```

---

## Task 15: Final integration — push, verify, prepare for develop merge

**Files:**
- (no code changes)

- [ ] **Step 1: Push the branch**

```bash
git push origin issue-3-sail-crossover
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Typecheck the entire workspace**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Manual UI walkthrough**

In the Mac dev server:

1. `/sails` — see RecommendationPanel + CrossoverChart + SettingsDrawer + ForecastTimeline.
2. `/helm` — see the new SAIL tile.
3. Toggle to demo mode at `/settings` if no live wind.
4. Confirm tile/panel colors match the chart legend.
5. Confirm the chart's hover line updates as you move over cells.
6. Save a custom hysteresisPercent via the settings drawer; reload the page; confirm it persists.

- [ ] **Step 5: Announce the branch is ready for develop merge**

Leave a final note in this plan run-log: "Branch `issue-3-sail-crossover` is ready to merge into `develop`. After merge, follow the develop→main promote (see CLAUDE.md → Branching model) when ready to deploy to the Pi."

Do NOT merge to develop or main automatically — that's a separate user decision.
