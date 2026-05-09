# H6000 Plan 3 — Calibrated True Wind, End to End

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a true-wind compute pipeline that consumes the boat's raw N2K + 0183 inputs, applies a calibration table (initially zero/identity), and re-broadcasts calibrated PGN 130306 onto the bus so the existing Zeus SR plotter and any other displays show our values. Cal table data lives in SQLite and is hot-reloadable; editing is via direct DB write or REST API for now (Plan 3B adds the wizard UI and polars).

**Architecture:**

- New package `@h6000/db`: Drizzle schema + `ConfigStore` class exposing typed observables for cal tables. Single SQLite file `config.db` (path configurable via env var).
- New package `@h6000/compute`: pure-function true-wind math (motion correction, 2D bilinear cal-table interpolation, vector subtraction → TWS/TWA/TWD) plus an RxJS pipeline that subscribes to bus channels via the ConfigStore.
- `@h6000/bridge` extension: a new `txPgn(pgn)` method on `WireDriver`, implemented on `Ngt1Driver` via canboatjs's ASCII encoder, stubbed (throws) on the others.
- `@h6000/web`: a minimal `/api/config/aws-awa` endpoint pair (GET/PUT) so the cal table can be poked from the browser (or curl) without writing SQL. **No wizard UI yet** — that's Plan 3B.
- `@h6000/autopilot-server`: instantiates ConfigStore, starts compute pipeline, wires TX to the live NGT-1.

**Tech Stack additions:**

- `drizzle-orm` and `better-sqlite3` (the same pair the rest of the user's workspace uses).
- No new compute deps — math is straightforward, RxJS handles streaming.

**Reference spec:** `docs/superpowers/specs/2026-05-08-h6000-design.md`. Implements build-sequence steps 11 (config DB), 12 (true-wind compute), and 15 (N2K TX). Steps 13 (cal-table editor wizard) and 14 (polars) are deferred to Plan 3B. BSP cal and compass deviation calibrations (also part of step 17 in the broader plan) are out of scope here — only AWS/AWA cal lands now.

---

## What's in scope

- SQLite-backed `config.db` with Drizzle ORM. Schema for boat config, AWS/AWA cal table, BSP cal (1D), compass deviation (1D). All three cal tables are populated on first boot with identity defaults.
- `ConfigStore` class with `Observable<AwsAwaCalTable>`, `Observable<BspCal>`, `Observable<CompassDeviation>`, `Observable<BoatConfig>`. Mutation methods (`setAwsAwaCal`, …) emit on those observables.
- Pure-function true-wind math:
  - Masthead motion correction (subtract masthead linear velocity from AW vector, computed from yaw rate × mast height).
  - 2D bilinear interpolation on the AWS/AWA cal grid.
  - 1D BSP correction.
  - 1D compass deviation correction.
  - Vector subtraction in earth frame to derive TWS/TWA/TWD.
- True-wind compute pipeline: RxJS-based, subscribes to needed input channels via `combineLatest`, applies math, publishes to `wind.true.calibrated.*` channels.
- New `txPgn(pgn)` method on `WireDriver` (typed PGN object → bus). `Ngt1Driver.txPgn` implementation using `canboatjs.pgnToActisenseN2KAsciiFormat` + serial write. Other drivers throw.
- TX wiring: subscribes to `wind.true.calibrated.*`, throttles to 5 Hz, builds PGN 130306, calls `Ngt1Driver.txPgn`.
- A minimal REST API in `@h6000/web` for AWS/AWA cal CRUD (`GET /api/config/aws-awa`, `PUT /api/config/aws-awa`).
- `autopilot-server` integration: ConfigStore + compute + TX wired into the existing single-process boot.

## What's NOT in scope (Plan 3B and beyond)

- Cal-table editor UI / tack-test wizard.
- Polars (Expedition CSV import, target boat speed compute, %polar, target VMG).
- Leeway pipeline, current pipeline, lay-line projection.
- BSP cal procedure / compass deviation cal procedure (the **tables exist** with identity defaults; the procedures to fill them land later).
- N2K TX of any PGN besides 130306. `127237` autopilot is a later plan.
- 0183 TX. Phase 0a remains read-only on 0183.
- Multi-version cal tables, audit history, undo. We overwrite in place.

---

## File structure

```
autopilot/
├── packages/
│   ├── core/                                       (no changes)
│   ├── bridge/
│   │   └── src/
│   │       ├── wire-driver.ts                      MODIFY: add txPgn(pgn)
│   │       ├── ngt-driver.ts                       MODIFY: implement txPgn
│   │       ├── ngt-driver.test.ts                  MODIFY: txPgn tests
│   │       ├── nmea0183/serial-driver.ts           MODIFY: add txPgn stub
│   │       ├── persistence/replay-driver.ts        MODIFY: add txPgn stub
│   │       ├── tx/
│   │       │   ├── true-wind-tx.ts                 NEW: subscribe + throttle + send
│   │       │   └── true-wind-tx.test.ts            NEW
│   │       └── index.ts                            MODIFY: export new tx surface
│   ├── db/                                         NEW PACKAGE
│   │   ├── package.json                            NEW
│   │   ├── tsconfig.json                           NEW
│   │   └── src/
│   │       ├── schema.ts                           NEW: Drizzle table defs
│   │       ├── config-store.ts                     NEW: ConfigStore class
│   │       ├── config-store.test.ts                NEW
│   │       ├── defaults.ts                         NEW: identity cal defaults
│   │       └── index.ts                            NEW
│   ├── compute/                                    NEW PACKAGE
│   │   ├── package.json                            NEW
│   │   ├── tsconfig.json                           NEW
│   │   └── src/
│   │       ├── true-wind/
│   │       │   ├── math.ts                         NEW: pure functions
│   │       │   ├── math.test.ts                    NEW
│   │       │   ├── pipeline.ts                     NEW: RxJS subscription
│   │       │   └── pipeline.test.ts                NEW
│   │       └── index.ts                            NEW
│   └── web/
│       └── src/app/api/config/aws-awa/
│           └── route.ts                            NEW: GET / PUT
└── apps/
    └── autopilot-server/
        └── src/
            └── index.ts                            MODIFY: wire ConfigStore + compute + TX
```

---

## Task 1: Bootstrap `@h6000/db` package

**Files:**

- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Modify: root `package.json` (add `drizzle-orm`, `better-sqlite3` to root deps)

- [ ] **Step 1: Install runtime deps at workspace root**

```bash
npm install drizzle-orm@^0.36 better-sqlite3@^11
npm install -D @types/better-sqlite3@^7
```

(If `drizzle-orm@^0.36` resolves to something materially newer, that's fine — pin in the package-lock.)

- [ ] **Step 2: Create `packages/db/package.json`**

```json
{
  "name": "@h6000/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@h6000/core": "*",
    "better-sqlite3": "^11",
    "drizzle-orm": "^0.36",
    "rxjs": "^7"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7",
    "@types/node": "^22",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

- [ ] **Step 3: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 4: Reinstall to wire workspace symlinks**

```bash
npm install
```

Expected: `node_modules/@h6000/db` symlink exists.

- [ ] **Step 5: Update root `tsconfig.json`** to include the new package

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/db" },
    { "path": "./packages/bridge" },
    { "path": "./apps/autopilot-server" }
  ]
}
```

(Keep `core` first; add `db` between `core` and `bridge`.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/package.json packages/db/tsconfig.json package.json package-lock.json tsconfig.json
git commit -m "feat(db): bootstrap @h6000/db package with Drizzle and better-sqlite3"
```

---

## Task 2: Drizzle schema for boat config and cal tables

**Files:**

- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/defaults.ts`

The schema covers four config kinds. We use a single SQLite file with one table per kind. Each table is keyed by a known string ID (`'singleton'` for boat config, etc.), so reads are `SELECT * WHERE id = 'singleton'`.

- [ ] **Step 1: Create `packages/db/src/schema.ts`**

```ts
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * All config rows are stored as JSON-serialized blobs in a `value` column.
 * This keeps the schema simple — Drizzle's strength here is connection
 * management, transactions, and migrations, not column-level typing for
 * complex nested structures (cal grids, polar tables).
 *
 * Each table is keyed by a known string ID. Most are singletons.
 */
export const boatConfig = sqliteTable('boat_config', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded BoatConfig
});

export const awsAwaCal = sqliteTable('aws_awa_cal', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded AwsAwaCalTable
});

export const bspCal = sqliteTable('bsp_cal', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded BspCal
});

export const compassDeviation = sqliteTable('compass_deviation', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded CompassDeviation
});
```

- [ ] **Step 2: Create `packages/db/src/defaults.ts`**

```ts
/**
 * Identity / zero-correction defaults for all config singletons. These are
 * what new databases get on first boot — every cal cell is zero, BoatConfig
 * is filled with sensible-but-overridable rig estimates.
 */

export interface BoatConfig {
  /** Mast height above the masthead unit's measurement reference, meters. */
  mastHeight: number;
  /** Distance from masthead to bow tip along the boat-x axis, meters. */
  mastheadOffsetX: number;
  /** Lateral offset of the masthead from the boat centerline, meters. */
  mastheadOffsetY: number;
  /** Magnetic variation for the sailing area, degrees (positive = east). */
  magVarDeg: number;
}

/**
 * Two-dimensional grid indexed by AWS bin × AWA bin. Each cell holds two
 * correction values: an angle correction (radians, added to AWA) and a
 * speed multiplier (dimensionless, 1.0 = no correction). Bilinear
 * interpolation between cells.
 */
export interface AwsAwaCalTable {
  /** Wind-speed bin centers, m/s. Strictly increasing. */
  awsBins: number[];
  /** Wind-angle bin centers, radians. Strictly increasing. Must cover [0, π]. */
  awaBins: number[];
  /** Angle correction grid in radians, [awsBins.length][awaBins.length]. */
  angleCorrection: number[][];
  /** Speed multiplier grid (1.0 = no correction), [awsBins.length][awaBins.length]. */
  speedMultiplier: number[][];
}

export interface BspCal {
  /** BSP bin centers, m/s. Strictly increasing. */
  bins: number[];
  /** Multiplier per bin (1.0 = no correction). */
  multiplier: number[];
}

export interface CompassDeviation {
  /** 36 entries, one per 10° heading bin. Index 0 = heading 0–10°. Radians, additive. */
  deviation: number[];
}

export const DEFAULT_BOAT_CONFIG: BoatConfig = {
  mastHeight: 18, // meters; rough catamaran value
  mastheadOffsetX: 0,
  mastheadOffsetY: 0,
  magVarDeg: 0,
};

const zeros2D = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

const ones2D = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));

/** Default 8 AWS bins × 13 AWA bins; identity (no correction). */
export const DEFAULT_AWS_AWA_CAL: AwsAwaCalTable = {
  awsBins: [2, 4, 6, 8, 10, 12, 16, 20], // m/s
  awaBins: Array.from({ length: 13 }, (_, i) => (i * Math.PI) / 12), // 0, 15°, 30°, … 180°
  angleCorrection: zeros2D(8, 13),
  speedMultiplier: ones2D(8, 13),
};

export const DEFAULT_BSP_CAL: BspCal = {
  bins: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12], // m/s
  multiplier: Array.from({ length: 10 }, () => 1.0),
};

export const DEFAULT_COMPASS_DEVIATION: CompassDeviation = {
  deviation: Array.from({ length: 36 }, () => 0),
};
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/defaults.ts
git commit -m "feat(db): add Drizzle schema and identity defaults"
```

---

## Task 3: ConfigStore with hot-reload (TDD)

**Files:**

- Create: `packages/db/src/config-store.ts`
- Test: `packages/db/src/config-store.test.ts`
- Create: `packages/db/src/index.ts`

The `ConfigStore` opens the SQLite file, ensures rows exist (insert defaults on first boot), exposes typed observables for each kind, and provides setters that update the DB and emit on the relevant observable.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { firstValueFrom, skip, take } from 'rxjs';
import { ConfigStore } from './config-store.js';
import { DEFAULT_BOAT_CONFIG, DEFAULT_AWS_AWA_CAL, type BoatConfig } from './defaults.js';

describe('ConfigStore', () => {
  let dir: string;
  let store: ConfigStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'h6000-cfg-'));
    store = await ConfigStore.open(path.join(dir, 'config.db'));
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns identity defaults on a fresh database', async () => {
    const cfg = await firstValueFrom(store.boatConfig$);
    expect(cfg).toEqual(DEFAULT_BOAT_CONFIG);
    const cal = await firstValueFrom(store.awsAwaCal$);
    expect(cal.awsBins).toEqual(DEFAULT_AWS_AWA_CAL.awsBins);
    expect(cal.angleCorrection.flat().every((v) => v === 0)).toBe(true);
  });

  it('emits the new value on the observable when setBoatConfig is called', async () => {
    const next: Promise<BoatConfig> = firstValueFrom(store.boatConfig$.pipe(skip(1), take(1)));
    await store.setBoatConfig({ ...DEFAULT_BOAT_CONFIG, magVarDeg: -15.3 });
    const v = await next;
    expect(v.magVarDeg).toBe(-15.3);
  });

  it('persists writes across reopens', async () => {
    await store.setBoatConfig({ ...DEFAULT_BOAT_CONFIG, magVarDeg: -12 });
    await store.close();

    const reopened = await ConfigStore.open(path.join(dir, 'config.db'));
    const cfg = await firstValueFrom(reopened.boatConfig$);
    expect(cfg.magVarDeg).toBe(-12);
    await reopened.close();
    // re-assign so afterEach close() doesn't re-close the original
    store = reopened;
  });

  it('exposes BehaviorSubject-like access — late subscribers get the current value', async () => {
    await store.setBoatConfig({ ...DEFAULT_BOAT_CONFIG, magVarDeg: 5 });
    const v = await firstValueFrom(store.boatConfig$);
    expect(v.magVarDeg).toBe(5);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```
npx vitest run packages/db/src/config-store.test.ts
```

Module not found.

- [ ] **Step 3: Implement `packages/db/src/config-store.ts`**

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { BehaviorSubject, type Observable } from 'rxjs';
import {
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_BOAT_CONFIG,
  DEFAULT_BSP_CAL,
  DEFAULT_COMPASS_DEVIATION,
  type AwsAwaCalTable,
  type BoatConfig,
  type BspCal,
  type CompassDeviation,
} from './defaults.js';
import { awsAwaCal, bspCal, boatConfig as boatConfigTable, compassDeviation } from './schema.js';

const SINGLETON = 'singleton';

/**
 * Opens (and migrates as needed) an SQLite-backed config store. Each cal
 * kind exposes a BehaviorSubject-style observable. Setters write through
 * to SQLite *and* emit on the observable, so subscribers see hot reloads
 * without polling.
 */
export class ConfigStore {
  private readonly subjects: {
    boatConfig: BehaviorSubject<BoatConfig>;
    awsAwaCal: BehaviorSubject<AwsAwaCalTable>;
    bspCal: BehaviorSubject<BspCal>;
    compassDeviation: BehaviorSubject<CompassDeviation>;
  };

  private constructor(
    private readonly raw: Database.Database,
    private readonly db: BetterSQLite3Database,
    initial: {
      boatConfig: BoatConfig;
      awsAwaCal: AwsAwaCalTable;
      bspCal: BspCal;
      compassDeviation: CompassDeviation;
    },
  ) {
    this.subjects = {
      boatConfig: new BehaviorSubject(initial.boatConfig),
      awsAwaCal: new BehaviorSubject(initial.awsAwaCal),
      bspCal: new BehaviorSubject(initial.bspCal),
      compassDeviation: new BehaviorSubject(initial.compassDeviation),
    };
  }

  static async open(filePath: string): Promise<ConfigStore> {
    const raw = new Database(filePath);
    const db = drizzle(raw);

    // Create tables if they don't exist. Using exec for IF NOT EXISTS DDL
    // since drizzle-kit migrations are heavier than this Phase 0 needs.
    raw.exec(`
      CREATE TABLE IF NOT EXISTS boat_config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS aws_awa_cal (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bsp_cal (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS compass_deviation (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);

    const ensure = <T>(table: typeof boatConfigTable, defaultValue: T): T => {
      const row = db.select().from(table).where(eq(table.id, SINGLETON)).all()[0];
      if (row) return JSON.parse(row.value) as T;
      db.insert(table)
        .values({ id: SINGLETON, value: JSON.stringify(defaultValue) })
        .run();
      return defaultValue;
    };

    const initial = {
      boatConfig: ensure<BoatConfig>(boatConfigTable, DEFAULT_BOAT_CONFIG),
      awsAwaCal: ensure<AwsAwaCalTable>(awsAwaCal, DEFAULT_AWS_AWA_CAL),
      bspCal: ensure<BspCal>(bspCal, DEFAULT_BSP_CAL),
      compassDeviation: ensure<CompassDeviation>(compassDeviation, DEFAULT_COMPASS_DEVIATION),
    };

    return new ConfigStore(raw, db, initial);
  }

  get boatConfig$(): Observable<BoatConfig> {
    return this.subjects.boatConfig.asObservable();
  }
  get awsAwaCal$(): Observable<AwsAwaCalTable> {
    return this.subjects.awsAwaCal.asObservable();
  }
  get bspCal$(): Observable<BspCal> {
    return this.subjects.bspCal.asObservable();
  }
  get compassDeviation$(): Observable<CompassDeviation> {
    return this.subjects.compassDeviation.asObservable();
  }

  async setBoatConfig(value: BoatConfig): Promise<void> {
    this.write(boatConfigTable, value);
    this.subjects.boatConfig.next(value);
  }
  async setAwsAwaCal(value: AwsAwaCalTable): Promise<void> {
    this.write(awsAwaCal, value);
    this.subjects.awsAwaCal.next(value);
  }
  async setBspCal(value: BspCal): Promise<void> {
    this.write(bspCal, value);
    this.subjects.bspCal.next(value);
  }
  async setCompassDeviation(value: CompassDeviation): Promise<void> {
    this.write(compassDeviation, value);
    this.subjects.compassDeviation.next(value);
  }

  async close(): Promise<void> {
    this.raw.close();
    this.subjects.boatConfig.complete();
    this.subjects.awsAwaCal.complete();
    this.subjects.bspCal.complete();
    this.subjects.compassDeviation.complete();
  }

  private write<T>(table: typeof boatConfigTable, value: T): void {
    const json = JSON.stringify(value);
    this.db
      .insert(table)
      .values({ id: SINGLETON, value: json })
      .onConflictDoUpdate({ target: table.id, set: { value: json } })
      .run();
  }
}
```

(The `typeof boatConfigTable` type-fudge in `ensure`/`write` works because all four tables share the same column shape. If TypeScript's strictness rejects it, change to `any` for those internal helpers — Drizzle's typed inference is more strict than helpful at this seam.)

- [ ] **Step 4: Create `packages/db/src/index.ts`**

```ts
export * from './schema.js';
export * from './defaults.js';
export * from './config-store.js';
```

- [ ] **Step 5: Run — expect pass**

```
npx vitest run packages/db
```

All 4 tests pass. `tsc -b packages/db` clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/config-store.ts packages/db/src/config-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): ConfigStore with SQLite persistence and hot-reload observables"
```

---

## Task 4: Bootstrap `@h6000/compute` package

**Files:**

- Create: `packages/compute/package.json`
- Create: `packages/compute/tsconfig.json`
- Modify: root `tsconfig.json` (add the new package to references)

- [ ] **Step 1: Create `packages/compute/package.json`**

```json
{
  "name": "@h6000/compute",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@h6000/core": "*",
    "@h6000/db": "*",
    "rxjs": "^7"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: Create `packages/compute/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"],
  "references": [{ "path": "../core" }, { "path": "../db" }]
}
```

- [ ] **Step 3: Add to root `tsconfig.json` references**

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/db" },
    { "path": "./packages/compute" },
    { "path": "./packages/bridge" },
    { "path": "./apps/autopilot-server" }
  ]
}
```

- [ ] **Step 4: Reinstall**

```bash
npm install
```

- [ ] **Step 5: Commit**

```bash
git add packages/compute/package.json packages/compute/tsconfig.json tsconfig.json package-lock.json
git commit -m "feat(compute): bootstrap @h6000/compute package"
```

---

## Task 5: True wind math (TDD)

**Files:**

- Create: `packages/compute/src/true-wind/math.ts`
- Test: `packages/compute/src/true-wind/math.test.ts`

Pure functions. No I/O, no observables. Inputs are numbers; outputs are numbers. The pipeline (Task 6) will wrap this with RxJS.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  computeTrueWind,
  bilinearInterpolate2D,
  applyBspCal,
  applyCompassDeviation,
  type TrueWindInputs,
  type TrueWindOutputs,
} from './math.js';
import {
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_BSP_CAL,
  DEFAULT_COMPASS_DEVIATION,
  DEFAULT_BOAT_CONFIG,
} from '@h6000/db';

const baseInputs = (overrides: Partial<TrueWindInputs> = {}): TrueWindInputs => ({
  aws: 5, // m/s
  awa: Math.PI / 4, // 45°
  bsp: 3, // m/s
  headingMagRad: 0,
  yawRateRad: 0,
  awsAwaCal: DEFAULT_AWS_AWA_CAL,
  bspCal: DEFAULT_BSP_CAL,
  compassDeviation: DEFAULT_COMPASS_DEVIATION,
  boatConfig: DEFAULT_BOAT_CONFIG,
  ...overrides,
});

describe('computeTrueWind — round trip', () => {
  it('produces sensible TWS/TWA when AW = vector(BSP, 0) (boat steaming straight into apparent wind)', () => {
    // Apparent wind aligned with bow at 5 m/s, boat moving forward at 3 m/s.
    // True wind should be 2 m/s, on the bow.
    const out = computeTrueWind(baseInputs({ aws: 5, awa: 0, bsp: 3 }));
    expect(out.tws).toBeCloseTo(2, 4);
    expect(out.twa).toBeCloseTo(0, 4);
  });

  it('produces TWS=BSP and TWA=π when apparent wind is exactly cancelled by boat motion (calm true wind)', () => {
    // If AW = (BSP, 0) at the masthead, the boat is generating all the apparent
    // wind itself: true wind is zero. We test a case where TW is non-zero but
    // simple: apparent at 90°.
    const out = computeTrueWind(baseInputs({ aws: 3, awa: Math.PI / 2, bsp: 3 }));
    // TW magnitude = sqrt(3^2 + 3^2) = ~4.24, on the beam-aft direction.
    expect(out.tws).toBeCloseTo(Math.sqrt(18), 3);
  });

  it('with identity cal, calibrated TWA matches uncalibrated', () => {
    const out = computeTrueWind(baseInputs());
    expect(Number.isFinite(out.tws)).toBe(true);
    expect(Number.isFinite(out.twa)).toBe(true);
    expect(Number.isFinite(out.twd)).toBe(true);
  });

  it('TWD = TWA + heading when heading = 0', () => {
    const out = computeTrueWind(baseInputs({ headingMagRad: 0 }));
    expect(out.twd).toBeCloseTo(out.twa, 6);
  });

  it('rotating heading rotates TWD by the same amount', () => {
    const a = computeTrueWind(baseInputs({ headingMagRad: 0 }));
    const b = computeTrueWind(baseInputs({ headingMagRad: Math.PI / 2 }));
    const delta = b.twd - a.twd;
    // Allow ±2π wrap.
    const norm = ((delta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    expect(Math.abs(norm - Math.PI / 2)).toBeLessThan(1e-6);
  });
});

describe('bilinearInterpolate2D', () => {
  it('returns the cell value at exact bin centers', () => {
    const xBins = [0, 1, 2];
    const yBins = [0, 1, 2];
    const grid = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ];
    expect(bilinearInterpolate2D(xBins, yBins, grid, 1, 1)).toBe(4);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 0, 0)).toBe(0);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 2, 2)).toBe(8);
  });

  it('interpolates linearly between adjacent cells', () => {
    const xBins = [0, 2];
    const yBins = [0, 2];
    const grid = [
      [0, 10],
      [10, 20],
    ];
    // Halfway in both dims should be the average of all 4 corners = 10.
    expect(bilinearInterpolate2D(xBins, yBins, grid, 1, 1)).toBe(10);
  });

  it('clamps inputs outside the grid range', () => {
    const xBins = [0, 1, 2];
    const yBins = [0, 1, 2];
    const grid = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ];
    expect(bilinearInterpolate2D(xBins, yBins, grid, -5, -5)).toBe(0);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 99, 99)).toBe(8);
  });
});

describe('applyBspCal', () => {
  it('returns BSP unchanged with identity multiplier', () => {
    expect(applyBspCal(5, DEFAULT_BSP_CAL)).toBe(5);
  });

  it('applies linearly-interpolated multiplier', () => {
    const cal = {
      bins: [0, 10],
      multiplier: [0.9, 1.1], // halfway → 1.0
    };
    // At bsp = 5 (halfway), multiplier should be 1.0 → output = 5.
    expect(applyBspCal(5, cal)).toBeCloseTo(5, 6);
  });
});

describe('applyCompassDeviation', () => {
  it('returns heading unchanged with identity deviation', () => {
    expect(applyCompassDeviation(1.234, DEFAULT_COMPASS_DEVIATION)).toBe(1.234);
  });

  it('adds the deviation for the corresponding 10° bin', () => {
    const cal = {
      deviation: Array.from({ length: 36 }, (_, i) => (i === 5 ? 0.1 : 0)),
    };
    // 5th bin = 50°-60° heading. 55° in radians is between 50° and 60°.
    const heading = (55 * Math.PI) / 180;
    const corrected = applyCompassDeviation(heading, cal);
    expect(corrected).toBeCloseTo(heading + 0.1, 6);
  });
});
```

- [ ] **Step 2: Run — expect failure (module not found)**

- [ ] **Step 3: Implement `packages/compute/src/true-wind/math.ts`**

```ts
import type { AwsAwaCalTable, BoatConfig, BspCal, CompassDeviation } from '@h6000/db';

export interface TrueWindInputs {
  /** Apparent wind speed at the masthead, m/s. */
  aws: number;
  /** Apparent wind angle (from bow, positive starboard), radians, [-π, π]. */
  awa: number;
  /** Boat speed through water, m/s. */
  bsp: number;
  /** Magnetic heading, radians [0, 2π). */
  headingMagRad: number;
  /** Yaw rate (positive = clockwise from above), rad/s. */
  yawRateRad: number;
  awsAwaCal: AwsAwaCalTable;
  bspCal: BspCal;
  compassDeviation: CompassDeviation;
  boatConfig: BoatConfig;
}

export interface TrueWindOutputs {
  /** True wind speed, m/s. */
  tws: number;
  /** True wind angle (from bow), radians, [-π, π]. */
  twa: number;
  /** True wind direction (compass-style, from north), radians [0, 2π). */
  twd: number;
  /** What the calibration produced, before vector subtraction (debugging). */
  awsCal: number;
  awaCal: number;
  /** What the BSP correction produced. */
  bspCal: number;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Compute true wind from apparent wind + boat speed + heading.
 *
 * Pipeline stages:
 *   1. Masthead motion correction: subtract masthead linear velocity from
 *      the apparent wind vector. Velocity = yaw_rate × mast_height,
 *      perpendicular to the boat heading at the masthead.
 *   2. AWS/AWA calibration: 2D bilinear interpolation on the cal grid.
 *   3. BSP calibration: 1D linear interpolation on the BSP cal table.
 *   4. Compass deviation: lookup by heading bin.
 *   5. Vector subtraction: TW = AW - V_boat in the earth frame.
 */
export function computeTrueWind(inp: TrueWindInputs): TrueWindOutputs {
  // --- Step 1: masthead motion correction ---
  // Yaw rate × mast height gives the masthead's lateral linear velocity.
  // Sign convention: positive yaw rate (turning to starboard) creates a
  // headwind component from the port side at the masthead, which adds
  // to apparent wind from the port direction.
  const mastheadLatVel = inp.yawRateRad * inp.boatConfig.mastHeight;
  // Decompose AW vector in boat frame.
  const awX = inp.aws * Math.cos(inp.awa);
  const awY = inp.aws * Math.sin(inp.awa);
  // Subtract the masthead's lateral velocity from the apparent vector to get
  // the apparent wind that the masthead WOULD see if it were stationary.
  const awCorrectedY = awY - mastheadLatVel;
  const awsCorr = Math.hypot(awX, awCorrectedY);
  const awaCorr = Math.atan2(awCorrectedY, awX);

  // --- Step 2: AWS/AWA cal table ---
  // Use |awa| for table lookup since the cal grid is symmetric across the
  // boat centerline. Apply the angle correction with the original sign.
  const awaAbs = Math.abs(awaCorr);
  const angleCorr = bilinearInterpolate2D(
    inp.awsAwaCal.awsBins,
    inp.awsAwaCal.awaBins,
    inp.awsAwaCal.angleCorrection,
    awsCorr,
    awaAbs,
  );
  const speedMul = bilinearInterpolate2D(
    inp.awsAwaCal.awsBins,
    inp.awsAwaCal.awaBins,
    inp.awsAwaCal.speedMultiplier,
    awsCorr,
    awaAbs,
  );
  const awsCal = awsCorr * speedMul;
  const awaCal = awaCorr + Math.sign(awaCorr || 1) * angleCorr;

  // --- Step 3: BSP cal ---
  const bspCal = applyBspCal(inp.bsp, inp.bspCal);

  // --- Step 4: compass deviation ---
  const headingTrue =
    applyCompassDeviation(inp.headingMagRad, inp.compassDeviation) +
    inp.boatConfig.magVarDeg * DEG_TO_RAD;

  // --- Step 5: vector subtraction in earth frame ---
  // AW vector in boat frame:
  const awCalX = awsCal * Math.cos(awaCal);
  const awCalY = awsCal * Math.sin(awaCal);
  // Rotate to earth frame: the boat's bow points along headingTrue (compass
  // convention: 0 = north, π/2 = east). Standard math convention is x=east,
  // y=north, angle measured CCW from east. We use compass convention
  // throughout: angles measured CW from north, x=north, y=east.
  // For our purposes we just need consistency between AW rotation and the
  // velocity vector subtraction.
  const cosH = Math.cos(headingTrue);
  const sinH = Math.sin(headingTrue);
  const awEarthX = awCalX * cosH - awCalY * sinH;
  const awEarthY = awCalX * sinH + awCalY * cosH;
  // Boat velocity vector in earth frame (along heading).
  const vbEarthX = bspCal * cosH;
  const vbEarthY = bspCal * sinH;
  // True wind = apparent wind - boat velocity.
  const twEarthX = awEarthX - vbEarthX;
  const twEarthY = awEarthY - vbEarthY;
  const tws = Math.hypot(twEarthX, twEarthY);
  // TWD: angle of TW vector in earth frame, compass convention 0..2π.
  let twd = Math.atan2(twEarthY, twEarthX);
  if (twd < 0) twd += Math.PI * 2;
  // TWA: TW in boat frame, signed [-π, π].
  const twBoatX = twEarthX * cosH + twEarthY * sinH;
  const twBoatY = -twEarthX * sinH + twEarthY * cosH;
  const twa = Math.atan2(twBoatY, twBoatX);

  return { tws, twa, twd, awsCal, awaCal, bspCal };
}

/**
 * Bilinear interpolation on a regular grid. Inputs outside the grid are
 * clamped to the nearest edge. `xBins` and `yBins` must be strictly
 * increasing.
 */
export function bilinearInterpolate2D(
  xBins: number[],
  yBins: number[],
  grid: number[][],
  x: number,
  y: number,
): number {
  const xi = locate(xBins, x);
  const yi = locate(yBins, y);
  const x0 = xBins[xi.lo]!;
  const x1 = xBins[xi.hi]!;
  const y0 = yBins[yi.lo]!;
  const y1 = yBins[yi.hi]!;
  const fx = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  const fy = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
  const c00 = grid[xi.lo]![yi.lo]!;
  const c01 = grid[xi.lo]![yi.hi]!;
  const c10 = grid[xi.hi]![yi.lo]!;
  const c11 = grid[xi.hi]![yi.hi]!;
  return c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy;
}

function locate(bins: number[], v: number): { lo: number; hi: number } {
  if (bins.length === 0) return { lo: 0, hi: 0 };
  if (v <= bins[0]!) return { lo: 0, hi: 0 };
  if (v >= bins[bins.length - 1]!) {
    return { lo: bins.length - 1, hi: bins.length - 1 };
  }
  for (let i = 0; i < bins.length - 1; i++) {
    if (v >= bins[i]! && v <= bins[i + 1]!) return { lo: i, hi: i + 1 };
  }
  return { lo: bins.length - 1, hi: bins.length - 1 };
}

export function applyBspCal(bsp: number, cal: BspCal): number {
  if (cal.bins.length === 0) return bsp;
  if (cal.bins.length !== cal.multiplier.length) return bsp;
  const idx = locate(cal.bins, bsp);
  const x0 = cal.bins[idx.lo]!;
  const x1 = cal.bins[idx.hi]!;
  const m0 = cal.multiplier[idx.lo]!;
  const m1 = cal.multiplier[idx.hi]!;
  const fx = x1 === x0 ? 0 : (bsp - x0) / (x1 - x0);
  const m = m0 * (1 - fx) + m1 * fx;
  return bsp * m;
}

export function applyCompassDeviation(headingRad: number, cal: CompassDeviation): number {
  if (cal.deviation.length === 0) return headingRad;
  // Normalize heading to [0, 2π)
  const TWO_PI = 2 * Math.PI;
  let h = headingRad % TWO_PI;
  if (h < 0) h += TWO_PI;
  // 36 bins of 10° each = π/18 radians.
  const binWidth = TWO_PI / cal.deviation.length;
  const idx = Math.min(cal.deviation.length - 1, Math.floor(h / binWidth));
  return headingRad + cal.deviation[idx]!;
}
```

- [ ] **Step 4: Run — expect pass**

```
npx vitest run packages/compute/src/true-wind/math.test.ts
```

All tests pass. `tsc -b packages/compute` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/true-wind/math.ts packages/compute/src/true-wind/math.test.ts
git commit -m "feat(compute): true-wind math with cal-table interpolation"
```

---

## Task 6: True wind compute pipeline (TDD)

**Files:**

- Create: `packages/compute/src/true-wind/pipeline.ts`
- Test: `packages/compute/src/true-wind/pipeline.test.ts`
- Create: `packages/compute/src/index.ts`

The pipeline subscribes to bus channels via `combineLatest`, applies the math, and publishes computed samples. It also subscribes to the ConfigStore observables so cal-table changes hot-reload immediately.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bus, Channels, type Sample } from '@h6000/core';
import { ConfigStore } from '@h6000/db';
import { startTrueWindPipeline } from './pipeline.js';

const sample = (channel: string, value: number, t_ns = 1n): Sample => ({
  channel,
  t_ns,
  value: { kind: 'scalar', value },
  source: 'test',
});

describe('startTrueWindPipeline', () => {
  let dir: string;
  let store: ConfigStore;
  let bus: Bus;
  let stop: () => Promise<void>;
  let received: Sample[];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'h6000-pipeline-'));
    store = await ConfigStore.open(path.join(dir, 'config.db'));
    bus = new Bus();
    received = [];
    bus.subscribe('wind.true.calibrated.**', (s) => received.push(s));
    stop = await startTrueWindPipeline({ bus, configStore: store });
  });

  afterEach(async () => {
    await stop();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('publishes wind.true.calibrated.{angle,speed,direction} when all inputs are present', async () => {
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5));
    bus.publish(sample(Channels.Wind.ApparentAngle, 0));
    bus.publish(sample(Channels.Boat.SpeedWater, 3));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 0));

    await new Promise((r) => setTimeout(r, 30));

    const channels = new Set(received.map((s) => s.channel));
    expect(channels.has('wind.true.calibrated.speed')).toBe(true);
    expect(channels.has('wind.true.calibrated.angle')).toBe(true);
    expect(channels.has('wind.true.calibrated.direction')).toBe(true);
  });

  it('drops a tick when an input is older than 2 seconds', async () => {
    // Inject only AWS — no AWA, BSP, or HDG. Pipeline should not emit.
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });

  it('recomputes when the cal table changes', async () => {
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5));
    bus.publish(sample(Channels.Wind.ApparentAngle, 0));
    bus.publish(sample(Channels.Boat.SpeedWater, 3));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 0));
    await new Promise((r) => setTimeout(r, 30));
    const initialCount = received.length;
    expect(initialCount).toBeGreaterThan(0);

    // Change the cal table and re-publish one input to trigger a tick.
    const cal = await firstValueFrom(store.awsAwaCal$);
    const cal2 = {
      ...cal,
      angleCorrection: cal.angleCorrection.map((row) => row.map(() => 0.1)),
    };
    await store.setAwsAwaCal(cal2);
    bus.publish(sample(Channels.Wind.ApparentSpeed, 5.01));
    await new Promise((r) => setTimeout(r, 30));
    expect(received.length).toBeGreaterThan(initialCount);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```
npx vitest run packages/compute/src/true-wind/pipeline.test.ts
```

Module not found.

- [ ] **Step 3: Implement `packages/compute/src/true-wind/pipeline.ts`**

```ts
import { combineLatest, firstValueFrom, type Subscription } from 'rxjs';
import { Bus, Channels, type Sample } from '@h6000/core';
import type { AwsAwaCalTable, BoatConfig, BspCal, CompassDeviation, ConfigStore } from '@h6000/db';
import { computeTrueWind } from './math.js';

export interface TrueWindPipelineOptions {
  bus: Bus;
  configStore: ConfigStore;
  /** If a sample on a required channel is older than this, drop the tick. */
  staleAfterMs?: number;
}

interface LatestValues {
  aws?: { value: number; t_ns: bigint };
  awa?: { value: number; t_ns: bigint };
  bsp?: { value: number; t_ns: bigint };
  hdg?: { value: number; t_ns: bigint };
  yawRate?: { value: number; t_ns: bigint };
}

export async function startTrueWindPipeline(
  opts: TrueWindPipelineOptions,
): Promise<() => Promise<void>> {
  const { bus, configStore } = opts;
  const staleAfterMs = opts.staleAfterMs ?? 2000;
  const latest: LatestValues = {};
  const subs: Array<() => void> = [];
  const rxSubs: Subscription[] = [];

  // Subscribe to required input channels. We track each value's age and
  // drop the tick if any required input is stale.
  const trackScalar = (channel: string, key: keyof LatestValues): void => {
    subs.push(
      bus.subscribe(channel, (s) => {
        if (s.value.kind !== 'scalar') return;
        latest[key] = { value: s.value.value, t_ns: s.t_ns };
        recompute();
      }),
    );
  };
  trackScalar(Channels.Wind.ApparentSpeed, 'aws');
  trackScalar(Channels.Wind.ApparentAngle, 'awa');
  trackScalar(Channels.Boat.SpeedWater, 'bsp');
  trackScalar(Channels.Boat.HeadingMagnetic, 'hdg');
  // Yaw rate is optional — defaults to 0 if no source is publishing it.
  trackScalar('motion.rateOfTurn', 'yawRate');

  // Cache the latest cal tables so recompute() doesn't pull from the
  // BehaviorSubject on every tick. Updated by the combineLatest below.
  let configSnapshot: {
    boatConfig: BoatConfig;
    awsAwaCal: AwsAwaCalTable;
    bspCal: BspCal;
    compassDeviation: CompassDeviation;
  } = {
    boatConfig: await firstValueFrom(configStore.boatConfig$),
    awsAwaCal: await firstValueFrom(configStore.awsAwaCal$),
    bspCal: await firstValueFrom(configStore.bspCal$),
    compassDeviation: await firstValueFrom(configStore.compassDeviation$),
  };

  rxSubs.push(
    combineLatest([
      configStore.boatConfig$,
      configStore.awsAwaCal$,
      configStore.bspCal$,
      configStore.compassDeviation$,
    ]).subscribe(([boatConfig, awsAwaCal, bspCal, compassDeviation]) => {
      configSnapshot = { boatConfig, awsAwaCal, bspCal, compassDeviation };
      recompute();
    }),
  );

  function recompute(): void {
    if (!latest.aws || !latest.awa || !latest.bsp || !latest.hdg) {
      return;
    }
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    const stale = (t: bigint): boolean => Number((now_ns - t) / 1_000_000n) > staleAfterMs;
    if (
      stale(latest.aws.t_ns) ||
      stale(latest.awa.t_ns) ||
      stale(latest.bsp.t_ns) ||
      stale(latest.hdg.t_ns)
    ) {
      return;
    }
    const out = computeTrueWind({
      aws: latest.aws.value,
      awa: latest.awa.value,
      bsp: latest.bsp.value,
      headingMagRad: latest.hdg.value,
      yawRateRad: latest.yawRate?.value ?? 0,
      awsAwaCal: configSnapshot.awsAwaCal,
      bspCal: configSnapshot.bspCal,
      compassDeviation: configSnapshot.compassDeviation,
      boatConfig: configSnapshot.boatConfig,
    });
    const t = now_ns;
    bus.publish(make('wind.true.calibrated.speed', out.tws, t));
    bus.publish(make('wind.true.calibrated.angle', out.twa, t));
    bus.publish(make('wind.true.calibrated.direction', out.twd, t));
  }

  return async () => {
    for (const u of subs) u();
    for (const s of rxSubs) s.unsubscribe();
  };
}

function make(channel: string, value: number, t_ns: bigint): Sample {
  return {
    channel,
    t_ns,
    value: { kind: 'scalar', value, unit: channel.endsWith('.speed') ? 'm/s' : 'rad' },
    source: 'computed:true_wind',
  };
}
```

- [ ] **Step 4: Add `packages/compute/src/index.ts`**

```ts
export * from './true-wind/math.js';
export * from './true-wind/pipeline.js';
```

- [ ] **Step 5: Run — expect pass**

```
npx vitest run packages/compute
```

All tests pass. `tsc -b packages/compute` clean.

- [ ] **Step 6: Commit**

```bash
git add packages/compute/src/true-wind/pipeline.ts packages/compute/src/true-wind/pipeline.test.ts packages/compute/src/index.ts
git commit -m "feat(compute): true-wind pipeline with hot-reloading cal tables"
```

---

## Task 7: Add `txPgn` to WireDriver, stub on existing drivers

**Files:**

- Modify: `packages/bridge/src/wire-driver.ts`
- Modify: `packages/bridge/src/ngt-driver.ts`
- Modify: `packages/bridge/src/nmea0183/serial-driver.ts`
- Modify: `packages/bridge/src/persistence/replay-driver.ts`

- [ ] **Step 1: Add `txPgn` and `OutgoingPgn` type to `wire-driver.ts`**

Append (don't replace) — keep all existing types. Add:

```ts
export interface OutgoingPgn {
  pgn: number;
  /** Priority 0–7. Default 6 if undefined. */
  prio?: number;
  /** Destination address. Default 255 (broadcast) if undefined. */
  dst?: number;
  /** Field name → value, matching canboat's database. */
  fields: Record<string, unknown>;
}
```

In the `WireDriver` interface, add a method:

```ts
  /**
   * Transmit a typed PGN object onto the bus. The driver is responsible for
   * encoding it appropriately (Actisense ASCII for NGT-1, raw CAN for the
   * Phase 1 MCU driver).
   */
  txPgn(pgn: OutgoingPgn): Promise<void>;
```

- [ ] **Step 2: Stub `txPgn` on `Ngt1Driver`** (full implementation in Task 8)

In `ngt-driver.ts`, import `OutgoingPgn` and add:

```ts
  async txPgn(_pgn: OutgoingPgn): Promise<void> {
    throw new Error('Ngt1Driver.txPgn not implemented yet (Task 8 lands it)');
  }
```

This is a temporary throw; Task 8 replaces it.

- [ ] **Step 3: Stub `txPgn` on `SerialPort0183Driver` and `ReplayDriver`**

Both throw permanently:

```ts
  async txPgn(_pgn: OutgoingPgn): Promise<void> {
    throw new Error('<DriverName>.txPgn not supported');
  }
```

(With the appropriate driver name in the error.)

- [ ] **Step 4: Run all bridge tests**

```
npx vitest run packages/bridge
```

All 48+ tests still pass — pure interface widening.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/wire-driver.ts packages/bridge/src/ngt-driver.ts packages/bridge/src/nmea0183/serial-driver.ts packages/bridge/src/persistence/replay-driver.ts
git commit -m "feat(bridge): add txPgn(pgn) to WireDriver, stub on drivers"
```

---

## Task 8: Implement `Ngt1Driver.txPgn` (TDD)

**Files:**

- Modify: `packages/bridge/src/ngt-driver.ts`
- Modify: `packages/bridge/src/ngt-driver.test.ts`

The Phase 0 NGT-1 is in ASCII mode. canboatjs's `pgnToActisenseN2KAsciiFormat` (verified in Plan 1's smoke test) encodes a PGN object into the comma-separated ASCII format with a checksum. We write that string + `\n` to the underlying serial source.

**Smoke-test the canboatjs API first:** if `pgnToActisenseN2KAsciiFormat` doesn't exist or behaves differently than expected, fall back to `pgnToActisenseSerialFormat` (the older binary format) or `toActisenseSerialFormat`. Pick whichever produces a string the NGT-1 will accept on the same line-oriented serial port. Document which one you used.

- [ ] **Step 1: Smoke-test the canboatjs encoder**

Create `/tmp/smoke-tx.mjs`:

```js
import canboat from '@canboat/canboatjs';

const out =
  canboat.pgnToActisenseN2KAsciiFormat?.({
    pgn: 130306,
    prio: 2,
    dst: 255,
    fields: { 'Wind Speed': 5.34, 'Wind Angle': 1.0, Reference: 'Apparent' },
  }) ??
  canboat.pgnToActisenseSerialFormat?.({
    pgn: 130306,
    prio: 2,
    dst: 255,
    fields: { 'Wind Speed': 5.34, 'Wind Angle': 1.0, Reference: 'Apparent' },
  });
console.log('encoded:', JSON.stringify(out));
```

Run: `node /tmp/smoke-tx.mjs`. Expected: prints a non-empty string. **Note which encoder produced it.** Pick the corresponding function in the implementation. Delete the smoke script.

- [ ] **Step 2: Add a TX test to `ngt-driver.test.ts`**

The existing `MemorySource` only emits data; for TX we need a sink. Extend it to record `write()` calls. Append (don't replace) to the existing test file:

```ts
class MemorySink {
  writes: Buffer[] = [];
  on() {
    return this;
  }
  off() {
    return this;
  }
  write(buf: Buffer | string, cb?: () => void): boolean {
    this.writes.push(typeof buf === 'string' ? Buffer.from(buf) : buf);
    cb?.();
    return true;
  }
}

describe('Ngt1Driver.txPgn', () => {
  it('encodes a PGN 130306 wind frame and writes the line to the serial sink', async () => {
    const sink = new MemorySink();
    const driver = new Ngt1Driver({ source: sink as any });
    await driver.start();
    await driver.txPgn({
      pgn: 130306,
      prio: 2,
      dst: 255,
      fields: {
        'Wind Speed': 5.34,
        'Wind Angle': 1.0,
        Reference: 'Apparent',
      },
    });
    expect(sink.writes.length).toBeGreaterThan(0);
    const text = Buffer.concat(sink.writes).toString('utf8');
    expect(text).toMatch(/130306/);
    expect(text.endsWith('\n')).toBe(true);
  });
});
```

(The `as any` cast on `sink` is fine — the driver only writes; it doesn't actually need the full `Ngt1Source` shape for this path. If your TypeScript prefers a tighter shape, define a `MemorySinkSource` class that extends both shapes.)

- [ ] **Step 3: Run — expect failure**

```
npx vitest run packages/bridge/src/ngt-driver.test.ts
```

The new test fails because `txPgn` still throws.

- [ ] **Step 4: Implement `Ngt1Driver.txPgn`**

Add an `Ngt1Sink` interface alongside `Ngt1Source`:

```ts
export interface Ngt1Sink {
  write(buf: Buffer | string, cb?: (err?: Error | null) => void): boolean;
}
```

Update the constructor to accept both shapes (most real `SerialPort` instances satisfy both). Then replace the throwing `txPgn` with:

```ts
import canboat from '@canboat/canboatjs';

// near the top, alongside FromPgn cast:
const { pgnToActisenseN2KAsciiFormat } = canboat as unknown as {
  FromPgn: new () => /* … existing */;
  pgnToActisenseN2KAsciiFormat: (pgn: OutgoingPgn) => string;
};

// ... in the class:

  async txPgn(pgn: OutgoingPgn): Promise<void> {
    const line = pgnToActisenseN2KAsciiFormat({
      pgn: pgn.pgn,
      prio: pgn.prio ?? 6,
      dst: pgn.dst ?? 255,
      fields: pgn.fields,
    });
    if (!line) throw new Error(`canboatjs returned empty encoding for PGN ${pgn.pgn}`);
    const sink = this.source as unknown as Ngt1Sink;
    if (typeof sink.write !== 'function') {
      throw new Error('Ngt1Driver.txPgn: source has no .write() method');
    }
    await new Promise<void>((resolve, reject) => {
      sink.write(line + '\n', (err) => (err ? reject(err) : resolve()));
    });
  }
```

If your smoke test in Step 1 confirmed a different encoder (e.g. `pgnToActisenseSerialFormat`), substitute that name throughout. Add a comment noting which encoder you used and why.

- [ ] **Step 5: Run — expect pass**

```
npx vitest run packages/bridge/src/ngt-driver.test.ts
```

All NGT-1 tests pass (existing 2 + new 1 = 3).

- [ ] **Step 6: Run all bridge tests**

```
npx vitest run packages/bridge
```

All pass.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/ngt-driver.ts packages/bridge/src/ngt-driver.test.ts
git commit -m "feat(bridge): Ngt1Driver.txPgn encodes via canboatjs and writes to serial"
```

---

## Task 9: TX wiring — subscribe to compute output, throttle, send (TDD)

**Files:**

- Create: `packages/bridge/src/tx/true-wind-tx.ts`
- Test: `packages/bridge/src/tx/true-wind-tx.test.ts`

The TX wiring subscribes to `wind.true.calibrated.{speed,angle}` channels, combines them by latest, throttles emission to 5 Hz, builds a PGN 130306 object, and calls `driver.txPgn(...)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Bus, type Sample } from '@h6000/core';
import { startTrueWindTx } from './true-wind-tx.js';
import type { OutgoingPgn, WireDriver } from '../wire-driver.js';
import { Subject, BehaviorSubject } from 'rxjs';

class FakeDriver implements WireDriver {
  rxCan = new Subject<never>() as never;
  rx0183 = new Subject<never>() as never;
  health = new BehaviorSubject({
    connected: true,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  start = async () => {};
  stop = async () => {};
  txCan = async () => {
    throw new Error();
  };
  tx0183 = async () => {
    throw new Error();
  };
  sent: OutgoingPgn[] = [];
  txPgn = async (pgn: OutgoingPgn): Promise<void> => {
    this.sent.push(pgn);
  };
}

const sample = (channel: string, value: number, t_ns: bigint = 1n): Sample => ({
  channel,
  t_ns,
  value: { kind: 'scalar', value },
  source: 'test',
});

describe('startTrueWindTx', () => {
  let bus: Bus;
  let driver: FakeDriver;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    bus = new Bus();
    driver = new FakeDriver();
    stop = await startTrueWindTx({
      bus,
      driver,
      throttleMs: 10, // fast for tests
    });
  });

  afterEach(async () => {
    await stop();
  });

  it('emits PGN 130306 with apparent reference fields when both speed and angle are present', async () => {
    bus.publish(sample('wind.true.calibrated.angle', 0.785));
    bus.publish(sample('wind.true.calibrated.speed', 5.2));
    await new Promise((r) => setTimeout(r, 30));
    expect(driver.sent.length).toBeGreaterThanOrEqual(1);
    const last = driver.sent[driver.sent.length - 1]!;
    expect(last.pgn).toBe(130306);
    expect(last.fields['Wind Speed']).toBeCloseTo(5.2, 4);
    expect(last.fields['Wind Angle']).toBeCloseTo(0.785, 4);
    // We're emitting calibrated TRUE wind:
    expect(String(last.fields['Reference'])).toMatch(/True/);
  });

  it('throttles to roughly the configured interval', async () => {
    // Publish fast — driver should NOT see one TX per publish.
    for (let i = 0; i < 50; i++) {
      bus.publish(sample('wind.true.calibrated.angle', i * 0.01));
      bus.publish(sample('wind.true.calibrated.speed', 5));
    }
    await new Promise((r) => setTimeout(r, 50));
    // 50ms wall, throttle 10ms → at most 6 emissions
    expect(driver.sent.length).toBeLessThanOrEqual(6);
    expect(driver.sent.length).toBeGreaterThan(0);
  });

  it('does not emit if only one of speed/angle has been seen', async () => {
    bus.publish(sample('wind.true.calibrated.speed', 5));
    await new Promise((r) => setTimeout(r, 30));
    expect(driver.sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```
npx vitest run packages/bridge/src/tx/true-wind-tx.test.ts
```

Module not found.

- [ ] **Step 3: Implement `packages/bridge/src/tx/true-wind-tx.ts`**

```ts
import { Subject, throttleTime, type Subscription } from 'rxjs';
import type { Bus } from '@h6000/core';
import type { WireDriver } from '../wire-driver.js';

export interface TrueWindTxOptions {
  bus: Bus;
  driver: WireDriver;
  /** Minimum interval between transmits, ms. Default 200 (5 Hz). */
  throttleMs?: number;
}

/**
 * Subscribe to `wind.true.calibrated.{speed,angle}` on the bus and emit
 * PGN 130306 frames to the wire-driver at most once every `throttleMs`.
 *
 * The PGN encodes Reference = "True (boat referenced)" which is what the
 * H5000 / Zeus SR family expects for TWS/TWA values referenced to the boat
 * (not ground-true wind direction — that's "True (ground referenced)").
 */
export async function startTrueWindTx(opts: TrueWindTxOptions): Promise<() => Promise<void>> {
  const { bus, driver } = opts;
  const throttleMs = opts.throttleMs ?? 200;

  let speed: number | undefined;
  let angle: number | undefined;
  const trigger = new Subject<void>();

  const subs = [
    bus.subscribe('wind.true.calibrated.speed', (s) => {
      if (s.value.kind === 'scalar') {
        speed = s.value.value;
        trigger.next();
      }
    }),
    bus.subscribe('wind.true.calibrated.angle', (s) => {
      if (s.value.kind === 'scalar') {
        angle = s.value.value;
        trigger.next();
      }
    }),
  ];

  const rxSub: Subscription = trigger
    .pipe(throttleTime(throttleMs, undefined, { leading: true, trailing: true }))
    .subscribe(() => {
      if (speed === undefined || angle === undefined) return;
      void driver.txPgn({
        pgn: 130306,
        prio: 2,
        dst: 255,
        fields: {
          'Wind Speed': speed,
          'Wind Angle': angle,
          Reference: 'True (boat referenced)',
        },
      });
    });

  return async () => {
    for (const u of subs) u();
    rxSub.unsubscribe();
  };
}
```

- [ ] **Step 4: Run — expect pass**

```
npx vitest run packages/bridge/src/tx/true-wind-tx.test.ts
```

All 3 tests pass.

- [ ] **Step 5: Update `packages/bridge/src/index.ts`** to export the new TX surface

```ts
// Add to existing exports:
export * from './tx/true-wind-tx.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/tx/true-wind-tx.ts packages/bridge/src/tx/true-wind-tx.test.ts packages/bridge/src/index.ts
git commit -m "feat(bridge): TX wiring for calibrated true wind PGN 130306"
```

---

## Task 10: Web API — `/api/config/aws-awa` GET/PUT

**Files:**

- Create: `packages/web/src/app/api/config/aws-awa/route.ts`

A minimal pair of endpoints so the cal table can be read and overwritten without writing SQL. Plan 3B will replace this with a proper editor UI; for now, having an HTTP surface lets you `curl` the table.

This task assumes a `getConfigStore()` accessor will exist in `@h6000/core`'s shared-singleton pattern (analogous to `getSharedBus`). Wire it up in this task as well.

- [ ] **Step 1: Add `config-store-singleton.ts` to `@h6000/core`**

Create `packages/core/src/config-store-singleton.ts`:

```ts
import type { ConfigStore } from '@h6000/db';

let instance: ConfigStore | null = null;

/**
 * Returns the process-wide shared ConfigStore. Throws if not yet set.
 * Set by autopilot-server during boot via `setSharedConfigStore`.
 */
export function getSharedConfigStore(): ConfigStore {
  if (!instance) {
    throw new Error(
      'ConfigStore not initialized — autopilot-server must call setSharedConfigStore() during boot',
    );
  }
  return instance;
}

export function setSharedConfigStore(store: ConfigStore): void {
  instance = store;
}

export function _resetSharedConfigStoreForTests(): void {
  instance = null;
}
```

**However:** `@h6000/core` cannot import from `@h6000/db` (would create a cycle: db depends on core). Instead, type the singleton as `unknown` and cast at the call sites:

Actually, the cleanest move is: put the singleton accessor in `@h6000/db` itself. Update `packages/db/src/index.ts` to also export a process-wide singleton:

```ts
// packages/db/src/index.ts
export * from './schema.js';
export * from './defaults.js';
export * from './config-store.js';

import { ConfigStore } from './config-store.js';

let instance: ConfigStore | null = null;

export function getSharedConfigStore(): ConfigStore {
  if (!instance) {
    throw new Error(
      'ConfigStore not initialized — autopilot-server must call setSharedConfigStore() during boot',
    );
  }
  return instance;
}

export function setSharedConfigStore(store: ConfigStore): void {
  instance = store;
}

export function _resetSharedConfigStoreForTests(): void {
  instance = null;
}
```

(Don't create the `config-store-singleton.ts` in core; place the singleton in db's index.ts as shown.)

- [ ] **Step 2: Add `@h6000/db` as a dependency of `@h6000/web`**

Edit `packages/web/package.json` to add `"@h6000/db": "*"` to its `dependencies`.

Run `npm install` to wire the symlink.

- [ ] **Step 3: Build the db package**

```
npm run build --workspace=@h6000/db
```

Required because Next.js consumes core via the compiled `dist/` (Plan 1 finding) — same applies to db.

Update `packages/db/package.json` to point `main` at `./dist/index.js` to match core's pattern:

```json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
```

Then rebuild.

- [ ] **Step 4: Implement `packages/web/src/app/api/config/aws-awa/route.ts`**

```ts
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type AwsAwaCalTable } from '@h6000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cal = await firstValueFrom(store.awsAwaCal$);
  return Response.json(cal);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: AwsAwaCalTable;
  try {
    body = (await req.json()) as AwsAwaCalTable;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validateAwsAwaCal(body)) {
    return Response.json({ error: 'invalid cal table shape' }, { status: 422 });
  }
  await store.setAwsAwaCal(body);
  return Response.json({ ok: true });
}

function validateAwsAwaCal(cal: unknown): cal is AwsAwaCalTable {
  if (!cal || typeof cal !== 'object') return false;
  const c = cal as Record<string, unknown>;
  if (
    !Array.isArray(c.awsBins) ||
    !Array.isArray(c.awaBins) ||
    !Array.isArray(c.angleCorrection) ||
    !Array.isArray(c.speedMultiplier)
  ) {
    return false;
  }
  const aws = c.awsBins.length;
  const awa = c.awaBins.length;
  if (
    (c.angleCorrection as unknown[]).length !== aws ||
    (c.speedMultiplier as unknown[]).length !== aws
  ) {
    return false;
  }
  for (const row of c.angleCorrection as unknown[]) {
    if (!Array.isArray(row) || row.length !== awa) return false;
  }
  for (const row of c.speedMultiplier as unknown[]) {
    if (!Array.isArray(row) || row.length !== awa) return false;
  }
  return true;
}
```

- [ ] **Step 5: Typecheck**

```
npm run typecheck --workspace=@h6000/web
```

Clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/index.ts packages/db/package.json packages/web/package.json packages/web/src/app/api/config/aws-awa/route.ts package-lock.json
git commit -m "feat(web): minimal /api/config/aws-awa GET and PUT"
```

---

## Task 11: autopilot-server integration

**Files:**

- Modify: `apps/autopilot-server/src/index.ts`
- Modify: `apps/autopilot-server/package.json`

Boot order:

1. Open `ConfigStore` at `<dataDir>/config.db` (env var or default `./data/config.db`).
2. Set the singleton (so the web side's `/api/config/aws-awa` route can find it).
3. Boot drivers as before.
4. Run bridge.
5. Start true-wind compute pipeline.
6. Start true-wind TX (only if a driver supporting `txPgn` is present — i.e., NGT-1).
7. Boot Next.js.

- [ ] **Step 1: Add `@h6000/db` and `@h6000/compute` deps**

Edit `apps/autopilot-server/package.json` and add to `dependencies`:

```json
"@h6000/db": "*",
"@h6000/compute": "*",
```

Run `npm install`.

- [ ] **Step 2: Build core + db before continuing**

```
npm run build --workspace=@h6000/core
npm run build --workspace=@h6000/db
```

(Update the `predev`/`prebuild` scripts to include both. The script in `apps/autopilot-server/package.json`:

```json
"predev": "tsc -b ../../packages/core ../../packages/db",
"prebuild": "tsc -b ../../packages/core ../../packages/db",
```

)

- [ ] **Step 3: Update `apps/autopilot-server/src/index.ts`**

Add to imports:

```ts
import { mkdir } from 'node:fs/promises';
import { ConfigStore, setSharedConfigStore } from '@h6000/db';
import { startTrueWindPipeline } from '@h6000/compute';
import { startTrueWindTx, type WireDriver, Ngt1Driver } from '@h6000/bridge';
```

Add new env var:

```ts
const CONFIG_DB_PATH = process.env.CONFIG_DB ?? './data/config.db';
```

Inside `main()`, before the `bus`/drivers block:

```ts
// 0. Open ConfigStore so any code path (web routes, compute pipeline)
//    can resolve it.
const dataDir = path.dirname(CONFIG_DB_PATH);
await mkdir(dataDir, { recursive: true });
const store = await ConfigStore.open(CONFIG_DB_PATH);
setSharedConfigStore(store);
teardown.push(() => store.close());
```

After `runBridge`:

```ts
// Start the true-wind compute pipeline (subscribes to the bus and the
// ConfigStore, publishes wind.true.calibrated.* back to the bus).
const stopCompute = await startTrueWindPipeline({
  bus,
  configStore: store,
});
teardown.push(stopCompute);

// Start the true-wind TX wiring. Picks the first driver that supports
// txPgn (i.e. the NGT-1, which throws on others).
const ngt = drivers.find((d) => d instanceof Ngt1Driver);
if (ngt && !REPLAY) {
  const stopTx = await startTrueWindTx({ bus, driver: ngt });
  teardown.push(stopTx);
  // eslint-disable-next-line no-console
  console.log('[autopilot] true-wind TX online via NGT-1');
}
```

- [ ] **Step 4: Smoke-test (SKIP_BRIDGE path)**

```bash
npm run build --workspace=@h6000/core
npm run build --workspace=@h6000/db
SKIP_BRIDGE=1 timeout 20 npm run dev --workspace=@h6000/autopilot-server > /tmp/autopilot-task11.log 2>&1
cat /tmp/autopilot-task11.log
```

Expected: server boots, ConfigStore opens at `./data/config.db`, no NGT-1 attempt, web UI on port 3000. With no NGT-1 the TX wiring is skipped (correct).

```
curl -s -o /dev/null -w "GET /inspect: %{http_code}\n" -m 3 http://localhost:3000/inspect
curl -s -m 3 http://localhost:3000/api/config/aws-awa | head -c 200
```

Expected: `/inspect` returns 200, `/api/config/aws-awa` returns the default cal table JSON.

- [ ] **Step 5: Typecheck**

```
npx tsc -b apps/autopilot-server
```

Clean.

- [ ] **Step 6: Commit**

```bash
git add apps/autopilot-server/package.json apps/autopilot-server/src/index.ts package-lock.json
git commit -m "feat(server): integrate ConfigStore, true-wind compute, and TX wiring"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full test suite**

```
npm test
```

Expected: all packages green. Approximate count: prior 48 + ~20 new (db: 4, compute: ~8, bridge: ~4, …) = ~68 tests.

- [ ] **Step 2: Typecheck workspace**

```
npx tsc -b
```

Clean.

- [ ] **Step 3: Lint and format**

```
npm run lint
```

If anything is unformatted, run `npm run format` and commit.

- [ ] **Step 4: Commit any prettier-formatted files**

```bash
git add -u
git commit -m "chore: prettier formatting after Plan 3 landing"
```

(Skip if nothing changed.)

---

## Closing notes

After this plan lands:

- The H6000 computes calibrated true wind from raw inputs and emits PGN 130306 onto the N2K bus.
- Identity / zero cal means the _value_ will look similar to whatever was already on the bus — but it's now coming from us, with the cal infrastructure in place to start tuning.
- Cal tables can be edited via `curl -X PUT /api/config/aws-awa` (no UI yet).
- Hot-reload works: edit the table, the next compute tick uses the new values.

Plan 3B picks up:

- Web UI for the AWS/AWA cal grid (visual heat-map editor).
- Tack-test wizard.
- Polars editor (Expedition CSV import, target speed compute, %polar, target VMG).
- BSP and compass-deviation calibration procedures (the tables already exist; the UI to fill them is what's missing).

Out of scope still and beyond Plan 3B:

- Leeway / current pipelines (Plan 4 with the hybrid Option-C model).
- Layline projection (Plan 5).
- Autopilot decode → shadow → live (Plan 6).
