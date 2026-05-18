# Sail Crossover — Atomic Sails Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Model A's single-winner SailConfig + CrossoverMap with atomic Sails, each carrying its own (TWS, TWA) region on a fixed grid; recommender emits valid sails per category (headsail / main / downwind).

**Architecture:** Three independent categories. Each sail has a region of valid grid cells. Compute pipeline subscribes to wind, snaps to the fixed grid, and emits per-category `valid[]` + per-category `changeNeeded` with stable-time hysteresis. UI shows overlapping regions in view mode and single-sail editing in edit mode.

**Tech Stack:** TypeScript (strict, ESM, composite refs), Drizzle ORM + SQLite (`better-sqlite3`), RxJS, Vitest (forks), Next.js 16 (App Router) + React 19, Tailwind 4.

**Spec:** [`docs/superpowers/specs/2026-05-19-sail-crossover-atomic-design.md`](../specs/2026-05-19-sail-crossover-atomic-design.md)

**Branch:** Work on `sail-atomic` branch off `develop`. PR back to `develop` when green; promotion to `main` (Pi deploy) is a separate manual step.

---

## File map

**Created:**
- `packages/core/src/sail-grid.ts` + `.test.ts` — fixed grid constants + snap
- `packages/db/src/migrate-wardrobe-v3.ts` + `.test.ts` — v2 → v3 migration
- `packages/db/src/config-store-sails-v3.test.ts` — v3 validation
- `packages/compute/src/sail-crossover/region-lookup.ts` + `.test.ts` — region containment
- `packages/web/src/app/api/sails/[sailId]/region/route.ts` + `.test.ts`
- `packages/web/src/app/sails/CategoryRecommendation.tsx` — replaces RecommendationPanel
- `packages/web/src/app/sails/SailOverlayChart.tsx` — view-all overlapping chart
- `packages/web/src/app/sails/SailRegionEditor.tsx` — single-sail edit chart

**Modified:**
- `packages/core/src/types.ts` — `sail_recommendation` ChannelValue shape
- `packages/core/src/index.ts` — re-export sail-grid
- `packages/db/src/defaults.ts` — Sail, SailWardrobe v3, CrossoverSettings trimmed; drop CrossoverMap exports
- `packages/db/src/schema.ts` — drop `crossover_map` table
- `packages/db/src/config-store.ts` — rewrite setSails, drop crossover_map handling, simplify activePolar$
- `packages/compute/src/sail-crossover/pipeline.ts` — rewrite for category model
- `packages/compute/src/sail-crossover/index.ts` — exports
- `packages/web/src/app/api/sails/route.ts` — v3 PUT validation
- `packages/web/src/app/api/sails/active/route.ts` — per-category set
- `packages/web/src/app/api/crossover-settings/route.ts` — trim shape
- `packages/web/src/app/sails/page.tsx` — grouped by category
- `packages/web/src/app/sails/crossover/page.tsx` — new 3-pane layout
- `packages/web/src/app/inspect/page.tsx` — adjust exhaustive switch arm to new payload
- `packages/routing/src/types.ts` — remove `RouteLeg.configId`, `PlanInput.crossover`, `SailTimelineSegment`
- `packages/routing/src/plan.ts` — drop crossover usage

**Deleted:**
- `packages/db/src/migrate-wardrobe-v2.ts` + `.test.ts`
- `packages/db/src/config-store-crossover.test.ts`
- `packages/db/src/config-store-crossover-settings.test.ts`
- `packages/db/src/schema-crossover.test.ts`
- `packages/compute/src/sail-crossover/lookup.ts` + `.test.ts`
- `packages/web/src/app/api/crossover-map/route.ts` + `.test.ts`
- `packages/web/src/app/sails/CrossoverChart.tsx`
- `packages/web/src/app/sails/RecommendationPanel.tsx`
- `packages/web/src/app/sails/ForecastTimeline.tsx`
- `packages/routing/src/sail-timeline.ts` + `.test.ts`
- `packages/routing/src/plan.crossover.test.ts`

---

## Task 1: Create branch and confirm clean state

**Files:** none

- [ ] **Step 1: Create branch off develop**

```bash
cd /Users/gregjohnson/code/g5000
git checkout develop
git pull
git checkout -b sail-atomic
```

- [ ] **Step 2: Confirm baseline build passes**

```bash
npm test 2>&1 | tail -5
```

Expected: a "Test Files <N> passed" summary line with no failures. Record N as the baseline.

---

## Task 2: Fixed-grid constants and snap (TDD)

**Files:**
- Create: `packages/core/src/sail-grid.ts`
- Create: `packages/core/src/sail-grid.test.ts`
- Modify: `packages/core/src/index.ts` (add export)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/sail-grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SAIL_GRID_TWS_BINS,
  SAIL_GRID_TWS_STEP_KN,
  SAIL_GRID_TWA_BINS,
  SAIL_GRID_TWA_STEP_DEG,
  snapToFixedGrid,
  cellKey,
  parseCellKey,
} from './sail-grid';

const MPS_PER_KN = 0.514444;

describe('sail-grid constants', () => {
  it('defines 41 TWS bins at 1 kn step (0..40 kn)', () => {
    expect(SAIL_GRID_TWS_BINS).toBe(41);
    expect(SAIL_GRID_TWS_STEP_KN).toBe(1);
  });
  it('defines 37 TWA bins at 5° step (0..180°)', () => {
    expect(SAIL_GRID_TWA_BINS).toBe(37);
    expect(SAIL_GRID_TWA_STEP_DEG).toBe(5);
  });
});

describe('snapToFixedGrid', () => {
  it('snaps origin to (0, 0)', () => {
    const r = snapToFixedGrid({ twsMs: 0, twaRad: 0 });
    expect(r.twsIdx).toBe(0);
    expect(r.twaIdx).toBe(0);
  });
  it('snaps 10 kn (5.144 m/s) and 45° (π/4 rad) to (10, 9)', () => {
    const r = snapToFixedGrid({ twsMs: 10 * MPS_PER_KN, twaRad: Math.PI / 4 });
    expect(r.twsIdx).toBe(10);
    expect(r.twaIdx).toBe(9); // 45 / 5
  });
  it('clamps TWS above 40 kn to 40', () => {
    const r = snapToFixedGrid({ twsMs: 60 * MPS_PER_KN, twaRad: 0 });
    expect(r.twsIdx).toBe(40);
  });
  it('clamps negative TWS to 0', () => {
    const r = snapToFixedGrid({ twsMs: -5, twaRad: 0 });
    expect(r.twsIdx).toBe(0);
  });
  it('clamps TWA above 180° to bin 36', () => {
    const r = snapToFixedGrid({ twsMs: 0, twaRad: Math.PI + 0.1 });
    expect(r.twaIdx).toBe(36);
  });
  it('clamps negative TWA to bin 0', () => {
    const r = snapToFixedGrid({ twsMs: 0, twaRad: -0.5 });
    expect(r.twaIdx).toBe(0);
  });
  it('round-trips through cellKey', () => {
    expect(cellKey({ twsIdx: 12, twaIdx: 9 })).toBe('12,9');
  });
});

describe('parseCellKey', () => {
  it('parses a valid in-bounds key', () => {
    expect(parseCellKey('12,9')).toEqual({ twsIdx: 12, twaIdx: 9 });
  });
  it('returns null for malformed input', () => {
    expect(parseCellKey('foo')).toBeNull();
  });
  it('returns null for out-of-bounds twsIdx', () => {
    expect(parseCellKey('41,9')).toBeNull();
  });
  it('returns null for out-of-bounds twaIdx', () => {
    expect(parseCellKey('12,37')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/core/src/sail-grid.test.ts
```

Expected: FAIL — module `./sail-grid` cannot be found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/sail-grid.ts`:

```ts
/**
 * Fixed (TWS, TWA) grid for atomic-sail regions. Independent of polar bins;
 * sized to faithfully capture a North Sails-style crossover chart (1 kn × 5°).
 */

export const SAIL_GRID_TWS_STEP_KN = 1;
export const SAIL_GRID_TWS_MAX_KN = 40;
export const SAIL_GRID_TWS_BINS = SAIL_GRID_TWS_MAX_KN / SAIL_GRID_TWS_STEP_KN + 1; // 41

export const SAIL_GRID_TWA_STEP_DEG = 5;
export const SAIL_GRID_TWA_MAX_DEG = 180;
export const SAIL_GRID_TWA_BINS = SAIL_GRID_TWA_MAX_DEG / SAIL_GRID_TWA_STEP_DEG + 1; // 37

const MPS_PER_KN = 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export interface Cell {
  twsIdx: number;
  twaIdx: number;
}

export function snapToFixedGrid(input: { twsMs: number; twaRad: number }): Cell {
  const twsKn = input.twsMs / MPS_PER_KN;
  const twaDeg = Math.abs(input.twaRad * RAD_TO_DEG); // TWA is unsigned in this grid
  const twsIdx = clamp(Math.round(twsKn / SAIL_GRID_TWS_STEP_KN), 0, SAIL_GRID_TWS_BINS - 1);
  const twaIdx = clamp(Math.round(twaDeg / SAIL_GRID_TWA_STEP_DEG), 0, SAIL_GRID_TWA_BINS - 1);
  return { twsIdx, twaIdx };
}

export function cellKey(cell: Cell): string {
  return `${cell.twsIdx},${cell.twaIdx}`;
}

export function parseCellKey(key: string): Cell | null {
  const [a, b] = key.split(',');
  const twsIdx = Number(a);
  const twaIdx = Number(b);
  if (!Number.isInteger(twsIdx) || !Number.isInteger(twaIdx)) return null;
  if (twsIdx < 0 || twsIdx >= SAIL_GRID_TWS_BINS) return null;
  if (twaIdx < 0 || twaIdx >= SAIL_GRID_TWA_BINS) return null;
  return { twsIdx, twaIdx };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
```

- [ ] **Step 4: Export from package index**

Edit `packages/core/src/index.ts` and add a new line near the other exports:

```ts
export * from './sail-grid';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run packages/core/src/sail-grid.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sail-grid.ts packages/core/src/sail-grid.test.ts packages/core/src/index.ts
git commit -m "feat(core): fixed sail-region grid + snap (1 kt × 5°)"
```

---

## Task 3: Update `sail_recommendation` ChannelValue shape

**Files:**
- Modify: `packages/core/src/types.ts` (lines 14–23)

This task is a type-only change. The test is `tsc -b` across the workspace — many call sites will break and we'll fix them in later tasks. We commit the type change here so the broken state is localized.

- [ ] **Step 1: Edit `packages/core/src/types.ts`**

Replace the existing `sail_recommendation` arm (lines 14–23) with:

```ts
  | {
      /** Active sail-crossover recommendation; payload published on Channels.SAIL_RECOMMENDATION. */
      kind: 'sail_recommendation';
      cellTwsKn: number;
      cellTwaDeg: number;
      valid: {
        headsail: string[];
        main: string[];
        downwind: string[];
      };
      active: {
        headsail?: string;
        main?: string;
        downwind?: string;
      };
      changeNeeded: {
        headsail: boolean;
        main: boolean;
        downwind: boolean;
      };
      enteredAt: number;
      stableSeconds: number;
    };
```

- [ ] **Step 2: Don't try to typecheck the workspace yet**

This change intentionally breaks pipeline.ts, inspect/page.tsx, and RecommendationPanel.tsx. Each will be fixed in its own task. Commit and move on.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): redefine sail_recommendation payload (category model)"
```

---

## Task 4: Define Sail and v3 SailWardrobe types

**Files:**
- Modify: `packages/db/src/defaults.ts`

- [ ] **Step 1: Replace lines 205–256 of `packages/db/src/defaults.ts`**

Replace the entire `SailConfig` + `SailWardrobe` block (currently lines 195–256, including the doc comments above each) with:

```ts
/**
 * Sail wardrobe — Model B (atomic sails). Each sail is one piece of canvas
 * with its own valid region on a fixed (TWS, TWA) grid. The skipper composes a
 * sail plan by picking one sail per category (headsail / main / downwind).
 */
export type SailCategory = 'headsail' | 'main' | 'downwind';
export const SAIL_CATEGORIES: readonly SailCategory[] = [
  'headsail',
  'main',
  'downwind',
] as const;

export interface SailRegion {
  /** Grid cell keys "twsIdx,twaIdx" against the fixed grid in @g5000/core. */
  cells: string[];
}

export interface Sail {
  /** Stable unique id (e.g. 'j0', 'reef1', 'g0'). */
  id: string;
  /** Human-readable name (e.g. 'J0', 'Reef 1'). */
  name: string;
  category: SailCategory;
  /** Sail area in m² (optional; used to sort recommendations). */
  areaSqM?: number;
  notes?: string;
  region: SailRegion;
}

export interface SailWardrobe {
  /** Schema version. v3 = atomic sails. */
  schemaVersion: 3;
  boatId: BoatId;
  sails: Sail[];
  /** Currently hoisted sail in each category. All optional. */
  active: {
    headsail?: string;
    main?: string;
    downwind?: string;
  };
  /** Selects which polar revision is active for the boat. */
  activeMode: PolarMode;
}
```

- [ ] **Step 2: Replace the `DEFAULT_WARDROBE` constant near the bottom of the file**

Find the existing `DEFAULT_WARDROBE` (around line 406) and replace it with:

```ts
export const DEFAULT_WARDROBE: SailWardrobe = {
  schemaVersion: 3,
  boatId: 'sula',
  sails: [],
  active: {},
  activeMode: 'default',
};
```

- [ ] **Step 3: Remove the legacy `CrossoverMap` types and constants**

In the same file, delete the `CrossoverMap` interface (around lines 348–354), `DEFAULT_CROSSOVER_MAP` constant (around lines 356–361), and the doc-comment block immediately above the interface that introduces it.

- [ ] **Step 4: Trim `CrossoverSettings`**

Replace the existing `CrossoverSettings` interface and `DEFAULT_CROSSOVER_SETTINGS` constant (around lines 369–385) with:

```ts
/**
 * Per-boat settings for the sail-crossover feature. Mode-agnostic.
 * The grid is fixed in @g5000/core; chart bounds are no longer stored here.
 */
export interface CrossoverSettings {
  recommendationStableSeconds: number;
  forecastIntervalMinutes: number;
  forecastDurationHours: number;
}

export const DEFAULT_CROSSOVER_SETTINGS: CrossoverSettings = {
  recommendationStableSeconds: 30,
  forecastIntervalMinutes: 30,
  forecastDurationHours: 12,
};
```

- [ ] **Step 5: Verify the v3 types are exported from `@g5000/db`**

```bash
grep -n "export \* from './defaults'" packages/db/src/index.ts
```

If the line is present, `Sail`, `SailCategory`, `SailWardrobe`, `SailRegion`, and `SAIL_CATEGORIES` are exported automatically. If not, add explicit named re-exports in `packages/db/src/index.ts`:

```ts
export type { Sail, SailCategory, SailRegion, SailWardrobe, CrossoverSettings } from './defaults';
export { SAIL_CATEGORIES, DEFAULT_WARDROBE, DEFAULT_CROSSOVER_SETTINGS } from './defaults';
```

- [ ] **Step 6: Commit (without typechecking — many callers break here)**

```bash
git add packages/db/src/defaults.ts packages/db/src/index.ts
git commit -m "feat(db): v3 atomic-sail types; trim CrossoverSettings; drop CrossoverMap"
```

---

## Task 5: Drop `crossover_map` table from schema

**Files:**
- Modify: `packages/db/src/schema.ts` (lines 138–148, the `crossoverMap` table block)

- [ ] **Step 1: Edit `packages/db/src/schema.ts`**

Locate the `crossoverMap` table definition (around lines 138–148) and delete it entirely, including the `export const crossoverMap = sqliteTable(...)` declaration and any doc comment immediately above it. Leave the `crossoverSettings` table alone (it's reused with a trimmed shape).

Find any export of `crossoverMap` from this file and remove it. Verify with:

```bash
grep -n 'crossoverMap' packages/db/src/schema.ts
```

Expected: no matches.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "refactor(db): drop crossover_map table (single-winner model removed)"
```

---

## Task 6: Migration v2 → v3 (TDD)

**Files:**
- Create: `packages/db/src/migrate-wardrobe-v3.ts`
- Create: `packages/db/src/migrate-wardrobe-v3.test.ts`

The v2 → v3 migrator takes raw v2 JSON (from the `sail_wardrobe` table) and, optionally, the v2 `crossover_map` row + active polar, and returns a v3 `SailWardrobe`. Splits each v2 SailConfig into up to 3 atomic Sails via `mainState` / `headsail` / `downwindSail` fields, dedupes by slug, and remaps painted cells from polar-bin space to fixed-grid space.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/migrate-wardrobe-v3.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateWardrobeV2toV3, type V2Wardrobe } from './migrate-wardrobe-v3';
import type { PolarTable } from './defaults';

const SAMPLE_POLAR: PolarTable = {
  twsBins: [3.086, 4.115, 5.144, 6.173, 7.202, 8.231, 10.289, 12.346], // 6,8,10,12,14,16,20,24 kn in m/s
  twaBins: [0.524, 0.785, 1.047, 1.309, 1.571, 2.094, 2.618, 3.142], // 30,45,60,75,90,120,150,180 deg in rad
  speeds: Array.from({ length: 8 }, () => new Array(8).fill(0)),
};

describe('migrateWardrobeV2toV3', () => {
  it('splits one v2 config into atomic sails', () => {
    const v2: V2Wardrobe = {
      boatId: 'sula',
      configs: [
        {
          id: 'j0-full',
          name: 'J0 + Full',
          headsail: 'J0',
          mainState: 'Full',
          modes: {},
        },
      ],
      activeConfigId: 'j0-full',
      activeMode: 'default',
    };
    const v3 = migrateWardrobeV2toV3(v2, null, SAMPLE_POLAR);
    expect(v3.schemaVersion).toBe(3);
    expect(v3.sails.map((s) => ({ id: s.id, category: s.category }))).toEqual([
      { id: 'j0', category: 'headsail' },
      { id: 'full-main', category: 'main' },
    ]);
    expect(v3.active).toEqual({ headsail: 'j0', main: 'full-main' });
  });

  it('dedupes sails across configs', () => {
    const v2: V2Wardrobe = {
      boatId: 'sula',
      configs: [
        { id: 'a', name: 'J0 + Full', headsail: 'J0', mainState: 'Full', modes: {} },
        { id: 'b', name: 'J0 + Reef1', headsail: 'J0', mainState: 'Reef1', modes: {} },
      ],
      activeConfigId: 'a',
      activeMode: 'default',
    };
    const v3 = migrateWardrobeV2toV3(v2, null, SAMPLE_POLAR);
    const ids = v3.sails.map((s) => s.id).sort();
    expect(ids).toEqual(['full-main', 'j0', 'reef1']);
  });

  it('remaps crossover_map cells into atomic regions', () => {
    const v2: V2Wardrobe = {
      boatId: 'sula',
      configs: [
        {
          id: 'stj-reef1',
          name: 'STJ + Reef1',
          headsail: 'STJ',
          mainState: 'Reef1',
          modes: {},
        },
      ],
      activeConfigId: 'stj-reef1',
      activeMode: 'default',
    };
    // Polar-bin cell (twsIdx=2, twaIdx=2) means TWS=10 kn, TWA=60°.
    // Fixed-grid cell for the same point: twsIdx=10, twaIdx=12.
    const map = { boatId: 'sula', mode: 'default', cells: { '2,2': 'stj-reef1' }, updatedAt: 0 };
    const v3 = migrateWardrobeV2toV3(v2, map, SAMPLE_POLAR);
    const stj = v3.sails.find((s) => s.id === 'stj');
    const reef1 = v3.sails.find((s) => s.id === 'reef1');
    expect(stj?.region.cells).toContain('10,12');
    expect(reef1?.region.cells).toContain('10,12');
  });

  it('handles v2 with no crossover_map', () => {
    const v2: V2Wardrobe = {
      boatId: 'sula',
      configs: [{ id: 'a', name: 'A', headsail: 'A2', modes: {} }],
      activeConfigId: 'a',
      activeMode: 'default',
    };
    const v3 = migrateWardrobeV2toV3(v2, null, SAMPLE_POLAR);
    expect(v3.sails).toHaveLength(1);
    expect(v3.sails[0]!.region.cells).toEqual([]);
  });

  it('returns input unchanged if already v3', () => {
    const v3In = {
      schemaVersion: 3 as const,
      boatId: 'sula' as const,
      sails: [],
      active: {},
      activeMode: 'default' as const,
    };
    const v3Out = migrateWardrobeV2toV3(v3In, null, SAMPLE_POLAR);
    expect(v3Out).toEqual(v3In);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/db/src/migrate-wardrobe-v3.test.ts
```

Expected: FAIL — `./migrate-wardrobe-v3` not found.

- [ ] **Step 3: Implement the migrator**

Create `packages/db/src/migrate-wardrobe-v3.ts`:

```ts
import {
  SAIL_GRID_TWS_BINS,
  SAIL_GRID_TWA_BINS,
  snapToFixedGrid,
  cellKey,
} from '@g5000/core';
import type { PolarMode, BoatId, PolarTable } from './defaults';
import type { Sail, SailCategory, SailWardrobe } from './defaults';

/** v2 SailWardrobe shape, frozen here for the migrator. */
export interface V2SailConfig {
  id: string;
  name: string;
  mainState?: string;
  headsail?: string;
  downwindSail?: string;
  modes?: Partial<Record<PolarMode, { activeRevisionId: string }>>;
}

export interface V2Wardrobe {
  boatId: BoatId;
  configs: V2SailConfig[];
  activeConfigId: string;
  activeMode: PolarMode;
}

interface V2CrossoverMap {
  boatId: BoatId;
  mode: PolarMode;
  cells: Record<string, string>;
  updatedAt: number;
}

function isV3(input: unknown): input is SailWardrobe {
  return !!input && typeof input === 'object' && (input as { schemaVersion?: number }).schemaVersion === 3;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "Full" / "Full main" → 'full-main'; "Reef1" → 'reef1'; "Reef 2" → 'reef2' */
function mainStateToSail(state: string): { id: string; name: string } {
  const normalized = state.trim();
  const lower = normalized.toLowerCase();
  if (lower === 'full' || lower === 'full main' || lower === 'fullmain') {
    return { id: 'full-main', name: 'Full Main' };
  }
  return { id: slug(normalized), name: normalized };
}

export function migrateWardrobeV2toV3(
  input: V2Wardrobe | SailWardrobe,
  map: V2CrossoverMap | null,
  activePolar: PolarTable,
): SailWardrobe {
  if (isV3(input)) return input;

  const v2 = input as V2Wardrobe;
  // configId -> [sailIds] for cell remap
  const configToSails = new Map<string, string[]>();
  const byId = new Map<string, Sail>();

  for (const cfg of v2.configs) {
    const sailIds: string[] = [];
    if (cfg.headsail) {
      const id = slug(cfg.headsail);
      if (!byId.has(id)) {
        byId.set(id, { id, name: cfg.headsail, category: 'headsail', region: { cells: [] } });
      }
      sailIds.push(id);
    }
    if (cfg.mainState) {
      const { id, name } = mainStateToSail(cfg.mainState);
      if (!byId.has(id)) {
        byId.set(id, { id, name, category: 'main', region: { cells: [] } });
      }
      sailIds.push(id);
    }
    if (cfg.downwindSail) {
      const id = slug(cfg.downwindSail);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: cfg.downwindSail,
          category: 'downwind',
          region: { cells: [] },
        });
      }
      sailIds.push(id);
    }
    configToSails.set(cfg.id, sailIds);
  }

  // Remap painted cells: polar (twsIdx, twaIdx) → fixed-grid cell
  if (map) {
    for (const [polarKey, configId] of Object.entries(map.cells)) {
      const [pTwsStr, pTwaStr] = polarKey.split(',');
      const pTws = Number(pTwsStr);
      const pTwa = Number(pTwaStr);
      const twsMs = activePolar.twsBins[pTws];
      const twaRad = activePolar.twaBins[pTwa];
      if (twsMs === undefined || twaRad === undefined) continue;
      const fixed = snapToFixedGrid({ twsMs, twaRad });
      const key = cellKey(fixed);
      const sailIds = configToSails.get(configId) ?? [];
      for (const sailId of sailIds) {
        const sail = byId.get(sailId);
        if (!sail) continue;
        if (!sail.region.cells.includes(key)) sail.region.cells.push(key);
      }
    }
  }

  // Sort cells lexically per sail for deterministic output
  for (const sail of byId.values()) {
    sail.region.cells.sort();
  }

  const activeCfg = v2.configs.find((c) => c.id === v2.activeConfigId);
  const active: SailWardrobe['active'] = {};
  if (activeCfg) {
    if (activeCfg.headsail) active.headsail = slug(activeCfg.headsail);
    if (activeCfg.mainState) active.main = mainStateToSail(activeCfg.mainState).id;
    if (activeCfg.downwindSail) active.downwind = slug(activeCfg.downwindSail);
  }

  return {
    schemaVersion: 3,
    boatId: v2.boatId,
    sails: Array.from(byId.values()),
    active,
    activeMode: v2.activeMode,
  };
}

/** Recognises legacy SAIL_GRID_TWS_BINS/SAIL_GRID_TWA_BINS bounds for guards elsewhere. */
export const FIXED_GRID_BOUNDS = {
  twsBins: SAIL_GRID_TWS_BINS,
  twaBins: SAIL_GRID_TWA_BINS,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run packages/db/src/migrate-wardrobe-v3.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrate-wardrobe-v3.ts packages/db/src/migrate-wardrobe-v3.test.ts
git commit -m "feat(db): v2 → v3 wardrobe migrator (config splitting + cell remap)"
```

---

## Task 7: Rewrite `ConfigStore` for v3 wardrobe

**Files:**
- Modify: `packages/db/src/config-store.ts`
- Delete: `packages/db/src/migrate-wardrobe-v2.ts`, `packages/db/src/migrate-wardrobe-v2.test.ts`
- Delete: `packages/db/src/config-store-crossover.test.ts`, `packages/db/src/schema-crossover.test.ts`, `packages/db/src/config-store-crossover-settings.test.ts`

- [ ] **Step 1: Delete legacy migrator and crossover-map tests**

```bash
git rm packages/db/src/migrate-wardrobe-v2.ts \
       packages/db/src/migrate-wardrobe-v2.test.ts \
       packages/db/src/config-store-crossover.test.ts \
       packages/db/src/schema-crossover.test.ts \
       packages/db/src/config-store-crossover-settings.test.ts
```

- [ ] **Step 2: Rewrite `ConfigStore` sails handling**

In `packages/db/src/config-store.ts`:

a) Remove the imports of `CrossoverMap`, `DEFAULT_CROSSOVER_MAP`, and `migrateWardrobeV1ToV2` (or `migrateWardrobeV2`) and the `crossoverMap` schema import.

b) Remove `subjects.crossoverMap` initialization; remove the crossover_map load block (around lines 292–309); remove `crossoverMap$`, `setCrossoverMap()` (around lines 442–469).

c) Replace the `setSails()` method (currently lines 507–523) with:

```ts
async setSails(value: SailWardrobe): Promise<void> {
  if (value.schemaVersion !== 3) {
    throw new Error(`setSails: expected schemaVersion 3, got ${(value as { schemaVersion?: number }).schemaVersion}`);
  }
  const ids = new Set<string>();
  for (const sail of value.sails) {
    if (ids.has(sail.id)) {
      throw new Error(`setSails: duplicate sail id "${sail.id}"`);
    }
    ids.add(sail.id);
    if (!SAIL_CATEGORIES.includes(sail.category)) {
      throw new Error(`setSails: sail "${sail.id}" has unknown category "${sail.category}"`);
    }
  }
  // Active references must match the sail's category, or be cleared.
  const cleaned: SailWardrobe['active'] = {};
  for (const cat of SAIL_CATEGORIES) {
    const ref = value.active[cat];
    if (!ref) continue;
    const sail = value.sails.find((s) => s.id === ref);
    if (sail && sail.category === cat) cleaned[cat] = ref;
    // else: silently drop the stale reference
  }
  const stored: SailWardrobe = { ...value, active: cleaned };
  this.upsert(sailWardrobe, stored);
  this.subjects.sails.next(stored);
}
```

(Add `SAIL_CATEGORIES` to the existing import line from `./defaults`.)

d) Rewrite `activePolar$` to drop the wardrobe-config dependency. Replace it (currently lines 410–432) with:

```ts
get activePolar$(): Observable<PolarTable> {
  return combineLatest([this.subjects.sails, this.subjects.polarRevisions]).pipe(
    map(([wardrobe, revisionsById]) => {
      const mode = wardrobe.activeMode;
      // Find the most-recent revision for the boat in this mode.
      const candidates: PolarRevision[] = [];
      for (const rev of revisionsById.values()) {
        if (rev.boatId === wardrobe.boatId && rev.mode === mode) candidates.push(rev);
      }
      if (candidates.length === 0) return DEFAULT_POLARS;
      candidates.sort((a, b) => b.createdAt - a.createdAt);
      return candidates[0]!.table;
    }),
  );
},
```

(Ensure `PolarRevision` is in the imports from `./defaults`.)

e) Boot-time migration: replace the existing v1/v2 migration block (currently calling `migrateWardrobeV1ToV2`) with a call to `migrateWardrobeV2toV3`. The raw v2 wardrobe row + v2 crossover_map row + active polar are fed in; the result is written back to `sail_wardrobe` and the `crossover_map` table contents are discarded (the table itself is dropped in Task 5).

The block — open() method, where sail_wardrobe is loaded — becomes:

```ts
// Load raw sail wardrobe row (may be v1, v2, or v3).
const wardrobeRow = this.raw
  .prepare('SELECT value FROM sail_wardrobe WHERE id = ? LIMIT 1')
  .get(this.__activeBoatId) as { value: string } | undefined;
const rawWardrobe = wardrobeRow ? JSON.parse(wardrobeRow.value) : DEFAULT_WARDROBE;

// Read legacy crossover_map row if the table still exists (drop happens next deploy).
let legacyMap: { boatId: string; mode: string; cells: Record<string, string>; updatedAt: number } | null = null;
try {
  const row = this.raw
    .prepare('SELECT value FROM crossover_map WHERE boat_id = ? AND mode = ? LIMIT 1')
    .get(this.__activeBoatId, rawWardrobe.activeMode ?? 'default') as { value: string } | undefined;
  if (row) legacyMap = JSON.parse(row.value);
} catch {
  // Table doesn't exist post-drop — that's fine.
}

// Read active polar table from polar_revisions (most-recent for boat+mode).
const polarRow = this.raw
  .prepare(
    `SELECT value FROM polar_revisions
     WHERE boat_id = ? AND mode = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
  .get(this.__activeBoatId, rawWardrobe.activeMode ?? 'default') as { value: string } | undefined;
const activePolar = polarRow ? JSON.parse(polarRow.value).table : DEFAULT_POLARS;

const wardrobe = migrateWardrobeV2toV3(rawWardrobe, legacyMap, activePolar);
// Persist migrated v3 shape (idempotent if already v3).
this.raw
  .prepare('INSERT OR REPLACE INTO sail_wardrobe (id, value) VALUES (?, ?)')
  .run(this.__activeBoatId, JSON.stringify(wardrobe));
this.subjects.sails = new BehaviorSubject<SailWardrobe>(wardrobe);
```

(Adjust the surrounding code so this fits in place of the previous wardrobe load.)

- [ ] **Step 3: Drop the `crossover_map` DDL execution**

In the same file, find where `crossover_map` is created via `db.exec(...)` (likely in the schema-bootstrap section at the top of `open()`). Replace the `CREATE TABLE IF NOT EXISTS crossover_map ...` SQL with `DROP TABLE IF EXISTS crossover_map`. This cleans up the table on first v3 boot. Leave `crossover_settings` alone — only the JSON shape is trimmed.

- [ ] **Step 4: Write the v3 validation test**

Create `packages/db/src/config-store-sails-v3.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ConfigStore } from './config-store';
import type { SailWardrobe } from './defaults';

function makeStore(): ConfigStore {
  const s = new ConfigStore({ url: ':memory:', activeBoatId: 'sula' });
  s.open();
  return s;
}

describe('ConfigStore.setSails (v3)', () => {
  let store: ConfigStore;
  beforeEach(() => {
    store = makeStore();
  });
  afterEach(() => {
    store.close();
  });

  it('accepts a valid v3 wardrobe', async () => {
    const w: SailWardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [
        { id: 'j0', name: 'J0', category: 'headsail', region: { cells: ['10,5'] } },
        { id: 'reef1', name: 'Reef 1', category: 'main', region: { cells: [] } },
      ],
      active: { headsail: 'j0', main: 'reef1' },
      activeMode: 'default',
    };
    await expect(store.setSails(w)).resolves.toBeUndefined();
  });

  it('rejects duplicate sail ids', async () => {
    const w: SailWardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [
        { id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } },
        { id: 'j0', name: 'J0 again', category: 'headsail', region: { cells: [] } },
      ],
      active: {},
      activeMode: 'default',
    };
    await expect(store.setSails(w)).rejects.toThrow(/duplicate/i);
  });

  it('rejects active reference of wrong category', async () => {
    const w: SailWardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [{ id: 'reef1', name: 'Reef 1', category: 'main', region: { cells: [] } }],
      active: { headsail: 'reef1' },
      activeMode: 'default',
    };
    await store.setSails(w);
    // The validator silently drops a stale ref:
    const stored = await new Promise<SailWardrobe>((resolve) => {
      store.sails$.subscribe((v) => resolve(v));
    });
    expect(stored.active.headsail).toBeUndefined();
  });

  it('clears active reference when a sail is deleted', async () => {
    await store.setSails({
      schemaVersion: 3,
      boatId: 'sula',
      sails: [{ id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } }],
      active: { headsail: 'j0' },
      activeMode: 'default',
    });
    await store.setSails({
      schemaVersion: 3,
      boatId: 'sula',
      sails: [],
      active: { headsail: 'j0' },
      activeMode: 'default',
    });
    const stored = await new Promise<SailWardrobe>((resolve) => {
      store.sails$.subscribe((v) => resolve(v));
    });
    expect(stored.active.headsail).toBeUndefined();
  });

  it('rejects wrong schemaVersion', async () => {
    // @ts-expect-error testing runtime guard
    await expect(store.setSails({ schemaVersion: 2 })).rejects.toThrow(/schemaVersion/);
  });
});
```

- [ ] **Step 5: Run config-store tests**

```bash
npx vitest run packages/db/src/config-store-sails-v3.test.ts
```

Expected: PASS (5 tests). If existing `packages/db/src/config-store.test.ts` references old v2 fields, fix them in place (replace `wardrobe.configs` with `wardrobe.sails`, `activeConfigId` with `active.headsail` etc.).

- [ ] **Step 6: Run the full db package**

```bash
npx vitest run packages/db
```

Expected: PASS. Any v2-shape leftovers in remaining tests are bugs in this task — fix in-line.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/config-store.ts packages/db/src/config-store-sails-v3.test.ts
git add packages/db/src/migrate-wardrobe-v2.ts packages/db/src/migrate-wardrobe-v2.test.ts \
        packages/db/src/config-store-crossover.test.ts packages/db/src/schema-crossover.test.ts \
        packages/db/src/config-store-crossover-settings.test.ts
git commit -m "refactor(db): rewrite ConfigStore for v3 wardrobe; drop crossover_map"
```

---

## Task 8: Region-lookup helper for compute pipeline (TDD)

**Files:**
- Create: `packages/compute/src/sail-crossover/region-lookup.ts`
- Create: `packages/compute/src/sail-crossover/region-lookup.test.ts`
- Delete: `packages/compute/src/sail-crossover/lookup.ts`, `packages/compute/src/sail-crossover/lookup.test.ts`

- [ ] **Step 1: Delete legacy single-winner lookup**

```bash
git rm packages/compute/src/sail-crossover/lookup.ts \
       packages/compute/src/sail-crossover/lookup.test.ts
```

- [ ] **Step 2: Write failing test**

Create `packages/compute/src/sail-crossover/region-lookup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Sail } from '@g5000/db';
import { findValidSailsByCategory } from './region-lookup';

const j0: Sail = { id: 'j0', name: 'J0', category: 'headsail', areaSqM: 79, region: { cells: ['10,12', '14,9'] } };
const stj: Sail = { id: 'stj', name: 'STJ', category: 'headsail', areaSqM: 44, region: { cells: ['14,9', '20,9'] } };
const reef1: Sail = { id: 'reef1', name: 'Reef 1', category: 'main', areaSqM: 58, region: { cells: ['14,9'] } };
const g0: Sail = { id: 'g0', name: 'G0', category: 'downwind', areaSqM: 143, region: { cells: ['14,30'] } };

describe('findValidSailsByCategory', () => {
  it('returns sails whose region contains the cell', () => {
    const r = findValidSailsByCategory([j0, stj, reef1, g0], { twsIdx: 14, twaIdx: 9 });
    expect(r.headsail).toEqual(['j0', 'stj']); // sorted by area desc (79 > 44)
    expect(r.main).toEqual(['reef1']);
    expect(r.downwind).toEqual([]);
  });

  it('returns empty arrays when no sail matches', () => {
    const r = findValidSailsByCategory([j0, stj, reef1, g0], { twsIdx: 0, twaIdx: 0 });
    expect(r).toEqual({ headsail: [], main: [], downwind: [] });
  });

  it('sorts sails without areaSqM last, then by id ascending', () => {
    const a: Sail = { id: 'z', name: 'Z', category: 'headsail', region: { cells: ['10,0'] } };
    const b: Sail = { id: 'a', name: 'A', category: 'headsail', region: { cells: ['10,0'] } };
    const c: Sail = { id: 'c', name: 'C', category: 'headsail', areaSqM: 50, region: { cells: ['10,0'] } };
    const r = findValidSailsByCategory([a, b, c], { twsIdx: 10, twaIdx: 0 });
    expect(r.headsail).toEqual(['c', 'a', 'z']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run packages/compute/src/sail-crossover/region-lookup.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `packages/compute/src/sail-crossover/region-lookup.ts`:

```ts
import type { Cell } from '@g5000/core';
import type { Sail, SailCategory } from '@g5000/db';
import { cellKey } from '@g5000/core';

export interface ValidByCategory {
  headsail: string[];
  main: string[];
  downwind: string[];
}

export function findValidSailsByCategory(sails: Sail[], cell: Cell): ValidByCategory {
  const key = cellKey(cell);
  const buckets: Record<SailCategory, Sail[]> = { headsail: [], main: [], downwind: [] };
  for (const sail of sails) {
    if (sail.region.cells.includes(key)) buckets[sail.category].push(sail);
  }
  return {
    headsail: buckets.headsail.sort(compareSails).map((s) => s.id),
    main: buckets.main.sort(compareSails).map((s) => s.id),
    downwind: buckets.downwind.sort(compareSails).map((s) => s.id),
  };
}

function compareSails(a: Sail, b: Sail): number {
  const aHasArea = a.areaSqM !== undefined;
  const bHasArea = b.areaSqM !== undefined;
  if (aHasArea && bHasArea) {
    if (b.areaSqM! !== a.areaSqM!) return b.areaSqM! - a.areaSqM!;
    return a.id.localeCompare(b.id);
  }
  if (aHasArea) return -1;
  if (bHasArea) return 1;
  return a.id.localeCompare(b.id);
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
npx vitest run packages/compute/src/sail-crossover/region-lookup.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/compute/src/sail-crossover/region-lookup.ts \
        packages/compute/src/sail-crossover/region-lookup.test.ts \
        packages/compute/src/sail-crossover/lookup.ts \
        packages/compute/src/sail-crossover/lookup.test.ts
git commit -m "feat(compute): per-category sail region lookup; drop single-winner"
```

---

## Task 9: Rewrite the sail-crossover pipeline (TDD)

**Files:**
- Modify: `packages/compute/src/sail-crossover/pipeline.ts` (full rewrite)
- Modify: `packages/compute/src/sail-crossover/pipeline.test.ts` (full rewrite)
- Modify: `packages/compute/src/sail-crossover/index.ts`

- [ ] **Step 1: Write new pipeline tests**

Overwrite `packages/compute/src/sail-crossover/pipeline.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { Bus } from '@g5000/core';
import type { Sample } from '@g5000/core';
import type { CrossoverSettings, SailWardrobe } from '@g5000/db';
import { startSailCrossoverPipeline } from './pipeline';

function bus(): Bus {
  return new Bus();
}

const SETTINGS: CrossoverSettings = {
  recommendationStableSeconds: 5,
  forecastIntervalMinutes: 30,
  forecastDurationHours: 12,
};

const WARDROBE: SailWardrobe = {
  schemaVersion: 3,
  boatId: 'sula',
  sails: [
    { id: 'j0', name: 'J0', category: 'headsail', areaSqM: 79, region: { cells: ['10,9'] } },
    { id: 'reef1', name: 'Reef 1', category: 'main', areaSqM: 58, region: { cells: ['10,9'] } },
  ],
  active: { headsail: 'j0', main: 'reef1' },
  activeMode: 'default',
};

function makeWindSample(twsMs: number, twaRad: number, t_ns: bigint): [Sample, Sample] {
  return [
    { channel: 'wind.true.speed', t_ns, value: { kind: 'scalar', value: twsMs }, source: 'test' },
    { channel: 'wind.true.angle', t_ns, value: { kind: 'scalar', value: twaRad }, source: 'test' },
  ];
}

describe('sail-crossover pipeline', () => {
  it('emits valid sails per category at current cell', async () => {
    const b = bus();
    const sails$ = new BehaviorSubject<SailWardrobe>(WARDROBE);
    const settings$ = new BehaviorSubject<CrossoverSettings>(SETTINGS);
    const sub = startSailCrossoverPipeline({
      bus: b,
      sails$,
      settings$,
      now: () => 1000,
    });
    const seen: any[] = [];
    b.subscribe('sail.recommendation', (s) => seen.push(s.value));

    // 10 kn (5.144 m/s) at 45° (0.785 rad) -> cell (10, 9)
    const [sp, an] = makeWindSample(10 * 0.514444, Math.PI / 4, 1_000_000_000n);
    b.publish(sp);
    b.publish(an);
    await new Promise((r) => setTimeout(r, 5));

    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last.kind).toBe('sail_recommendation');
    expect(last.valid.headsail).toEqual(['j0']);
    expect(last.valid.main).toEqual(['reef1']);
    expect(last.changeNeeded).toEqual({ headsail: false, main: false, downwind: false });
    sub.unsubscribe();
  });

  it('fires changeNeeded after stableSeconds when active falls out of valid set', async () => {
    const b = bus();
    const sails$ = new BehaviorSubject<SailWardrobe>(WARDROBE);
    const settings$ = new BehaviorSubject<CrossoverSettings>(SETTINGS);
    let now = 1000;
    const sub = startSailCrossoverPipeline({
      bus: b,
      sails$,
      settings$,
      now: () => now,
    });
    const seen: any[] = [];
    b.subscribe('sail.recommendation', (s) => seen.push(s.value));

    // At 20 kn, 90° -> cell (20, 18). Neither active sail is valid here.
    const [sp1, an1] = makeWindSample(20 * 0.514444, Math.PI / 2, 1_000_000_000n);
    b.publish(sp1);
    b.publish(an1);
    await new Promise((r) => setTimeout(r, 5));

    expect(seen.at(-1)!.changeNeeded.headsail).toBe(false); // not yet stable

    // Advance 6 seconds, send another sample at the same cell
    now += 6;
    const [sp2, an2] = makeWindSample(20 * 0.514444, Math.PI / 2, 2_000_000_000n);
    b.publish(sp2);
    b.publish(an2);
    await new Promise((r) => setTimeout(r, 5));

    expect(seen.at(-1)!.changeNeeded.headsail).toBe(true);
    expect(seen.at(-1)!.changeNeeded.main).toBe(true);
    sub.unsubscribe();
  });
});
```

- [ ] **Step 2: Run tests, expect FAIL**

```bash
npx vitest run packages/compute/src/sail-crossover/pipeline.test.ts
```

Expected: FAIL — old pipeline signature is gone.

- [ ] **Step 3: Rewrite the pipeline**

Overwrite `packages/compute/src/sail-crossover/pipeline.ts`:

```ts
import { combineLatest, Subscription } from 'rxjs';
import { Bus, Channels, snapToFixedGrid, type Cell } from '@g5000/core';
import type { CrossoverSettings, Sail, SailCategory, SailWardrobe } from '@g5000/db';
import { findValidSailsByCategory, type ValidByCategory } from './region-lookup';
import type { Observable } from 'rxjs';

export interface StartArgs {
  bus: Bus;
  sails$: Observable<SailWardrobe>;
  settings$: Observable<CrossoverSettings>;
  /** UNIX seconds; injectable for tests. */
  now?: () => number;
}

/**
 * Per-category timer state: when did the active sail first fall outside its
 * region? null when it's currently valid. The timer is reset whenever the
 * active sail re-enters its region, OR when the user changes the active sail
 * for that category.
 */
interface CategoryTimer {
  outSince: number | null;
  lastActive: string | undefined;
}

const CATEGORIES: SailCategory[] = ['headsail', 'main', 'downwind'];

export function startSailCrossoverPipeline(args: StartArgs): Subscription {
  const now = args.now ?? (() => Math.floor(Date.now() / 1000));
  const timers: Record<SailCategory, CategoryTimer> = {
    headsail: { outSince: null, lastActive: undefined },
    main: { outSince: null, lastActive: undefined },
    downwind: { outSince: null, lastActive: undefined },
  };

  // We need TWS + TWA together. Latch both and emit on every wind update.
  let lastTws: number | null = null;
  let lastTwa: number | null = null;

  const sub = combineLatest([args.sails$, args.settings$]).subscribe(([wardrobe, settings]) => {
    // Re-evaluate on store changes too (e.g., user repaints a region).
    if (lastTws !== null && lastTwa !== null) {
      emit(args.bus, wardrobe, settings, lastTws, lastTwa, now(), timers);
    }
  });

  sub.add(
    args.bus.subscribe('wind.true.speed', (s) => {
      if (s.value.kind !== 'scalar') return;
      lastTws = s.value.value;
      maybeEmit(args, wardrobeAndSettings(args), lastTws, lastTwa, now(), timers);
    }),
  );
  sub.add(
    args.bus.subscribe('wind.true.angle', (s) => {
      if (s.value.kind !== 'scalar') return;
      lastTwa = s.value.value;
      maybeEmit(args, wardrobeAndSettings(args), lastTws, lastTwa, now(), timers);
    }),
  );

  return sub;
}

// Helper: synchronously read the latest wardrobe/settings via BehaviorSubject pattern.
// Subscriptions used inside .subscribe() callbacks would re-emit; instead we use a
// snapshot pattern. Pipeline accepts BehaviorSubject-like observables.
function wardrobeAndSettings(args: StartArgs): { wardrobe: SailWardrobe; settings: CrossoverSettings } | null {
  // We rely on the subjects being BehaviorSubjects — read .value via a one-shot subscribe.
  let w: SailWardrobe | null = null;
  let s: CrossoverSettings | null = null;
  const sw = args.sails$.subscribe((v) => (w = v));
  const ss = args.settings$.subscribe((v) => (s = v));
  sw.unsubscribe();
  ss.unsubscribe();
  return w && s ? { wardrobe: w, settings: s } : null;
}

function maybeEmit(
  args: StartArgs,
  state: { wardrobe: SailWardrobe; settings: CrossoverSettings } | null,
  tws: number | null,
  twa: number | null,
  t: number,
  timers: Record<SailCategory, CategoryTimer>,
): void {
  if (!state || tws === null || twa === null) return;
  emit(args.bus, state.wardrobe, state.settings, tws, twa, t, timers);
}

function emit(
  bus: Bus,
  wardrobe: SailWardrobe,
  settings: CrossoverSettings,
  twsMs: number,
  twaRad: number,
  t: number,
  timers: Record<SailCategory, CategoryTimer>,
): void {
  const cell: Cell = snapToFixedGrid({ twsMs, twaRad });
  const valid: ValidByCategory = findValidSailsByCategory(wardrobe.sails, cell);
  const changeNeeded = {
    headsail: false,
    main: false,
    downwind: false,
  };

  for (const cat of CATEGORIES) {
    const active = wardrobe.active[cat];
    const timer = timers[cat];
    // Reset timer if user changed active sail
    if (active !== timer.lastActive) {
      timer.outSince = null;
      timer.lastActive = active;
    }
    if (!active) {
      timer.outSince = null;
      continue;
    }
    const inRange = valid[cat].includes(active);
    if (inRange) {
      timer.outSince = null;
    } else {
      if (timer.outSince === null) timer.outSince = t;
      if (t - timer.outSince >= settings.recommendationStableSeconds) {
        changeNeeded[cat] = true;
      }
    }
  }

  const MPS_PER_KN = 0.514444;
  const RAD_TO_DEG = 180 / Math.PI;
  bus.publish({
    channel: Channels.SAIL_RECOMMENDATION,
    t_ns: BigInt(t) * 1_000_000_000n,
    value: {
      kind: 'sail_recommendation',
      cellTwsKn: cell.twsIdx, // 1 kn per bin, so idx == knots
      cellTwaDeg: cell.twaIdx * 5,
      valid,
      active: { ...wardrobe.active },
      changeNeeded,
      enteredAt: t,
      stableSeconds: settings.recommendationStableSeconds,
    },
    source: 'compute:sail-crossover',
  });
}
```

- [ ] **Step 4: Re-export from index**

In `packages/compute/src/sail-crossover/index.ts`, replace the contents with:

```ts
export { startSailCrossoverPipeline, type StartArgs } from './pipeline';
export { findValidSailsByCategory, type ValidByCategory } from './region-lookup';
```

- [ ] **Step 5: Run pipeline tests**

```bash
npx vitest run packages/compute/src/sail-crossover/pipeline.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Run the whole compute package**

```bash
npx vitest run packages/compute
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/compute/src/sail-crossover/pipeline.ts \
        packages/compute/src/sail-crossover/pipeline.test.ts \
        packages/compute/src/sail-crossover/index.ts
git commit -m "feat(compute): per-category sail-crossover pipeline (Model B)"
```

---

## Task 10: Remove routing-side sail timeline

**Files:**
- Delete: `packages/routing/src/sail-timeline.ts`, `packages/routing/src/sail-timeline.test.ts`, `packages/routing/src/plan.crossover.test.ts`
- Modify: `packages/routing/src/types.ts`, `packages/routing/src/plan.ts`, `packages/routing/src/index.ts`

- [ ] **Step 1: Delete sail-timeline files**

```bash
git rm packages/routing/src/sail-timeline.ts \
       packages/routing/src/sail-timeline.test.ts \
       packages/routing/src/plan.crossover.test.ts
```

- [ ] **Step 2: Edit `packages/routing/src/types.ts`**

Find `RouteLeg` (around line 25) and remove the `configId?: string;` field. Find `PlanInput` (around lines 95–105) and remove the `crossover?: ...` field. Find and delete the `SailTimelineSegment` interface (around lines 74–81).

- [ ] **Step 3: Edit `packages/routing/src/plan.ts`**

Remove any references to `input.crossover`, `leg.configId`, or the sail-timeline imports. The `plan()` function returns legs without `configId`.

- [ ] **Step 4: Edit `packages/routing/src/index.ts`**

Remove any export of `computeSailTimeline` or `SailTimelineSegment`.

- [ ] **Step 5: Run routing tests**

```bash
npx vitest run packages/routing
```

Expected: PASS. Existing property tests for `plan()` should still pass — removing `configId` is type-narrowing.

- [ ] **Step 6: Commit**

```bash
git add packages/routing/src/types.ts packages/routing/src/plan.ts packages/routing/src/index.ts \
        packages/routing/src/sail-timeline.ts packages/routing/src/sail-timeline.test.ts \
        packages/routing/src/plan.crossover.test.ts
git commit -m "refactor(routing): drop per-leg sail recommendation + sail-timeline"
```

---

## Task 11: Rewrite `/api/sails` route for v3 (TDD)

**Files:**
- Modify: `packages/web/src/app/api/sails/route.ts`
- Create / modify: `packages/web/src/app/api/sails/route.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/web/src/app/api/sails/route.test.ts` (overwrite if it exists):

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from './route';

// Helper: stub the singleton store with an in-memory ConfigStore.
import { ConfigStore } from '@g5000/db';

function setupStore() {
  const store = new ConfigStore({ url: ':memory:', activeBoatId: 'sula' });
  store.open();
  (globalThis as any).__g5000_config_store__ = store;
  return store;
}

describe('/api/sails route', () => {
  beforeEach(() => {
    setupStore();
  });

  it('GET returns v3 wardrobe', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.schemaVersion).toBe(3);
    expect(Array.isArray(body.sails)).toBe(true);
  });

  it('PUT accepts a valid v3 wardrobe and round-trips', async () => {
    const wardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [{ id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } }],
      active: { headsail: 'j0' },
      activeMode: 'default',
    };
    const req = new NextRequest('http://x/api/sails', {
      method: 'PUT',
      body: JSON.stringify(wardrobe),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const back = await (await GET()).json();
    expect(back.sails).toHaveLength(1);
    expect(back.active.headsail).toBe('j0');
  });

  it('PUT rejects wardrobe with duplicate sail ids', async () => {
    const wardrobe = {
      schemaVersion: 3,
      boatId: 'sula',
      sails: [
        { id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } },
        { id: 'j0', name: 'J0 alt', category: 'headsail', region: { cells: [] } },
      ],
      active: {},
      activeMode: 'default',
    };
    const req = new NextRequest('http://x/api/sails', {
      method: 'PUT',
      body: JSON.stringify(wardrobe),
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npx vitest run packages/web/src/app/api/sails/route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Rewrite the route handler**

Overwrite `packages/web/src/app/api/sails/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';
import type { SailWardrobe } from '@g5000/db';

export async function GET(): Promise<NextResponse> {
  const store = getSharedConfigStore();
  return new Promise<NextResponse>((resolve) => {
    const sub = store.sails$.subscribe((w: SailWardrobe) => {
      resolve(NextResponse.json(w));
      sub.unsubscribe();
    });
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as SailWardrobe;
  const store = getSharedConfigStore();
  try {
    await store.setSails(body);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npx vitest run packages/web/src/app/api/sails/route.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/sails/route.ts packages/web/src/app/api/sails/route.test.ts
git commit -m "feat(web): /api/sails v3 GET/PUT with validation"
```

---

## Task 12: Rewrite `/api/sails/active` for per-category set

**Files:**
- Modify: `packages/web/src/app/api/sails/active/route.ts`
- Create: `packages/web/src/app/api/sails/active/route.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/web/src/app/api/sails/active/route.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { ConfigStore } from '@g5000/db';

function setupStore() {
  const store = new ConfigStore({ url: ':memory:', activeBoatId: 'sula' });
  store.open();
  store.setSails({
    schemaVersion: 3,
    boatId: 'sula',
    sails: [
      { id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } },
      { id: 'reef1', name: 'Reef 1', category: 'main', region: { cells: [] } },
    ],
    active: {},
    activeMode: 'default',
  });
  (globalThis as any).__g5000_config_store__ = store;
  return store;
}

describe('/api/sails/active route', () => {
  beforeEach(() => {
    setupStore();
  });

  it('POST sets active sail for a category', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({ category: 'headsail', sailId: 'j0' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('POST with sailId=null clears the active sail', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({ category: 'main', sailId: null }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('POST rejects unknown category', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({ category: 'mizzen', sailId: null }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('POST rejects sailId not matching the category', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({ category: 'headsail', sailId: 'reef1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
npx vitest run packages/web/src/app/api/sails/active/route.test.ts
```

- [ ] **Step 3: Rewrite the route handler**

Overwrite `packages/web/src/app/api/sails/active/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSharedConfigStore, SAIL_CATEGORIES } from '@g5000/db';
import type { SailCategory } from '@g5000/db';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as { category: SailCategory; sailId: string | null };
  if (!SAIL_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `unknown category "${body.category}"` }, { status: 400 });
  }
  const store = getSharedConfigStore();
  // Read current wardrobe synchronously through the BehaviorSubject
  const w = await new Promise<import('@g5000/db').SailWardrobe>((resolve) => {
    const sub = store.sails$.subscribe((v) => {
      resolve(v);
      sub.unsubscribe();
    });
  });
  if (body.sailId !== null) {
    const sail = w.sails.find((s) => s.id === body.sailId);
    if (!sail) {
      return NextResponse.json({ error: `unknown sail "${body.sailId}"` }, { status: 400 });
    }
    if (sail.category !== body.category) {
      return NextResponse.json(
        { error: `sail "${body.sailId}" is category "${sail.category}", not "${body.category}"` },
        { status: 400 },
      );
    }
  }
  const active = { ...w.active, [body.category]: body.sailId ?? undefined };
  // Cleanly drop undefined keys
  for (const k of Object.keys(active) as SailCategory[]) {
    if (active[k] === undefined) delete active[k];
  }
  await store.setSails({ ...w, active });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
npx vitest run packages/web/src/app/api/sails/active/route.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/sails/active/route.ts packages/web/src/app/api/sails/active/route.test.ts
git commit -m "feat(web): /api/sails/active per-category set"
```

---

## Task 13: New `/api/sails/[sailId]/region` route (TDD)

**Files:**
- Create: `packages/web/src/app/api/sails/[sailId]/region/route.ts`
- Create: `packages/web/src/app/api/sails/[sailId]/region/route.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/web/src/app/api/sails/[sailId]/region/route.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { ConfigStore } from '@g5000/db';

function setupStore() {
  const store = new ConfigStore({ url: ':memory:', activeBoatId: 'sula' });
  store.open();
  store.setSails({
    schemaVersion: 3,
    boatId: 'sula',
    sails: [{ id: 'j0', name: 'J0', category: 'headsail', region: { cells: [] } }],
    active: {},
    activeMode: 'default',
  });
  (globalThis as any).__g5000_config_store__ = store;
  return store;
}

describe('/api/sails/[sailId]/region route', () => {
  beforeEach(() => {
    setupStore();
  });

  it('POST replaces cells for the given sail', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({ cells: ['10,5', '12,9'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ sailId: 'j0' }) });
    expect(res.status).toBe(200);
  });

  it('POST returns 404 for unknown sail', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({ cells: ['1,1'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ sailId: 'nope' }) });
    expect(res.status).toBe(404);
  });

  it('POST rejects out-of-bounds cell keys', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({ cells: ['99,99'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ sailId: 'j0' }) });
    expect(res.status).toBe(400);
  });

  it('POST rejects malformed cell keys', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({ cells: ['hello'] }),
    });
    const res = await POST(req, { params: Promise.resolve({ sailId: 'j0' }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
npx vitest run "packages/web/src/app/api/sails/[sailId]/region/route.test.ts"
```

- [ ] **Step 3: Implement the route**

Create `packages/web/src/app/api/sails/[sailId]/region/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';
import { parseCellKey } from '@g5000/core';
import type { SailWardrobe } from '@g5000/db';

interface Params {
  params: Promise<{ sailId: string }>;
}

export async function POST(req: NextRequest, ctx: Params): Promise<NextResponse> {
  const { sailId } = await ctx.params;
  const body = (await req.json()) as { cells: string[] };
  if (!Array.isArray(body.cells)) {
    return NextResponse.json({ error: 'cells must be an array' }, { status: 400 });
  }
  for (const key of body.cells) {
    if (parseCellKey(key) === null) {
      return NextResponse.json({ error: `invalid cell key "${key}"` }, { status: 400 });
    }
  }
  const store = getSharedConfigStore();
  const w = await new Promise<SailWardrobe>((resolve) => {
    const sub = store.sails$.subscribe((v) => {
      resolve(v);
      sub.unsubscribe();
    });
  });
  const sail = w.sails.find((s) => s.id === sailId);
  if (!sail) {
    return NextResponse.json({ error: `sail "${sailId}" not found` }, { status: 404 });
  }
  // Dedupe + sort for deterministic storage.
  const unique = Array.from(new Set(body.cells)).sort();
  const updated: SailWardrobe = {
    ...w,
    sails: w.sails.map((s) => (s.id === sailId ? { ...s, region: { cells: unique } } : s)),
  };
  await store.setSails(updated);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
npx vitest run "packages/web/src/app/api/sails/[sailId]/region/route.test.ts"
```

- [ ] **Step 5: Commit**

```bash
git add "packages/web/src/app/api/sails/[sailId]/region/route.ts" \
        "packages/web/src/app/api/sails/[sailId]/region/route.test.ts"
git commit -m "feat(web): /api/sails/[sailId]/region POST (replace cells)"
```

---

## Task 14: Drop `/api/crossover-map` route

**Files:**
- Delete: `packages/web/src/app/api/crossover-map/route.ts`, `route.test.ts`

- [ ] **Step 1: Delete the route**

```bash
git rm packages/web/src/app/api/crossover-map/route.ts \
       packages/web/src/app/api/crossover-map/route.test.ts
rmdir packages/web/src/app/api/crossover-map 2>/dev/null || true
```

- [ ] **Step 2: Search for stale references**

```bash
grep -rn 'crossover-map' packages/web/src
```

Fix any UI imports that still call `/api/crossover-map` — typically `/sails/crossover/page.tsx`. (These will be rewritten in Task 18; for now, replace any direct fetches with `// removed: crossover-map endpoint dropped in Model B refactor` and TypeScript will continue to fail. That's expected.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(web): drop /api/crossover-map (replaced by region routes)"
```

---

## Task 15: Trim `/api/crossover-settings` response shape

**Files:**
- Modify: `packages/web/src/app/api/crossover-settings/route.ts`
- Modify: `packages/web/src/app/api/crossover-settings/route.test.ts`

- [ ] **Step 1: Edit `/api/crossover-settings/route.ts`**

Update the file so GET returns and POST accepts only `{ recommendationStableSeconds, forecastIntervalMinutes, forecastDurationHours }`. Both handlers should reject unknown keys with 400 (or silently strip — pick one and apply consistently). Replace any existing handler with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';
import type { CrossoverSettings } from '@g5000/db';

export async function GET(): Promise<NextResponse> {
  const store = getSharedConfigStore();
  const settings = await new Promise<CrossoverSettings>((resolve) => {
    const sub = store.crossoverSettings$.subscribe((v) => {
      resolve(v);
      sub.unsubscribe();
    });
  });
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as Partial<CrossoverSettings>;
  const required = ['recommendationStableSeconds', 'forecastIntervalMinutes', 'forecastDurationHours'] as const;
  const merged: CrossoverSettings = {
    recommendationStableSeconds: body.recommendationStableSeconds ?? 30,
    forecastIntervalMinutes: body.forecastIntervalMinutes ?? 30,
    forecastDurationHours: body.forecastDurationHours ?? 12,
  };
  for (const k of required) {
    if (typeof merged[k] !== 'number' || !Number.isFinite(merged[k])) {
      return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
    }
  }
  const store = getSharedConfigStore();
  await store.setCrossoverSettings(merged);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Update the existing test**

Rewrite `packages/web/src/app/api/crossover-settings/route.test.ts` to assert only the 3-field shape:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { ConfigStore } from '@g5000/db';

function setupStore() {
  const store = new ConfigStore({ url: ':memory:', activeBoatId: 'sula' });
  store.open();
  (globalThis as any).__g5000_config_store__ = store;
  return store;
}

describe('/api/crossover-settings', () => {
  beforeEach(() => {
    setupStore();
  });

  it('GET returns the 3-field shape', async () => {
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      'forecastDurationHours',
      'forecastIntervalMinutes',
      'recommendationStableSeconds',
    ]);
  });

  it('POST round-trips', async () => {
    const req = new NextRequest('http://x', {
      method: 'POST',
      body: JSON.stringify({
        recommendationStableSeconds: 10,
        forecastIntervalMinutes: 15,
        forecastDurationHours: 6,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const back = await (await GET()).json();
    expect(back.recommendationStableSeconds).toBe(10);
  });
});
```

- [ ] **Step 3: Run test, expect PASS**

```bash
npx vitest run packages/web/src/app/api/crossover-settings/route.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/api/crossover-settings/route.ts \
        packages/web/src/app/api/crossover-settings/route.test.ts
git commit -m "refactor(web): trim /api/crossover-settings to 3-field shape"
```

---

## Task 16: Fix `/inspect` exhaustive-switch arm for new payload

**Files:**
- Modify: `packages/web/src/app/inspect/page.tsx`

- [ ] **Step 1: Locate the exhaustive switch**

```bash
grep -n "kind === 'sail_recommendation'" packages/web/src/app/inspect/page.tsx
```

Find the arm that renders the sail-recommendation channel. Replace it with a rendering of the new fields. For example:

```tsx
if (sample.value.kind === 'sail_recommendation') {
  const v = sample.value;
  return (
    <span>
      cell ({v.cellTwsKn} kn, {v.cellTwaDeg}°) — H:{v.valid.headsail.join('/') || '—'} M:{v.valid.main.join('/') || '—'} D:{v.valid.downwind.join('/') || '—'}
    </span>
  );
}
```

- [ ] **Step 2: Typecheck the web package**

```bash
npm run build --workspace @g5000/web 2>&1 | tail -40
```

This will likely still fail because `/sails` and `/sails/crossover` pages haven't been rewritten yet. Confirm the only errors are in those two files, not in `inspect/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/inspect/page.tsx
git commit -m "fix(web): inspect exhaustive switch for v3 sail_recommendation"
```

---

## Task 17: Rewrite `/sails` wardrobe page

**Files:**
- Modify: `packages/web/src/app/sails/page.tsx` (complete rewrite)
- Delete (later in Task 18): `packages/web/src/app/sails/ForecastTimeline.tsx`, `RecommendationPanel.tsx`, `CrossoverChart.tsx`

- [ ] **Step 1: Overwrite `packages/web/src/app/sails/page.tsx`**

Replace the entire file:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { Sail, SailCategory, SailWardrobe } from '@g5000/db';

const CATEGORIES: { key: SailCategory; label: string }[] = [
  { key: 'headsail', label: 'Headsails' },
  { key: 'main', label: 'Main / Reef' },
  { key: 'downwind', label: 'Downwind' },
];

function slug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export default function SailsPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [draftName, setDraftName] = useState<Record<SailCategory, string>>({
    headsail: '',
    main: '',
    downwind: '',
  });
  const [draftArea, setDraftArea] = useState<Record<SailCategory, string>>({
    headsail: '',
    main: '',
    downwind: '',
  });

  useEffect(() => {
    void fetch('/api/sails').then(async (r) => setWardrobe(await r.json()));
  }, []);

  async function save(next: SailWardrobe) {
    const res = await fetch('/api/sails', { method: 'PUT', body: JSON.stringify(next) });
    if (!res.ok) {
      const body = await res.json();
      alert(`Save failed: ${body.error ?? res.statusText}`);
      return;
    }
    setWardrobe(next);
  }

  if (!wardrobe) return <div className="p-4">Loading…</div>;

  async function addSail(cat: SailCategory) {
    const name = draftName[cat].trim();
    if (!name) return;
    const id = slug(name);
    if (wardrobe!.sails.some((s) => s.id === id)) {
      alert(`Sail "${id}" already exists.`);
      return;
    }
    const areaSqM = draftArea[cat] ? Number(draftArea[cat]) : undefined;
    const newSail: Sail = {
      id,
      name,
      category: cat,
      region: { cells: [] },
      ...(Number.isFinite(areaSqM) && areaSqM ? { areaSqM } : {}),
    };
    await save({ ...wardrobe!, sails: [...wardrobe!.sails, newSail] });
    setDraftName({ ...draftName, [cat]: '' });
    setDraftArea({ ...draftArea, [cat]: '' });
  }

  async function deleteSail(sailId: string) {
    if (!confirm(`Delete sail "${sailId}"? Its region will be lost.`)) return;
    await save({ ...wardrobe!, sails: wardrobe!.sails.filter((s) => s.id !== sailId) });
  }

  async function setActive(cat: SailCategory, sailId: string | null) {
    await fetch('/api/sails/active', {
      method: 'POST',
      body: JSON.stringify({ category: cat, sailId }),
    });
    // Refresh
    setWardrobe(await (await fetch('/api/sails')).json());
  }

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Sail Wardrobe</h1>
      {CATEGORIES.map(({ key, label }) => {
        const sailsInCat = wardrobe.sails.filter((s) => s.category === key);
        return (
          <section key={key}>
            <h2 className="text-lg font-medium mb-2">{label}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Name</th>
                  <th className="text-left">Area (m²)</th>
                  <th className="text-left">Cells</th>
                  <th className="text-left">Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sailsInCat.map((sail) => (
                  <tr key={sail.id}>
                    <td>{sail.name}</td>
                    <td>{sail.areaSqM ?? ''}</td>
                    <td>{sail.region.cells.length}</td>
                    <td>
                      <input
                        type="radio"
                        name={`active-${key}`}
                        checked={wardrobe.active[key] === sail.id}
                        onChange={() => setActive(key, sail.id)}
                      />
                    </td>
                    <td>
                      <button onClick={() => deleteSail(sail.id)} className="text-red-500">
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <input
                      value={draftName[key]}
                      onChange={(e) => setDraftName({ ...draftName, [key]: e.target.value })}
                      placeholder="new sail name"
                      className="border px-1"
                    />
                  </td>
                  <td>
                    <input
                      value={draftArea[key]}
                      onChange={(e) => setDraftArea({ ...draftArea, [key]: e.target.value })}
                      placeholder="m²"
                      className="border px-1 w-20"
                    />
                  </td>
                  <td colSpan={3}>
                    <button onClick={() => addSail(key)} className="text-blue-500">
                      add
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="text-sm text-gray-500">
        Paint each sail's TWS/TWA region on the <a href="/sails/crossover" className="underline">crossover page</a>.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke**

```bash
npm run dev --workspace @g5000/autopilot-server &
sleep 8
curl -s http://localhost:3000/api/sails | head -c 200
```

Expected: JSON with v3 wardrobe. Kill the dev server (`kill %1`).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sails/page.tsx
git commit -m "feat(web): /sails wardrobe page (atomic sails, category-grouped)"
```

---

## Task 18: New `CategoryRecommendation` component

**Files:**
- Create: `packages/web/src/app/sails/CategoryRecommendation.tsx`
- Delete: `packages/web/src/app/sails/RecommendationPanel.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/web/src/app/sails/CategoryRecommendation.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { Sail, SailCategory, SailWardrobe } from '@g5000/db';

interface Rec {
  cellTwsKn: number;
  cellTwaDeg: number;
  valid: Record<SailCategory, string[]>;
  active: Partial<Record<SailCategory, string>>;
  changeNeeded: Record<SailCategory, boolean>;
}

export function CategoryRecommendation({ wardrobe }: { wardrobe: SailWardrobe }) {
  const [rec, setRec] = useState<Rec | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream?channels=sail.recommendation');
    es.addEventListener('message', (ev) => {
      try {
        const sample = JSON.parse(ev.data);
        if (sample.value?.kind === 'sail_recommendation') setRec(sample.value);
      } catch {
        // ignore parse error
      }
    });
    return () => es.close();
  }, []);

  const byId = new Map(wardrobe.sails.map((s) => [s.id, s] as const));
  const labels: Record<SailCategory, string> = {
    headsail: 'Headsail',
    main: 'Main',
    downwind: 'Downwind',
  };

  return (
    <div className="space-y-2">
      <h3 className="text-base font-medium">Recommendation</h3>
      {rec ? (
        <p className="text-xs text-gray-500">
          {rec.cellTwsKn} kn / {rec.cellTwaDeg}°
        </p>
      ) : (
        <p className="text-xs text-gray-500">waiting for wind…</p>
      )}
      {(['headsail', 'main', 'downwind'] as SailCategory[]).map((cat) => {
        const active = rec?.active[cat];
        const valid = rec?.valid[cat] ?? [];
        const change = rec?.changeNeeded[cat] ?? false;
        return (
          <div key={cat} className="border rounded p-2">
            <div className="text-sm font-medium flex items-center gap-2">
              {labels[cat]}
              {change && (
                <span className="bg-red-500 text-white text-xs px-1 rounded">change</span>
              )}
            </div>
            <div className="text-sm">
              <span className="text-gray-600">active:</span>{' '}
              {active ? byId.get(active)?.name ?? active : '—'}
            </div>
            <div className="text-xs text-gray-600 flex flex-wrap gap-1 mt-1">
              {valid.length ? (
                valid.map((id) => (
                  <span key={id} className="bg-gray-100 px-1 rounded">
                    {byId.get(id)?.name ?? id}
                  </span>
                ))
              ) : (
                <span>none valid</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Delete the old panel**

```bash
git rm packages/web/src/app/sails/RecommendationPanel.tsx
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sails/CategoryRecommendation.tsx
git commit -m "feat(web): CategoryRecommendation component (per-category live rec)"
```

---

## Task 19: New chart components (`SailOverlayChart` view; `SailRegionEditor` edit)

**Files:**
- Create: `packages/web/src/app/sails/SailOverlayChart.tsx`
- Create: `packages/web/src/app/sails/SailRegionEditor.tsx`
- Delete: `packages/web/src/app/sails/CrossoverChart.tsx`
- Delete: `packages/web/src/app/sails/ForecastTimeline.tsx`

- [ ] **Step 1: Implement `SailOverlayChart.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import {
  SAIL_GRID_TWS_BINS,
  SAIL_GRID_TWA_BINS,
  SAIL_GRID_TWA_STEP_DEG,
} from '@g5000/core';
import type { Sail, SailCategory, SailWardrobe } from '@g5000/db';
import { colorForId } from '../../lib/config-color';

const CELL_W = 14;
const CELL_H = 14;

interface Props {
  wardrobe: SailWardrobe;
  filterCategory?: SailCategory | 'all';
  liveCell?: { twsIdx: number; twaIdx: number };
}

export function SailOverlayChart({ wardrobe, filterCategory = 'all', liveCell }: Props) {
  const sails = useMemo(
    () =>
      filterCategory === 'all'
        ? wardrobe.sails
        : wardrobe.sails.filter((s) => s.category === filterCategory),
    [wardrobe, filterCategory],
  );

  const W = SAIL_GRID_TWS_BINS * CELL_W;
  const H = SAIL_GRID_TWA_BINS * CELL_H;

  return (
    <svg width={W + 40} height={H + 30}>
      <g transform="translate(40,0)">
        {/* Axis lines */}
        {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((kn) => (
          <line key={`gx-${kn}`} x1={kn * CELL_W} y1={0} x2={kn * CELL_W} y2={H} stroke="#eee" />
        ))}
        {[0, 30, 60, 90, 120, 150, 180].map((deg) => {
          const y = (deg / SAIL_GRID_TWA_STEP_DEG) * CELL_H;
          return <line key={`gy-${deg}`} x1={0} y1={y} x2={W} y2={y} stroke="#eee" />;
        })}

        {/* Region fills */}
        {sails.map((sail) => (
          <g key={sail.id} fill={colorForId(sail.id)} fillOpacity={0.25}>
            {sail.region.cells.map((key) => {
              const [tx, ty] = key.split(',').map(Number);
              return (
                <rect
                  key={`${sail.id}-${key}`}
                  x={(tx as number) * CELL_W}
                  y={(ty as number) * CELL_H}
                  width={CELL_W}
                  height={CELL_H}
                />
              );
            })}
          </g>
        ))}

        {/* Live position */}
        {liveCell && (
          <circle
            cx={liveCell.twsIdx * CELL_W + CELL_W / 2}
            cy={liveCell.twaIdx * CELL_H + CELL_H / 2}
            r={5}
            fill="black"
            stroke="white"
            strokeWidth={2}
          />
        )}
      </g>
      <text x={10} y={10} fontSize={10}>TWA</text>
      <text x={W} y={H + 20} fontSize={10}>TWS (kn)</text>
    </svg>
  );
}
```

- [ ] **Step 2: Implement `SailRegionEditor.tsx`**

```tsx
'use client';

import { useState } from 'react';
import {
  SAIL_GRID_TWS_BINS,
  SAIL_GRID_TWA_BINS,
  SAIL_GRID_TWA_STEP_DEG,
  cellKey,
} from '@g5000/core';
import type { Sail } from '@g5000/db';
import { colorForId } from '../../lib/config-color';

const CELL_W = 14;
const CELL_H = 14;

interface Props {
  sail: Sail;
  onSave: (cells: string[]) => Promise<void>;
}

export function SailRegionEditor({ sail, onSave }: Props) {
  const [cells, setCells] = useState<Set<string>>(new Set(sail.region.cells));
  const [dirty, setDirty] = useState(false);

  function toggle(twsIdx: number, twaIdx: number) {
    const key = cellKey({ twsIdx, twaIdx });
    const next = new Set(cells);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCells(next);
    setDirty(true);
  }

  const W = SAIL_GRID_TWS_BINS * CELL_W;
  const H = SAIL_GRID_TWA_BINS * CELL_H;
  const color = colorForId(sail.id);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">Editing: <b>{sail.name}</b> ({cells.size} cells)</span>
        <button
          disabled={!dirty}
          onClick={() => {
            void onSave(Array.from(cells).sort());
            setDirty(false);
          }}
          className="px-2 py-1 bg-blue-500 text-white text-sm rounded disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <svg width={W + 40} height={H + 30}>
        <g transform="translate(40,0)">
          {Array.from({ length: SAIL_GRID_TWA_BINS }, (_, twaIdx) =>
            Array.from({ length: SAIL_GRID_TWS_BINS }, (_, twsIdx) => {
              const key = cellKey({ twsIdx, twaIdx });
              const on = cells.has(key);
              return (
                <rect
                  key={key}
                  x={twsIdx * CELL_W}
                  y={twaIdx * CELL_H}
                  width={CELL_W}
                  height={CELL_H}
                  fill={on ? color : 'white'}
                  fillOpacity={on ? 0.55 : 1}
                  stroke="#ddd"
                  onClick={() => toggle(twsIdx, twaIdx)}
                />
              );
            }),
          )}
          {[0, 30, 60, 90, 120, 150, 180].map((deg) => {
            const y = (deg / SAIL_GRID_TWA_STEP_DEG) * CELL_H;
            return (
              <text key={`ly-${deg}`} x={-30} y={y + 4} fontSize={10}>
                {deg}°
              </text>
            );
          })}
          {[0, 10, 20, 30, 40].map((kn) => (
            <text key={`lx-${kn}`} x={kn * CELL_W} y={H + 14} fontSize={10}>
              {kn}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
```

- [ ] **Step 3: Delete the old chart components**

```bash
git rm packages/web/src/app/sails/CrossoverChart.tsx \
       packages/web/src/app/sails/ForecastTimeline.tsx
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/sails/SailOverlayChart.tsx packages/web/src/app/sails/SailRegionEditor.tsx
git commit -m "feat(web): SailOverlayChart (view) + SailRegionEditor (edit)"
```

---

## Task 20: Rewrite `/sails/crossover` page wiring

**Files:**
- Modify: `packages/web/src/app/sails/crossover/page.tsx`

- [ ] **Step 1: Overwrite the file**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Sail, SailCategory, SailWardrobe } from '@g5000/db';
import { CategoryRecommendation } from '../CategoryRecommendation';
import { SailOverlayChart } from '../SailOverlayChart';
import { SailRegionEditor } from '../SailRegionEditor';

type Mode = 'view' | 'edit';

export default function CrossoverPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [filter, setFilter] = useState<SailCategory | 'all'>('all');
  const [editSailId, setEditSailId] = useState<string | null>(null);

  async function reload() {
    setWardrobe(await (await fetch('/api/sails')).json());
  }

  useEffect(() => {
    void reload();
  }, []);

  if (!wardrobe) return <div className="p-4">Loading…</div>;

  const editSail: Sail | undefined =
    editSailId ? wardrobe.sails.find((s) => s.id === editSailId) : undefined;

  async function saveRegion(sailId: string, cells: string[]) {
    const res = await fetch(`/api/sails/${sailId}/region`, {
      method: 'POST',
      body: JSON.stringify({ cells }),
    });
    if (!res.ok) {
      const body = await res.json();
      alert(`Save failed: ${body.error ?? res.statusText}`);
      return;
    }
    await reload();
  }

  return (
    <div className="grid grid-cols-[260px_1fr_220px] gap-4 p-4">
      <aside>
        <CategoryRecommendation wardrobe={wardrobe} />
      </aside>
      <main>
        <div className="flex gap-2 mb-2 text-sm">
          <button
            onClick={() => setMode('view')}
            className={mode === 'view' ? 'underline font-medium' : ''}
          >
            View all
          </button>
          <button
            onClick={() => setMode('edit')}
            className={mode === 'edit' ? 'underline font-medium' : ''}
          >
            Edit one
          </button>
          {mode === 'view' && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as SailCategory | 'all')}
              className="border ml-4"
            >
              <option value="all">All categories</option>
              <option value="headsail">Headsails only</option>
              <option value="main">Main only</option>
              <option value="downwind">Downwind only</option>
            </select>
          )}
        </div>
        {mode === 'view' && <SailOverlayChart wardrobe={wardrobe} filterCategory={filter} />}
        {mode === 'edit' && editSail && (
          <SailRegionEditor sail={editSail} onSave={(cells) => saveRegion(editSail.id, cells)} />
        )}
        {mode === 'edit' && !editSail && (
          <div className="text-sm text-gray-500">Pick a sail to edit →</div>
        )}
      </main>
      <aside>
        <h3 className="text-sm font-medium">Sails</h3>
        {(['headsail', 'main', 'downwind'] as SailCategory[]).map((cat) => (
          <div key={cat} className="mt-2">
            <div className="text-xs text-gray-500">{cat}</div>
            {wardrobe.sails
              .filter((s) => s.category === cat)
              .map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setMode('edit');
                    setEditSailId(s.id);
                  }}
                  className={`block w-full text-left px-1 ${
                    s.id === editSailId ? 'bg-blue-100' : ''
                  }`}
                >
                  {s.name}{' '}
                  <span className="text-xs text-gray-400">({s.region.cells.length})</span>
                </button>
              ))}
          </div>
        ))}
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the web package**

```bash
npm run build --workspace @g5000/web 2>&1 | tail -20
```

Expected: clean build. If any errors, fix them.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sails/crossover/page.tsx
git commit -m "feat(web): /sails/crossover atomic-sails layout (view + edit)"
```

---

## Task 21: Full test sweep and typecheck

**Files:** none

- [ ] **Step 1: Run the full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: PASS. Compare the test-file count to the baseline from Task 1 — the delta should reflect: removed crossover/sail-timeline tests, added v3/region tests. No regressions in unrelated packages.

- [ ] **Step 2: Run typecheck across the workspace**

```bash
npm run typecheck 2>&1 | tail -30
```

Expected: clean (modulo the known `TS5083 apps/router` stale ref documented in CLAUDE.md — that's pre-existing).

- [ ] **Step 3: Run prettier check**

```bash
npm run lint
```

Expected: clean. If formatting drift, run `npm run format` and re-commit.

- [ ] **Step 4: Commit any final cleanups**

```bash
git status
# If any unstaged formatting changes:
git add -A
git commit -m "chore: prettier"
```

---

## Task 22: Manual browser smoke

**Files:** none

- [ ] **Step 1: Start the dev server**

```bash
npm run dev --workspace @g5000/autopilot-server
```

Wait for `ready on http://localhost:3000`.

- [ ] **Step 2: Open `/sails` and verify**

In a browser, open `http://localhost:3000/sails`.

Confirm:
- Three section headings (Headsails, Main / Reef, Downwind)
- If the v2 → v3 migration found existing configs, atomic sails should be listed under each category
- Add a new sail in one category — it persists across reload
- Click an "active" radio — page refreshes with the dot moved

- [ ] **Step 3: Open `/sails/crossover` and verify**

Navigate to `http://localhost:3000/sails/crossover`.

Confirm:
- Left rail: 3 recommendation cards (Headsail / Main / Downwind), all showing "waiting for wind…" or live values in demo mode
- Center: SVG grid with axis labels (0–40 kn × 0–180°)
- Right rail: list of sails grouped by category
- Click a sail → enters edit mode, region highlighted, can paint cells
- "Save" round-trips through `/api/sails/[sailId]/region` (DevTools network tab)

- [ ] **Step 4: Run in demo mode and verify the recommendation panel updates**

```bash
DEMO_MODE=1 npm run dev --workspace @g5000/autopilot-server
```

Open `/sails/crossover`. In demo the wind injector cycles through samples; the recommendation panel should update.

- [ ] **Step 5: Stop the server**

```bash
kill $(lsof -t -i:3000) || true
```

- [ ] **Step 6: Commit any final cleanups (likely none)**

If no changes, skip. Otherwise:

```bash
git status
git add -A
git commit -m "chore: post-smoke fixes"
```

---

## Task 23: PR back to develop

**Files:** none

- [ ] **Step 1: Push branch**

```bash
git push -u origin sail-atomic
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base develop --title "Sail crossover refactor — atomic sails (Model B)" --body "$(cat <<'EOF'
## Summary
- Replaces Model A's `SailConfig` + single-winner `CrossoverMap` with atomic `Sail`s, each carrying its own region on a fixed 1 kn × 5° (TWS, TWA) grid.
- New pipeline emits per-category `valid[]` + `changeNeeded` on `sail.recommendation`.
- Categories: headsail / main / downwind. Three exclusive picks compose a sail plan.
- Best-effort migration from v2 wardrobe + crossover_map.

## Test plan
- [x] `npm test` — all packages pass
- [x] `npm run typecheck` — clean
- [x] Manual browser pass on `/sails` and `/sails/crossover`
- [ ] Promote develop → main and verify Pi smoke after deploy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report PR URL**

Capture the URL printed by `gh pr create` and surface it to the user. STOP here — promote-to-main is a manual decision.

---

## Self-review summary

**Spec coverage:** each spec section has a task — domain model (Tasks 4, 6), grid (Task 2), pipeline (Tasks 8–9), API (Tasks 11–15), UI (Tasks 17–20), routing cleanup (Task 10), tests (every TDD step), migration (Task 6).

**Risk flags for the executor:**
- Task 7 touches `ConfigStore` deeply — if the existing `open()` method differs structurally from the snippet, adapt the snippet to fit the actual control flow rather than copying verbatim.
- Task 9's `wardrobeAndSettings()` helper assumes `sails$` / `settings$` are `BehaviorSubject`-like. The tests pass them as `BehaviorSubject` instances. The real `ConfigStore.sails$` is backed by a `BehaviorSubject`, so production behavior matches.
- The Pi migration runs on first boot after `main` is updated. If `crossover_map` table no longer exists at that point, the `try/catch` in Task 7 step 2 returns `legacyMap = null` (intended).
- Demo-mode publishes calibrated wind but NOT through `wind.true.speed`/`wind.true.angle` directly in all cases — verify in Task 22 step 4 that the recommendation panel actually animates.
