# G5000 Plan 7 — Polars and Performance Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Import a polar table (Expedition CSV), edit cells in a browser, and have the compute pipeline publish target boat speed, %polar, current VMG, target VMG, and target TWA upwind/downwind back onto the bus. This is the first feature where the G5000 tells you something your H5000 doesn't — the calibrated, boat-specific performance numbers a polar table unlocks.

**Architecture:**
- New `polars` table in `@g5000/db` (single-row, JSON payload — same pattern as the cal tables). New `PolarTable` interface + a built-in cat-shaped default polar for first boot. ConfigStore gets a fourth observable: `polars$`.
- New `polars/` module in `@g5000/compute` with: an Expedition CSV parser (`parseExpeditionPolar`), the math primitives (`interpolatePolarSpeed`, `optimalTwaForVmg`), and a `startPolarPipeline()` that subscribes to `wind.true.calibrated.*` and `boat.speed.water`, computes the performance numbers per tick, and publishes them as `performance.*` channels on the bus.
- New `/api/config/polars` GET / PUT and `/api/config/polars/import` POST endpoints. PUT takes the full structured table; the import POST takes a raw CSV body and replaces the table.
- New `/polars` page following the established heatmap-editor pattern: a colored grid of TWS rows × TWA columns showing boat speed, click a cell to edit, plus an "Import CSV" file picker.
- autopilot-server wires up the new pipeline and config observable.

**Tech stack additions:** none. The polar plot visualization (the classic radial diagram) is deferred to Plan 8 — heatmap is fine for now and reuses the CalHeatmap pattern.

**Reference spec:** `docs/superpowers/specs/2026-05-08-h6000-design.md`. Implements build-sequence step 14.

---

## What's in scope

- Polar storage: new SQLite table + ConfigStore observable + identity default (a cat-shaped baseline polar).
- Expedition CSV parser: tab/comma-separated grid with TWS column headers + TWA row headers, returns a typed `PolarTable`.
- Pure-function polar math: bilinear interpolation for target speed at any (TWS, |TWA|), VMG and target-VMG computation, optimal-TWA-for-VMG search (per TWS row, cached at table load).
- Compute pipeline: subscribes to required bus channels, applies math on every tick, publishes `performance.targetSpeed`, `performance.percentPolar`, `performance.vmg`, `performance.targetVmg`, `performance.targetTwaUpwind`, `performance.targetTwaDownwind`.
- REST API for polars (GET / PUT / POST-import).
- `/polars` page with heatmap + cell editor + CSV upload.
- autopilot-server integration.

## What's NOT in scope

- Polar plot (radial / "racing chart" visualization) — Plan 8 picks this up.
- VPP-style time-corrected scoring.
- Multiple polars (foiling vs. non-foiling). Single polar for now; multi-mode lands when we add the `mode` channel.
- N2K TX of performance values. The pipeline publishes to the bus only; transmitting `performance.*` to chart plotters as B&G-proprietary PGNs is later work.
- Beating-angle / running-angle persistence (we recompute every tick rather than store).

---

## File structure

```
autopilot/
├── packages/
│   ├── db/
│   │   └── src/
│   │       ├── defaults.ts                       MODIFY: add PolarTable type + DEFAULT_POLARS
│   │       ├── schema.ts                         MODIFY: add polars table
│   │       └── config-store.ts                   MODIFY: add polars$ observable + setPolars
│   ├── compute/
│   │   └── src/
│   │       ├── polars/
│   │       │   ├── csv-parser.ts                 NEW: Expedition CSV → PolarTable
│   │       │   ├── csv-parser.test.ts            NEW
│   │       │   ├── math.ts                       NEW: interpolation + VMG + optimal TWA
│   │       │   ├── math.test.ts                  NEW
│   │       │   ├── pipeline.ts                   NEW: RxJS pipeline
│   │       │   └── pipeline.test.ts              NEW
│   │       └── index.ts                          MODIFY: re-export polars/*
│   └── web/
│       └── src/app/
│           ├── api/config/polars/
│           │   ├── route.ts                      NEW (GET / PUT)
│           │   └── import/route.ts               NEW (POST CSV)
│           └── polars/
│               ├── page.tsx                      NEW
│               ├── PolarHeatmap.tsx              NEW
│               └── PolarCellEditor.tsx           NEW
└── apps/
    └── autopilot-server/
        └── src/
            └── index.ts                          MODIFY: start polar pipeline
```

---

## Task 1: Polar schema, defaults, and ConfigStore observable (TDD-extension)

**Files:**
- Modify: `packages/db/src/defaults.ts` — add `PolarTable` interface + `DEFAULT_POLARS`
- Modify: `packages/db/src/schema.ts` — add `polars` table
- Modify: `packages/db/src/config-store.ts` — add `polars$` observable, `setPolars()` setter, initialization
- Modify: `packages/db/src/config-store.test.ts` — extend tests to cover polars

### Step 1: Add `PolarTable` to `defaults.ts`

Append after the existing exports:

```ts
/**
 * Boat polar: rows = true wind speed bins, cols = true wind angle bins.
 * `boatSpeed[twsIdx][twaIdx]` is target boat speed (m/s) at that wind state.
 * Both bin arrays must be strictly increasing. TWA bins must span [0, π].
 */
export interface PolarTable {
  /** True wind speed bin centers, m/s. */
  twsBins: number[];
  /** True wind angle bin centers, radians (always positive — table is symmetric). */
  twaBins: number[];
  /** Target boat speed in m/s, indexed [twsIdx][twaIdx]. */
  boatSpeed: number[][];
}

/**
 * Baseline catamaran-ish polar. Values are deliberately rough — the user is
 * expected to import their own polar via CSV before performance numbers are
 * trustworthy. Shape: 8 TWS bins × 9 TWA bins.
 *
 * Boat speeds chosen to roughly resemble a 40' sport catamaran in displacement
 * mode. Real boats vary widely.
 */
const DEG = Math.PI / 180;
export const DEFAULT_POLARS: PolarTable = {
  twsBins: [2, 4, 6, 8, 10, 12, 16, 20], // m/s ≈ 4, 8, 12, 16, 20, 23, 31, 39 kn
  twaBins: [
    0 * DEG,
    30 * DEG,
    45 * DEG,
    60 * DEG,
    90 * DEG,
    120 * DEG,
    135 * DEG,
    150 * DEG,
    180 * DEG,
  ],
  // Rows = TWS (low to high), cols = TWA (0=in-irons, π=dead-down).
  boatSpeed: [
    // TWS 2 m/s (~4 kn)
    [0, 0.8, 1.3, 1.6, 1.6, 1.4, 1.2, 0.9, 0.4],
    // TWS 4 m/s (~8 kn)
    [0, 1.8, 2.7, 3.2, 3.4, 3.3, 3.0, 2.6, 1.6],
    // TWS 6 m/s (~12 kn)
    [0, 3.0, 4.3, 5.0, 5.4, 5.6, 5.4, 5.0, 3.4],
    // TWS 8 m/s (~16 kn)
    [0, 4.0, 5.6, 6.4, 7.0, 7.4, 7.4, 7.1, 5.4],
    // TWS 10 m/s (~20 kn)
    [0, 4.5, 6.4, 7.2, 8.1, 8.7, 8.9, 8.6, 6.8],
    // TWS 12 m/s (~23 kn)
    [0, 4.8, 6.9, 7.8, 8.9, 9.7, 10.0, 9.7, 7.8],
    // TWS 16 m/s (~31 kn)
    [0, 5.0, 7.2, 8.3, 9.7, 10.7, 11.0, 10.8, 8.8],
    // TWS 20 m/s (~39 kn)
    [0, 5.0, 7.3, 8.5, 10.0, 11.1, 11.4, 11.2, 9.0],
  ],
};
```

### Step 2: Add polars table to `schema.ts`

Append:

```ts
export const polars = sqliteTable('polars', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded PolarTable
});
```

### Step 3: Extend `ConfigStore` to handle polars

In `packages/db/src/config-store.ts`:

1. Add to imports:
```ts
import {
  ...,
  DEFAULT_POLARS,
  type PolarTable,
  ...,
} from './defaults.js';
import { polars, ... } from './schema.js';
```

2. Extend the constructor's `subjects` object literal type, add `polars` initial-value parameter, and add it to the subjects:
```ts
private readonly subjects: {
  boatConfig: BehaviorSubject<BoatConfig>;
  awsAwaCal: BehaviorSubject<AwsAwaCalTable>;
  bspCal: BehaviorSubject<BspCal>;
  compassDeviation: BehaviorSubject<CompassDeviation>;
  polars: BehaviorSubject<PolarTable>;  // NEW
};
```

3. Add a `CREATE TABLE IF NOT EXISTS polars (id TEXT PRIMARY KEY, value TEXT NOT NULL)` to the `raw.exec(...)` block in `open()`.

4. Add to the `loadOrInsert` table union type list (`typeof boatConfigTable | typeof awsAwaCal | typeof bspCal | typeof compassDeviation | typeof polars`).

5. Add `polars: loadOrInsert<PolarTable>(polars, DEFAULT_POLARS)` to the `initial` object.

6. Initialize `subjects.polars` from `initial.polars` in the constructor.

7. Add the getter:
```ts
get polars$(): Observable<PolarTable> {
  return this.subjects.polars.asObservable();
}
```

8. Add the setter:
```ts
async setPolars(value: PolarTable): Promise<void> {
  this.upsert(polars, value);
  this.subjects.polars.next(value);
}
```

9. Add `polars` to the type union in `upsert`.

10. Add `this.subjects.polars.complete()` to `close()`.

### Step 4: Extend `config-store.test.ts` with polar tests

Append (don't replace) to the existing `describe('ConfigStore', ...)` block:

```ts
import { DEFAULT_POLARS, type PolarTable } from './defaults.js';

it('returns the default polar on a fresh database', async () => {
  const polars = await firstValueFrom(store.polars$);
  expect(polars.twsBins).toEqual(DEFAULT_POLARS.twsBins);
  expect(polars.boatSpeed.length).toBe(DEFAULT_POLARS.twsBins.length);
});

it('emits a new polar when setPolars is called', async () => {
  const next: Promise<PolarTable> = firstValueFrom(
    store.polars$.pipe(skip(1), take(1)),
  );
  const updated: PolarTable = {
    ...DEFAULT_POLARS,
    boatSpeed: DEFAULT_POLARS.boatSpeed.map((row) => row.map(() => 0)),
  };
  await store.setPolars(updated);
  const v = await next;
  expect(v.boatSpeed.flat().every((x) => x === 0)).toBe(true);
});
```

### Step 5: Run tests — expect 2 new tests pass + 4 existing tests still pass

```
npx vitest run packages/db
```

All 6 tests pass.

### Step 6: Rebuild db dist (web consumes it from dist)

```
npm run build --workspace=@g5000/db
```

### Step 7: Verify typecheck

```
npx tsc -b packages/db
```

Clean.

### Step 8: Commit

```bash
git add packages/db/src/defaults.ts packages/db/src/schema.ts packages/db/src/config-store.ts packages/db/src/config-store.test.ts
git commit -m "feat(db): add PolarTable schema, defaults, and ConfigStore.polars\$"
```

---

## Task 2: Expedition CSV parser (TDD)

**Files:**
- Create: `packages/compute/src/polars/csv-parser.ts`
- Test: `packages/compute/src/polars/csv-parser.test.ts`

Expedition's polar format uses tab or comma separation, with TWS values in the header row (after a `twa/tws` label) and TWA values in the leftmost column. All values are in knots and degrees by Expedition convention; we convert to m/s and radians internally so downstream code is consistently SI.

Example input:
```
twa/tws	4	6	8	10	12
0	0	0	0	0	0
30	2.5	4.0	5.2	6.0	6.4
45	3.8	5.5	6.8	7.7	8.2
...
```

### Step 1: Write the failing tests

```ts
import { describe, it, expect } from 'vitest';
import { parseExpeditionPolar } from './csv-parser.js';

const KNOTS_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

describe('parseExpeditionPolar', () => {
  it('parses a minimal tab-separated polar with one row', () => {
    const csv = 'twa/tws\t4\t8\n45\t3.0\t5.0\n';
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins.map((v) => v / KNOTS_TO_MS)).toEqual([4, 8]);
    expect(polar.twaBins).toEqual([45 * DEG_TO_RAD]);
    expect(polar.boatSpeed[0]![0]).toBeCloseTo(3.0 * KNOTS_TO_MS, 4);
    expect(polar.boatSpeed[1]![0]).toBeCloseTo(5.0 * KNOTS_TO_MS, 4);
  });

  it('parses comma-separated input', () => {
    const csv = 'twa/tws,4,8\n45,3.0,5.0\n';
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins.length).toBe(2);
    expect(polar.twaBins.length).toBe(1);
  });

  it('parses a multi-row polar', () => {
    const csv = [
      'twa/tws\t4\t8\t12',
      '30\t2.5\t4.0\t5.0',
      '60\t3.8\t5.5\t6.8',
      '90\t3.5\t5.0\t6.5',
    ].join('\n');
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins.length).toBe(3);
    expect(polar.twaBins.length).toBe(3);
    expect(polar.boatSpeed[0]!.length).toBe(3); // 3 TWA bins for TWS index 0
    expect(polar.boatSpeed[1]!.length).toBe(3);
  });

  it('ignores blank lines and trailing whitespace', () => {
    const csv = '\n\ntwa/tws\t4\t8\n\n45\t3.0\t5.0\n\n';
    const polar = parseExpeditionPolar(csv);
    expect(polar.twaBins.length).toBe(1);
  });

  it('skips comment lines starting with #', () => {
    const csv = ['# Boat: J/70', 'twa/tws\t4\t8', '45\t3.0\t5.0'].join('\n');
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins.length).toBe(2);
  });

  it('throws on malformed input (missing header)', () => {
    const csv = '45\t3.0\t5.0\n';
    expect(() => parseExpeditionPolar(csv)).toThrow();
  });

  it('throws on inconsistent row length', () => {
    const csv = 'twa/tws\t4\t8\n45\t3.0\n';
    expect(() => parseExpeditionPolar(csv)).toThrow();
  });

  it('rounds TWA bin to 6 decimal places (avoid floating-point noise)', () => {
    const csv = 'twa/tws\t4\n45\t3.0\n';
    const polar = parseExpeditionPolar(csv);
    // 45° in radians has many decimal places; we just verify it's close.
    expect(polar.twaBins[0]).toBeCloseTo(0.7853982, 6);
  });

  it('converts TWS knots → m/s and TWA degrees → radians correctly', () => {
    const csv = 'twa/tws\t10\n90\t5.0\n';
    const polar = parseExpeditionPolar(csv);
    expect(polar.twsBins[0]).toBeCloseTo(10 * KNOTS_TO_MS, 4); // ~5.144 m/s
    expect(polar.twaBins[0]).toBeCloseTo(Math.PI / 2, 6); // 90° = π/2
    expect(polar.boatSpeed[0]![0]).toBeCloseTo(5.0 * KNOTS_TO_MS, 4);
  });
});
```

### Step 2: Run — expect failure (module not found)

```
npx vitest run packages/compute/src/polars/csv-parser.test.ts
```

### Step 3: Implement `csv-parser.ts`

```ts
import type { PolarTable } from '@g5000/db';

const KNOTS_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Parse an Expedition-style polar CSV/TSV into a typed PolarTable.
 *
 * Format:
 *   - First non-blank, non-comment line is the header: `twa/tws<sep>tws1<sep>tws2<sep>...`
 *     (TWS values in knots).
 *   - Subsequent lines: `twa<sep>bsp1<sep>bsp2<sep>...` (TWA in degrees, boat speed in knots).
 *   - Separator can be tab or comma; both are accepted on every line.
 *   - Blank lines and lines starting with `#` are skipped.
 *   - All values are converted to SI: TWS m/s, TWA radians, boat speed m/s.
 */
export function parseExpeditionPolar(csv: string): PolarTable {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 2) {
    throw new Error(
      'parseExpeditionPolar: need at least a header line and one data row',
    );
  }
  const headerTokens = splitLine(lines[0]!);
  if (headerTokens.length < 2) {
    throw new Error(
      `parseExpeditionPolar: header has too few columns: "${lines[0]}"`,
    );
  }
  const headerLabel = headerTokens[0]!.toLowerCase().replace(/\s/g, '');
  // Accept any header that includes "twa" or "tws" or starts with a label
  // followed by numeric TWS values. We tolerate "twa/tws", "twa\\tws", etc.
  if (!/twa|tws|^[a-z]/.test(headerLabel)) {
    throw new Error(
      `parseExpeditionPolar: header doesn't look like a polar header: "${lines[0]}"`,
    );
  }
  const twsBinsKn = headerTokens.slice(1).map((s) => {
    const n = Number(s);
    if (!Number.isFinite(n)) {
      throw new Error(
        `parseExpeditionPolar: non-numeric TWS in header: "${s}"`,
      );
    }
    return n;
  });

  const twaBinsDeg: number[] = [];
  const boatSpeedKnByTwa: number[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const tokens = splitLine(lines[i]!);
    if (tokens.length !== twsBinsKn.length + 1) {
      throw new Error(
        `parseExpeditionPolar: row ${i + 1} has ${tokens.length} cols, expected ${twsBinsKn.length + 1}: "${lines[i]}"`,
      );
    }
    const twaDeg = Number(tokens[0]);
    if (!Number.isFinite(twaDeg)) {
      throw new Error(
        `parseExpeditionPolar: row ${i + 1} TWA is not numeric: "${tokens[0]}"`,
      );
    }
    twaBinsDeg.push(twaDeg);
    boatSpeedKnByTwa.push(
      tokens.slice(1).map((s, j) => {
        const n = Number(s);
        if (!Number.isFinite(n)) {
          throw new Error(
            `parseExpeditionPolar: row ${i + 1} col ${j + 2} is not numeric: "${s}"`,
          );
        }
        return n;
      }),
    );
  }

  // Convert to SI and reshape to [twsIdx][twaIdx].
  const twsBins = twsBinsKn.map((kn) => kn * KNOTS_TO_MS);
  const twaBins = twaBinsDeg.map((deg) =>
    Math.round(deg * DEG_TO_RAD * 1e6) / 1e6,
  );
  const boatSpeed: number[][] = twsBins.map((_, twsIdx) =>
    boatSpeedKnByTwa.map((row) => row[twsIdx]! * KNOTS_TO_MS),
  );

  return { twsBins, twaBins, boatSpeed };
}

function splitLine(line: string): string[] {
  // Try tab first, fall back to comma if there are no tabs.
  return line.includes('\t') ? line.split(/\t+/) : line.split(/,+/);
}
```

### Step 4: Run — expect pass

```
npx vitest run packages/compute/src/polars/csv-parser.test.ts
```

All 9 tests pass.

### Step 5: Verify typecheck

```
npx tsc -b packages/compute
```

### Step 6: Commit

```bash
git add packages/compute/src/polars/csv-parser.ts packages/compute/src/polars/csv-parser.test.ts
git commit -m "feat(compute): Expedition polar CSV parser (TWA degrees / TWS knots → SI)"
```

---

## Task 3: Polar math — interpolation, VMG, optimal TWA (TDD)

**Files:**
- Create: `packages/compute/src/polars/math.ts`
- Test: `packages/compute/src/polars/math.test.ts`

Pure functions:
- `interpolatePolarSpeed(polar, tws, twaAbs)` — bilinear interp → target boat speed (m/s)
- `vmgFor(bsp, twa)` — signed VMG; positive = upwind progress, negative = downwind progress
- `optimalTwaForVmg(polar, tws, direction)` — for the given TWS row, return the TWA (radians) that maximizes upwind or downwind VMG by scanning the table

### Step 1: Write the failing tests

```ts
import { describe, it, expect } from 'vitest';
import {
  interpolatePolarSpeed,
  vmgFor,
  optimalTwaForVmg,
} from './math.js';
import { DEFAULT_POLARS } from '@g5000/db';

describe('interpolatePolarSpeed', () => {
  it('returns the cell value at an exact (TWS, TWA) bin match', () => {
    // DEFAULT_POLARS has TWS bin index 2 = 6 m/s, TWA bin index 2 = 45°.
    const expected = DEFAULT_POLARS.boatSpeed[2]![2]!;
    const v = interpolatePolarSpeed(
      DEFAULT_POLARS,
      6,
      (45 * Math.PI) / 180,
    );
    expect(v).toBeCloseTo(expected, 6);
  });

  it('clamps inputs below all bins to the first cell', () => {
    const v = interpolatePolarSpeed(DEFAULT_POLARS, 0.1, 0);
    expect(v).toBe(DEFAULT_POLARS.boatSpeed[0]![0]);
  });

  it('clamps inputs above all bins to the last cell', () => {
    const v = interpolatePolarSpeed(DEFAULT_POLARS, 100, Math.PI * 2);
    const last = DEFAULT_POLARS.boatSpeed[DEFAULT_POLARS.twsBins.length - 1]!;
    expect(v).toBe(last[last.length - 1]);
  });

  it('interpolates linearly between bins', () => {
    // Mid-way between TWS bin 2 (6) and 3 (8) m/s, at exact TWA bin 4 (90°).
    const a = DEFAULT_POLARS.boatSpeed[2]![4]!;
    const b = DEFAULT_POLARS.boatSpeed[3]![4]!;
    const v = interpolatePolarSpeed(DEFAULT_POLARS, 7, (90 * Math.PI) / 180);
    expect(v).toBeCloseTo((a + b) / 2, 6);
  });
});

describe('vmgFor', () => {
  it('returns positive VMG upwind (TWA < π/2)', () => {
    expect(vmgFor(5, (45 * Math.PI) / 180)).toBeCloseTo(
      5 * Math.cos((45 * Math.PI) / 180),
      6,
    );
  });

  it('returns negative VMG downwind (TWA > π/2)', () => {
    expect(vmgFor(5, (135 * Math.PI) / 180)).toBeCloseTo(
      5 * Math.cos((135 * Math.PI) / 180),
      6,
    );
  });
});

describe('optimalTwaForVmg', () => {
  it('finds an upwind TWA in (0, π/2) at moderate TWS', () => {
    const twa = optimalTwaForVmg(DEFAULT_POLARS, 8, 'upwind');
    expect(twa).toBeGreaterThan(0);
    expect(twa).toBeLessThan(Math.PI / 2);
  });

  it('finds a downwind TWA in (π/2, π)', () => {
    const twa = optimalTwaForVmg(DEFAULT_POLARS, 8, 'downwind');
    expect(twa).toBeGreaterThan(Math.PI / 2);
    expect(twa).toBeLessThan(Math.PI);
  });

  it('is monotonic in the right direction with wind speed (rough sanity)', () => {
    // A reasonable cat polar will broaden (optimal TWA stays close to 45°) with
    // light air → moderate. Just assert finite-ness; specific bin choices may
    // jump around because the table is coarse.
    expect(Number.isFinite(optimalTwaForVmg(DEFAULT_POLARS, 4, 'upwind'))).toBe(true);
    expect(Number.isFinite(optimalTwaForVmg(DEFAULT_POLARS, 12, 'downwind'))).toBe(true);
  });
});
```

### Step 2: Run — expect failure

### Step 3: Implement `math.ts`

```ts
import type { PolarTable } from '@g5000/db';

/**
 * Bilinear interpolation of target boat speed at (TWS, |TWA|) on a polar grid.
 * Inputs outside the grid are clamped to the nearest edge.
 */
export function interpolatePolarSpeed(
  polar: PolarTable,
  tws: number,
  twaAbs: number,
): number {
  return bilinear(polar.twsBins, polar.twaBins, polar.boatSpeed, tws, twaAbs);
}

/**
 * Signed VMG: positive = upwind component, negative = downwind component.
 * Equivalent to bsp * cos(TWA); positive TWA above π/2 yields negative VMG.
 */
export function vmgFor(bsp: number, twa: number): number {
  return bsp * Math.cos(twa);
}

/**
 * For a given TWS, find the TWA (radians) that maximizes |VMG| in the
 * requested direction. Scans the polar's TWA bins for the row interpolated
 * to the requested TWS. Coarse — fine enough for Phase 0 display purposes;
 * a continuous solver would refine this further.
 */
export function optimalTwaForVmg(
  polar: PolarTable,
  tws: number,
  direction: 'upwind' | 'downwind',
): number {
  let bestTwa = direction === 'upwind' ? polar.twaBins[1]! : polar.twaBins[polar.twaBins.length - 2]!;
  let bestVmg = -Infinity;
  for (const twa of polar.twaBins) {
    if (direction === 'upwind' && twa >= Math.PI / 2) continue;
    if (direction === 'downwind' && twa <= Math.PI / 2) continue;
    const bsp = interpolatePolarSpeed(polar, tws, twa);
    // For "best upwind" we want the largest +VMG; for "best downwind"
    // we want the largest |negative VMG|, i.e. the most negative VMG
    // → equivalent to largest +VMG against the wind-from-behind, i.e.
    // largest bsp·|cos(twa)|. We optimise the magnitude.
    const vmg = direction === 'upwind' ? bsp * Math.cos(twa) : -bsp * Math.cos(twa);
    if (vmg > bestVmg) {
      bestVmg = vmg;
      bestTwa = twa;
    }
  }
  return bestTwa;
}

function bilinear(
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
  return (
    c00 * (1 - fx) * (1 - fy) +
    c10 * fx * (1 - fy) +
    c01 * (1 - fx) * fy +
    c11 * fx * fy
  );
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
```

(The `bilinear` and `locate` helpers are intentional duplicates of the same functions in `true-wind/math.ts`. Sharing them would be cleaner but is a refactor task — defer.)

### Step 4: Run — expect pass

```
npx vitest run packages/compute/src/polars/math.test.ts
```

### Step 5: Commit

```bash
git add packages/compute/src/polars/math.ts packages/compute/src/polars/math.test.ts
git commit -m "feat(compute): polar interpolation, VMG, optimal-TWA-for-VMG"
```

---

## Task 4: Polar compute pipeline (TDD)

**Files:**
- Create: `packages/compute/src/polars/pipeline.ts`
- Test: `packages/compute/src/polars/pipeline.test.ts`
- Modify: `packages/compute/src/index.ts` — re-export polar surface

Subscribes to:
- `wind.true.calibrated.speed`
- `wind.true.calibrated.angle`
- `boat.speed.water`
- ConfigStore's `polars$`

Publishes:
- `performance.target.boatSpeed` — interpolated at current (TWS, |TWA|)
- `performance.percentPolar` — bsp_actual / target × 100 (or 0 if target is 0)
- `performance.vmg` — current signed VMG
- `performance.target.vmg` — VMG at the optimal TWA for the current direction
- `performance.target.twaUpwind` — best-VMG TWA for current TWS, in (0, π/2)
- `performance.target.twaDownwind` — best-VMG TWA for current TWS, in (π/2, π)

### Step 1: Write the failing tests

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bus, type Sample } from '@g5000/core';
import { ConfigStore } from '@g5000/db';
import { startPolarPipeline } from './pipeline.js';

const sample = (channel: string, value: number, t_ns = 1n): Sample => ({
  channel,
  t_ns,
  value: { kind: 'scalar', value },
  source: 'test',
});

describe('startPolarPipeline', () => {
  let dir: string;
  let store: ConfigStore;
  let bus: Bus;
  let stop: () => Promise<void>;
  let received: Sample[];

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-polar-'));
    store = await ConfigStore.open(path.join(dir, 'config.db'));
    bus = new Bus();
    received = [];
    bus.subscribe('performance.**', (s) => received.push(s));
    stop = await startPolarPipeline({
      bus,
      configStore: store,
      staleAfterMs: 60_000,
    });
  });

  afterEach(async () => {
    await stop();
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('publishes performance.target.{boatSpeed,vmg,twaUpwind,twaDownwind} when all inputs are present', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.calibrated.speed', 8, now)); // 8 m/s TWS
    bus.publish(sample('wind.true.calibrated.angle', Math.PI / 4, now)); // 45° TWA
    bus.publish(sample('boat.speed.water', 5.5, now));

    await new Promise((r) => setTimeout(r, 30));

    const channels = new Set(received.map((s) => s.channel));
    expect(channels.has('performance.target.boatSpeed')).toBe(true);
    expect(channels.has('performance.target.vmg')).toBe(true);
    expect(channels.has('performance.target.twaUpwind')).toBe(true);
    expect(channels.has('performance.target.twaDownwind')).toBe(true);
    expect(channels.has('performance.vmg')).toBe(true);
    expect(channels.has('performance.percentPolar')).toBe(true);
  });

  it('emits percentPolar = actual/target × 100 (rough)', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.calibrated.speed', 8, now));
    bus.publish(sample('wind.true.calibrated.angle', Math.PI / 2, now)); // 90° TWA
    bus.publish(sample('boat.speed.water', 7, now)); // boat speed 7 m/s

    await new Promise((r) => setTimeout(r, 30));

    const pp = received.find((s) => s.channel === 'performance.percentPolar');
    expect(pp).toBeDefined();
    if (pp && pp.value.kind === 'scalar') {
      // For TWS=8 m/s, TWA=90°, default cat polar → about 7.0 m/s. Boat at
      // 7.0 → ~100%. Don't pin exact value; just sanity-check range.
      expect(pp.value.value).toBeGreaterThan(50);
      expect(pp.value.value).toBeLessThan(200);
    }
  });

  it('does not emit when any required input is missing', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.calibrated.speed', 8, now));
    // No TWA, no BSP.
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);
  });

  it('recomputes when the polar table changes', async () => {
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('wind.true.calibrated.speed', 8, now));
    bus.publish(sample('wind.true.calibrated.angle', Math.PI / 4, now));
    bus.publish(sample('boat.speed.water', 5, now));
    await new Promise((r) => setTimeout(r, 30));
    const initial = received.length;
    expect(initial).toBeGreaterThan(0);

    // Zero out the polar — target should drop to 0, percentPolar should
    // become a finite degenerate value (we expect 0 or undefined). We just
    // assert the pipeline RE-fires.
    const polar = await firstValueFromBehavior(store.polars$);
    await store.setPolars({
      ...polar,
      boatSpeed: polar.boatSpeed.map((row) => row.map(() => 0)),
    });
    const now2 = BigInt(Date.now()) * 1_000_000n;
    bus.publish(sample('boat.speed.water', 5.01, now2));
    await new Promise((r) => setTimeout(r, 30));
    expect(received.length).toBeGreaterThan(initial);
  });
});

import { firstValueFrom } from 'rxjs';
const firstValueFromBehavior = firstValueFrom;
```

### Step 2: Run — expect failure

### Step 3: Implement `pipeline.ts`

```ts
import { combineLatest, firstValueFrom, type Subscription } from 'rxjs';
import { Bus, type Sample } from '@g5000/core';
import type { ConfigStore, PolarTable } from '@g5000/db';
import {
  interpolatePolarSpeed,
  optimalTwaForVmg,
  vmgFor,
} from './math.js';

export interface PolarPipelineOptions {
  bus: Bus;
  configStore: ConfigStore;
  /** If a sample on a required channel is older than this, drop the tick. */
  staleAfterMs?: number;
}

interface LatestValues {
  tws?: { value: number; t_ns: bigint };
  twa?: { value: number; t_ns: bigint };
  bsp?: { value: number; t_ns: bigint };
}

export async function startPolarPipeline(
  opts: PolarPipelineOptions,
): Promise<() => Promise<void>> {
  const { bus, configStore } = opts;
  const staleAfterMs = opts.staleAfterMs ?? 2000;
  const latest: LatestValues = {};
  const subs: Array<() => void> = [];
  const rxSubs: Subscription[] = [];

  let polar: PolarTable = await firstValueFrom(configStore.polars$);

  function recompute(): void {
    if (!latest.tws || !latest.twa || !latest.bsp) return;
    const now_ns = BigInt(Date.now()) * 1_000_000n;
    const stale = (t: bigint): boolean =>
      Number((now_ns - t) / 1_000_000n) > staleAfterMs;
    if (
      stale(latest.tws.t_ns) ||
      stale(latest.twa.t_ns) ||
      stale(latest.bsp.t_ns)
    ) {
      return;
    }
    const tws = latest.tws.value;
    const twa = latest.twa.value;
    const twaAbs = Math.abs(twa);
    const bsp = latest.bsp.value;
    const targetBsp = interpolatePolarSpeed(polar, tws, twaAbs);
    const percentPolar = targetBsp > 0 ? (bsp / targetBsp) * 100 : 0;
    const vmg = vmgFor(bsp, twa);
    const tUp = optimalTwaForVmg(polar, tws, 'upwind');
    const tDn = optimalTwaForVmg(polar, tws, 'downwind');
    const targetVmg =
      twaAbs < Math.PI / 2
        ? vmgFor(interpolatePolarSpeed(polar, tws, tUp), tUp)
        : -vmgFor(interpolatePolarSpeed(polar, tws, tDn), tDn);

    bus.publish(make('performance.target.boatSpeed', targetBsp, now_ns, 'm/s'));
    bus.publish(make('performance.percentPolar', percentPolar, now_ns, '%'));
    bus.publish(make('performance.vmg', vmg, now_ns, 'm/s'));
    bus.publish(make('performance.target.vmg', targetVmg, now_ns, 'm/s'));
    bus.publish(make('performance.target.twaUpwind', tUp, now_ns, 'rad'));
    bus.publish(make('performance.target.twaDownwind', tDn, now_ns, 'rad'));
  }

  const trackScalar = (channel: string, key: keyof LatestValues): void => {
    subs.push(
      bus.subscribe(channel, (s) => {
        if (s.value.kind !== 'scalar') return;
        latest[key] = { value: s.value.value, t_ns: s.t_ns };
        recompute();
      }),
    );
  };
  trackScalar('wind.true.calibrated.speed', 'tws');
  trackScalar('wind.true.calibrated.angle', 'twa');
  trackScalar('boat.speed.water', 'bsp');

  rxSubs.push(
    configStore.polars$.subscribe((next) => {
      polar = next;
      recompute();
    }),
  );

  return async () => {
    for (const u of subs) u();
    for (const s of rxSubs) s.unsubscribe();
  };
}

function make(
  channel: string,
  value: number,
  t_ns: bigint,
  unit: string,
): Sample {
  return {
    channel,
    t_ns,
    value: { kind: 'scalar', value, unit },
    source: 'computed:polars',
  };
}
```

### Step 4: Update `packages/compute/src/index.ts` to re-export

Append:

```ts
export * from './polars/csv-parser.js';
export * from './polars/math.js';
export * from './polars/pipeline.js';
```

### Step 5: Run — expect pass

```
npx vitest run packages/compute
```

All polar tests + existing 27 compute tests pass.

### Step 6: Rebuild compute dist

```
npm run build --workspace=@g5000/compute
```

### Step 7: Commit

```bash
git add packages/compute/src/polars/pipeline.ts packages/compute/src/polars/pipeline.test.ts packages/compute/src/index.ts
git commit -m "feat(compute): polar performance pipeline publishes performance.* channels"
```

---

## Task 5: REST endpoints — `/api/config/polars` GET / PUT / import

**Files:**
- Create: `packages/web/src/app/api/config/polars/route.ts`
- Create: `packages/web/src/app/api/config/polars/import/route.ts`

### Step 1: GET / PUT polar table

`packages/web/src/app/api/config/polars/route.ts`:

```ts
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type PolarTable } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const polar = await firstValueFrom(store.polars$);
  return Response.json(polar);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: PolarTable;
  try {
    body = (await req.json()) as PolarTable;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validatePolar(body)) {
    return Response.json(
      { error: 'invalid polar table shape' },
      { status: 422 },
    );
  }
  await store.setPolars(body);
  return Response.json({ ok: true });
}

function validatePolar(p: unknown): p is PolarTable {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (!Array.isArray(o.twsBins) || !Array.isArray(o.twaBins) || !Array.isArray(o.boatSpeed)) {
    return false;
  }
  if ((o.boatSpeed as unknown[]).length !== o.twsBins.length) return false;
  for (const row of o.boatSpeed as unknown[]) {
    if (!Array.isArray(row) || row.length !== o.twaBins.length) return false;
  }
  return true;
}
```

### Step 2: POST CSV import

`packages/web/src/app/api/config/polars/import/route.ts`:

```ts
import { getSharedConfigStore } from '@g5000/db';
import { parseExpeditionPolar } from '@g5000/compute';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  const csv = await req.text();
  if (!csv || csv.length === 0) {
    return Response.json({ error: 'empty body' }, { status: 400 });
  }
  let polar;
  try {
    polar = parseExpeditionPolar(csv);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }
  await store.setPolars(polar);
  return Response.json({
    ok: true,
    twsBinCount: polar.twsBins.length,
    twaBinCount: polar.twaBins.length,
  });
}
```

### Step 3: Typecheck

```
npm run typecheck --workspace=@g5000/web
```

### Step 4: Commit

```bash
git add packages/web/src/app/api/config/polars/route.ts packages/web/src/app/api/config/polars/import/route.ts
git commit -m "feat(web): /api/config/polars GET/PUT and /api/config/polars/import POST"
```

---

## Task 6: `/polars` page — heatmap + CSV import + cell editor

**Files:**
- Create: `packages/web/src/app/polars/page.tsx`
- Create: `packages/web/src/app/polars/PolarHeatmap.tsx`
- Create: `packages/web/src/app/polars/PolarCellEditor.tsx`

Mirror of the `/calibration/wind` pattern. Color the heatmap by boat speed (instead of angle correction). Display values in knots for human-readable headers (m/s for internal storage).

### Step 1: `PolarHeatmap.tsx`

```tsx
'use client';

import type React from 'react';
import type { PolarTable } from '@g5000/db';

export interface PolarHeatmapProps {
  polar: PolarTable;
  selected?: { twsIdx: number; twaIdx: number };
  onSelect?: (cell: { twsIdx: number; twaIdx: number }) => void;
}

const MS_TO_KNOTS = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export function PolarHeatmap({ polar, selected, onSelect }: PolarHeatmapProps) {
  const maxBsp = Math.max(1e-6, ...polar.boatSpeed.flat());

  const cellStyle = (v: number): React.CSSProperties => {
    if (v <= 0) return { backgroundColor: '#1e293b' };
    const intensity = Math.min(1, v / maxBsp);
    // Cool teal → bright cyan as speed rises.
    const r = Math.floor(24 + intensity * 80);
    const g = Math.floor(80 + intensity * 150);
    const b = Math.floor(160 + intensity * 60);
    return { backgroundColor: `rgb(${r},${g},${b})` };
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs font-mono">
        <thead>
          <tr>
            <th className="p-1 text-slate-500">TWS \ TWA</th>
            {polar.twaBins.map((twa, i) => (
              <th key={i} className="p-1 text-slate-500 text-right">
                {(twa * RAD_TO_DEG).toFixed(0)}°
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {polar.twsBins.map((tws, twsIdx) => (
            <tr key={twsIdx}>
              <th className="p-1 text-slate-500 text-right pr-2">
                {(tws * MS_TO_KNOTS).toFixed(0)} kn
              </th>
              {polar.twaBins.map((_, twaIdx) => {
                const v = polar.boatSpeed[twsIdx]![twaIdx]!;
                const isSelected =
                  selected?.twsIdx === twsIdx && selected.twaIdx === twaIdx;
                return (
                  <td
                    key={twaIdx}
                    onClick={() => onSelect?.({ twsIdx, twaIdx })}
                    style={cellStyle(v)}
                    className={`p-2 cursor-pointer text-right ${
                      isSelected ? 'ring-2 ring-amber-400' : ''
                    }`}
                    title={`TWS ${(tws * MS_TO_KNOTS).toFixed(1)} kn, TWA ${(
                      polar.twaBins[twaIdx]! * RAD_TO_DEG
                    ).toFixed(0)}°, target ${(v * MS_TO_KNOTS).toFixed(2)} kn`}
                  >
                    {(v * MS_TO_KNOTS).toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-2">
        Boat speed shown in knots. Click a cell to edit.
      </p>
    </div>
  );
}
```

### Step 2: `PolarCellEditor.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';
import type { PolarTable } from '@g5000/db';

const MS_TO_KNOTS = 1 / 0.514444;
const KNOTS_TO_MS = 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export interface PolarCellEditorProps {
  polar: PolarTable;
  cell: { twsIdx: number; twaIdx: number };
  onApply: (updated: PolarTable) => void | Promise<void>;
}

export function PolarCellEditor({ polar, cell, onApply }: PolarCellEditorProps) {
  const currentMs = polar.boatSpeed[cell.twsIdx]![cell.twaIdx]!;
  const [newKn, setNewKn] = useState((currentMs * MS_TO_KNOTS).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setNewKn((currentMs * MS_TO_KNOTS).toFixed(2));
    setErr(null);
  }, [cell.twsIdx, cell.twaIdx, currentMs]);

  const handleApply = async (): Promise<void> => {
    const parsed = Number(newKn);
    if (!Number.isFinite(parsed)) {
      setErr('Not a number');
      return;
    }
    const newMs = parsed * KNOTS_TO_MS;
    const updated: PolarTable = {
      ...polar,
      boatSpeed: polar.boatSpeed.map((row, i) =>
        i === cell.twsIdx
          ? row.map((v, j) => (j === cell.twaIdx ? newMs : v))
          : row.slice(),
      ),
    };
    setBusy(true);
    setErr(null);
    try {
      await onApply(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const twsAt = polar.twsBins[cell.twsIdx]! * MS_TO_KNOTS;
  const twaAt = polar.twaBins[cell.twaIdx]! * RAD_TO_DEG;

  return (
    <div className="border border-slate-700 rounded p-4 space-y-3">
      <div className="text-sm text-slate-300">
        Editing cell at <span className="font-mono">TWS {twsAt.toFixed(1)} kn</span>{' '}
        × <span className="font-mono">TWA {twaAt.toFixed(0)}°</span>
      </div>
      <label className="block text-sm">
        <span className="text-slate-400">Target boat speed (knots):</span>
        <input
          type="number"
          step="0.1"
          value={newKn}
          onChange={(e) => setNewKn(e.target.value)}
          className="block w-32 mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono"
        />
      </label>
      <button
        onClick={handleApply}
        disabled={busy}
        className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Apply'}
      </button>
      {err && <div className="text-sm text-red-400">{err}</div>}
    </div>
  );
}
```

### Step 3: `page.tsx`

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PolarTable } from '@g5000/db';
import { PolarHeatmap } from './PolarHeatmap';
import { PolarCellEditor } from './PolarCellEditor';

export default function PolarsPage() {
  const [polar, setPolar] = useState<PolarTable | null>(null);
  const [selected, setSelected] = useState<{ twsIdx: number; twaIdx: number } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/polars', { cache: 'no-store' });
      if (!res.ok) {
        setErr(`reload failed: ${res.status}`);
        return;
      }
      const body = (await res.json()) as PolarTable;
      setPolar(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleApply = async (updated: PolarTable): Promise<void> => {
    const res = await fetch('/api/config/polars', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PUT failed: ${res.status} ${body}`);
    }
    await reload();
  };

  const handleImport = async (file: File): Promise<void> => {
    setImportBusy(true);
    setErr(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/config/polars/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Import failed: ${res.status} ${body}`);
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Polars</h1>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.pol"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
            }}
            className="hidden"
            id="polar-import"
          />
          <label
            htmlFor="polar-import"
            className={`px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium cursor-pointer ${
              importBusy ? 'opacity-50' : ''
            }`}
          >
            {importBusy ? 'Importing…' : 'Import CSV'}
          </label>
        </div>
      </div>

      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {polar && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Polar grid</h2>
          <PolarHeatmap
            polar={polar}
            selected={selected ?? undefined}
            onSelect={(c) => setSelected(c)}
          />
          {selected && (
            <PolarCellEditor polar={polar} cell={selected} onApply={handleApply} />
          )}
        </section>
      )}

      {!polar && !err && <p className="text-slate-400">Loading…</p>}
    </main>
  );
}
```

### Step 4: Typecheck

```
npm run typecheck --workspace=@g5000/web
```

### Step 5: Commit

```bash
git add packages/web/src/app/polars/page.tsx packages/web/src/app/polars/PolarHeatmap.tsx packages/web/src/app/polars/PolarCellEditor.tsx
git commit -m "feat(web): /polars page with heatmap, cell editor, and CSV import"
```

---

## Task 7: autopilot-server wires the polar compute pipeline

**Files:**
- Modify: `apps/autopilot-server/src/index.ts`

The polar pipeline runs alongside the true-wind pipeline. Same shape.

### Step 1: Add to imports

```ts
import { startTrueWindPipeline, startPolarPipeline } from '@g5000/compute';
```

### Step 2: Start it after the true-wind pipeline

After the existing `const stopCompute = await startTrueWindPipeline(...)` + `teardown.push(stopCompute)` block, add:

```ts
  const stopPolarPipeline = await startPolarPipeline({
    bus,
    configStore: store,
  });
  teardown.push(stopPolarPipeline);
  // eslint-disable-next-line no-console
  console.log('[autopilot] polar pipeline online');
```

### Step 3: Smoke-test

```bash
pkill -f "tsx watch src/index.ts" 2>&1 || true
sleep 1
SKIP_BRIDGE=1 npm run dev --workspace=@g5000/autopilot-server > /tmp/p7-smoke.log 2>&1 &
sleep 14
grep -E "config db|true-wind|polar|web UI" /tmp/p7-smoke.log
echo "---"
curl -s -o /dev/null -w "GET /polars : %{http_code} (%{time_total}s)\n" -m 15 http://localhost:3000/polars
curl -s -m 5 http://localhost:3000/api/config/polars | head -c 200
echo ""
pkill -f "tsx watch src/index.ts" 2>&1 || true
```

Expected: log shows `[autopilot] polar pipeline online`; `/polars` returns 200; `/api/config/polars` returns the default polar JSON.

### Step 4: Commit

```bash
git add apps/autopilot-server/src/index.ts
git commit -m "feat(server): start polar performance pipeline at boot"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full test suite**

```
npm test
```

Expected: prior 94 tests + ~24 new (db 2, csv-parser 9, math 8, pipeline 4, give-or-take) ≈ 118 tests pass.

- [ ] **Step 2: Workspace typecheck**

```
npx tsc -b
```

Clean.

- [ ] **Step 3: Lint and format**

```
npm run lint
npm run format
```

Commit any prettier diffs.

- [ ] **Step 4: Optional manual demo via replay**

If you have any captured session file, replay it with the polar pipeline online and observe the performance.* channels showing up in `/inspect`:

```
REPLAY=./sessions/<some-session>.jsonl.gz REPLAY_MODE=asap npm run dev --workspace=@g5000/autopilot-server
```

Open `/inspect` — alongside the wind/boat/motion channels, you should now see `performance.target.boatSpeed`, `performance.percentPolar`, `performance.vmg`, `performance.target.vmg`, `performance.target.twaUpwind`, `performance.target.twaDownwind`.

- [ ] **Step 5: Final commit (if any prettier diffs)**

```bash
git add -u
git commit -m "chore: prettier formatting after Plan 7"
```

---

## Closing notes

After this plan:
- Sail with G5000 connected to your N2K bus → `/inspect` shows live target speed for your current TWS/TWA → "I should be doing 6.2 m/s right now, I'm only at 4.8, what's wrong?" feedback you currently don't get from any vendor product without the H5000 Performance Pack license.
- Polar table is editable via the web UI or via a single `curl -X POST -H 'Content-Type: text/csv' --data-binary @my-polar.csv http://device:3000/api/config/polars/import`.
- The performance pipeline is parallel to true-wind, so adding more derived channels (laylines, leeway, current) follows the same template.

Plan 8 picks up the **radial polar plot visualization** — the classic "racing chart" radial diagram with the current operating point overlaid. Plus optionally the remaining cal pages (BSP / compass / boat config).
