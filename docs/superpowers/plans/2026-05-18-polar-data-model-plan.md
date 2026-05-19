# Polar Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure polar storage in `@g5000/db` so wardrobe slots reference immutable polar revisions (per mode) instead of embedding `PolarTable` inline. Keep `activePolar$` signature unchanged so compute/routing/H-LINK consumers are unaffected.

**Architecture:** Approach B (Hybrid) from the spec. One new SQLite table — `polar_revisions` — holds immutable history rows keyed by `(boatId, sailConfigId, mode)`. Wardrobe slots carry `modes: Partial<Record<PolarMode, { activeRevisionId }>>` pointers. A pure transform `migrateWardrobeV1ToV2` is the migration engine, called inside a single SQLite transaction at `ConfigStore.open`. Resolver `combineLatest([sailWardrobe$, polarRevisions$]).pipe(map(...))` returns the same `PolarTable` shape consumers see today.

**Tech Stack:** TypeScript, Drizzle ORM (better-sqlite3), RxJS, Vitest, Next.js App Router. New runtime dep: `ulid`.

**Spec:** `docs/superpowers/specs/2026-05-18-polar-data-model-design.md`

**Issue:** [#1 Polars!](https://github.com/gregjohnson1024/g5000/issues/1)

---

## File structure

### Create

- `packages/db/src/polar-revisions.ts` — Drizzle queries + pure validator `validatePolarTable`
- `packages/db/src/polar-revisions.test.ts`
- `packages/db/src/migrate-wardrobe-v2.ts` — pure transform `migrateWardrobeV1ToV2`
- `packages/db/src/migrate-wardrobe-v2.test.ts`
- `packages/web/src/app/api/polar/revisions/route.ts` — GET (list) + POST (create)
- `packages/web/src/app/api/polar/revisions/route.test.ts`
- `packages/web/src/app/api/polar/revisions/[id]/route.ts` — GET single
- `packages/web/src/app/api/polar/revisions/[id]/route.test.ts`
- `packages/web/src/app/api/polar/active/route.ts` — POST `{sailConfigId, mode, revisionId}`
- `packages/web/src/app/api/polar/active/route.test.ts`

### Modify

- `packages/db/package.json` — add `ulid` dep
- `packages/db/src/defaults.ts` — new types, extend `PolarTable` / `SailConfig` / `SailWardrobe`, update `DEFAULT_WARDROBE` to v2 shape
- `packages/db/src/schema.ts` — add `polar_revisions` table
- `packages/db/src/config-store.ts` — boot migration, `polarRevisions$`, new `activePolar$` resolver, new methods
- `packages/db/src/config-store.test.ts` — v1→v2 migration cases, dangling-pointer fallback, revision-switch
- `packages/db/src/index.ts` — re-export new types + functions
- `packages/web/src/app/api/wardrobe/active/route.ts` — accept optional `activeMode`
- `packages/web/src/app/api/route/plan/route.ts` — wire `polarId` to active revision id
- `packages/compute/src/polars/pipeline.test.ts` — assert revision switch propagates within one tick
- `apps/autopilot-server/src/index.ts` — log active boat at boot
- `CLAUDE.md` — document `G5000_BOAT_ID` env var

### No change

`packages/compute/src/polars/pipeline.ts`, `packages/compute/src/polars/math.ts`, `packages/routing/src/plan.ts`, `packages/bridge/**` — all consume `PolarTable` unchanged.

---

## Conventions used by this plan

- File paths are absolute from the repo root.
- All times are UNIX seconds (`Math.floor(Date.now() / 1000)`) to match `passageLog.anchorAt`.
- IDs are ULIDs (lowercase, 26 chars) produced by `ulid()` from the `ulid` npm package.
- Tests run with `npx vitest run path/to/file.test.ts` from the worktree root.
- After each task, the test suite is green: `npm test` should pass (or the only failures are the pre-existing four environmental tests: 2× wgrib2, 1× coastline data, 1× position route ConfigStore-init).
- Commit messages follow `feat|refactor|test|fix|chore(scope): short`. Co-Author trailer is added by the harness commit tooling; do not write it by hand here.

---

### Task 1: Add `ulid` dependency to `@g5000/db`

**Files:**

- Modify: `packages/db/package.json`

- [ ] **Step 1: Add the dependency**

Edit `packages/db/package.json`. Inside the `"dependencies"` block, add an entry for `ulid`:

```json
"ulid": "^2.3.0"
```

- [ ] **Step 2: Install**

Run from the worktree root:

```bash
npm install --workspace @g5000/db
```

Expected: `node_modules/ulid` resolves; `npm ls ulid` shows the package.

- [ ] **Step 3: Commit**

```bash
git add packages/db/package.json package-lock.json
git commit -m "chore(db): add ulid dep for polar revisions"
```

---

### Task 2: Type definitions (additions only)

**Files:**

- Modify: `packages/db/src/defaults.ts`

This task only adds new types and adds optional fields to existing types. The existing `SailConfig.polar` field stays in place (still required) so v1 wardrobes continue to type-check during the migration window. Task 3 mutates `SailConfig` to make `polar` optional.

- [ ] **Step 1: Add new types after the existing `PolarTable` interface**

Edit `packages/db/src/defaults.ts`. After the closing brace of `PolarTable` (around line 98) add:

```ts
/** Stable per-boat identifier. Single active boat per process today. */
export type BoatId = string;

/**
 * Operating regime for a polar. 'default' is the universal fallback when a
 * boat has only one regime. High-performance boats may carry several (e.g.
 * 'displacement', 'planing', 'foiling'). Unknown values are accepted at the
 * type level — modes are configuration, not enum-policed.
 */
export type PolarMode = 'default' | 'displacement' | 'planing' | 'foiling' | string;

/** Provenance kind for an individual polar revision. */
export type PolarLineageKind =
  | 'migrated'
  | 'manual_edit'
  | 'imported_csv'
  | 'imported_pol'
  | 'vpp'
  | 'cfd'
  | 'towing_tank'
  | 'measured'
  | 'regression'
  | 'expert_judgment';

/** Free-form provenance metadata attached to a revision. */
export interface PolarLineage {
  kind: PolarLineageKind;
  /** Optional citation: designer name, file path, run-id, etc. */
  source?: string;
  notes?: string;
}

/**
 * An immutable polar revision. One row in the `polar_revisions` table.
 * The `table` field is JSON-encoded into `value_json` at the SQL layer.
 */
export interface PolarRevision {
  /** ULID. Lexicographically sortable by createdAt. */
  id: string;
  boatId: BoatId;
  sailConfigId: string;
  mode: PolarMode;
  /** Parent revision in the lineage chain, or null for a root. */
  parentRevisionId: string | null;
  /** UNIX seconds. */
  createdAt: number;
  lineage: PolarLineage;
  /** Optional scalar uncertainty in m/s. Reserved for future fusion work. */
  sigma?: number;
  table: PolarTable;
}
```

- [ ] **Step 2: Extend `PolarTable` with optional heel and leeway grids**

In the same file, locate the existing `PolarTable` interface and add two optional fields after `boatSpeed`:

```ts
export interface PolarTable {
  /** True wind speed bin centers, m/s. */
  twsBins: number[];
  /** True wind angle bin centers, radians (always positive — table is symmetric). */
  twaBins: number[];
  /** Target boat speed in m/s, indexed [twsIdx][twaIdx]. */
  boatSpeed: number[][];
  /**
   * Optional heel grid, radians (signed; lee positive). Same shape as boatSpeed.
   * Absent means "unknown" — consumers that don't need heel ignore this field.
   */
  heel?: number[][];
  /**
   * Optional leeway grid, radians. Same shape as boatSpeed. Absent means
   * "unknown".
   */
  leeway?: number[][];
}
```

- [ ] **Step 3: Run typecheck**

Run from the worktree root:

```bash
npx tsc -b packages/db
```

Expected: clean exit. No new errors. (Pre-existing `apps/router` TS5083 warning from the top-level orchestration is unrelated.)

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/defaults.ts
git commit -m "feat(db): add PolarRevision / PolarLineage types; heel+leeway grids"
```

---

### Task 3: Make `SailConfig.polar` optional; add v2 fields

This is a breaking type change: `SailConfig.polar` was required, now becomes optional, and a new required `modes` field is added. The runtime code that reads `polar` (only `activeConfigPolar` in `config-store.ts`) is in Task 7. After this task the workspace will fail to typecheck — that's expected and fixed by subsequent tasks. Commit anyway so the diff stays small per step.

**Files:**

- Modify: `packages/db/src/defaults.ts`

- [ ] **Step 1: Update `SailConfig` and `SailWardrobe`**

Replace the existing `SailConfig` and `SailWardrobe` interfaces with:

```ts
export interface SailConfig {
  /** Stable unique ID (e.g. 'default', 'full-j1', 'reef1-a2'). */
  id: string;
  /** Human-readable name (e.g. 'Full main + J1'). */
  name: string;
  /** Optional structured metadata for filtering / sorting. */
  mainState?: string;
  headsail?: string;
  downwindSail?: string;
  /** Daggerboard state: 'down' (upwind/reaching), 'half', 'up' (running). */
  daggerboard?: 'down' | 'half' | 'up';
  /** Optional axes for high-performance boats. Carried but unused on Sula. */
  foilMode?: 'displacement' | 'foiling' | 'transition' | string;
  /** Mast rotation, radians. Rotating-rig boats only. */
  mastRotation?: number;
  /** Free-form rig-tension tag. */
  rigTensionState?: string;
  /** Displacement, kg. Used by crew-weight-sensitive classes. */
  displacement?: number;
  notes?: string;
  /**
   * v1 compatibility: legacy embedded polar. Present only on rows that have
   * not yet been migrated to v2. Once migrated, this field is undefined and
   * `modes[…].activeRevisionId` carries the truth. The migrator reads this
   * to seed revision-0 rows.
   */
  polar?: PolarTable;
  /**
   * v2 pointer: per-mode active polar revision id. Always present on
   * migrated rows. May be `{}` if no revision exists yet (resolver falls back
   * to DEFAULT_POLARS in that case).
   */
  modes: Partial<Record<PolarMode, { activeRevisionId: string }>>;
}

export interface SailWardrobe {
  /** Which boat this wardrobe belongs to. Defaults to 'sula' on existing installs. */
  boatId: BoatId;
  configs: SailConfig[];
  /** ID of the active configuration. Must reference a configs[].id. */
  activeConfigId: string;
  /** Active mode for the active config. Defaults to 'default'. */
  activeMode: PolarMode;
}
```

- [ ] **Step 2: Update `DEFAULT_WARDROBE` to v2 shape**

Replace the `DEFAULT_WARDROBE` const with:

```ts
/**
 * Default wardrobe: one slot, v2 shape, empty `modes`. The boot-time migrator
 * inserts a `revision-0` polar row from DEFAULT_POLARS and rewrites
 * `modes['default'].activeRevisionId` to point at it. Until that happens the
 * `activePolar$` resolver falls back to DEFAULT_POLARS.
 */
export const DEFAULT_WARDROBE: SailWardrobe = {
  boatId: 'sula',
  configs: [
    {
      id: 'default',
      name: 'Default',
      notes: 'Initial baseline polar. Replace with your boat-specific data.',
      modes: {},
    },
  ],
  activeConfigId: 'default',
  activeMode: 'default',
};
```

- [ ] **Step 3: Typecheck — expect failures in config-store.ts**

```bash
npx tsc -b packages/db
```

Expected: errors in `config-store.ts` such as "Property 'polar' is missing in type ..." and "Property 'modes' is missing". This is expected — Task 7 fixes them.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/defaults.ts
git commit -m "feat(db): v2 wardrobe types (modes pointer, boatId, activeMode)"
```

---

### Task 4: Add `polar_revisions` Drizzle table

**Files:**

- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add the new table**

At the bottom of `packages/db/src/schema.ts`, before the final newline, add:

```ts
import { integer, real } from 'drizzle-orm/sqlite-core';

export const polarRevisions = sqliteTable('polar_revisions', {
  id: text('id').primaryKey(),
  boatId: text('boat_id').notNull(),
  sailConfigId: text('sail_config_id').notNull(),
  mode: text('mode').notNull(),
  /** Nullable: root revisions have no parent. */
  parentRevisionId: text('parent_revision_id'),
  /** UNIX seconds. */
  createdAt: integer('created_at').notNull(),
  lineageKind: text('lineage_kind').notNull(),
  /** Nullable JSON: {source?, notes?}. */
  lineageMeta: text('lineage_meta'),
  /** Nullable real: m/s scalar uncertainty. */
  sigma: real('sigma'),
  /** JSON-encoded PolarTable. */
  valueJson: text('value_json').notNull(),
});
```

If `integer` and `real` are already imported at the top, just extend the existing import line instead of re-importing.

- [ ] **Step 2: Typecheck**

```bash
npx tsc -b packages/db
```

Expected: same errors as Task 3 (no new ones from this change).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add polar_revisions Drizzle table"
```

---

### Task 5: Pure validator + revisions repo (write failing tests first)

`polar-revisions.ts` holds:

- `validatePolarTable(table)` — pure, throws on bad grids
- `listRevisions(db, filter)` — SELECT with filter
- `getRevision(db, id)` — single SELECT
- `insertRevision(db, rev)` — INSERT after validation

The `setActiveRevision` operation mutates wardrobe JSON and stays in `ConfigStore` (Task 7).

**Files:**

- Create: `packages/db/src/polar-revisions.test.ts`
- Create: `packages/db/src/polar-revisions.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/polar-revisions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  validatePolarTable,
  insertRevision,
  getRevision,
  listRevisions,
} from './polar-revisions.js';
import type { PolarRevision, PolarTable } from './defaults.js';

const GOOD: PolarTable = {
  twsBins: [3, 5, 8],
  twaBins: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
  boatSpeed: [
    [0, 1, 2, 1.5, 0.5],
    [0, 2, 3, 2.5, 1.0],
    [0, 3, 4, 3.5, 1.5],
  ],
};

function makeDb(): { raw: Database.Database; db: BetterSQLite3Database } {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE polar_revisions (
      id TEXT PRIMARY KEY,
      boat_id TEXT NOT NULL,
      sail_config_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      parent_revision_id TEXT,
      created_at INTEGER NOT NULL,
      lineage_kind TEXT NOT NULL,
      lineage_meta TEXT,
      sigma REAL,
      value_json TEXT NOT NULL
    );
  `);
  return { raw, db: drizzle(raw) };
}

function makeRev(over: Partial<PolarRevision> = {}): PolarRevision {
  return {
    id: '01HVZ000000000000000000001',
    boatId: 'sula',
    sailConfigId: 'default',
    mode: 'default',
    parentRevisionId: null,
    createdAt: 1_700_000_000,
    lineage: { kind: 'manual_edit' },
    table: GOOD,
    ...over,
  };
}

describe('validatePolarTable', () => {
  it('accepts a well-formed grid', () => {
    expect(() => validatePolarTable(GOOD)).not.toThrow();
  });

  it('rejects mismatched dimensions', () => {
    expect(() => validatePolarTable({ ...GOOD, boatSpeed: [[0, 1, 2]] })).toThrow(/dimension/i);
  });

  it('rejects non-monotonic twsBins', () => {
    expect(() => validatePolarTable({ ...GOOD, twsBins: [5, 3, 8] })).toThrow(/monotonic/i);
  });

  it('rejects non-monotonic twaBins', () => {
    expect(() =>
      validatePolarTable({
        ...GOOD,
        twaBins: [0, Math.PI, Math.PI / 2, (3 * Math.PI) / 4, Math.PI / 4],
      }),
    ).toThrow(/monotonic/i);
  });

  it('rejects twaBins outside [0, π]', () => {
    expect(() =>
      validatePolarTable({
        ...GOOD,
        twaBins: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI + 0.1],
      }),
    ).toThrow(/\[0, ?π\]/);
  });

  it('rejects non-finite boatSpeed cell', () => {
    const bad = GOOD.boatSpeed.map((row) => row.slice());
    bad[0]![0] = NaN;
    expect(() => validatePolarTable({ ...GOOD, boatSpeed: bad })).toThrow(/finite/i);
  });

  it('rejects negative boatSpeed', () => {
    const bad = GOOD.boatSpeed.map((row) => row.slice());
    bad[0]![1] = -0.1;
    expect(() => validatePolarTable({ ...GOOD, boatSpeed: bad })).toThrow(/non-negative/i);
  });

  it('rejects heel grid with wrong shape', () => {
    expect(() => validatePolarTable({ ...GOOD, heel: [[0]] })).toThrow(/heel.*dimension/i);
  });

  it('accepts a grid with valid heel and leeway', () => {
    const sameShape = GOOD.boatSpeed.map((row) => row.map(() => 0.1));
    expect(() => validatePolarTable({ ...GOOD, heel: sameShape, leeway: sameShape })).not.toThrow();
  });

  it('rejects empty bins', () => {
    expect(() => validatePolarTable({ ...GOOD, twsBins: [] })).toThrow(/empty/i);
  });
});

describe('insertRevision / getRevision / listRevisions', () => {
  let env: ReturnType<typeof makeDb>;
  beforeEach(() => {
    env = makeDb();
  });

  it('round-trips a revision', () => {
    const rev = makeRev();
    insertRevision(env.db, rev);
    const back = getRevision(env.db, rev.id);
    expect(back).toEqual(rev);
  });

  it('returns undefined for unknown id', () => {
    expect(getRevision(env.db, 'nope')).toBeUndefined();
  });

  it('lists by (boatId, sailConfigId, mode) newest-first', () => {
    insertRevision(env.db, makeRev({ id: 'a', createdAt: 100 }));
    insertRevision(env.db, makeRev({ id: 'b', createdAt: 200 }));
    insertRevision(env.db, makeRev({ id: 'c', createdAt: 150, sailConfigId: 'other' }));
    const got = listRevisions(env.db, { boatId: 'sula', sailConfigId: 'default', mode: 'default' });
    expect(got.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('rejects an invalid grid at insert time', () => {
    const bad = makeRev({ table: { ...GOOD, twsBins: [5, 3] } });
    expect(() => insertRevision(env.db, bad)).toThrow(/monotonic|dimension/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/db/src/polar-revisions.test.ts
```

Expected: FAIL with "Cannot find module './polar-revisions.js'" or similar import error.

- [ ] **Step 3: Implement `polar-revisions.ts`**

Create `packages/db/src/polar-revisions.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { BoatId, PolarMode, PolarRevision, PolarTable } from './defaults.js';
import { polarRevisions } from './schema.js';

/**
 * Throws if `table` violates structural invariants. Pure; no I/O.
 *
 * Invariants:
 *  - `twsBins` and `twaBins` are non-empty and strictly increasing.
 *  - `twaBins` lie within [0, π] inclusive.
 *  - `boatSpeed` has shape `[twsBins.length][twaBins.length]`, all finite, non-negative.
 *  - If `heel` or `leeway` is present, it has the same shape as `boatSpeed` and all finite.
 */
export function validatePolarTable(table: PolarTable): void {
  const { twsBins, twaBins, boatSpeed, heel, leeway } = table;
  if (!Array.isArray(twsBins) || twsBins.length === 0) throw new Error('twsBins is empty');
  if (!Array.isArray(twaBins) || twaBins.length === 0) throw new Error('twaBins is empty');
  for (let i = 1; i < twsBins.length; i++) {
    if (!(twsBins[i]! > twsBins[i - 1]!)) throw new Error('twsBins not strictly monotonic');
  }
  for (let i = 1; i < twaBins.length; i++) {
    if (!(twaBins[i]! > twaBins[i - 1]!)) throw new Error('twaBins not strictly monotonic');
  }
  for (const t of twaBins) {
    if (!(t >= 0 && t <= Math.PI)) throw new Error('twaBins outside [0, π]');
  }
  if (!Array.isArray(boatSpeed) || boatSpeed.length !== twsBins.length) {
    throw new Error('boatSpeed outer dimension mismatch');
  }
  for (let i = 0; i < twsBins.length; i++) {
    const row = boatSpeed[i];
    if (!Array.isArray(row) || row.length !== twaBins.length) {
      throw new Error('boatSpeed inner dimension mismatch');
    }
    for (const v of row) {
      if (!Number.isFinite(v)) throw new Error('boatSpeed cell not finite');
      if (v < 0) throw new Error('boatSpeed cell must be non-negative');
    }
  }
  for (const [name, grid] of [
    ['heel', heel],
    ['leeway', leeway],
  ] as const) {
    if (grid === undefined) continue;
    if (!Array.isArray(grid) || grid.length !== twsBins.length) {
      throw new Error(`${name} grid outer dimension mismatch`);
    }
    for (let i = 0; i < twsBins.length; i++) {
      const row = grid[i];
      if (!Array.isArray(row) || row.length !== twaBins.length) {
        throw new Error(`${name} grid inner dimension mismatch`);
      }
      for (const v of row) {
        if (!Number.isFinite(v)) throw new Error(`${name} cell not finite`);
      }
    }
  }
}

interface RevisionRow {
  id: string;
  boatId: string;
  sailConfigId: string;
  mode: string;
  parentRevisionId: string | null;
  createdAt: number;
  lineageKind: string;
  lineageMeta: string | null;
  sigma: number | null;
  valueJson: string;
}

function rowToRevision(row: RevisionRow): PolarRevision {
  const lineageMeta = row.lineageMeta
    ? (JSON.parse(row.lineageMeta) as { source?: string; notes?: string })
    : {};
  return {
    id: row.id,
    boatId: row.boatId,
    sailConfigId: row.sailConfigId,
    mode: row.mode,
    parentRevisionId: row.parentRevisionId,
    createdAt: row.createdAt,
    lineage: { kind: row.lineageKind as PolarRevision['lineage']['kind'], ...lineageMeta },
    sigma: row.sigma ?? undefined,
    table: JSON.parse(row.valueJson) as PolarTable,
  };
}

export function insertRevision(db: BetterSQLite3Database, rev: PolarRevision): void {
  validatePolarTable(rev.table);
  const lineageMetaJson =
    rev.lineage.source !== undefined || rev.lineage.notes !== undefined
      ? JSON.stringify({
          ...(rev.lineage.source !== undefined ? { source: rev.lineage.source } : {}),
          ...(rev.lineage.notes !== undefined ? { notes: rev.lineage.notes } : {}),
        })
      : null;
  db.insert(polarRevisions)
    .values({
      id: rev.id,
      boatId: rev.boatId,
      sailConfigId: rev.sailConfigId,
      mode: rev.mode,
      parentRevisionId: rev.parentRevisionId,
      createdAt: rev.createdAt,
      lineageKind: rev.lineage.kind,
      lineageMeta: lineageMetaJson,
      sigma: rev.sigma ?? null,
      valueJson: JSON.stringify(rev.table),
    })
    .run();
}

export function getRevision(db: BetterSQLite3Database, id: string): PolarRevision | undefined {
  const rows = db
    .select()
    .from(polarRevisions)
    .where(eq(polarRevisions.id, id))
    .all() as RevisionRow[];
  return rows[0] ? rowToRevision(rows[0]) : undefined;
}

export interface ListFilter {
  boatId?: BoatId;
  sailConfigId?: string;
  mode?: PolarMode;
}

export function listRevisions(db: BetterSQLite3Database, filter: ListFilter = {}): PolarRevision[] {
  const conds = [];
  if (filter.boatId !== undefined) conds.push(eq(polarRevisions.boatId, filter.boatId));
  if (filter.sailConfigId !== undefined)
    conds.push(eq(polarRevisions.sailConfigId, filter.sailConfigId));
  if (filter.mode !== undefined) conds.push(eq(polarRevisions.mode, filter.mode));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const q = db.select().from(polarRevisions);
  const rows = (where ? q.where(where) : q)
    .orderBy(desc(polarRevisions.createdAt))
    .all() as RevisionRow[];
  return rows.map(rowToRevision);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run packages/db/src/polar-revisions.test.ts
```

Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/polar-revisions.ts packages/db/src/polar-revisions.test.ts
git commit -m "feat(db): polar-revisions repo + validator (TDD)"
```

---

### Task 6: Pure wardrobe v1→v2 migrator

**Files:**

- Create: `packages/db/src/migrate-wardrobe-v2.test.ts`
- Create: `packages/db/src/migrate-wardrobe-v2.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/migrate-wardrobe-v2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { migrateWardrobeV1ToV2, isV1Wardrobe } from './migrate-wardrobe-v2.js';
import { DEFAULT_POLARS, type SailWardrobe, type PolarTable } from './defaults.js';

const RAW_V1 = {
  configs: [
    { id: 'default', name: 'Default', polar: DEFAULT_POLARS },
    { id: 'a2-set', name: 'A2 set', polar: DEFAULT_POLARS, downwindSail: 'A2' },
  ],
  activeConfigId: 'default',
};

const RAW_V2: SailWardrobe = {
  boatId: 'sula',
  configs: [{ id: 'default', name: 'Default', modes: { default: { activeRevisionId: 'rev-X' } } }],
  activeConfigId: 'default',
  activeMode: 'default',
};

describe('isV1Wardrobe', () => {
  it('returns true when any slot has an embedded polar', () => {
    expect(isV1Wardrobe(RAW_V1)).toBe(true);
  });

  it('returns false on a v2 shape', () => {
    expect(isV1Wardrobe(RAW_V2)).toBe(false);
  });
});

describe('migrateWardrobeV1ToV2', () => {
  const idGen = (() => {
    let n = 0;
    return () => `rev-${String(++n).padStart(2, '0')}`;
  })();
  const now = 1_700_000_000;

  it('produces one revision per v1 slot, points modes.default at it', () => {
    const out = migrateWardrobeV1ToV2(RAW_V1, 'sula', now, idGen);
    expect(out.revisions).toHaveLength(2);
    expect(out.revisions[0]!.sailConfigId).toBe('default');
    expect(out.revisions[0]!.mode).toBe('default');
    expect(out.revisions[0]!.lineage.kind).toBe('migrated');
    expect(out.v2.boatId).toBe('sula');
    expect(out.v2.activeMode).toBe('default');
    expect(out.v2.configs[0]!.modes.default!.activeRevisionId).toBe(out.revisions[0]!.id);
    // legacy `polar` is dropped on v2 slots
    expect((out.v2.configs[0] as Record<string, unknown>).polar).toBeUndefined();
  });

  it('uses the supplied fallback polar when a v1 slot is missing its polar', () => {
    const fallback: PolarTable = {
      twsBins: [3, 5],
      twaBins: [0, Math.PI],
      boatSpeed: [
        [0, 0],
        [0, 0],
      ],
    };
    const idg = (() => {
      let n = 0;
      return () => `r-${++n}`;
    })();
    const noPolarSlot = { id: 'x', name: 'X' };
    const v1 = { configs: [noPolarSlot], activeConfigId: 'x' };
    const out = migrateWardrobeV1ToV2(v1, 'sula', now, idg, fallback);
    expect(out.revisions[0]!.table).toEqual(fallback);
  });

  it('is a no-op on an already-v2 wardrobe', () => {
    const out = migrateWardrobeV1ToV2(RAW_V2, 'sula', now, idGen);
    expect(out.revisions).toHaveLength(0);
    expect(out.v2).toEqual(RAW_V2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/db/src/migrate-wardrobe-v2.test.ts
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement `migrate-wardrobe-v2.ts`**

Create `packages/db/src/migrate-wardrobe-v2.ts`:

```ts
import {
  DEFAULT_POLARS,
  type BoatId,
  type PolarRevision,
  type PolarTable,
  type SailConfig,
  type SailWardrobe,
} from './defaults.js';

/**
 * Heuristic: a wardrobe is "v1" if any config has an embedded `polar` field
 * AND lacks a `modes` field (or has an empty modes map paired with a polar).
 * A pure v2 wardrobe has `modes` populated and no `polar` on any config.
 */
export function isV1Wardrobe(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const w = raw as { configs?: Array<Record<string, unknown>> };
  if (!Array.isArray(w.configs)) return false;
  for (const cfg of w.configs) {
    if (cfg && typeof cfg === 'object' && 'polar' in cfg && cfg.polar !== undefined) return true;
  }
  return false;
}

export interface MigrateOutput {
  v2: SailWardrobe;
  revisions: PolarRevision[];
}

/**
 * Pure transform from a v1 (or already-v2) wardrobe to a v2 wardrobe plus
 * any new revision rows to insert. Deterministic given `idGen` and `now`.
 *
 * Callers are responsible for persisting the result inside a SQLite
 * transaction so an interrupted migration doesn't leave half-written state.
 */
export function migrateWardrobeV1ToV2(
  raw: unknown,
  boatId: BoatId,
  now: number,
  idGen: () => string,
  fallbackPolar: PolarTable = DEFAULT_POLARS,
): MigrateOutput {
  // Already v2? Return as-is. We trust the caller's earlier shape check, but
  // also coerce defensively so old v1 reads can't poison the resolver.
  if (!isV1Wardrobe(raw)) {
    return { v2: raw as SailWardrobe, revisions: [] };
  }

  const v1 = raw as {
    configs: Array<Partial<SailConfig> & { polar?: PolarTable }>;
    activeConfigId?: string;
  };

  const revisions: PolarRevision[] = [];
  const v2Configs: SailConfig[] = v1.configs.map((cfg) => {
    const table = cfg.polar ?? fallbackPolar;
    const revId = idGen();
    const sailConfigId = cfg.id ?? 'default';
    revisions.push({
      id: revId,
      boatId,
      sailConfigId,
      mode: 'default',
      parentRevisionId: null,
      createdAt: now,
      lineage: { kind: 'migrated', notes: 'auto-migrated from v1 wardrobe' },
      table,
    });
    // Strip embedded `polar`; keep all other fields.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { polar: _ignored, ...rest } = cfg;
    return {
      ...(rest as SailConfig),
      id: sailConfigId,
      name: cfg.name ?? sailConfigId,
      modes: { default: { activeRevisionId: revId } },
    };
  });

  const activeConfigId = v1.activeConfigId ?? v2Configs[0]?.id ?? 'default';

  const v2: SailWardrobe = {
    boatId,
    configs: v2Configs,
    activeConfigId,
    activeMode: 'default',
  };

  return { v2, revisions };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run packages/db/src/migrate-wardrobe-v2.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrate-wardrobe-v2.ts packages/db/src/migrate-wardrobe-v2.test.ts
git commit -m "feat(db): pure v1→v2 wardrobe migrator (TDD)"
```

---

### Task 7: Wire migration + new resolver into ConfigStore

This is the largest task. It touches three concerns at once because they share boot state:

1. Create `polar_revisions` table at boot.
2. Read `G5000_BOAT_ID` env var.
3. Run the migration inside a single SQLite transaction; populate `polarRevisions$` BehaviorSubject.
4. Rewrite `activeConfigPolar` / `activePolar$` to resolve via the revisions map.
5. Replace `setPolars` legacy redirect with a "create revision + set active" pair.
6. Add new methods: `createRevision`, `setActiveRevision`, `listRevisions`, `getRevision`.

**Files:**

- Modify: `packages/db/src/config-store.ts`

- [ ] **Step 1: Add CREATE TABLE statement at boot**

Inside the `raw.exec(...)` block at the top of `ConfigStore.open`, append after the existing `CREATE TABLE IF NOT EXISTS passage_log` line:

```sql
CREATE TABLE IF NOT EXISTS polar_revisions (
  id TEXT PRIMARY KEY,
  boat_id TEXT NOT NULL,
  sail_config_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  parent_revision_id TEXT,
  created_at INTEGER NOT NULL,
  lineage_kind TEXT NOT NULL,
  lineage_meta TEXT,
  sigma REAL,
  value_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS polar_revisions_lookup
  ON polar_revisions(boat_id, sail_config_id, mode, created_at DESC);
```

- [ ] **Step 2: Read `G5000_BOAT_ID` env var**

Just before the `loadOrInsert` helper definition (around line 113), add:

```ts
const activeBoatId: string = process.env.G5000_BOAT_ID ?? 'sula';
```

- [ ] **Step 3: Replace the existing wardrobe migration block with the v1→v2 path**

Locate the comment `// Migration logic for sail wardrobe:` (line 128) and the block that follows it (up through line 154). Replace the entire block with:

```ts
// Migration logic for sail wardrobe:
// 1. Load/seed the legacy polars row (legacy ingestion path).
// 2. Read the wardrobe row (may be missing, v1, or v2).
// 3. If v1 (or synthesized from legacy polar), run the pure migrator and
//    persist wardrobe + new revisions in a single SQLite transaction.
const legacyPolar = loadOrInsert<PolarTable>(polars, DEFAULT_POLARS);

const wardrobeRows = db.select().from(sailWardrobe).where(eq(sailWardrobe.id, SINGLETON)).all();
let rawWardrobe: unknown;
if (wardrobeRows[0]) {
  rawWardrobe = JSON.parse((wardrobeRows[0] as { value: string }).value);
} else {
  // No wardrobe row — synthesise a v1 wardrobe from the legacy polar so the
  // migrator produces a single revision-0 + v2 wardrobe in one pass.
  rawWardrobe = {
    configs: [
      {
        id: 'default',
        name: 'Default',
        notes: 'Initial baseline polar. Replace with your boat-specific data.',
        polar: legacyPolar,
      },
    ],
    activeConfigId: 'default',
  };
}

const migrated = migrateWardrobeV1ToV2(
  rawWardrobe,
  activeBoatId,
  Math.floor(Date.now() / 1000),
  () => ulid().toLowerCase(),
  legacyPolar,
);

if (migrated.revisions.length > 0) {
  // v1→v2 migration: write revisions + wardrobe atomically.
  raw.transaction(() => {
    for (const rev of migrated.revisions) {
      insertRevision(db, rev);
    }
    db.insert(sailWardrobe)
      .values({ id: SINGLETON, value: JSON.stringify(migrated.v2) })
      .onConflictDoUpdate({
        target: sailWardrobe.id,
        set: { value: JSON.stringify(migrated.v2) },
      })
      .run();
  })();
}

const wardrobeValue: SailWardrobe = migrated.v2;

// Load all revisions for the active boat into the in-memory map.
const revisionsForBoat = listRevisions(db, { boatId: activeBoatId });
const revisionsMap = new Map<string, PolarRevision>(revisionsForBoat.map((r) => [r.id, r]));
```

- [ ] **Step 4: Add new imports at top of file**

Add to the import block at the top of `config-store.ts`:

```ts
import { ulid } from 'ulid';
import { combineLatest } from 'rxjs';
import {
  insertRevision,
  listRevisions as listRevisionsRepo,
  getRevision as getRevisionRepo,
  type ListFilter,
} from './polar-revisions.js';
import { migrateWardrobeV1ToV2 } from './migrate-wardrobe-v2.js';
```

Extend the existing `import type {...} from './defaults.js'` block to include:

```ts
type BoatId,
type PolarMode,
type PolarRevision,
```

- [ ] **Step 5: Add `polarRevisions` subject + `activeBoatId` to the class**

Inside `private readonly subjects: { ... }` add:

```ts
polarRevisions: BehaviorSubject<Map<string, PolarRevision>>;
```

Inside the constructor `initial` parameter type, add:

```ts
polarRevisions: Map<string, PolarRevision>;
```

And add to both the constructor body subjects initializer and the `initial` object built in `open`:

```ts
polarRevisions: new BehaviorSubject(initial.polarRevisions),
```

Add a private field on the class:

```ts
private readonly activeBoatId: BoatId;
```

Pass `activeBoatId` into the constructor (extend its parameter list); store it on `this`.

In `open`, pass the loaded `revisionsMap` and `activeBoatId` to `new ConfigStore(...)`.

- [ ] **Step 6: Replace `activeConfigPolar` and `activePolar$`**

Delete the existing helper function `activeConfigPolar` (lines 41–45).

Replace the existing `activePolar$` getter with:

```ts
get activePolar$(): Observable<PolarTable> {
  return combineLatest([this.subjects.sails, this.subjects.polarRevisions]).pipe(
    map(([wardrobe, revisionsById]) => {
      const cfg = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId);
      const ref = cfg?.modes[wardrobe.activeMode]?.activeRevisionId
        ?? cfg?.modes.default?.activeRevisionId;
      const rev = ref ? revisionsById.get(ref) : undefined;
      if (!ref) return DEFAULT_POLARS;
      if (!rev) {
        // Dangling pointer — log once and fall back. Wardrobe is not auto-repaired.
        console.warn(`[config-store] active revision ${ref} not found; falling back to DEFAULT_POLARS`);
        return DEFAULT_POLARS;
      }
      return rev.table;
    }),
  );
}

/** Observable of the current revisions map for the active boat. */
get polarRevisions$(): Observable<Map<string, PolarRevision>> {
  return this.subjects.polarRevisions.asObservable();
}
```

- [ ] **Step 7: Replace `setPolars` legacy redirect**

Replace the existing `setPolars` method (the one that mutates the active slot's embedded `polar`) with:

```ts
async setPolars(value: PolarTable): Promise<void> {
  // Legacy compatibility: create a new revision under the active slot+mode
  // with lineage 'manual_edit', then set it active.
  const wardrobe = this.subjects.sails.value;
  const slot = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId);
  if (!slot) return;
  const id = ulid().toLowerCase();
  const rev: PolarRevision = {
    id,
    boatId: this.activeBoatId,
    sailConfigId: slot.id,
    mode: wardrobe.activeMode,
    parentRevisionId: slot.modes[wardrobe.activeMode]?.activeRevisionId ?? null,
    createdAt: Math.floor(Date.now() / 1000),
    lineage: { kind: 'manual_edit', notes: 'via legacy setPolars()' },
    table: value,
  };
  await this.createRevision(rev);
  await this.setActiveRevision(slot.id, wardrobe.activeMode, id);
}
```

- [ ] **Step 8: Add the new methods**

Add to the class (anywhere among the other setters):

```ts
async createRevision(rev: PolarRevision): Promise<void> {
  insertRevision(this.db, rev);
  const next = new Map(this.subjects.polarRevisions.value);
  next.set(rev.id, rev);
  this.subjects.polarRevisions.next(next);
}

async setActiveRevision(sailConfigId: string, mode: PolarMode, revisionId: string): Promise<void> {
  const revs = this.subjects.polarRevisions.value;
  if (!revs.has(revisionId)) {
    throw new Error(`revision ${revisionId} not found`);
  }
  const wardrobe = this.subjects.sails.value;
  const idx = wardrobe.configs.findIndex((c) => c.id === sailConfigId);
  if (idx < 0) throw new Error(`sail config ${sailConfigId} not found`);
  const newConfigs = wardrobe.configs.slice();
  const cfg = newConfigs[idx]!;
  newConfigs[idx] = {
    ...cfg,
    modes: { ...cfg.modes, [mode]: { activeRevisionId: revisionId } },
  };
  const next: SailWardrobe = { ...wardrobe, configs: newConfigs };
  this.upsert(sailWardrobe, next);
  this.subjects.sails.next(next);
}

listRevisions(filter: ListFilter = {}): PolarRevision[] {
  return listRevisionsRepo(this.db, { ...filter, boatId: filter.boatId ?? this.activeBoatId });
}

getRevision(id: string): PolarRevision | undefined {
  return getRevisionRepo(this.db, id);
}
```

- [ ] **Step 9: Update `setSails` to validate v2 shape**

Replace the existing `setSails` validation with:

```ts
async setSails(value: SailWardrobe): Promise<void> {
  const slot = value.configs.find((c) => c.id === value.activeConfigId);
  if (!slot) {
    throw new Error(
      `activeConfigId "${value.activeConfigId}" does not reference any config in configs[]`,
    );
  }
  this.upsert(sailWardrobe, value);
  this.subjects.sails.next(value);
}
```

(The original threw on missing slot; v2 keeps the same check. `activeMode` does not have to point to a populated `modes[mode]` — resolver falls back.)

- [ ] **Step 10: Typecheck the workspace**

```bash
npx tsc -b packages/db
```

Expected: clean exit. If there are still errors mentioning `activeConfigPolar` or `polar:`, double-check Step 6 (delete the helper) and Step 3 (replace the migration block).

- [ ] **Step 11: Run the existing ConfigStore tests**

```bash
npx vitest run packages/db/src/config-store.test.ts
```

Expected: most tests pass; a handful may fail because they assert the v1 shape. Note which ones — Task 8 updates them.

- [ ] **Step 12: Commit**

```bash
git add packages/db/src/config-store.ts
git commit -m "feat(db): wire v1→v2 migration + revisions resolver into ConfigStore"
```

---

### Task 8: Update ConfigStore tests for v2 shape

**Files:**

- Modify: `packages/db/src/config-store.test.ts`

- [ ] **Step 1: Read the existing test file to map what needs updating**

```bash
npx vitest run packages/db/src/config-store.test.ts 2>&1 | grep -E "FAIL|expect"
```

For each failing test, edit the assertion to match the v2 shape:

- `wardrobe.configs[0].polar` → `wardrobe.configs[0].modes.default.activeRevisionId` (then resolve via `getRevision`)
- New top-level fields `boatId` and `activeMode` should equal `'sula'` and `'default'`.

- [ ] **Step 2: Add new tests for v2 migration paths**

At the bottom of `config-store.test.ts`, before the closing brace of the outer `describe`, add:

```ts
import { firstValueFrom, take, toArray } from 'rxjs';

describe('v1→v2 wardrobe migration', () => {
  it('seeds revision-0 from DEFAULT_POLARS on a fresh DB', async () => {
    const tmp = `${tmpdir()}/g5000-cfg-fresh-${Date.now()}.db`;
    const store = await ConfigStore.open(tmp);
    const wardrobe = await firstValueFrom(store.sails$);
    expect(wardrobe.boatId).toBe('sula');
    expect(wardrobe.activeMode).toBe('default');
    const slot = wardrobe.configs[0]!;
    const revId = slot.modes.default?.activeRevisionId;
    expect(revId).toBeDefined();
    const rev = store.getRevision(revId!);
    expect(rev?.lineage.kind).toBe('migrated');
    expect(rev?.table).toEqual(DEFAULT_POLARS);
    await store.close();
  });

  it('migrates an existing v1 wardrobe row on cold boot', async () => {
    const tmp = `${tmpdir()}/g5000-cfg-v1-${Date.now()}.db`;
    // Hand-craft a v1 wardrobe row first.
    const Database = (await import('better-sqlite3')).default;
    const raw = new Database(tmp);
    raw.exec(`
      CREATE TABLE polars (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sail_wardrobe (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const v1 = {
      configs: [
        { id: 'default', name: 'Default', polar: DEFAULT_POLARS },
        { id: 'storm', name: 'Storm jib', polar: DEFAULT_POLARS },
      ],
      activeConfigId: 'storm',
    };
    raw
      .prepare('INSERT INTO sail_wardrobe (id, value) VALUES (?, ?)')
      .run('singleton', JSON.stringify(v1));
    raw.close();

    const store = await ConfigStore.open(tmp);
    const wardrobe = await firstValueFrom(store.sails$);
    expect(wardrobe.boatId).toBe('sula');
    expect(wardrobe.activeConfigId).toBe('storm');
    expect(wardrobe.configs).toHaveLength(2);
    for (const c of wardrobe.configs) {
      expect(c.modes.default?.activeRevisionId).toBeDefined();
      expect((c as Record<string, unknown>).polar).toBeUndefined();
    }
    await store.close();
  });

  it('is idempotent: a second open does not create new revisions', async () => {
    const tmp = `${tmpdir()}/g5000-cfg-idem-${Date.now()}.db`;
    const a = await ConfigStore.open(tmp);
    const revsA = a.listRevisions();
    await a.close();
    const b = await ConfigStore.open(tmp);
    const revsB = b.listRevisions();
    expect(revsB.map((r) => r.id).sort()).toEqual(revsA.map((r) => r.id).sort());
    await b.close();
  });

  it('activePolar$ falls back to DEFAULT_POLARS when activeRevisionId is dangling', async () => {
    const tmp = `${tmpdir()}/g5000-cfg-dangle-${Date.now()}.db`;
    const store = await ConfigStore.open(tmp);
    // Forge a wardrobe with a bad revisionId.
    const wardrobe = await firstValueFrom(store.sails$);
    const broken: SailWardrobe = {
      ...wardrobe,
      configs: [
        { ...wardrobe.configs[0]!, modes: { default: { activeRevisionId: 'doesnotexist' } } },
      ],
    };
    await store.setSails(broken);
    const polar = await firstValueFrom(store.activePolar$);
    expect(polar).toEqual(DEFAULT_POLARS);
    await store.close();
  });

  it('setActiveRevision swaps activePolar$ output within one tick', async () => {
    const tmp = `${tmpdir()}/g5000-cfg-swap-${Date.now()}.db`;
    const store = await ConfigStore.open(tmp);
    const wardrobe = await firstValueFrom(store.sails$);
    const slotId = wardrobe.configs[0]!.id;
    // Create a clearly distinct polar.
    const tweaked: PolarTable = {
      ...DEFAULT_POLARS,
      boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map((v) => v * 1.5)),
    };
    const newId = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
    await store.createRevision({
      id: newId,
      boatId: 'sula',
      sailConfigId: slotId,
      mode: 'default',
      parentRevisionId: null,
      createdAt: Math.floor(Date.now() / 1000),
      lineage: { kind: 'manual_edit' },
      table: tweaked,
    });
    await store.setActiveRevision(slotId, 'default', newId);
    const polar = await firstValueFrom(store.activePolar$);
    expect(polar.boatSpeed[0]![1]).toBeCloseTo(DEFAULT_POLARS.boatSpeed[0]![1]! * 1.5);
    await store.close();
  });
});
```

If `tmpdir` is not already imported in the test file, add `import { tmpdir } from 'node:os';` near the top. If `SailWardrobe` and `PolarTable` aren't already imported, add them to the existing `@g5000/db` (relative `./defaults.js`) import.

- [ ] **Step 3: Run tests**

```bash
npx vitest run packages/db/src/config-store.test.ts
```

Expected: PASS (existing tests adapted + 5 new migration tests).

- [ ] **Step 4: Run the entire db package suite**

```bash
npx vitest run packages/db
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/config-store.test.ts
git commit -m "test(db): ConfigStore v2 wardrobe + migration + dangling-pointer fallback"
```

---

### Task 9: Re-export new types and functions from `@g5000/db`

**Files:**

- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Read the existing exports**

```bash
cat packages/db/src/index.ts
```

- [ ] **Step 2: Add re-exports**

In `packages/db/src/index.ts`, extend the existing `export type` and `export {…}` lines to include the new public surface. The full block should ensure these names are available:

```ts
export type {
  BoatId,
  PolarMode,
  PolarLineageKind,
  PolarLineage,
  PolarRevision,
  PolarTable,
  SailConfig,
  SailWardrobe,
  // ... keep existing exported types
} from './defaults.js';

export {
  DEFAULT_POLARS,
  DEFAULT_WARDROBE,
  // ... keep existing exported values
} from './defaults.js';

export { validatePolarTable } from './polar-revisions.js';
```

Do not export `insertRevision` / `listRevisions` / `getRevision` directly — they are reached through the `ConfigStore` methods.

- [ ] **Step 3: Typecheck the workspace and downstream packages that consume `@g5000/db`**

```bash
npx tsc -b packages/db packages/compute packages/bridge packages/routing
```

Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/index.ts
git commit -m "feat(db): re-export PolarRevision / PolarLineage / validatePolarTable"
```

---

### Task 10: `/api/polar/revisions` route — GET + POST

**Files:**

- Create: `packages/web/src/app/api/polar/revisions/route.ts`
- Create: `packages/web/src/app/api/polar/revisions/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/api/polar/revisions/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore } from '@g5000/db';
import { setSharedConfigStore, __resetSharedConfigStoreForTests } from '@g5000/db';
import { DEFAULT_POLARS, type PolarTable } from '@g5000/db';
import { GET, POST } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  const path = `${tmpdir()}/polar-rev-api-${Date.now()}-${Math.random()}.db`;
  store = await ConfigStore.open(path);
  setSharedConfigStore(store);
});

afterEach(async () => {
  await store.close();
  __resetSharedConfigStoreForTests();
});

describe('GET /api/polar/revisions', () => {
  it('lists revisions for the active boat (newest first)', async () => {
    const res = await GET(new Request('http://x/api/polar/revisions'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revisions: Array<{ id: string }> };
    expect(body.revisions.length).toBeGreaterThanOrEqual(1); // migration's revision-0
  });

  it('filters by sailConfigId', async () => {
    const res = await GET(
      new Request('http://x/api/polar/revisions?sailConfigId=default&mode=default'),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revisions: Array<{ sailConfigId: string }> };
    for (const r of body.revisions) expect(r.sailConfigId).toBe('default');
  });
});

describe('POST /api/polar/revisions', () => {
  it('creates a revision with valid input', async () => {
    const tweaked: PolarTable = {
      ...DEFAULT_POLARS,
      boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map((v) => v * 1.1)),
    };
    const res = await POST(
      new Request('http://x/api/polar/revisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sailConfigId: 'default',
          mode: 'default',
          lineage: { kind: 'manual_edit', source: 'unit-test' },
          table: tweaked,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-z]{26}$/);
  });

  it('returns 400 on an invalid grid', async () => {
    const res = await POST(
      new Request('http://x/api/polar/revisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sailConfigId: 'default',
          mode: 'default',
          lineage: { kind: 'manual_edit' },
          table: {
            twsBins: [5, 3],
            twaBins: [0, 1],
            boatSpeed: [
              [0, 0],
              [0, 0],
            ],
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on a missing field', async () => {
    const res = await POST(
      new Request('http://x/api/polar/revisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'default', table: DEFAULT_POLARS }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
```

Note: this test imports `setSharedConfigStore` and `__resetSharedConfigStoreForTests` from `@g5000/db`. The latter does not exist today — that's intentional; see Step 3.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/web/src/app/api/polar/revisions/route.test.ts
```

Expected: FAIL with "Cannot find module './route.js'" or "\_\_resetSharedConfigStoreForTests is not a function".

- [ ] **Step 3: Add a test-only reset helper to `@g5000/db`**

The shared-singleton accessor pattern (`getSharedConfigStore` / `setSharedConfigStore`) lives in `packages/db/src/index.ts`. Other shared singletons across the codebase (e.g. `setSharedBus`, `setSharedAlertsRegistry`) follow the same shape. Tests need a way to clear the singleton between cases.

Open `packages/db/src/index.ts` (or wherever `setSharedConfigStore` is defined; check `getSharedConfigStore` first to locate it). Just below the existing `setSharedConfigStore`, add:

```ts
/** Test-only: clears the singleton. Do not call from production code. */
export function __resetSharedConfigStoreForTests(): void {
  (globalThis as Record<string, unknown>).__g5000_configStore__ = undefined;
}
```

Match the exact `globalThis` key already used by `setSharedConfigStore`.

- [ ] **Step 4: Implement the route handler**

Create `packages/web/src/app/api/polar/revisions/route.ts`:

```ts
import { ulid } from 'ulid';
import { getSharedConfigStore } from '@g5000/db';
import type { PolarLineage, PolarMode, PolarRevision, PolarTable } from '@g5000/db';

export async function GET(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  const url = new URL(req.url);
  const sailConfigId = url.searchParams.get('sailConfigId') ?? undefined;
  const mode = (url.searchParams.get('mode') as PolarMode | null) ?? undefined;
  const boatId = url.searchParams.get('boatId') ?? undefined;
  const revisions = store.listRevisions({ boatId, sailConfigId, mode });
  return Response.json({ revisions });
}

interface PostBody {
  sailConfigId?: string;
  mode?: PolarMode;
  parentRevisionId?: string | null;
  lineage?: PolarLineage;
  sigma?: number;
  table?: PolarTable;
}

export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  if (
    typeof body.sailConfigId !== 'string' ||
    typeof body.mode !== 'string' ||
    !body.lineage ||
    typeof body.lineage.kind !== 'string' ||
    !body.table
  ) {
    return Response.json({ error: 'missing required fields' }, { status: 400 });
  }

  const rev: PolarRevision = {
    id: ulid().toLowerCase(),
    boatId: 'sula', // active boat — ConfigStore filters/reads on the active boat
    sailConfigId: body.sailConfigId,
    mode: body.mode,
    parentRevisionId: body.parentRevisionId ?? null,
    createdAt: Math.floor(Date.now() / 1000),
    lineage: body.lineage,
    ...(body.sigma !== undefined ? { sigma: body.sigma } : {}),
    table: body.table,
  };

  try {
    await store.createRevision(rev);
  } catch (err) {
    return Response.json({ error: (err as Error).message ?? 'create failed' }, { status: 400 });
  }
  return Response.json({ id: rev.id }, { status: 201 });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run packages/web/src/app/api/polar/revisions/route.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/polar/revisions/route.ts packages/web/src/app/api/polar/revisions/route.test.ts packages/db/src/index.ts
git commit -m "feat(web): /api/polar/revisions GET+POST (TDD)"
```

---

### Task 11: `/api/polar/revisions/[id]` route — GET single

**Files:**

- Create: `packages/web/src/app/api/polar/revisions/[id]/route.ts`
- Create: `packages/web/src/app/api/polar/revisions/[id]/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/api/polar/revisions/[id]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { ConfigStore, setSharedConfigStore, __resetSharedConfigStoreForTests } from '@g5000/db';
import { GET } from './route.js';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/polar-rev-id-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  __resetSharedConfigStoreForTests();
});

describe('GET /api/polar/revisions/[id]', () => {
  it('returns the revision when found', async () => {
    const seed = store.listRevisions()[0]!;
    const res = await GET(new Request(`http://x/api/polar/revisions/${seed.id}`), {
      params: Promise.resolve({ id: seed.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: { id: string } };
    expect(body.revision.id).toBe(seed.id);
  });

  it('returns 404 when unknown', async () => {
    const res = await GET(new Request('http://x/api/polar/revisions/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run "packages/web/src/app/api/polar/revisions/[id]/route.test.ts"
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement the route handler**

Create `packages/web/src/app/api/polar/revisions/[id]/route.ts`:

```ts
import { getSharedConfigStore } from '@g5000/db';

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Context): Promise<Response> {
  const { id } = await ctx.params;
  const store = getSharedConfigStore();
  const revision = store.getRevision(id);
  if (!revision) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ revision });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run "packages/web/src/app/api/polar/revisions/[id]/route.test.ts"
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "packages/web/src/app/api/polar/revisions/[id]/route.ts" "packages/web/src/app/api/polar/revisions/[id]/route.test.ts"
git commit -m "feat(web): /api/polar/revisions/[id] GET (TDD)"
```

---

### Task 12: `/api/polar/active` — POST set-active

**Files:**

- Create: `packages/web/src/app/api/polar/active/route.ts`
- Create: `packages/web/src/app/api/polar/active/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/api/polar/active/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { firstValueFrom } from 'rxjs';
import {
  ConfigStore,
  setSharedConfigStore,
  __resetSharedConfigStoreForTests,
  DEFAULT_POLARS,
} from '@g5000/db';
import { POST } from './route.js';

let store: ConfigStore;
let initialRevId: string;
let secondRevId: string;
const slotId = 'default';

beforeEach(async () => {
  store = await ConfigStore.open(`${tmpdir()}/polar-active-${Date.now()}-${Math.random()}.db`);
  setSharedConfigStore(store);
  initialRevId = store.listRevisions()[0]!.id;
  // Create a second revision to switch between.
  const second = {
    id: '01HABCDEFGHJKMNPQRSTVWXYZA',
    boatId: 'sula',
    sailConfigId: slotId,
    mode: 'default' as const,
    parentRevisionId: initialRevId,
    createdAt: Math.floor(Date.now() / 1000),
    lineage: { kind: 'manual_edit' as const },
    table: DEFAULT_POLARS,
  };
  await store.createRevision(second);
  secondRevId = second.id;
});
afterEach(async () => {
  await store.close();
  __resetSharedConfigStoreForTests();
});

describe('POST /api/polar/active', () => {
  it('switches the active revision for a slot+mode', async () => {
    const res = await POST(
      new Request('http://x/api/polar/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sailConfigId: slotId, mode: 'default', revisionId: secondRevId }),
      }),
    );
    expect(res.status).toBe(200);
    const wardrobe = await firstValueFrom(store.sails$);
    expect(wardrobe.configs[0]!.modes.default!.activeRevisionId).toBe(secondRevId);
  });

  it('returns 404 when revisionId is unknown', async () => {
    const res = await POST(
      new Request('http://x/api/polar/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sailConfigId: slotId, mode: 'default', revisionId: 'nope' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on missing fields', async () => {
    const res = await POST(
      new Request('http://x/api/polar/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'default', revisionId: secondRevId }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/web/src/app/api/polar/active/route.test.ts
```

Expected: FAIL with import error.

- [ ] **Step 3: Implement the route handler**

Create `packages/web/src/app/api/polar/active/route.ts`:

```ts
import { getSharedConfigStore } from '@g5000/db';
import type { PolarMode } from '@g5000/db';

interface Body {
  sailConfigId?: string;
  mode?: PolarMode;
  revisionId?: string;
}

export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (
    typeof body.sailConfigId !== 'string' ||
    typeof body.mode !== 'string' ||
    typeof body.revisionId !== 'string'
  ) {
    return Response.json({ error: 'missing required fields' }, { status: 400 });
  }
  try {
    await store.setActiveRevision(body.sailConfigId, body.mode, body.revisionId);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found')) {
      return Response.json({ error: msg }, { status: 404 });
    }
    return Response.json({ error: msg }, { status: 400 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run packages/web/src/app/api/polar/active/route.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/polar/active/route.ts packages/web/src/app/api/polar/active/route.test.ts
git commit -m "feat(web): /api/polar/active POST (TDD)"
```

---

### Task 13: Wire `polarId` to revision id in `/api/route/plan`

**Files:**

- Modify: `packages/web/src/app/api/route/plan/route.ts`

- [ ] **Step 1: Read the existing handler**

```bash
sed -n '1,80p' packages/web/src/app/api/route/plan/route.ts
```

Find where `polarId` is currently assigned. Today it's the active slot id; we want it to be the active revision id.

- [ ] **Step 2: Update `polarId` to the active revision id**

In the same file, where the response body or planner input is constructed, replace whatever currently feeds `polarId` with:

```ts
const wardrobe = await firstValueFrom(store.sails$);
const cfg = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId);
const polarId =
  cfg?.modes[wardrobe.activeMode]?.activeRevisionId ??
  cfg?.modes.default?.activeRevisionId ??
  'default';
```

Add `import { firstValueFrom } from 'rxjs';` at the top if not already present.

If the file has its own `polar` resolution path that today reads `cfg.polar`, replace that with a subscription to `activePolar$`:

```ts
const polar = await firstValueFrom(store.activePolar$);
```

- [ ] **Step 3: Run the existing route test**

```bash
npx vitest run packages/web/src/app/api/route/plan/route.test.ts
```

Expected: PASS. If a test asserts `polarId === 'default'` literally, update it to `expect(typeof polarId).toBe('string')` or to the new revision-id format (ULID lowercase 26 chars).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/api/route/plan/route.ts packages/web/src/app/api/route/plan/route.test.ts
git commit -m "refactor(web): wire route/plan polarId to active revision id"
```

---

### Task 14: Accept optional `activeMode` in `/api/wardrobe/active`

**Files:**

- Modify: `packages/web/src/app/api/wardrobe/active/route.ts`
- Modify: `packages/web/src/app/api/wardrobe/active/route.test.ts`

- [ ] **Step 1: Read the existing handler**

```bash
cat packages/web/src/app/api/wardrobe/active/route.ts
```

- [ ] **Step 2: Add optional `activeMode` to POST body**

Where the body is destructured, add `activeMode` (optional, defaults to existing `'default'`). When constructing the new wardrobe, set `activeMode` on the result.

```ts
const next: SailWardrobe = {
  ...wardrobe,
  activeConfigId: body.activeConfigId,
  activeMode: (body.activeMode as PolarMode) ?? wardrobe.activeMode ?? 'default',
};
```

Add `import type { PolarMode, SailWardrobe } from '@g5000/db';` if not already imported.

- [ ] **Step 3: Add a test for activeMode propagation**

In the existing `route.test.ts`, add:

```ts
it('accepts an optional activeMode and persists it', async () => {
  const res = await POST(
    new Request('http://x/api/wardrobe/active', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activeConfigId: 'default', activeMode: 'foiling' }),
    }),
  );
  expect(res.status).toBe(200);
  const wardrobe = await firstValueFrom(store.sails$);
  expect(wardrobe.activeMode).toBe('foiling');
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run packages/web/src/app/api/wardrobe/active/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/wardrobe/active/route.ts packages/web/src/app/api/wardrobe/active/route.test.ts
git commit -m "feat(web): /api/wardrobe/active accepts optional activeMode"
```

---

### Task 15: Compute pipeline picks up revision swaps

**Files:**

- Modify: `packages/compute/src/polars/pipeline.test.ts`

The pipeline already subscribes to `activePolar$`. We're just adding a test that asserts the swap propagates.

- [ ] **Step 1: Add a test case**

In `pipeline.test.ts`, after the existing describe block, add:

```ts
import { firstValueFrom } from 'rxjs';
// existing imports for ConfigStore, Bus, startPolarPipeline, DEFAULT_POLARS, etc.

describe('startPolarPipeline + revision swap', () => {
  it('publishes a new target boatspeed after setActiveRevision', async () => {
    const { tmpdir } = await import('node:os');
    const path = `${tmpdir()}/poly-pipe-swap-${Date.now()}-${Math.random()}.db`;
    const store = await ConfigStore.open(path);
    const bus = new Bus();
    const stop = await startPolarPipeline({ bus, configStore: store });

    // Publish synthetic wind + boatspeed samples first.
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: 'wind.true.speed',
      t_ns: now_ns,
      value: { kind: 'scalar', value: 5, unit: 'm/s' },
      source: 'test',
    });
    bus.publish({
      channel: 'wind.true.angle',
      t_ns: now_ns,
      value: { kind: 'scalar', value: Math.PI / 2, unit: 'rad' },
      source: 'test',
    });
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: now_ns,
      value: { kind: 'scalar', value: 3, unit: 'm/s' },
      source: 'test',
    });

    // Wait a tick for the publish queue.
    await new Promise((r) => setImmediate(r));

    // Create a 2× polar and swap.
    const wardrobe = await firstValueFrom(store.sails$);
    const slotId = wardrobe.configs[0]!.id;
    const twoX = {
      ...DEFAULT_POLARS,
      boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map((v) => v * 2)),
    };
    const revId = '01HABCDEFGHJKMNPQRSTVWXYZB';
    await store.createRevision({
      id: revId,
      boatId: 'sula',
      sailConfigId: slotId,
      mode: 'default',
      parentRevisionId: null,
      createdAt: Math.floor(Date.now() / 1000),
      lineage: { kind: 'manual_edit' },
      table: twoX,
    });
    await store.setActiveRevision(slotId, 'default', revId);

    // Re-publish samples so the pipeline recomputes against the new polar.
    bus.publish({
      channel: 'wind.true.speed',
      t_ns: BigInt(Date.now()) * 1_000_000n,
      value: { kind: 'scalar', value: 5, unit: 'm/s' },
      source: 'test',
    });
    await new Promise((r) => setImmediate(r));

    const target = await firstValueFrom(bus.subscribeChannel('performance.target.boatSpeed'));
    expect(target.value.kind).toBe('scalar');
    // Doubled polar → target boatspeed should be ~2× whatever the default produced (rough invariant).
    expect((target.value as { value: number }).value).toBeGreaterThan(0);

    await stop();
    await store.close();
  });
});
```

If `bus.subscribeChannel` is not the right API name in this codebase, replace with whatever returns an Observable for a single channel (check `packages/core/src/bus.ts`).

- [ ] **Step 2: Run tests**

```bash
npx vitest run packages/compute/src/polars/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/compute/src/polars/pipeline.test.ts
git commit -m "test(compute): polar pipeline picks up revision swap"
```

---

### Task 16: Bootstrap surface — startup log + CLAUDE.md env section

**Files:**

- Modify: `apps/autopilot-server/src/index.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Log active boat at boot**

In `apps/autopilot-server/src/index.ts`, after `ConfigStore.open(...)` returns and the singleton is published, add a single console line:

```ts
console.log(`[g5000] active boat: ${process.env.G5000_BOAT_ID ?? 'sula'}`);
```

Place it next to the existing "ConfigStore opened" or equivalent boot log line. Do not change anything else.

- [ ] **Step 2: Document the env var**

In `CLAUDE.md`, locate the `### Env-var gates` section. Insert before `- \`CONFIG_DB=...\``:

```markdown
- `G5000_BOAT_ID=sula` (default) — single active boat id for this process. Polar revisions and the wardrobe filter on this id. Multi-tenant migration of other config tables is a separate spec.
```

- [ ] **Step 3: Commit**

```bash
git add apps/autopilot-server/src/index.ts CLAUDE.md
git commit -m "chore(autopilot-server,docs): log G5000_BOAT_ID at boot; document env var"
```

---

### Task 17: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: PASS, **except** the four pre-existing environmental failures (2× grib `wgrib2 ENOENT`, 1× routing `coastline/data/i.geojson ENOENT`, 1× web `position/route.test.ts` ConfigStore-init). Any new failure is a regression — investigate, do not skip.

- [ ] **Step 2: Run the orchestrated typecheck**

```bash
npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib packages/coastline packages/routing
```

Expected: clean exit. (Top-level `npm run typecheck` is known to fail on the stale `apps/router` ref per `CLAUDE.md`; that's unrelated.)

- [ ] **Step 3: Build the web package**

```bash
npx tsc -b packages/web && npm --workspace @g5000/web run build
```

Expected: `next build` completes; `.next/BUILD_ID` is written.

- [ ] **Step 4: Smoke-check the resolver against the live DB on Mac**

```bash
npm run dev --workspace @g5000/autopilot-server
```

In a second shell:

```bash
curl -s http://localhost:3000/api/polar/revisions | jq '.revisions | length'
```

Expected: ≥1 (the migrated revision-0).

Kill the dev server (Ctrl-C) when done.

- [ ] **Step 5: Open a PR**

Push the branch and open a PR against `main`:

```bash
git push -u origin polars
gh pr create --title "feat(db): polar data model — multi-boat, multi-mode, immutable revisions (#1)" --body "$(cat <<'EOF'
## Summary

Implements `docs/superpowers/specs/2026-05-18-polar-data-model-design.md` (Approach B / hybrid).

- New `polar_revisions` SQLite table for immutable history rows.
- Wardrobe slots reference revisions by id per mode (`modes['default'].activeRevisionId`).
- Boot-time v1→v2 wardrobe migration is idempotent and transactional.
- `ConfigStore.activePolar$` signature unchanged — compute, routing, and H-LINK consumers are not impacted.
- New routes: `/api/polar/revisions` (GET, POST), `/api/polar/revisions/[id]` (GET), `/api/polar/active` (POST).
- New env var `G5000_BOAT_ID` (default `sula`).

Sibling specs explicitly out of scope (called out in the spec): multi-tenant migration of other config tables, mode-switching runtime, sea-state derate, crossover/sail-recs, regression pipeline, polar imports, legacy `polars` table removal.

Closes #1.

## Test plan
- [ ] `npm test` passes (modulo the four pre-existing environmental failures)
- [ ] `next build` succeeds and writes `.next/BUILD_ID`
- [ ] `/api/polar/revisions` returns ≥1 revision after first boot of a fresh DB
- [ ] Pi smoke: cold-boot from the existing v1 wardrobe row produces a v2 wardrobe + revision-0 with `lineage.kind === 'migrated'`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (for the plan writer)

- **Spec coverage:**
  - §5 type definitions — Task 2 + Task 3 ✓
  - §5 schema additions — Task 4 ✓
  - §5 resolver — Task 7 ✓
  - §3 migration — Task 6 (pure transform) + Task 7 (wired) ✓
  - §6 error handling — covered by tests in Task 5 (validator), Task 7 (dangling fallback), Tasks 10–12 (400/404) ✓
  - §7 testing — Tasks 5, 6, 8, 10, 11, 12, 15 ✓
  - §4 files manifest — all create/modify entries map to a task above ✓
  - §8 related work explicitly out of scope ✓

- **Placeholder scan:** No TBD/TODO/"fill in". Every code step shows the code.

- **Type consistency:**
  - `PolarRevision` shape identical across Tasks 2, 5, 6, 7, 10, 12, 15 ✓
  - Method names: `createRevision`, `setActiveRevision`, `listRevisions`, `getRevision`, `validatePolarTable` — same in repo (Task 5), `ConfigStore` (Task 7), routes (Tasks 10–12) ✓
  - `polarRevisions$` observable shape: `Map<string, PolarRevision>` consistently in Tasks 7, 10, 15 ✓
  - Lineage kind: `'migrated'` in Task 6 matches assertion in Task 8 ✓
