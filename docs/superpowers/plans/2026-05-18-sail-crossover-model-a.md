# Sail Crossover Model A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sail-crossover feature (chart + recommendation tile + sail timeline + routing integration) on top of v2 polar revisions, using a separate `CrossoverMap` artifact for `(TWS, TWA) → configId` lookup. Single boat polar; no per-config polars.

**Architecture:** Two new ConfigStore rows (`crossover_map`, `crossover_settings`), a pure-function lookup over the active polar's grid, an RxJS pipeline publishing `sail.recommendation`, and a routing-layer decoration that labels each leg with the recommended `configId`. The existing v2 polar revisions are unchanged. The `issue-3-sail-crossover` branch is harvested for UI shells and the sail-timeline absorption helper.

**Tech Stack:** TypeScript ESM, Drizzle ORM + better-sqlite3, RxJS, Next.js 16 App Router, vitest. ULID for revision IDs (only if revisions are added later — out of scope for v1).

**Spec:** `docs/superpowers/specs/2026-05-18-sail-crossover-model-a.md`

**Reference branch (salvage-only):** `issue-3-sail-crossover` at `5b28e2f`. Worktree at `.worktrees/issue-3-sail-crossover/`. Files marked "salvage" are copied across with adjustments; the branch itself is **not** merged.

---

## Task 1: Types and defaults for CrossoverMap and CrossoverSettings

**Files:**
- Modify: `packages/db/src/defaults.ts`
- Test: `packages/db/src/crossover-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/crossover-defaults.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CROSSOVER_MAP,
  DEFAULT_CROSSOVER_SETTINGS,
  type CrossoverMap,
  type CrossoverSettings,
} from './defaults.js';

describe('CrossoverMap defaults', () => {
  it('starts empty and scoped to sula/default', () => {
    expect(DEFAULT_CROSSOVER_MAP.boatId).toBe('sula');
    expect(DEFAULT_CROSSOVER_MAP.mode).toBe('default');
    expect(DEFAULT_CROSSOVER_MAP.cells).toEqual({});
    expect(DEFAULT_CROSSOVER_MAP.updatedAt).toBe(0);
  });

  it('cells are keyed by "twsIdx,twaIdx" strings', () => {
    const m: CrossoverMap = {
      boatId: 'sula',
      mode: 'default',
      cells: { '0,5': 'full-j1', '3,2': 'reef1-j2' },
      updatedAt: 1700000000,
    };
    expect(Object.keys(m.cells)).toHaveLength(2);
  });
});

describe('CrossoverSettings defaults', () => {
  it('uses time-based hysteresis, not speed-based', () => {
    const s: CrossoverSettings = DEFAULT_CROSSOVER_SETTINGS;
    expect(s.recommendationStableSeconds).toBe(30);
    // verify no speed-margin field exists
    expect((s as unknown as { hysteresisPercent?: number }).hysteresisPercent).toBeUndefined();
  });

  it('chart bounds are sensible knots/degrees', () => {
    const s = DEFAULT_CROSSOVER_SETTINGS;
    expect(s.chartTwsMaxKn).toBe(30);
    expect(s.chartTwaMinDeg).toBe(30);
    expect(s.chartTwaMaxDeg).toBe(180);
    expect(s.forecastIntervalMinutes).toBe(30);
    expect(s.forecastDurationHours).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/src/crossover-defaults.test.ts`
Expected: FAIL — `CrossoverMap`, `CrossoverSettings`, `DEFAULT_CROSSOVER_MAP`, `DEFAULT_CROSSOVER_SETTINGS` not exported from `./defaults.js`.

- [ ] **Step 3: Add types and defaults to packages/db/src/defaults.ts**

Append to `packages/db/src/defaults.ts` (after `DEFAULT_AIS_ALARM_CONFIG`, before `PassageLog`):

```typescript
/**
 * Which sail configuration is recommended at each (TWS, TWA) cell of the
 * polar grid. One row per (boatId, mode). Cells absent from the map are
 * "no recommendation" — consumers render the chart cell uncoloured and
 * the recommendation tile shows neutral.
 *
 * Cell keys are `${twsIdx},${twaIdx}` (zero-indexed into the active polar
 * for the same (boatId, mode)). When the polar is re-binned with a
 * different `twsBins`/`twaBins` length, the migrator clears the map (see
 * ConfigStore.setActiveRevision).
 */
export interface CrossoverMap {
  boatId: BoatId;
  mode: PolarMode;
  cells: Record<string, string>;
  /** UNIX seconds; updated on every write. */
  updatedAt: number;
}

export const DEFAULT_CROSSOVER_MAP: CrossoverMap = {
  boatId: 'sula',
  mode: 'default',
  cells: {},
  updatedAt: 0,
};

/**
 * Per-boat settings for the sail-crossover feature. Mode-agnostic for now.
 * Hysteresis is time-based (cell must be stable for N seconds) because
 * Model A uses a single polar across all configs — there is no speed-delta
 * to compare like the prior per-config-polar design.
 */
export interface CrossoverSettings {
  recommendationStableSeconds: number;
  chartTwsMaxKn: number;
  chartTwaMinDeg: number;
  chartTwaMaxDeg: number;
  forecastIntervalMinutes: number;
  forecastDurationHours: number;
}

export const DEFAULT_CROSSOVER_SETTINGS: CrossoverSettings = {
  recommendationStableSeconds: 30,
  chartTwsMaxKn: 30,
  chartTwaMinDeg: 30,
  chartTwaMaxDeg: 180,
  forecastIntervalMinutes: 30,
  forecastDurationHours: 12,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/db/src/crossover-defaults.test.ts`
Expected: PASS (2 suites, 5 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/defaults.ts packages/db/src/crossover-defaults.test.ts
git commit -m "feat(db): CrossoverMap + CrossoverSettings types and defaults"
```

---

## Task 2: Drizzle schema rows for crossover_map and crossover_settings

**Files:**
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/src/schema-crossover.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema-crossover.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { crossoverMap as crossoverMapTable, crossoverSettings as crossoverSettingsTable } from './schema.js';

describe('schema: crossover tables', () => {
  it('crossover_map is keyed by (boatId, mode) with a JSON value', () => {
    const raw = new Database(':memory:');
    const db = drizzle(raw);
    // Mirror the migration we add inline so the test is self-contained
    raw.exec(`
      CREATE TABLE crossover_map (
        boat_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (boat_id, mode)
      );
      CREATE TABLE crossover_settings (
        boat_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.insert(crossoverMapTable)
      .values({ boatId: 'sula', mode: 'default', value: JSON.stringify({ cells: {} }) })
      .run();
    db.insert(crossoverSettingsTable)
      .values({ boatId: 'sula', value: JSON.stringify({ recommendationStableSeconds: 30 }) })
      .run();
    const m = raw.prepare('SELECT * FROM crossover_map').all() as Array<{
      boat_id: string;
      mode: string;
      value: string;
    }>;
    expect(m).toHaveLength(1);
    expect(m[0]?.boat_id).toBe('sula');
    expect(m[0]?.mode).toBe('default');
    const s = raw.prepare('SELECT * FROM crossover_settings').all() as Array<{
      boat_id: string;
      value: string;
    }>;
    expect(s).toHaveLength(1);
    expect(s[0]?.boat_id).toBe('sula');
    raw.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/src/schema-crossover.test.ts`
Expected: FAIL — `crossoverMap` and `crossoverSettings` not exported from `./schema.js`.

- [ ] **Step 3: Add Drizzle tables to packages/db/src/schema.ts**

Append to `packages/db/src/schema.ts`:

```typescript
export const crossoverMap = sqliteTable(
  'crossover_map',
  {
    boatId: text('boat_id').notNull(),
    mode: text('mode').notNull(),
    value: text('value').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.boatId, t.mode] }),
  }),
);

export const crossoverSettings = sqliteTable('crossover_settings', {
  boatId: text('boat_id').primaryKey(),
  value: text('value').notNull(),
});
```

If `primaryKey` isn't already imported in this file, add it to the existing `drizzle-orm/sqlite-core` import.

- [ ] **Step 4: Wire up DDL in ConfigStore.open**

In `packages/db/src/config-store.ts`, find the `raw.exec(\`CREATE TABLE IF NOT EXISTS …\`)` block in `ConfigStore.open`. Append two more `CREATE TABLE IF NOT EXISTS` statements:

```sql
CREATE TABLE IF NOT EXISTS crossover_map (
  boat_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (boat_id, mode)
);
CREATE TABLE IF NOT EXISTS crossover_settings (
  boat_id TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/db/src/schema-crossover.test.ts`
Expected: PASS.

Also run: `npx vitest run packages/db/`
Expected: ALL pre-existing db tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema-crossover.test.ts packages/db/src/config-store.ts
git commit -m "feat(db): crossover_map and crossover_settings tables + DDL"
```

---

## Task 3: ConfigStore.crossoverMap$ / setCrossoverMap

**Files:**
- Modify: `packages/db/src/config-store.ts`
- Test: `packages/db/src/config-store-crossover.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/config-store-crossover.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { ConfigStore } from './config-store.js';
import { DEFAULT_CROSSOVER_MAP } from './defaults.js';

const stores: ConfigStore[] = [];

afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});

async function freshStore(): Promise<ConfigStore> {
  const s = await ConfigStore.open(':memory:');
  stores.push(s);
  return s;
}

describe('ConfigStore — crossover map', () => {
  it('returns DEFAULT_CROSSOVER_MAP on a fresh store (active mode)', async () => {
    const store = await freshStore();
    const m = await firstValueFrom(store.crossoverMap$);
    expect(m.boatId).toBe(store.activeBoatId);
    expect(m.mode).toBe('default');
    expect(m.cells).toEqual({});
  });

  it('round-trips a written map', async () => {
    const store = await freshStore();
    await store.setCrossoverMap({
      boatId: store.activeBoatId,
      mode: 'default',
      cells: { '2,5': 'full-j1', '3,5': 'reef1-j2' },
      updatedAt: 1700000000,
    });
    const m = await firstValueFrom(store.crossoverMap$);
    expect(m.cells['2,5']).toBe('full-j1');
    expect(m.cells['3,5']).toBe('reef1-j2');
  });

  it('rejects a write whose mode mismatches active mode', async () => {
    const store = await freshStore();
    await expect(
      store.setCrossoverMap({
        boatId: store.activeBoatId,
        mode: 'planing',
        cells: {},
        updatedAt: 0,
      }),
    ).rejects.toThrow(/mode/);
  });

  it('rejects a write whose boatId mismatches active boat', async () => {
    const store = await freshStore();
    await expect(
      store.setCrossoverMap({
        boatId: 'someoneelse',
        mode: 'default',
        cells: {},
        updatedAt: 0,
      }),
    ).rejects.toThrow(/boat/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/src/config-store-crossover.test.ts`
Expected: FAIL — `store.crossoverMap$` and `store.setCrossoverMap` don't exist.

- [ ] **Step 3: Implement crossoverMap$ and setCrossoverMap on ConfigStore**

In `packages/db/src/config-store.ts`:

(a) Add to imports from `./defaults.js`:
```typescript
import {
  // … existing …
  DEFAULT_CROSSOVER_MAP,
  type CrossoverMap,
} from './defaults.js';
```

(b) Add to imports from `./schema.js`:
```typescript
import {
  // … existing …
  crossoverMap as crossoverMapTable,
} from './schema.js';
```

(c) Add to the `subjects` shape (private):
```typescript
crossoverMap: BehaviorSubject<CrossoverMap>;
```

(d) In `ConfigStore.open`, load the active (boatId, mode) row before constructing `initial` (place this after the wardrobe load so we have `wardrobeValue.activeMode` available):

```typescript
const xmRows = db
  .select()
  .from(crossoverMapTable)
  .where(eq(crossoverMapTable.boatId, activeBoatId))
  .all() as Array<{ boat_id: string; mode: string; value: string }>;
const xmForMode = xmRows.find((r) => r.mode === wardrobeValue.activeMode);
const crossoverMapValue: CrossoverMap = xmForMode
  ? { ...DEFAULT_CROSSOVER_MAP, ...(JSON.parse(xmForMode.value) as Partial<CrossoverMap>), boatId: activeBoatId, mode: wardrobeValue.activeMode }
  : { ...DEFAULT_CROSSOVER_MAP, boatId: activeBoatId, mode: wardrobeValue.activeMode };
```

Add `crossoverMap: crossoverMapValue` to `initial`.

(e) In the constructor body (alongside other `new BehaviorSubject(...)` lines):

```typescript
crossoverMap: new BehaviorSubject(initial.crossoverMap),
```

(f) Add the getter:

```typescript
get crossoverMap$(): Observable<CrossoverMap> {
  return this.subjects.crossoverMap.asObservable();
}
```

(g) Add the setter:

```typescript
async setCrossoverMap(value: CrossoverMap): Promise<void> {
  if (value.boatId !== this.__activeBoatId) {
    throw new Error(`setCrossoverMap: boatId ${value.boatId} != active ${this.__activeBoatId}`);
  }
  const activeMode = this.subjects.sails.value.activeMode;
  if (value.mode !== activeMode) {
    throw new Error(`setCrossoverMap: mode ${value.mode} != active ${activeMode}`);
  }
  const stored = { ...value, updatedAt: Math.floor(Date.now() / 1000) };
  this.raw
    .prepare(
      'INSERT INTO crossover_map (boat_id, mode, value) VALUES (?, ?, ?) ON CONFLICT (boat_id, mode) DO UPDATE SET value = excluded.value',
    )
    .run(stored.boatId, stored.mode, JSON.stringify(stored));
  this.subjects.crossoverMap.next(stored);
}
```

(Use `this.raw` — `ConfigStore` already has `raw: Database` set in the constructor; if not, route through the existing `upsert` helper instead.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/db/src/config-store-crossover.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full db test suite**

Run: `npx vitest run packages/db/`
Expected: All pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/config-store.ts packages/db/src/config-store-crossover.test.ts
git commit -m "feat(db): ConfigStore.crossoverMap\$ + setCrossoverMap"
```

---

## Task 4: ConfigStore.crossoverSettings$ / setCrossoverSettings

**Files:**
- Modify: `packages/db/src/config-store.ts`
- Test: `packages/db/src/config-store-crossover-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/config-store-crossover-settings.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { ConfigStore } from './config-store.js';
import { DEFAULT_CROSSOVER_SETTINGS } from './defaults.js';

const stores: ConfigStore[] = [];
afterEach(async () => { for (const s of stores.splice(0)) await s.close(); });

async function freshStore() {
  const s = await ConfigStore.open(':memory:');
  stores.push(s);
  return s;
}

describe('ConfigStore — crossover settings', () => {
  it('returns DEFAULT_CROSSOVER_SETTINGS on a fresh store', async () => {
    const store = await freshStore();
    const s = await firstValueFrom(store.crossoverSettings$);
    expect(s).toEqual(DEFAULT_CROSSOVER_SETTINGS);
  });

  it('round-trips a written settings object', async () => {
    const store = await freshStore();
    await store.setCrossoverSettings({
      ...DEFAULT_CROSSOVER_SETTINGS,
      recommendationStableSeconds: 60,
      chartTwsMaxKn: 25,
    });
    const s = await firstValueFrom(store.crossoverSettings$);
    expect(s.recommendationStableSeconds).toBe(60);
    expect(s.chartTwsMaxKn).toBe(25);
    expect(s.chartTwaMaxDeg).toBe(DEFAULT_CROSSOVER_SETTINGS.chartTwaMaxDeg);
  });

  it('partial writes merge with defaults', async () => {
    const store = await freshStore();
    await store.setCrossoverSettings({
      ...DEFAULT_CROSSOVER_SETTINGS,
      forecastDurationHours: 24,
    });
    const s = await firstValueFrom(store.crossoverSettings$);
    expect(s.forecastDurationHours).toBe(24);
    expect(s.forecastIntervalMinutes).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/src/config-store-crossover-settings.test.ts`
Expected: FAIL — `crossoverSettings$` and `setCrossoverSettings` don't exist.

- [ ] **Step 3: Implement on ConfigStore**

In `packages/db/src/config-store.ts`:

(a) Add to defaults import:
```typescript
import {
  // … existing …
  DEFAULT_CROSSOVER_SETTINGS,
  type CrossoverSettings,
} from './defaults.js';
```

(b) Add to schema import:
```typescript
crossoverSettings as crossoverSettingsTable,
```

(c) Load at `open()` time (after the crossover-map load):

```typescript
const xsRow = db
  .select()
  .from(crossoverSettingsTable)
  .where(eq(crossoverSettingsTable.boatId, activeBoatId))
  .all() as Array<{ boat_id: string; value: string }>;
const crossoverSettingsValue: CrossoverSettings = xsRow[0]
  ? { ...DEFAULT_CROSSOVER_SETTINGS, ...(JSON.parse(xsRow[0].value) as Partial<CrossoverSettings>) }
  : DEFAULT_CROSSOVER_SETTINGS;
```

Add `crossoverSettings: crossoverSettingsValue` to `initial`.

(d) Subject:
```typescript
crossoverSettings: new BehaviorSubject(initial.crossoverSettings),
```

(e) Getter:
```typescript
get crossoverSettings$(): Observable<CrossoverSettings> {
  return this.subjects.crossoverSettings.asObservable();
}
```

(f) Setter:
```typescript
async setCrossoverSettings(value: CrossoverSettings): Promise<void> {
  this.raw
    .prepare(
      'INSERT INTO crossover_settings (boat_id, value) VALUES (?, ?) ON CONFLICT (boat_id) DO UPDATE SET value = excluded.value',
    )
    .run(this.__activeBoatId, JSON.stringify(value));
  this.subjects.crossoverSettings.next(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/db/src/config-store-crossover-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full db test suite**

Run: `npx vitest run packages/db/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/config-store.ts packages/db/src/config-store-crossover-settings.test.ts
git commit -m "feat(db): ConfigStore.crossoverSettings\$ + setCrossoverSettings"
```

---

## Task 5: Channels.SAIL_RECOMMENDATION constant

**Files:**
- Modify: `packages/core/src/channels.ts`
- Test: existing channel pattern tests (no new test file)

- [ ] **Step 1: Add the constant**

In `packages/core/src/channels.ts`, add an entry to the `Channels` const object:

```typescript
SAIL_RECOMMENDATION: 'sail.recommendation',
```

If the file groups channels by domain with comments, place this in the appropriate group (alongside any other `sail.*` or `wardrobe.*` entries; create the group if none exists).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean (modulo apps/router stale ref documented in CLAUDE.md).

- [ ] **Step 3: Run channel tests**

Run: `npx vitest run packages/core/`
Expected: all pre-existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/channels.ts
git commit -m "feat(core): add Channels.SAIL_RECOMMENDATION"
```

---

## Task 6: Pure-function crossover cell lookup

**Files:**
- Create: `packages/compute/src/sail-crossover/lookup.ts`
- Create: `packages/compute/src/sail-crossover/index.ts`
- Test: `packages/compute/src/sail-crossover/lookup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/sail-crossover/lookup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { PolarTable, CrossoverMap } from '@g5000/db';
import { snapToCell, lookupConfigId } from './lookup.js';

const PI = Math.PI;

const polar: PolarTable = {
  twsBins: [3.09, 4.12, 5.14, 6.17, 7.20, 8.23, 10.29, 12.86], // 6,8,10,12,14,16,20,25 kn → m/s
  twaBins: [0, PI / 6, PI / 4, PI / 3, PI / 2, (2 * PI) / 3, (3 * PI) / 4, (5 * PI) / 6, PI],
  boatSpeed: Array.from({ length: 8 }, () => Array.from({ length: 9 }, () => 0)),
};

const map: CrossoverMap = {
  boatId: 'sula',
  mode: 'default',
  cells: {
    '0,3': 'a-sail',
    '4,5': 'b-sail',
    '7,8': 'c-sail',
  },
  updatedAt: 0,
};

describe('snapToCell', () => {
  it('snaps an exact bin centre to that cell', () => {
    expect(snapToCell(polar, 7.20, PI / 2)).toEqual({ twsIdx: 4, twaIdx: 4 });
  });

  it('snaps nearest by absolute distance', () => {
    // TWS halfway between bin 0 (6 kn) and bin 1 (8 kn) — 7 kn → bin closer is bin 0
    expect(snapToCell(polar, 6.5 * 0.514444, 0)).toMatchObject({ twsIdx: 0 });
  });

  it('clamps below the min TWS bin to 0', () => {
    expect(snapToCell(polar, 1.0, 0)).toMatchObject({ twsIdx: 0 });
  });

  it('clamps above the max TWS bin to last', () => {
    expect(snapToCell(polar, 50.0, 0)).toMatchObject({ twsIdx: 7 });
  });

  it('folds negative TWA into [0, π]', () => {
    expect(snapToCell(polar, 7.20, -PI / 4)).toEqual(snapToCell(polar, 7.20, PI / 4));
  });

  it('folds TWA > π by wrapping (port/starboard symmetric)', () => {
    // (3π/2) folds to (π/2)
    expect(snapToCell(polar, 7.20, (3 * PI) / 2)).toEqual(snapToCell(polar, 7.20, PI / 2));
  });
});

describe('lookupConfigId', () => {
  it('returns the configId at a filled cell', () => {
    expect(lookupConfigId(map, polar, polar.twsBins[4]!, polar.twaBins[5]!)).toBe('b-sail');
  });

  it('returns null at an empty cell', () => {
    expect(lookupConfigId(map, polar, polar.twsBins[1]!, polar.twaBins[1]!)).toBeNull();
  });

  it('handles symmetric TWA when looking up', () => {
    expect(lookupConfigId(map, polar, polar.twsBins[4]!, -polar.twaBins[5]!)).toBe('b-sail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/sail-crossover/`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lookup.ts**

Create `packages/compute/src/sail-crossover/lookup.ts`:

```typescript
import type { CrossoverMap, PolarTable } from '@g5000/db';

const TAU = Math.PI * 2;

function foldTwa(twa: number): number {
  // Map any real TWA to [0, π] using port/starboard symmetry.
  let t = ((twa % TAU) + TAU) % TAU;
  if (t > Math.PI) t = TAU - t;
  return t;
}

function nearestBinIdx(bins: number[], value: number): number {
  if (bins.length === 0) return 0;
  if (value <= bins[0]!) return 0;
  if (value >= bins[bins.length - 1]!) return bins.length - 1;
  let best = 0;
  let bestErr = Math.abs(value - bins[0]!);
  for (let i = 1; i < bins.length; i++) {
    const e = Math.abs(value - bins[i]!);
    if (e < bestErr) {
      best = i;
      bestErr = e;
    }
  }
  return best;
}

export interface Cell {
  twsIdx: number;
  twaIdx: number;
}

export function snapToCell(polar: PolarTable, twsMs: number, twaRad: number): Cell {
  return {
    twsIdx: nearestBinIdx(polar.twsBins, twsMs),
    twaIdx: nearestBinIdx(polar.twaBins, foldTwa(twaRad)),
  };
}

export function lookupConfigId(
  map: CrossoverMap,
  polar: PolarTable,
  twsMs: number,
  twaRad: number,
): string | null {
  const { twsIdx, twaIdx } = snapToCell(polar, twsMs, twaRad);
  return map.cells[`${twsIdx},${twaIdx}`] ?? null;
}
```

Create `packages/compute/src/sail-crossover/index.ts`:

```typescript
export { snapToCell, lookupConfigId, type Cell } from './lookup.js';
```

Also re-export from `packages/compute/src/index.ts`:

```typescript
export * from './sail-crossover/index.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/sail-crossover/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/sail-crossover/ packages/compute/src/index.ts
git commit -m "feat(compute): pure crossover cell snap + lookup"
```

---

## Task 7: Sail-crossover RxJS pipeline

**Design note:** Hysteresis ("should I switch?" maturation timer) is **consumer-side**, not pipeline-side. The pipeline tracks only when we first observed the current recommended config (`enteredAt`) and emits `stableSeconds` alongside; the UI (helm tile + recommendation panel) computes `shouldChange = recommended && recommended !== active && (Date.now()/1000 - enteredAt) >= stableSeconds` on each render. This avoids a class of RxJS bugs where a stable wind doesn't re-fire the pipeline so the maturation never gets re-evaluated.

**Files:**
- Create: `packages/compute/src/sail-crossover/pipeline.ts`
- Test: `packages/compute/src/sail-crossover/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/sail-crossover/pipeline.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import type { CrossoverMap, CrossoverSettings, PolarTable, SailWardrobe } from '@g5000/db';
import type { Sample } from '@g5000/core';
import { Bus, Channels } from '@g5000/core';
import { DEFAULT_CROSSOVER_MAP, DEFAULT_CROSSOVER_SETTINGS, DEFAULT_POLARS } from '@g5000/db';
import { startSailCrossoverPipeline, type SailRecommendation } from './pipeline.js';

interface FakeStore {
  activePolar$: BehaviorSubject<PolarTable>;
  sails$: BehaviorSubject<SailWardrobe>;
  crossoverMap$: BehaviorSubject<CrossoverMap>;
  crossoverSettings$: BehaviorSubject<CrossoverSettings>;
}

function wardrobe(activeConfigId: string, configs: string[] = ['a', 'b', 'c']): SailWardrobe {
  return {
    boatId: 'sula',
    activeConfigId,
    activeMode: 'default',
    configs: configs.map((id) => ({ id, name: id, modes: {} })),
  };
}

function fakeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  return {
    activePolar$: new BehaviorSubject(DEFAULT_POLARS),
    sails$: new BehaviorSubject(wardrobe('a')),
    crossoverMap$: new BehaviorSubject(DEFAULT_CROSSOVER_MAP),
    crossoverSettings$: new BehaviorSubject(DEFAULT_CROSSOVER_SETTINGS),
    ...overrides,
  };
}

function makeSample(channel: string, value: number, tMs: number): Sample {
  return { channel, source: 'test', t: tMs, value };
}

describe('startSailCrossoverPipeline', () => {
  it('does not publish when there is no wind sample', () => {
    const bus = new Bus();
    const store = fakeStore();
    const stop = startSailCrossoverPipeline({ bus, store } as never);
    const received: Sample[] = [];
    const unsub = bus.subscribe(Channels.SAIL_RECOMMENDATION, (s) => received.push(s));
    expect(received).toHaveLength(0);
    stop();
    unsub();
  });

  it('publishes recommendation at the current (TWS, TWA) cell when the map is filled', () => {
    const bus = new Bus();
    const store = fakeStore({
      crossoverMap$: new BehaviorSubject<CrossoverMap>({
        boatId: 'sula',
        mode: 'default',
        cells: { '4,4': 'b' }, // TWS bin 4 ≈ 14 kn, TWA bin 4 = 90°
        updatedAt: 0,
      }),
    });
    const stop = startSailCrossoverPipeline({ bus, store } as never);
    const received: SailRecommendation[] = [];
    const unsub = bus.subscribe(Channels.SAIL_RECOMMENDATION, (s) =>
      received.push(s.value as SailRecommendation),
    );

    const tws = DEFAULT_POLARS.twsBins[4]!;
    const twa = DEFAULT_POLARS.twaBins[4]!;
    bus.publish(makeSample('wind.true.speed', tws, 1_000_000));
    bus.publish(makeSample('wind.true.angle', twa, 1_000_000));

    expect(received.length).toBeGreaterThan(0);
    const last = received[received.length - 1]!;
    expect(last.recommendedConfigId).toBe('b');
    expect(last.activeConfigId).toBe('a');
    expect(last.cellTwsIdx).toBe(4);
    expect(last.cellTwaIdx).toBe(4);
    expect(last.stableSeconds).toBe(DEFAULT_CROSSOVER_SETTINGS.recommendationStableSeconds);
    expect(last.enteredAt).toBeGreaterThan(0);

    stop();
    unsub();
  });

  it('keeps enteredAt stable while the recommendation stays the same', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const bus = new Bus();
    const store = fakeStore({
      crossoverMap$: new BehaviorSubject<CrossoverMap>({
        boatId: 'sula',
        mode: 'default',
        cells: { '4,4': 'b', '5,4': 'b' }, // both nearby cells recommend 'b'
        updatedAt: 0,
      }),
    });
    const stop = startSailCrossoverPipeline({ bus, store } as never);
    const received: SailRecommendation[] = [];
    const unsub = bus.subscribe(Channels.SAIL_RECOMMENDATION, (s) =>
      received.push(s.value as SailRecommendation),
    );

    bus.publish(makeSample('wind.true.speed', DEFAULT_POLARS.twsBins[4]!, 1_700_000_000_000));
    bus.publish(makeSample('wind.true.angle', DEFAULT_POLARS.twaBins[4]!, 1_700_000_000_000));
    const firstEntered = received[received.length - 1]!.enteredAt;

    vi.setSystemTime(1_700_000_000_000 + 60_000);
    // Bump wind so the pipeline re-emits, but still maps to a cell where 'b' wins.
    bus.publish(
      makeSample('wind.true.speed', DEFAULT_POLARS.twsBins[5]!, 1_700_000_000_000 + 60_000),
    );
    const lastEntered = received[received.length - 1]!.enteredAt;
    expect(lastEntered).toBe(firstEntered);

    stop();
    unsub();
    vi.useRealTimers();
  });

  it('resets enteredAt when the recommended config changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const bus = new Bus();
    const store = fakeStore({
      crossoverMap$: new BehaviorSubject<CrossoverMap>({
        boatId: 'sula',
        mode: 'default',
        cells: { '4,4': 'b', '6,4': 'c' },
        updatedAt: 0,
      }),
    });
    const stop = startSailCrossoverPipeline({ bus, store } as never);
    const received: SailRecommendation[] = [];
    const unsub = bus.subscribe(Channels.SAIL_RECOMMENDATION, (s) =>
      received.push(s.value as SailRecommendation),
    );

    bus.publish(makeSample('wind.true.speed', DEFAULT_POLARS.twsBins[4]!, 1_700_000_000_000));
    bus.publish(makeSample('wind.true.angle', DEFAULT_POLARS.twaBins[4]!, 1_700_000_000_000));
    const firstEntered = received[received.length - 1]!.enteredAt;
    expect(received[received.length - 1]!.recommendedConfigId).toBe('b');

    vi.setSystemTime(1_700_000_000_000 + 60_000);
    bus.publish(
      makeSample('wind.true.speed', DEFAULT_POLARS.twsBins[6]!, 1_700_000_000_000 + 60_000),
    );
    expect(received[received.length - 1]!.recommendedConfigId).toBe('c');
    expect(received[received.length - 1]!.enteredAt).toBeGreaterThan(firstEntered);

    stop();
    unsub();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/sail-crossover/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement pipeline.ts**

Create `packages/compute/src/sail-crossover/pipeline.ts`:

```typescript
import { combineLatest, Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import { Channels, type Bus, type Sample } from '@g5000/core';
import type {
  CrossoverMap,
  CrossoverSettings,
  PolarTable,
  SailWardrobe,
} from '@g5000/db';
import { lookupConfigId, snapToCell } from './lookup.js';

/**
 * Published shape on Channels.SAIL_RECOMMENDATION. Consumers (helm tile,
 * recommendation panel) compute `shouldChange` themselves on each render:
 *
 *   shouldChange = recommendedConfigId
 *               && recommendedConfigId !== activeConfigId
 *               && (Date.now()/1000 - enteredAt) >= stableSeconds
 *
 * This avoids a class of RxJS bugs where the pipeline doesn't re-fire
 * after wind stabilises so the in-pipeline maturation timer never trips.
 */
export interface SailRecommendation {
  recommendedConfigId: string | null;
  activeConfigId: string;
  /** Index into the active polar's twsBins. */
  cellTwsIdx: number;
  /** Index into the active polar's twaBins. */
  cellTwaIdx: number;
  /** UNIX seconds when this recommendedConfigId was first observed. Resets
   *  to "now" when the recommendation flips to a different config. */
  enteredAt: number;
  /** Echoed from CrossoverSettings so the UI can compute shouldChange. */
  stableSeconds: number;
}

/** Minimal store shape used by the pipeline — duck-typed for testability. */
export interface CrossoverPipelineStore {
  activePolar$: Observable<PolarTable>;
  sails$: Observable<SailWardrobe>;
  crossoverMap$: Observable<CrossoverMap>;
  crossoverSettings$: Observable<CrossoverSettings>;
}

interface WindLatest {
  tws: number | null;
  twa: number | null;
  tMs: number;
}

export function startSailCrossoverPipeline(args: {
  bus: Bus;
  store: CrossoverPipelineStore;
}): () => void {
  const { bus, store } = args;
  const wind$ = new Subject<WindLatest>();
  let twsLatest: number | null = null;
  let twaLatest: number | null = null;

  const unsubTws = bus.subscribe('wind.true.speed', (s: Sample) => {
    if (typeof s.value === 'number') {
      twsLatest = s.value;
      wind$.next({ tws: twsLatest, twa: twaLatest, tMs: s.t });
    }
  });
  const unsubTwa = bus.subscribe('wind.true.angle', (s: Sample) => {
    if (typeof s.value === 'number') {
      twaLatest = s.value;
      wind$.next({ tws: twsLatest, twa: twaLatest, tMs: s.t });
    }
  });

  let lastCandidate: string | null = null;
  let candidateSince = 0;

  const sub = combineLatest([
    store.activePolar$,
    store.sails$,
    store.crossoverMap$,
    store.crossoverSettings$,
    wind$,
  ]).subscribe(([polar, wardrobe, map, settings, w]) => {
    if (w.tws === null || w.twa === null) return;
    const cell = snapToCell(polar, w.tws, w.twa);
    const recommended = lookupConfigId(map, polar, w.tws, w.twa);
    const nowSec = Math.floor(Date.now() / 1000);
    if (recommended !== lastCandidate) {
      lastCandidate = recommended;
      candidateSince = nowSec;
    }
    const payload: SailRecommendation = {
      recommendedConfigId: recommended,
      activeConfigId: wardrobe.activeConfigId,
      cellTwsIdx: cell.twsIdx,
      cellTwaIdx: cell.twaIdx,
      enteredAt: candidateSince,
      stableSeconds: settings.recommendationStableSeconds,
    };
    bus.publish({
      channel: Channels.SAIL_RECOMMENDATION,
      source: 'compute:sail-crossover',
      t: nowSec * 1000,
      value: payload,
    });
  });

  return () => {
    sub.unsubscribe();
    unsubTws();
    unsubTwa();
  };
}
```

**Note:** No `distinctUntilChanged` on `wind$` — we want the pipeline to re-emit on every wind sample so consumers see a fresh `enteredAt`/`stableSeconds` snapshot for client-side maturation comparison. Pinned wind doesn't burn cycles because the bridge naturally throttles wind samples to N2K's emit rate (~10 Hz).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/sail-crossover/pipeline.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/sail-crossover/pipeline.ts packages/compute/src/sail-crossover/pipeline.test.ts
git commit -m "feat(compute): sail-crossover RxJS pipeline publishing sail.recommendation"
```

---

> **Note:** Task 8 was removed during plan review. The hysteresis state machine that lived there has been inlined into Task 7's pipeline (now just two local variables) and "should I switch?" is computed client-side in the helm tile and recommendation panel. Task numbering below preserves the original sequence for cross-reference stability — there is no Task 8 to execute.

## Task 9: Wire pipeline into autopilot-server boot

**Files:**
- Modify: `apps/autopilot-server/src/index.ts`

- [ ] **Step 1: Add the import**

At the top of `apps/autopilot-server/src/index.ts`, add:

```typescript
import { startSailCrossoverPipeline } from '@g5000/compute';
```

- [ ] **Step 2: Start the pipeline at boot**

Locate the block where `startTrueWindPipeline` and `startPolarPipeline` are started in live mode. Adjacent to those, add:

```typescript
const stopSailCrossover = startSailCrossoverPipeline({ bus, store });
```

In the shutdown handler (where the other pipelines are torn down), call `stopSailCrossover()`.

- [ ] **Step 3: Build the server**

Run: `npm run build --workspace @g5000/autopilot-server`
Expected: builds cleanly.

- [ ] **Step 4: Boot in demo mode to verify nothing blows up**

Run: `DEMO_MODE=1 SKIP_BRIDGE=1 timeout 5 npm run dev --workspace @g5000/autopilot-server` (the `timeout 5` ends the process after 5s; treat exit code 124 as success here)

Expected: server starts, logs do not show pipeline-startup errors.

- [ ] **Step 5: Commit**

```bash
git add apps/autopilot-server/src/index.ts
git commit -m "feat(autopilot-server): start sail-crossover pipeline at boot"
```

---

## Task 10: Routing — PlanInput.crossover + per-leg configId

**Files:**
- Modify: `packages/routing/src/types.ts`
- Modify: `packages/routing/src/plan.ts`
- Test: `packages/routing/src/plan.crossover.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/routing/src/plan.crossover.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { CrossoverMap, PolarTable, SailWardrobe } from '@g5000/db';
import type { Coastline } from '@g5000/coastline';
import type { PlanInput, RouteLeg } from './types.js';
import { plan } from './plan.js';

// Minimal world: constant 10 m/s easterly wind everywhere, 1° grid, no land.
function tinyWind(): PlanInput['wind'] {
  return {
    source: 'TEST',
    bbox: { minLat: 30, minLon: -70, maxLat: 35, maxLon: -65 },
    grid: { dLat: 0.5, dLon: 0.5 },
    samples: (lat: number, lon: number, t: number) => ({
      uMs: 10, // wind FROM east blowing west (negative-x). u positive=eastward
      vMs: 0,
      tWall: t,
    }),
  } as never;
}

const polar: PolarTable = {
  twsBins: [3, 5, 7, 10, 13],
  twaBins: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
  boatSpeed: [
    [0, 2, 3, 2, 1],
    [0, 3, 4, 3, 2],
    [0, 4, 5, 4, 3],
    [0, 5, 6, 5, 4],
    [0, 6, 7, 6, 5],
  ],
};

const wardrobe: SailWardrobe = {
  boatId: 'sula',
  activeConfigId: 'jib',
  activeMode: 'default',
  configs: [
    { id: 'jib', name: 'Jib', modes: {} },
    { id: 'spin', name: 'Spinnaker', modes: {} },
  ],
};

describe('plan() with crossover decoration', () => {
  it('decorates legs with recommendedConfigId from the crossover map', () => {
    const map: CrossoverMap = {
      boatId: 'sula',
      mode: 'default',
      cells: {},
      updatedAt: 0,
    };
    // Fill every cell with 'jib' so any leg is decorated
    for (let i = 0; i < polar.twsBins.length; i++) {
      for (let j = 0; j < polar.twaBins.length; j++) {
        map.cells[`${i},${j}`] = 'jib';
      }
    }
    const route = plan({
      start: { lat: 32, lon: -68 },
      end: { lat: 32.5, lon: -67.5 },
      departure: 1700000000,
      wind: tinyWind(),
      polar,
      polarId: 'test-polar',
      coastline: { tree: { search: () => [] } } as unknown as Coastline,
      options: { maxHours: 24 },
      crossover: { map, wardrobe },
    });
    expect(route.legs.length).toBeGreaterThan(0);
    expect(route.legs.every((l: RouteLeg) => l.configId === 'jib')).toBe(true);
  });

  it('legs at uncovered cells carry no configId', () => {
    const map: CrossoverMap = {
      boatId: 'sula',
      mode: 'default',
      cells: {}, // empty
      updatedAt: 0,
    };
    const route = plan({
      start: { lat: 32, lon: -68 },
      end: { lat: 32.5, lon: -67.5 },
      departure: 1700000000,
      wind: tinyWind(),
      polar,
      polarId: 'test-polar',
      coastline: { tree: { search: () => [] } } as unknown as Coastline,
      options: { maxHours: 24 },
      crossover: { map, wardrobe },
    });
    expect(route.legs.length).toBeGreaterThan(0);
    expect(route.legs.every((l) => l.configId === undefined)).toBe(true);
  });

  it('without crossover input, legs have no configId field', () => {
    const route = plan({
      start: { lat: 32, lon: -68 },
      end: { lat: 32.5, lon: -67.5 },
      departure: 1700000000,
      wind: tinyWind(),
      polar,
      polarId: 'test-polar',
      coastline: { tree: { search: () => [] } } as unknown as Coastline,
      options: { maxHours: 24 },
    });
    expect(route.legs.every((l) => l.configId === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/routing/src/plan.crossover.test.ts`
Expected: FAIL — `PlanInput.crossover` and `RouteLeg.configId` don't exist.

- [ ] **Step 3: Extend types**

In `packages/routing/src/types.ts`:

(a) Add to `RouteLeg`:

```typescript
/** Recommended sail configuration for this leg, from the crossover map.
 *  Absent when no crossover input was provided OR the leg's cell is empty
 *  in the map. */
configId?: string;
```

(b) Add to `PlanInput`:

```typescript
/** When set, the planner decorates each leg with the recommended
 *  configId from the crossover map. Has no effect on the route geometry —
 *  polar selection is unchanged (single polar per boat+mode). */
crossover?: {
  map: import('@g5000/db').CrossoverMap;
  wardrobe: import('@g5000/db').SailWardrobe;
};
```

- [ ] **Step 4: Implement the decoration in plan.ts**

In `packages/routing/src/plan.ts`, after the leg is appended to the `legs` array, add a decoration pass. Find the line `const legs: RouteLeg[] = [];` and the loop that pushes legs. After the loop (just before the function returns the `Route`), add:

```typescript
if (input.crossover) {
  const { lookupConfigId } = await import('@g5000/compute');
  const validIds = new Set(input.crossover.wardrobe.configs.map((c) => c.id));
  for (const leg of legs) {
    const id = lookupConfigId(input.crossover.map, input.polar, leg.tws, leg.twa);
    if (id !== null && validIds.has(id)) {
      leg.configId = id;
    }
  }
}
```

(`plan()` may be synchronous; if so, change the import to a top-of-file `import { lookupConfigId } from '@g5000/compute';` and skip the dynamic import. Prefer the top-level import — it's cleaner and avoids making `plan()` async.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/routing/src/plan.crossover.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 6: Run full routing test suite**

Run: `npx vitest run packages/routing/`
Expected: all pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/routing/src/types.ts packages/routing/src/plan.ts packages/routing/src/plan.crossover.test.ts
git commit -m "feat(routing): PlanInput.crossover decorates legs with recommendedConfigId"
```

---

## Task 11: Sail timeline post-process

**Files:**
- Create: `packages/routing/src/sail-timeline.ts`
- Test: `packages/routing/src/sail-timeline.test.ts`
- Modify: `packages/routing/src/types.ts` (add `SailTimelineSegment`)
- Modify: `packages/routing/src/index.ts` (export)

**Reference:** the issue-3-sail-crossover branch at `.worktrees/issue-3-sail-crossover/packages/routing/src/sail-timeline.ts` and its test file. The function is already pure and operates on `legs[].configId`, so this task is largely a salvage with adjusted imports.

- [ ] **Step 1: Add `SailTimelineSegment` to types**

In `packages/routing/src/types.ts`:

```typescript
export interface SailTimelineSegment {
  fromLegIdx: number;
  toLegIdx: number;
  configId: string;
  startTime: number;
  endTime: number;
  durationHours: number;
}
```

- [ ] **Step 2: Write the failing test**

Copy from the reference branch:

```bash
cp .worktrees/issue-3-sail-crossover/packages/routing/src/sail-timeline.test.ts packages/routing/src/sail-timeline.test.ts
```

If the import paths use `.js` suffixes that match this repo's convention, no edits needed. If not, fix any imports so they read from `./types.js` and `./sail-timeline.js`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/routing/src/sail-timeline.test.ts`
Expected: FAIL — `./sail-timeline.js` module not found.

- [ ] **Step 4: Copy the implementation**

```bash
cp .worktrees/issue-3-sail-crossover/packages/routing/src/sail-timeline.ts packages/routing/src/sail-timeline.ts
```

Edit the copy to import `SailTimelineSegment` from `./types.js` (it may be importing from `./types.js` already — confirm and adjust).

- [ ] **Step 5: Export from routing's index**

Append to `packages/routing/src/index.ts`:

```typescript
export { computeSailTimeline } from './sail-timeline.js';
export type { SailTimelineSegment } from './types.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/routing/src/sail-timeline.test.ts`
Expected: PASS.

- [ ] **Step 7: Run full routing test suite**

Run: `npx vitest run packages/routing/`
Expected: ALL pass.

- [ ] **Step 8: Commit**

```bash
git add packages/routing/src/types.ts packages/routing/src/sail-timeline.ts packages/routing/src/sail-timeline.test.ts packages/routing/src/index.ts
git commit -m "feat(routing): computeSailTimeline post-process with short-run absorption"
```

---

## Task 12: /api/crossover-map GET and POST

**Files:**
- Create: `packages/web/src/app/api/crossover-map/route.ts`
- Test: `packages/web/src/app/api/crossover-map/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/crossover-map/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
} from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/crossover-map-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});

afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('GET /api/crossover-map', () => {
  it('returns the default empty map on a fresh store', async () => {
    const res = await GET();
    const json = (await res.json()) as { ok: boolean; map: { cells: Record<string, string> } };
    expect(json.ok).toBe(true);
    expect(json.map.cells).toEqual({});
  });
});

describe('POST /api/crossover-map', () => {
  it('persists a posted map and the next GET reflects it', async () => {
    const body = {
      boatId: store.activeBoatId,
      mode: 'default',
      cells: { '2,3': 'default' }, // 'default' is the seeded config id
    };
    const req = new Request('http://localhost/api/crossover-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const reread = await GET();
    const json = (await reread.json()) as { ok: boolean; map: { cells: Record<string, string> } };
    expect(json.map.cells['2,3']).toBe('default');
  });

  it('strips configIds not present in the wardrobe on write', async () => {
    const body = {
      boatId: store.activeBoatId,
      mode: 'default',
      cells: { '2,3': 'default', '4,5': 'nonexistent-config' },
    };
    const res = await POST(
      new Request('http://localhost/api/crossover-map', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(200);
    const reread = await GET();
    const json = (await reread.json()) as { ok: boolean; map: { cells: Record<string, string> } };
    expect(json.map.cells['2,3']).toBe('default');
    expect(json.map.cells['4,5']).toBeUndefined();
  });

  it('400s on malformed body', async () => {
    const req = new Request('http://localhost/api/crossover-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{notjson',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/api/crossover-map/`
Expected: FAIL — `./route.js` not found.

- [ ] **Step 3: Implement route.ts**

Create `packages/web/src/app/api/crossover-map/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type CrossoverMap } from '@g5000/db';

export async function GET() {
  const store = getSharedConfigStore();
  const map = await firstValueFrom(store.crossoverMap$);
  const wardrobe = await firstValueFrom(store.sails$);
  const valid = new Set(wardrobe.configs.map((c) => c.id));
  // Filter dangling configIds (configs that have since been deleted from the
  // wardrobe). Read-side filter keeps the stored map intact in case the
  // config is restored.
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(map.cells)) {
    if (valid.has(v)) filtered[k] = v;
  }
  return NextResponse.json({ ok: true, map: { ...map, cells: filtered } });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { message: 'invalid JSON body' } },
      { status: 400 },
    );
  }
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { boatId?: unknown }).boatId !== 'string' ||
    typeof (body as { mode?: unknown }).mode !== 'string' ||
    typeof (body as { cells?: unknown }).cells !== 'object' ||
    (body as { cells: unknown }).cells === null
  ) {
    return NextResponse.json(
      { ok: false, error: { message: 'expected { boatId, mode, cells }' } },
      { status: 400 },
    );
  }
  const store = getSharedConfigStore();
  const wardrobe = await firstValueFrom(store.sails$);
  const valid = new Set(wardrobe.configs.map((c) => c.id));
  const cells = (body as { cells: Record<string, unknown> }).cells;
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(cells)) {
    if (typeof v === 'string' && valid.has(v)) cleaned[k] = v;
  }
  const map: CrossoverMap = {
    boatId: (body as { boatId: string }).boatId,
    mode: (body as { mode: string }).mode,
    cells: cleaned,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  try {
    await store.setCrossoverMap(map);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: { message: e instanceof Error ? e.message : String(e) } },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, map });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/app/api/crossover-map/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/crossover-map/
git commit -m "feat(web): /api/crossover-map GET+POST"
```

---

## Task 13: /api/crossover-settings GET and POST

**Files:**
- Create: `packages/web/src/app/api/crossover-settings/route.ts`
- Test: `packages/web/src/app/api/crossover-settings/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/crossover-settings/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import {
  ConfigStore,
  setSharedConfigStore,
  _resetSharedConfigStoreForTests,
  DEFAULT_CROSSOVER_SETTINGS,
} from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/crossover-settings-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});

afterEach(async () => {
  await store.close();
  _resetSharedConfigStoreForTests();
});

describe('GET /api/crossover-settings', () => {
  it('returns defaults on a fresh store', async () => {
    const res = await GET();
    const json = (await res.json()) as { ok: boolean; settings: typeof DEFAULT_CROSSOVER_SETTINGS };
    expect(json.ok).toBe(true);
    expect(json.settings).toEqual(DEFAULT_CROSSOVER_SETTINGS);
  });
});

describe('POST /api/crossover-settings', () => {
  it('persists a posted settings object', async () => {
    const body = { ...DEFAULT_CROSSOVER_SETTINGS, recommendationStableSeconds: 90 };
    const req = new Request('http://localhost/api/crossover-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const reread = await GET();
    const json = (await reread.json()) as { ok: boolean; settings: typeof DEFAULT_CROSSOVER_SETTINGS };
    expect(json.settings.recommendationStableSeconds).toBe(90);
  });

  it('400s on malformed body', async () => {
    const req = new Request('http://localhost/api/crossover-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    expect((await POST(req)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/api/crossover-settings/`
Expected: FAIL.

- [ ] **Step 3: Implement route.ts**

Create `packages/web/src/app/api/crossover-settings/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import {
  getSharedConfigStore,
  type CrossoverSettings,
  DEFAULT_CROSSOVER_SETTINGS,
} from '@g5000/db';

const NUMERIC_KEYS = [
  'recommendationStableSeconds',
  'chartTwsMaxKn',
  'chartTwaMinDeg',
  'chartTwaMaxDeg',
  'forecastIntervalMinutes',
  'forecastDurationHours',
] as const satisfies ReadonlyArray<keyof CrossoverSettings>;

export async function GET() {
  const store = getSharedConfigStore();
  const settings = await firstValueFrom(store.crossoverSettings$);
  return NextResponse.json({ ok: true, settings });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const merged: CrossoverSettings = { ...DEFAULT_CROSSOVER_SETTINGS };
  for (const k of NUMERIC_KEYS) {
    const v = body[k];
    if (typeof v === 'number' && Number.isFinite(v)) (merged as Record<string, number>)[k] = v;
  }
  const store = getSharedConfigStore();
  await store.setCrossoverSettings(merged);
  return NextResponse.json({ ok: true, settings: merged });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/app/api/crossover-settings/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/crossover-settings/
git commit -m "feat(web): /api/crossover-settings GET+POST"
```

---

## Task 14: /api/route/plan — wire crossover into the planner

**Files:**
- Modify: `packages/web/src/app/api/route/plan/route.ts`
- Test: `packages/web/src/app/api/route/plan/route.test.ts`

- [ ] **Step 1: Inspect the current handler**

Read `packages/web/src/app/api/route/plan/route.ts`. Locate the section where it builds the `PlanInput` and calls `plan(input)`. (It already resolves `activePolar$` to a `PolarTable` and supplies `polar` + `polarId`.)

- [ ] **Step 2: Add crossover to the PlanInput**

Modify the handler so that before calling `plan(input)`, it pulls the crossover map and wardrobe from the store and includes them in `PlanInput.crossover`. Pseudocode:

```typescript
import { firstValueFrom } from 'rxjs';

// inside the handler:
const map = await firstValueFrom(store.crossoverMap$);
const wardrobe = await firstValueFrom(store.sails$);
const route = plan({
  // … existing fields …
  crossover: { map, wardrobe },
});
```

If the route already returns `route.legs` to the caller and persists the plan to `/api/plans`, also include the sail timeline in the response (call `computeSailTimeline(route.legs)`):

```typescript
import { computeSailTimeline } from '@g5000/routing';
// …
const sailTimeline = computeSailTimeline(route.legs);
return NextResponse.json({ ok: true, route: { ...route, sailTimeline } });
```

- [ ] **Step 3: Update or add a test**

In `packages/web/src/app/api/route/plan/route.test.ts`, add a test that paints a single crossover-map cell, fires a plan request, and asserts the returned route's `sailTimeline` contains the painted configId. If the existing test file is structured around a different harness, follow that file's conventions; do not invent a new pattern.

- [ ] **Step 4: Run the route test**

Run: `npx vitest run packages/web/src/app/api/route/plan/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/route/plan/
git commit -m "feat(web): /api/route/plan returns sailTimeline; passes crossover to planner"
```

---

## Task 15: Salvage helpers — getConfigColor

**Files:**
- Create: `packages/web/src/lib/config-color.ts`
- Test: `packages/web/src/lib/config-color.test.ts`

- [ ] **Step 1: Copy from reference branch**

```bash
cp .worktrees/issue-3-sail-crossover/packages/web/src/lib/config-color.ts packages/web/src/lib/config-color.ts
cp .worktrees/issue-3-sail-crossover/packages/web/src/lib/config-color.test.ts packages/web/src/lib/config-color.test.ts
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run packages/web/src/lib/config-color`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/config-color.ts packages/web/src/lib/config-color.test.ts
git commit -m "feat(web): getConfigColor stable-hash helper (salvaged from issue-3-sail-crossover)"
```

---

## Task 16: CrossoverChart — editable grid

**Files:**
- Create: `packages/web/src/app/sails/CrossoverChart.tsx`

This is a fresh implementation; the reference branch's `CrossoverChart.tsx` was a heatmap viewer of per-config polars. Model A's chart is an **authoring surface** for the map.

- [ ] **Step 1: Implement CrossoverChart.tsx**

Create `packages/web/src/app/sails/CrossoverChart.tsx`:

```typescript
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CrossoverMap, CrossoverSettings, PolarTable, SailWardrobe } from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

const KN_PER_MS = 1 / 0.514444;
const DEG_PER_RAD = 180 / Math.PI;

interface Props {
  wardrobe: SailWardrobe;
  polar: PolarTable;
  initial: CrossoverMap;
  settings: CrossoverSettings;
  onSave: (map: CrossoverMap) => Promise<void>;
}

export function CrossoverChart({ wardrobe, polar, initial, settings, onSave }: Props) {
  const [cells, setCells] = useState<Record<string, string>>(initial.cells);
  const [paint, setPaint] = useState<string>(wardrobe.configs[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Filter the polar grid to the settings-defined display window.
  const cols = useMemo(
    () => polar.twsBins.map((v, i) => ({ i, kn: v * KN_PER_MS })).filter((c) => c.kn <= settings.chartTwsMaxKn),
    [polar.twsBins, settings.chartTwsMaxKn],
  );
  const rows = useMemo(
    () =>
      polar.twaBins
        .map((v, i) => ({ i, deg: v * DEG_PER_RAD }))
        .filter((r) => r.deg >= settings.chartTwaMinDeg && r.deg <= settings.chartTwaMaxDeg),
    [polar.twaBins, settings.chartTwaMinDeg, settings.chartTwaMaxDeg],
  );

  function toggleCell(twsIdx: number, twaIdx: number) {
    const key = `${twsIdx},${twaIdx}`;
    setCells((c) => {
      const next = { ...c };
      if (next[key] === paint) delete next[key]; // click same: clear
      else next[key] = paint;
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    try {
      await onSave({
        boatId: initial.boatId,
        mode: initial.mode,
        cells,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      setDirty(false);
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setCells({});
    setDirty(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs uppercase tracking-wider text-slate-500">Paint:</div>
        {wardrobe.configs.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPaint(c.id)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
              paint === c.id ? 'border-slate-300' : 'border-slate-700'
            }`}
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded"
              style={{ background: getConfigColor(c.id) }}
            />
            {c.name}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: 1 }}>
          <thead>
            <tr>
              <th className="bg-slate-900 px-1 py-1 text-xs text-slate-500">TWA \\ TWS (kn)</th>
              {cols.map((c) => (
                <th key={c.i} className="bg-slate-900 px-1 py-1 text-xs text-slate-400">
                  {c.kn.toFixed(0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i}>
                <th className="bg-slate-900 px-1 py-1 text-xs text-slate-400">{r.deg.toFixed(0)}°</th>
                {cols.map((c) => {
                  const key = `${c.i},${r.i}`;
                  const id = cells[key];
                  const bg = id ? getConfigColor(id) : 'transparent';
                  return (
                    <td
                      key={c.i}
                      onClick={() => toggleCell(c.i, r.i)}
                      className="h-6 w-6 cursor-pointer border border-slate-800 hover:border-slate-500"
                      style={{ background: bg }}
                      title={id ?? '(empty)'}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="rounded bg-emerald-700 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-300"
        >
          Clear all
        </button>
        <div className="text-xs text-slate-500">
          {Object.keys(cells).length} cells painted
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sails/CrossoverChart.tsx
git commit -m "feat(web,sails): editable CrossoverChart authoring surface"
```

---

## Task 17: RecommendationPanel — SSE-driven, new payload shape

**Files:**
- Create: `packages/web/src/app/sails/RecommendationPanel.tsx`

**Reference:** `.worktrees/issue-3-sail-crossover/packages/web/src/app/sails/RecommendationPanel.tsx`. Salvage the SSE wiring; swap the payload shape and channel name.

- [ ] **Step 1: Implement RecommendationPanel.tsx**

Create `packages/web/src/app/sails/RecommendationPanel.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import type { SailWardrobe } from '@g5000/db';
import { getConfigColor } from '../../lib/config-color';

interface SailRecommendation {
  recommendedConfigId: string | null;
  activeConfigId: string;
  cellTwsIdx: number;
  cellTwaIdx: number;
  enteredAt: number;
  stableSeconds: number;
}

function useRecommendation(): SailRecommendation | null {
  const [rec, setRec] = useState<SailRecommendation | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { channel: string; sample: { value: unknown } };
        if (parsed.channel === 'sail.recommendation') {
          setRec(parsed.sample.value as SailRecommendation);
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);
  return rec;
}

// Re-render every 5 s so the maturation timer's UI state stays fresh even
// when no new sail.recommendation event arrives.
function useTick(intervalMs: number): void {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

function nameOf(wardrobe: SailWardrobe, id: string | null): string {
  if (!id) return '—';
  return wardrobe.configs.find((c) => c.id === id)?.name ?? id;
}

export function RecommendationPanel({ wardrobe }: { wardrobe: SailWardrobe }) {
  const rec = useRecommendation();
  useTick(5_000);
  if (!rec) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">
        Waiting for wind…
      </div>
    );
  }
  const active = nameOf(wardrobe, rec.activeConfigId);
  const recommended = nameOf(wardrobe, rec.recommendedConfigId);
  const sameAsActive = rec.recommendedConfigId === rec.activeConfigId;
  const elapsedSec = Math.floor(Date.now() / 1000) - rec.enteredAt;
  const shouldChange =
    rec.recommendedConfigId !== null && !sameAsActive && elapsedSec >= rec.stableSeconds;

  let frame = 'border-slate-700';
  if (shouldChange) frame = 'border-rose-600';
  else if (!sameAsActive && rec.recommendedConfigId) frame = 'border-amber-600';

  return (
    <div className={`rounded border bg-slate-900 p-4 ${frame}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500">Sail recommendation</div>
      <div className="mt-2 flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-4 w-4 rounded"
          style={{
            background: rec.recommendedConfigId ? getConfigColor(rec.recommendedConfigId) : '#475569',
          }}
        />
        <div className="text-lg text-slate-100">{recommended}</div>
      </div>
      <div className="mt-1 text-xs text-slate-400">
        Active: <span className="text-slate-200">{active}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        Cell: TWS bin {rec.cellTwsIdx} × TWA bin {rec.cellTwaIdx} · stable {elapsedSec}s / {rec.stableSeconds}s
      </div>
      {shouldChange && (
        <div className="mt-2 text-sm text-rose-300">Change recommended — switch active config.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sails/RecommendationPanel.tsx
git commit -m "feat(web,sails): RecommendationPanel reads sail.recommendation channel"
```

---

## Task 18: SailRecommendationTile (helm) — new payload shape

**Files:**
- Create: `packages/web/src/app/helm/SailRecommendationTile.tsx`

- [ ] **Step 1: Implement the tile**

Create `packages/web/src/app/helm/SailRecommendationTile.tsx`:

```typescript
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getConfigColor } from '../../lib/config-color';

interface SailRecommendation {
  recommendedConfigId: string | null;
  activeConfigId: string;
  enteredAt: number;
  stableSeconds: number;
}

function useRecommendation(): SailRecommendation | null {
  const [rec, setRec] = useState<SailRecommendation | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as { channel: string; sample: { value: unknown } };
        if (parsed.channel === 'sail.recommendation') {
          setRec(parsed.sample.value as SailRecommendation);
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);
  return rec;
}

function useTick(intervalMs: number): void {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export function SailRecommendationTile() {
  const rec = useRecommendation();
  useTick(5_000);
  const id = rec?.recommendedConfigId ?? null;
  const color = id ? getConfigColor(id) : '#475569';
  const sameAsActive = rec ? id === rec.activeConfigId : true;
  const elapsedSec = rec ? Math.floor(Date.now() / 1000) - rec.enteredAt : 0;
  const shouldChange = rec ? id !== null && !sameAsActive && elapsedSec >= rec.stableSeconds : false;
  let border = 'border-slate-700';
  if (shouldChange) border = 'border-rose-600';
  else if (id && !sameAsActive) border = 'border-amber-600';

  return (
    <Link
      href="/sails"
      className={`block rounded border ${border} bg-slate-900 p-3 hover:bg-slate-800`}
    >
      <div className="text-xs uppercase tracking-wider text-slate-500">Sail</div>
      <div className="mt-1 flex items-center gap-2">
        <span aria-hidden className="inline-block h-3 w-3 rounded" style={{ background: color }} />
        <div className="text-sm text-slate-100">{id ?? '—'}</div>
      </div>
      {shouldChange && <div className="mt-1 text-xs text-rose-300">Change recommended</div>}
    </Link>
  );
}
```

- [ ] **Step 2: Mount the tile on the helm page**

In `packages/web/src/app/helm/page.tsx`, import and render the tile in the existing tile grid. Place it near the related performance tiles (consult the file's layout; copy the pattern of existing tiles). Example placement:

```typescript
import { SailRecommendationTile } from './SailRecommendationTile';
// … inside the JSX tile grid:
<SailRecommendationTile />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/helm/SailRecommendationTile.tsx packages/web/src/app/helm/page.tsx
git commit -m "feat(web,helm): SailRecommendationTile on the helm page"
```

---

## Task 19: ForecastTimeline — salvage and re-wire

**Files:**
- Create: `packages/web/src/app/sails/ForecastTimeline.tsx`

- [ ] **Step 1: Copy from reference branch**

```bash
cp .worktrees/issue-3-sail-crossover/packages/web/src/app/sails/ForecastTimeline.tsx packages/web/src/app/sails/ForecastTimeline.tsx
```

- [ ] **Step 2: Adjust imports if needed**

Open the file. Confirm it imports `getConfigColor` from `../../lib/config-color` and `SailWardrobe` from `@g5000/db`. The component reads `/api/plans` and renders bands keyed by `configId` from the plan's `route.sailTimeline`. Model A's plan response already includes `sailTimeline` (Task 14), so no shape changes are needed.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/sails/ForecastTimeline.tsx
git commit -m "feat(web,sails): ForecastTimeline (salvaged) renders the plan's sailTimeline"
```

---

## Task 20: SettingsDrawer — CrossoverSettings keys

**Files:**
- Create: `packages/web/src/app/sails/SettingsDrawer.tsx`

- [ ] **Step 1: Implement SettingsDrawer.tsx**

Create `packages/web/src/app/sails/SettingsDrawer.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { DEFAULT_CROSSOVER_SETTINGS, type CrossoverSettings } from '@g5000/db';

interface Props {
  initial: CrossoverSettings;
  onSave: (settings: CrossoverSettings) => Promise<void>;
}

const FIELDS: Array<{ key: keyof CrossoverSettings; label: string; min: number; max: number; step: number }> = [
  { key: 'recommendationStableSeconds', label: 'Recommendation stable (s)', min: 5, max: 600, step: 5 },
  { key: 'chartTwsMaxKn', label: 'Chart TWS max (kn)', min: 10, max: 60, step: 1 },
  { key: 'chartTwaMinDeg', label: 'Chart TWA min (°)', min: 0, max: 90, step: 5 },
  { key: 'chartTwaMaxDeg', label: 'Chart TWA max (°)', min: 90, max: 180, step: 5 },
  { key: 'forecastIntervalMinutes', label: 'Forecast interval (min)', min: 5, max: 240, step: 5 },
  { key: 'forecastDurationHours', label: 'Forecast duration (h)', min: 1, max: 96, step: 1 },
];

export function SettingsDrawer({ initial, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CrossoverSettings>(initial);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-slate-400 underline hover:text-slate-200"
      >
        Chart settings
      </button>
    );
  }

  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-slate-700 bg-slate-950 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-500">Chart settings</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-xs">
            <div className="text-slate-400">{f.label}</div>
            <input
              type="number"
              value={draft[f.key]}
              min={f.min}
              max={f.max}
              step={f.step}
              onChange={(e) =>
                setDraft({ ...draft, [f.key]: Number(e.target.value) || DEFAULT_CROSSOVER_SETTINGS[f.key] })
              }
              className="w-full rounded bg-slate-900 px-2 py-1 text-slate-100"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded bg-emerald-700 px-3 py-1 text-sm text-white disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sails/SettingsDrawer.tsx
git commit -m "feat(web,sails): SettingsDrawer for CrossoverSettings"
```

---

## Task 21: /sails page — wire everything together

**Files:**
- Modify: `packages/web/src/app/sails/page.tsx`

- [ ] **Step 1: Implement the page**

Replace the contents of `packages/web/src/app/sails/page.tsx` with:

```typescript
'use client';

import { useEffect, useState } from 'react';
import type {
  CrossoverMap, CrossoverSettings, PolarTable, SailWardrobe,
} from '@g5000/db';
import { CrossoverChart } from './CrossoverChart';
import { ForecastTimeline } from './ForecastTimeline';
import { RecommendationPanel } from './RecommendationPanel';
import { SettingsDrawer } from './SettingsDrawer';

export default function SailsPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [polar, setPolar] = useState<PolarTable | null>(null);
  const [map, setMap] = useState<CrossoverMap | null>(null);
  const [settings, setSettings] = useState<CrossoverSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    try {
      const [wRes, pRes, mRes, sRes] = await Promise.all([
        fetch('/api/wardrobe/active', { cache: 'no-store' }),
        fetch('/api/polar/active', { cache: 'no-store' }),
        fetch('/api/crossover-map', { cache: 'no-store' }),
        fetch('/api/crossover-settings', { cache: 'no-store' }),
      ]);
      const wJ = (await wRes.json()) as { ok: boolean; wardrobe?: SailWardrobe; error?: { message: string } };
      const pJ = (await pRes.json()) as { ok: boolean; polar?: PolarTable; error?: { message: string } };
      const mJ = (await mRes.json()) as { ok: boolean; map?: CrossoverMap; error?: { message: string } };
      const sJ = (await sRes.json()) as { ok: boolean; settings?: CrossoverSettings; error?: { message: string } };
      if (!wJ.ok || !pJ.ok || !mJ.ok || !sJ.ok) {
        setErr(
          wJ.error?.message ?? pJ.error?.message ?? mJ.error?.message ?? sJ.error?.message ?? 'load failed',
        );
        return;
      }
      setWardrobe(wJ.wardrobe ?? null);
      setPolar(pJ.polar ?? null);
      setMap(mJ.map ?? null);
      setSettings(sJ.settings ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function saveMap(next: CrossoverMap) {
    const res = await fetch('/api/crossover-map', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: { message?: string } };
      throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    }
    await reload();
  }

  async function saveSettings(next: CrossoverSettings) {
    const res = await fetch('/api/crossover-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await reload();
  }

  if (err) return <div className="p-4 text-rose-300">Error: {err}</div>;
  if (!wardrobe || !polar || !map || !settings) return <div className="p-4 text-slate-400">Loading…</div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between">
        <h1 className="text-xl text-slate-100">Sails</h1>
        <SettingsDrawer initial={settings} onSave={saveSettings} />
      </div>
      <RecommendationPanel wardrobe={wardrobe} />
      <CrossoverChart wardrobe={wardrobe} polar={polar} initial={map} settings={settings} onSave={saveMap} />
      <ForecastTimeline wardrobe={wardrobe} />
    </div>
  );
}
```

If `/api/wardrobe/active` doesn't already exist, use `/api/sails` (the existing wardrobe-read endpoint) instead, and pluck `wardrobe` from `j.wardrobe` or `j.value`. Verify against the file present on `develop`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/sails/page.tsx
git commit -m "feat(web,sails): /sails page wires CrossoverChart + Recommendation + Timeline"
```

---

## Task 22: Navbar entry for /sails (if missing)

**Files:**
- Modify: `packages/web/src/app/Navbar.tsx` (only if `/sails` is not already linked)

- [ ] **Step 1: Inspect Navbar**

Open `packages/web/src/app/Navbar.tsx`. If a link to `/sails` already exists, **skip this task and proceed to Task 23**.

- [ ] **Step 2: Add the link**

Add `<NavLink href="/sails">Sails</NavLink>` (matching the file's existing component shape — `NavLink` may be named differently; mirror the existing `/alerts` entry's pattern) in the navbar.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/Navbar.tsx
git commit -m "feat(web): Navbar link to /sails"
```

---

## Task 23: PlanControls — drop wardrobe payload

**Files:**
- Modify: `packages/web/src/components/PlanControls.tsx` (only if the file exists; on develop, check first)

- [ ] **Step 1: Inspect PlanControls**

```bash
ls packages/web/src/components/PlanControls.tsx 2>&1 || echo "NOT PRESENT — skip this task"
```

If the file is not present (it's a sail-crossover-branch artifact and was not on develop), **skip this task**. The `/api/route/plan` route already pulls crossover data server-side (Task 14), so no client payload changes are needed.

- [ ] **Step 2: If present, remove client-side wardrobe payload**

Open the file. If it builds a `wardrobe` field for the POST body to `/api/route/plan`, delete that field. Crossover data is now sourced server-side from `ConfigStore`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: clean.

- [ ] **Step 4: Commit (if changes were made)**

```bash
git add packages/web/src/components/PlanControls.tsx
git commit -m "refactor(web): PlanControls no longer sends wardrobe to /api/route/plan"
```

---

## Task 24: Full test + typecheck + build

**Files:** None (validation only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: ALL tests pass. The count should be ≥ pre-existing develop count + the new tests added in this plan (~15 new tests).

- [ ] **Step 2: Run typecheck across the repo**

Run: `npm run typecheck`
Expected: clean (modulo the apps/router stale ref documented in CLAUDE.md).

- [ ] **Step 3: Run a full build**

Run: `npm run build`
Expected: every workspace builds. `next build` on `packages/web` succeeds.

- [ ] **Step 4: Commit any incidental fixes**

If the above runs surface incidental issues (missing imports, type errors in a place the plan didn't touch), fix them and commit:

```bash
git add -p
git commit -m "fix: <one-line>"
```

If everything's clean, skip this step.

---

## Task 25: Browser smoke test

**Files:** None (validation only)

- [ ] **Step 1: Boot the dev server**

```bash
DEMO_MODE=1 npm run dev --workspace @g5000/autopilot-server
```

Wait until the log line shows "Ready on http://localhost:3000".

- [ ] **Step 2: Open /sails in Chrome**

Use `chrome-devtools-mcp` (or open `http://localhost:3000/sails` manually):
- Page renders without console errors.
- Wardrobe shows the seeded "Default" config (or whatever's in ConfigStore).
- Polar grid renders the cells.
- Clicking a cell paints it with the active paint config.
- Clicking the same cell again clears it.
- Save button persists; reloading the page shows the painted cells.

- [ ] **Step 3: Open /helm**

Verify `SailRecommendationTile` appears in the tile grid. In demo mode, with wind injected, the tile should populate within a few seconds (demo mode publishes synthetic wind).

- [ ] **Step 4: Plan a route, verify timeline**

From `/chart`, plan a route. Then go to `/sails` and confirm `ForecastTimeline` renders coloured bands. The bands correspond to the painted cells along the route's wind track.

- [ ] **Step 5: Stop the dev server**

```bash
# Ctrl-C in the dev terminal, or:
pkill -f "tsx watch"
```

- [ ] **Step 6: Document any smoke-test issues**

If something doesn't work, file a follow-up issue and note it here — do NOT block the merge on a UI polish issue if the core data flow works. The plan is to ship Model A and iterate. Stop on functional regressions (e.g., recommendation never fires, save 500s); ship with cosmetic gaps.

---

## Task 26: Cleanup and merge prep

**Files:**
- Delete: `docs/superpowers/specs/2026-05-18-sail-crossover-chart-design.md`
- Delete: `docs/superpowers/plans/2026-05-18-sail-crossover-chart.md`

- [ ] **Step 1: Delete the superseded v1 spec and plan**

```bash
git rm docs/superpowers/specs/2026-05-18-sail-crossover-chart-design.md docs/superpowers/plans/2026-05-18-sail-crossover-chart.md
```

(If these files were never present on `develop` and are only on the `issue-3-sail-crossover` branch, `git rm` will fail with "did not match any files" — in that case skip this step.)

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: drop superseded sail-crossover v1 spec + plan"
```

(Skip if Step 1 was skipped.)

- [ ] **Step 3: Final sanity**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all green.

- [ ] **Step 4: Push the worktree branch**

```bash
git push -u origin HEAD
```

Open a PR `<worktree-branch> → develop` titled "feat: sail-crossover Model A (single polar + crossover map)" with body referencing the Model A spec.

- [ ] **Step 5: After PR merge, retire the old branch**

(Manual step, post-merge — out of scope for the plan execution, but note it.) Delete `issue-3-sail-crossover` from `origin` and from the local `.worktrees/` directory. The branch is no longer needed; its salvageable pieces were extracted by name in this plan.

---

## Self-review checklist

Run through these once the plan is complete; fix issues inline.

- **Spec coverage:**
  - § 3.1 `CrossoverMap` → Tasks 1, 2, 3
  - § 3.2 `CrossoverSettings` → Tasks 1, 2, 4
  - § 3.3 No v2 schema changes → enforced by absence (no migration tasks)
  - § 4 compute pipeline → Tasks 5, 6, 7, 9 (Task 8 removed — hysteresis is consumer-side)
  - § 5 chart authoring → Tasks 15, 16, 20, 21
  - § 6 routing integration → Tasks 10, 11, 14
  - § 7 sail timeline → Task 11
  - § 8 UI inventory → Tasks 15–23
  - § 10 channels → Task 5
  - § 11 out of scope → not implemented (intentional)
  - § 12 risks → polar-rebinning behaviour deferred to a future task (out of scope for v1; only fires when polar revisions are swapped)
  - § 13 testing strategy → Tasks 1, 3, 4, 6, 7, 10, 11, 12, 13, 25
  - § 14 acceptance → Task 25 (browser smoke covers all five criteria)
  - § 15 promotion → Task 26

- **Placeholder scan:** no "TBD", "add validation", "implement later", "similar to" references remain.

- **Type consistency:**
  - `CrossoverMap` and `CrossoverSettings` shapes match between defaults (Task 1), ConfigStore (Tasks 3, 4), routes (Tasks 12, 13), and UI (Tasks 16, 20).
  - `SailRecommendation` shape (no `shouldChange` field; `enteredAt` + `stableSeconds` are echoed) matches between pipeline (Task 7), helm tile (Task 18), and `/sails` recommendation panel (Task 17).
  - `RouteLeg.configId?` is added in Task 10 and consumed by Task 11 (`computeSailTimeline`).
  - Route handlers (Tasks 12, 13) use `getSharedConfigStore()` from `@g5000/db`; tests use `setSharedConfigStore()` / `_resetSharedConfigStoreForTests()`, mirroring `packages/web/src/app/api/polar/active/route.test.ts`.
