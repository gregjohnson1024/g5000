# Groove Live Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish live "groove" performance metrics on the g5000 bus (time-in-groove, VMG-efficiency, steering steadiness/effort, speed-CV, build-rate, point-of-sail, helm-source, leeway) and surface them on the `/helm` view and the Sula mast display.

**Architecture:** A new `@g5000/compute/groove` pipeline subscribes to channels already on the RxJS bus (true wind, boat speed, the `race.targetSpeed`/`race.targetTwa` targets, rudder, heel, autopilot mode) and publishes derived `groove.*` / `boat.leeway` channels. It *composes* existing true-wind and polar-target math — it does not re-derive them. Pure, independently-testable units (point-of-sail classifier, rolling-window math, metric formulas, leeway) feed a thin wiring pipeline modelled on the existing `race/polar-targets.ts`. Because every metric is a bus channel, the same code feeds live tiles, the H-LINK re-emit, session logging, and replay.

**Tech Stack:** Node ≥22, ESM-only, strict TypeScript (composite project refs, `tsc -b`), RxJS bus, SQLite/Drizzle via `ConfigStore`, Next.js 16 + React 19 web UI, Vitest (+ fast-check) for tests.

**Scope:** This is Phase 0 + the **core** of Phase 1 from the design spec (`docs/superpowers/specs/2026-05-31-groove-performance-telemetry-design.md`). Deferred to follow-on plans: the diagnostic add-ons (pitch-risk, maneuver cost, puff gain/lag — "groove diagnostics" plan), the envelope-polar builder (Phase 2), and attribution + scorecard depth (Phase 3). `helmNervousness` is Phase 3 and is **not** in this plan.

**Conventions:**
- Run a single test file from the repo root with: `npx vitest run <path>`.
- Build the whole workspace with: `npm run -ws build` is not used — use `npx tsc -b` from the repo root (composite refs).
- Internal units are SI (radians, m/s); convert to °/kn/% only at the formatter.
- Commit messages end with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**File structure (created/modified by this plan):**
- `packages/core/src/channels.ts` — MODIFY: add `Boat.Leeway` and the `Groove` channel group.
- `packages/bridge/src/channel-mapper.ts` — MODIFY: add PGN 127245 handler → `boat.rudder.angle`.
- `packages/bridge/src/channel-mapper.test.ts` — MODIFY: test for the above.
- `packages/db/src/defaults.ts` — MODIFY: `GrooveSettings` interface + `DEFAULT_GROOVE_SETTINGS`.
- `packages/db/src/schema.ts` — MODIFY: `groove_settings` table.
- `packages/db/src/config-store.ts` — MODIFY: seed + `grooveSettings$` + `setGrooveSettings`.
- `packages/compute/src/groove/point-of-sail.ts` (+ `.test.ts`) — CREATE: classifier.
- `packages/compute/src/groove/windows.ts` (+ `.test.ts`) — CREATE: rolling-window math.
- `packages/compute/src/groove/leeway.ts` (+ `.test.ts`) — CREATE: leeway model.
- `packages/compute/src/groove/metrics.ts` (+ `.test.ts`) — CREATE: in-groove / VMG-efficiency / VMG / target-Δ.
- `packages/compute/src/groove/pipeline.ts` (+ `.test.ts`) — CREATE: bus wiring + publish.
- `packages/compute/src/groove/index.ts` — CREATE: barrel.
- `packages/compute/package.json` — MODIFY: `./groove` export.
- `apps/g5000/src/groove-subsystem.ts` — CREATE: boot wiring.
- `apps/g5000/src/index.ts:204-205` — MODIFY: start the subsystem.
- `packages/web/src/app/helm/page.tsx` — MODIFY: groove tile cluster (uses existing `HelmTile`).
- `packages/web/src/lib/mast-format.ts` (location confirmed in Task 13) — MODIFY: format new units.
- `docs/design/hercules-feature-notes.md:82` — MODIFY: correct the stale heel-sensor claim.

---

### Task 1: Channel constants for groove + leeway

**Files:**
- Modify: `packages/core/src/channels.ts`

`knownChannelSet()` walks the `Channels` registry, so adding constants here automatically makes them selectable as mast tiles. No separate registration needed.

- [ ] **Step 1: Add the `Boat.Leeway` constant**

In `packages/core/src/channels.ts`, inside the `Boat: { ... }` object, after `RudderAngle: 'boat.rudder.angle',` add:

```ts
    /** Leeway angle estimate, radians (signed; lee positive). */
    Leeway: 'boat.leeway',
```

- [ ] **Step 2: Add the `Groove` channel group**

In the same file, add a new top-level group after the `Race: { ... }` block (before the closing `} as const;`):

```ts
  Groove: {
    /** Point of sail: 'upwind' | 'reaching' | 'downwind' | 'not-sailing'. */
    PointOfSail: 'groove.pointOfSail',
    /** Who is steering: 'human' | 'autopilot'. */
    HelmSource: 'groove.helmSource',
    /** Instantaneous in-groove flag: enum 'in' | 'out'. */
    InGroove: 'groove.inGroove',
    /** Time-weighted % of the rolling window spent in-groove. */
    TimeInGroove: 'groove.timeInGroove',
    /** VMG efficiency %, point-of-sail-correct. */
    VmgEfficiency: 'groove.vmgEfficiency',
    /** VMG to/from the wind, m/s. */
    Vmg: 'groove.vmg',
    /** |TWA| − targetTwa, radians (signed: + footing, − pinching). */
    TargetTwaError: 'groove.targetTwaError',
    /** Circular std-dev of TWA over the window, radians. */
    TwaSteadiness: 'groove.twaSteadiness',
    /** Coefficient of variation of STW over the window (dimensionless). */
    SpeedCv: 'groove.speedCv',
    /** Rudder reversals per minute over the window. */
    SteeringEffort: 'groove.steeringEffort',
    /** Max rising slope of STW over the window, m/s². */
    BuildRate: 'groove.buildRate',
  },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b packages/core`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/channels.ts
git commit -m "feat(groove): channel constants for groove metrics + leeway

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Map PGN 127245 (Rudder) → `boat.rudder.angle`

**Files:**
- Modify: `packages/bridge/src/channel-mapper.ts`
- Test: `packages/bridge/src/channel-mapper.test.ts`

Today the *commanded* rudder is decoded from PGN **127237** → `autopilot.commandedRudder`. There is **no** handler for the dedicated Rudder PGN **127245**; its `Position` field is the actual rudder angle. Add that mapping.

- [ ] **Step 1: Write the failing test**

In `packages/bridge/src/channel-mapper.test.ts`, add inside the `describe('mapPgnToSamples', ...)` block:

```ts
  it('maps PGN 127245 rudder Position to boat.rudder.angle', () => {
    const decoded = make(127245, { Instance: 0, Position: -0.12 });
    const samples = mapPgnToSamples(decoded);
    expect(samples.map((s) => s.channel)).toEqual([Channels.Boat.RudderAngle]);
    expect(samples[0]?.value).toEqual({ kind: 'scalar', value: -0.12, unit: 'rad' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/bridge/src/channel-mapper.test.ts -t "127245 rudder"`
Expected: FAIL — `samples` is empty (no 127245 handler), so the `toEqual([Channels.Boat.RudderAngle])` assertion fails.

- [ ] **Step 3: Add the handler**

In `packages/bridge/src/channel-mapper.ts`, add a new entry to the `mappers` record (place it after the existing `127251` rate-of-turn handler for tidiness):

```ts
  // PGN 127245 — Rudder. "Position" is the actual rudder angle (rad);
  // "Angle Order" is the commanded value (the autopilot's commanded rudder
  // is decoded separately from PGN 127237).
  127245: (pgn) => {
    const pos = pgn.fields['Position'];
    if (typeof pos !== 'number') return [];
    return [
      {
        channel: Channels.Boat.RudderAngle,
        t_ns: pgn.rxTimestamp,
        value: scalar(pos, 'rad'),
        source: sourceTag(pgn),
      },
    ];
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/bridge/src/channel-mapper.test.ts -t "127245 rudder"`
Expected: PASS.

- [ ] **Step 5: Run the whole mapper test file (no regressions)**

Run: `npx vitest run packages/bridge/src/channel-mapper.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/channel-mapper.ts packages/bridge/src/channel-mapper.test.ts
git commit -m "feat(bridge): map PGN 127245 rudder Position to boat.rudder.angle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `GrooveSettings` in ConfigStore

**Files:**
- Modify: `packages/db/src/defaults.ts`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/config-store.ts`
- Test: `packages/db/src/config-store.test.ts`

Mirror the existing `crossover_settings` pattern: a single-row JSON table keyed on `boat_id`, seeded at `open()` over defaults, exposed via an observable + setter.

- [ ] **Step 1: Add the interface + defaults**

In `packages/db/src/defaults.ts`, after `DEFAULT_CROSSOVER_SETTINGS`, add:

```ts
/**
 * Per-boat tunables for the live "groove" metrics. Angles in degrees, speeds
 * in knots in storage (UI-friendly); the compute pipeline converts to SI.
 */
export interface GrooveSettings {
  /** TWA tolerance band for "in groove", degrees (upwind). */
  twaToleranceDeg: number;
  /** Multiplier applied to the tolerance downwind (groove is broader). */
  downwindToleranceFactor: number;
  /** Fraction of target boat speed required for "in groove". */
  speedFraction: number;
  /** Rolling-window length, seconds. */
  windowSec: number;
  /** Below this TWS (knots) → not-sailing. */
  twsFloorKn: number;
  /** Below this STW (knots) → below steerage → not-sailing. */
  steerageFloorKn: number;
  /** |TWA| below this (degrees) → upwind. */
  reachingBandLoDeg: number;
  /** |TWA| above this (degrees) → downwind. Between the two → reaching. */
  reachingBandHiDeg: number;
  /** Ignore rudder movements smaller than this (degrees) when counting reversals. */
  rudderDeadbandDeg: number;
  /** Leeway coefficient k in λ = k·heel/STW². 0 disables (publishes 0). */
  leewayK: number;
  /** Clamp on |leeway|, degrees. */
  leewayMaxDeg: number;
  /** If no autopilot.mode sample within this many seconds, assume human helm. */
  helmSourceTtlSec: number;
}

export const DEFAULT_GROOVE_SETTINGS: GrooveSettings = {
  twaToleranceDeg: 5,
  downwindToleranceFactor: 1.5,
  speedFraction: 0.95,
  windowSec: 60,
  twsFloorKn: 3,
  steerageFloorKn: 1,
  reachingBandLoDeg: 70,
  reachingBandHiDeg: 110,
  rudderDeadbandDeg: 0.5,
  leewayK: 0,
  leewayMaxDeg: 10,
  helmSourceTtlSec: 30,
};
```

- [ ] **Step 2: Add the Drizzle table**

In `packages/db/src/schema.ts`, after the `crossoverSettings` table definition, add (match the exact column style used by `crossoverSettings`):

```ts
export const grooveSettings = sqliteTable('groove_settings', {
  boatId: text('boat_id').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});
```

- [ ] **Step 3: Write the failing test**

In `packages/db/src/config-store.test.ts`, add a test mirroring the existing crossover-settings test (find it with `grep -n crossover packages/db/src/config-store.test.ts` and copy its structure). The test:

```ts
  it('seeds groove settings with defaults and round-trips a set', async () => {
    const store = await openTestStore(); // use whatever helper the file already uses to open an in-memory store
    expect(store.getGrooveSettings()).toEqual(DEFAULT_GROOVE_SETTINGS);
    const next = { ...DEFAULT_GROOVE_SETTINGS, windowSec: 90 };
    await store.setGrooveSettings(next);
    expect(store.getGrooveSettings()).toEqual(next);
  });
```

Import `DEFAULT_GROOVE_SETTINGS` at the top of the test file. If the file's store-open helper is named differently than `openTestStore`, use the existing one (check the crossover test).

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run packages/db/src/config-store.test.ts -t "groove settings"`
Expected: FAIL — `getGrooveSettings`/`setGrooveSettings` do not exist.

- [ ] **Step 5: Wire ConfigStore**

In `packages/db/src/config-store.ts`:

1. Import `DEFAULT_GROOVE_SETTINGS, type GrooveSettings` from `./defaults.js` (extend the existing import).
2. Add a `grooveSettings` subject. Find where `this.subjects.crossoverSettings` is declared/initialised and add a parallel `grooveSettings: new BehaviorSubject<GrooveSettings>(DEFAULT_GROOVE_SETTINGS)` (match the exact subject type the file uses — `BehaviorSubject` if crossover uses it).
3. In `open()` where `crossover_settings` is loaded and seeded, add the analogous block for `groove_settings`:

```ts
    const grooveRow = this.raw
      .prepare('SELECT value FROM groove_settings WHERE boat_id = ?')
      .get(this.__activeBoatId) as { value: string } | undefined;
    const grooveLoaded = grooveRow ? (JSON.parse(grooveRow.value) as Partial<GrooveSettings>) : {};
    this.subjects.grooveSettings.next({ ...DEFAULT_GROOVE_SETTINGS, ...grooveLoaded });
```

   Ensure the `CREATE TABLE IF NOT EXISTS groove_settings (boat_id TEXT PRIMARY KEY, value TEXT NOT NULL)` runs where the other `CREATE TABLE IF NOT EXISTS crossover_settings (...)` runs.
4. Add the accessors next to `crossoverSettings$`:

```ts
  get grooveSettings$(): Observable<GrooveSettings> {
    return this.subjects.grooveSettings.asObservable();
  }
  getGrooveSettings(): GrooveSettings {
    return this.subjects.grooveSettings.value;
  }
  async setGrooveSettings(value: GrooveSettings): Promise<void> {
    this.raw
      .prepare(
        'INSERT INTO groove_settings (boat_id, value) VALUES (?, ?) ON CONFLICT (boat_id) DO UPDATE SET value = excluded.value',
      )
      .run(this.__activeBoatId, JSON.stringify(value));
    this.subjects.grooveSettings.next(value);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/db/src/config-store.test.ts -t "groove settings"`
Expected: PASS.

- [ ] **Step 7: Build + commit**

Run: `npx tsc -b packages/db`
Expected: no errors.

```bash
git add packages/db/src/defaults.ts packages/db/src/schema.ts packages/db/src/config-store.ts packages/db/src/config-store.test.ts
git commit -m "feat(db): GrooveSettings config (seeded defaults + setter)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Point-of-sail classifier

**Files:**
- Create: `packages/compute/src/groove/point-of-sail.ts`
- Test: `packages/compute/src/groove/point-of-sail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { classifyPointOfSail, type PointOfSail } from './point-of-sail.js';

const DEG = Math.PI / 180;
const KN = 0.514444;
const base = {
  twsMs: 8 * KN,
  bspMs: 6 * KN,
  reachingLoRad: 70 * DEG,
  reachingHiRad: 110 * DEG,
  twsFloorMs: 3 * KN,
  steerageFloorMs: 1 * KN,
};

describe('classifyPointOfSail', () => {
  it('returns not-sailing below the wind floor', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 45 * DEG, twsMs: 2 * KN })).toBe<PointOfSail>('not-sailing');
  });
  it('returns not-sailing below steerage', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 45 * DEG, bspMs: 0.5 * KN })).toBe<PointOfSail>('not-sailing');
  });
  it('classifies a beat as upwind', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 45 * DEG })).toBe<PointOfSail>('upwind');
  });
  it('classifies the no-mans-land as reaching', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 90 * DEG })).toBe<PointOfSail>('reaching');
  });
  it('classifies a run as downwind', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 150 * DEG })).toBe<PointOfSail>('downwind');
  });
  it('uses the boundaries inclusively on the upwind side', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 70 * DEG })).toBe<PointOfSail>('reaching');
    expect(classifyPointOfSail({ ...base, twaAbsRad: 69.9 * DEG })).toBe<PointOfSail>('upwind');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/groove/point-of-sail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type PointOfSail = 'upwind' | 'reaching' | 'downwind' | 'not-sailing';

export interface ClassifyArgs {
  /** |TWA|, radians. */
  twaAbsRad: number;
  /** True wind speed, m/s. */
  twsMs: number;
  /** Boat speed through water, m/s. */
  bspMs: number;
  /** Upwind/reaching boundary, radians. */
  reachingLoRad: number;
  /** Reaching/downwind boundary, radians. */
  reachingHiRad: number;
  /** Below this TWS → not-sailing. */
  twsFloorMs: number;
  /** Below this STW → not-sailing. */
  steerageFloorMs: number;
}

/** Heuristic point-of-sail from |TWA|, gated by wind/steerage floors. */
export function classifyPointOfSail(a: ClassifyArgs): PointOfSail {
  if (a.twsMs < a.twsFloorMs || a.bspMs < a.steerageFloorMs) return 'not-sailing';
  if (a.twaAbsRad < a.reachingLoRad) return 'upwind';
  if (a.twaAbsRad > a.reachingHiRad) return 'downwind';
  return 'reaching';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/groove/point-of-sail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/groove/point-of-sail.ts packages/compute/src/groove/point-of-sail.test.ts
git commit -m "feat(groove): point-of-sail classifier

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rolling-window math

**Files:**
- Create: `packages/compute/src/groove/windows.ts`
- Test: `packages/compute/src/groove/windows.test.ts`

All functions are pure and operate on plain arrays. `t_ns` is BigInt nanoseconds. Each returns `null` when there is not enough data.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  timeWeightedFraction,
  circularStdDev,
  coefficientOfVariation,
  reversalsPerMinute,
  maxRisingSlope,
} from './windows.js';

const ns = (sec: number): bigint => BigInt(Math.round(sec * 1e9));

describe('timeWeightedFraction', () => {
  it('returns null with fewer than two samples', () => {
    expect(timeWeightedFraction([])).toBeNull();
    expect(timeWeightedFraction([{ t_ns: ns(0), flag: true }])).toBeNull();
  });
  it('weights intervals by the flag at their start', () => {
    // 0–1s true, 1–3s false → 1s true of 3s total = 0.333…
    const r = timeWeightedFraction([
      { t_ns: ns(0), flag: true },
      { t_ns: ns(1), flag: false },
      { t_ns: ns(3), flag: false },
    ]);
    expect(r).toBeCloseTo(1 / 3, 6);
  });
  it('is always within [0,1] (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ s: fc.integer({ min: 0, max: 1000 }), f: fc.boolean() }), { minLength: 2, maxLength: 50 }),
        (xs) => {
          const sorted = xs.map((x, i) => ({ t_ns: ns(x.s + i * 0.001), flag: x.f })).sort((a, b) => Number(a.t_ns - b.t_ns));
          const r = timeWeightedFraction(sorted);
          return r === null || (r >= 0 && r <= 1);
        },
      ),
    );
  });
});

describe('circularStdDev', () => {
  it('is ~0 for identical angles', () => {
    expect(circularStdDev([0.3, 0.3, 0.3])).toBeCloseTo(0, 6);
  });
  it('handles the ±π wrap (values near +π and −π are close)', () => {
    const sd = circularStdDev([Math.PI - 0.01, -Math.PI + 0.01]);
    expect(sd).toBeLessThan(0.1); // small, not ~π
  });
  it('returns null when empty', () => {
    expect(circularStdDev([])).toBeNull();
  });
  it('is non-negative (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), { minLength: 1, maxLength: 50 }), (xs) => {
        const sd = circularStdDev(xs);
        return sd !== null && sd >= 0;
      }),
    );
  });
});

describe('coefficientOfVariation', () => {
  it('returns 0 for constant values', () => {
    expect(coefficientOfVariation([3, 3, 3])).toBeCloseTo(0, 6);
  });
  it('returns null when empty or mean ~0', () => {
    expect(coefficientOfVariation([])).toBeNull();
    expect(coefficientOfVariation([0, 0])).toBeNull();
  });
});

describe('reversalsPerMinute', () => {
  it('counts direction changes above the dead-band', () => {
    // up, up, down, up → 2 reversals over 4s span → 30/min
    const r = reversalsPerMinute(
      [
        { t_ns: ns(0), value: 0 },
        { t_ns: ns(1), value: 0.2 },
        { t_ns: ns(2), value: 0.4 },
        { t_ns: ns(3), value: 0.1 },
        { t_ns: ns(4), value: 0.3 },
      ],
      0.05,
    );
    expect(r).toBeCloseTo((2 / 4) * 60, 6);
  });
  it('ignores movements within the dead-band', () => {
    const r = reversalsPerMinute(
      [
        { t_ns: ns(0), value: 0 },
        { t_ns: ns(1), value: 0.01 },
        { t_ns: ns(2), value: -0.01 },
        { t_ns: ns(3), value: 0.01 },
      ],
      0.05,
    );
    expect(r).toBe(0);
  });
  it('returns null with insufficient samples', () => {
    expect(reversalsPerMinute([{ t_ns: ns(0), value: 0 }], 0.05)).toBeNull();
  });
});

describe('maxRisingSlope', () => {
  it('returns the largest positive d(value)/dt in m/s²', () => {
    const r = maxRisingSlope([
      { t_ns: ns(0), value: 1 },
      { t_ns: ns(1), value: 1.5 }, // +0.5/s
      { t_ns: ns(2), value: 3 }, // +1.5/s
      { t_ns: ns(3), value: 2 }, // negative
    ]);
    expect(r).toBeCloseTo(1.5, 6);
  });
  it('returns null with insufficient samples', () => {
    expect(maxRisingSlope([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/groove/windows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface FlagSample {
  t_ns: bigint;
  flag: boolean;
}
export interface NumSample {
  t_ns: bigint;
  value: number;
}

const secondsBetween = (a: bigint, b: bigint): number => Number(b - a) / 1e9;

/**
 * Time-weighted fraction of the window where flag is true. Each interval
 * [tᵢ, tᵢ₊₁) is weighted by its duration and the flag value at tᵢ.
 * Returns null with < 2 samples.
 */
export function timeWeightedFraction(samples: ReadonlyArray<FlagSample>): number | null {
  if (samples.length < 2) return null;
  let trueTime = 0;
  let total = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const dt = secondsBetween(samples[i]!.t_ns, samples[i + 1]!.t_ns);
    if (dt <= 0) continue;
    total += dt;
    if (samples[i]!.flag) trueTime += dt;
  }
  if (total <= 0) return null;
  return trueTime / total;
}

/**
 * Circular standard deviation of angles (radians). Uses the mean resultant
 * length R: SD = sqrt(-2·ln R), which is wrap-safe. Returns null when empty.
 */
export function circularStdDev(angles: ReadonlyArray<number>): number | null {
  if (angles.length === 0) return null;
  let sumSin = 0;
  let sumCos = 0;
  for (const a of angles) {
    sumSin += Math.sin(a);
    sumCos += Math.cos(a);
  }
  const n = angles.length;
  const r = Math.hypot(sumSin / n, sumCos / n);
  if (r >= 1) return 0;
  if (r <= 0) return Math.sqrt(-2 * Math.log(Number.EPSILON));
  return Math.sqrt(-2 * Math.log(r));
}

/** Std-dev ÷ mean. Null when empty or |mean| < 1e-9. */
export function coefficientOfVariation(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (Math.abs(mean) < 1e-9) return null;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return Math.sqrt(variance) / mean;
}

/**
 * Reversals per minute: count sign changes in successive deltas, ignoring
 * deltas whose magnitude is below the dead-band. Null with < 2 samples or
 * zero span.
 */
export function reversalsPerMinute(samples: ReadonlyArray<NumSample>, deadband: number): number | null {
  if (samples.length < 2) return null;
  const span = secondsBetween(samples[0]!.t_ns, samples[samples.length - 1]!.t_ns);
  if (span <= 0) return null;
  let reversals = 0;
  let lastDir = 0; // -1, 0, +1
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i]!.value - samples[i - 1]!.value;
    if (Math.abs(d) < deadband) continue;
    const dir = d > 0 ? 1 : -1;
    if (lastDir !== 0 && dir !== lastDir) reversals++;
    lastDir = dir;
  }
  return (reversals / span) * 60;
}

/** Largest positive d(value)/dt across consecutive samples, units value/s. Null with < 2. */
export function maxRisingSlope(samples: ReadonlyArray<NumSample>): number | null {
  if (samples.length < 2) return null;
  let best = -Infinity;
  for (let i = 1; i < samples.length; i++) {
    const dt = secondsBetween(samples[i - 1]!.t_ns, samples[i]!.t_ns);
    if (dt <= 0) continue;
    const slope = (samples[i]!.value - samples[i - 1]!.value) / dt;
    if (slope > best) best = slope;
  }
  return best === -Infinity ? null : best;
}

/** Drop samples older than `cutoff_ns`. Returns a new array. */
export function pruneBefore<T extends { t_ns: bigint }>(samples: ReadonlyArray<T>, cutoff_ns: bigint): T[] {
  return samples.filter((s) => s.t_ns >= cutoff_ns);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/groove/windows.test.ts`
Expected: PASS (all, including the fast-check properties).

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/groove/windows.ts packages/compute/src/groove/windows.test.ts
git commit -m "feat(groove): rolling-window math (fraction, circular SD, CV, reversals, slope)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Leeway model

**Files:**
- Create: `packages/compute/src/groove/leeway.ts`
- Test: `packages/compute/src/groove/leeway.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { leewayRad } from './leeway.js';

describe('leewayRad', () => {
  it('is zero when k is zero (disabled)', () => {
    expect(leewayRad({ heelRad: 0.1, stwMs: 3, k: 0, maxRad: 0.2, stwFloorMs: 0.5 })).toBe(0);
  });
  it('follows λ = k·heel / STW²', () => {
    // k=4, heel=0.1, stw=2 → 4*0.1/4 = 0.1
    expect(leewayRad({ heelRad: 0.1, stwMs: 2, k: 4, maxRad: 1, stwFloorMs: 0.5 })).toBeCloseTo(0.1, 9);
  });
  it('clamps the STW floor to avoid blow-up at low speed', () => {
    // stw below floor → uses floor 0.5 → 4*0.1/0.25 = 1.6, clamped to maxRad 0.2
    expect(leewayRad({ heelRad: 0.1, stwMs: 0.1, k: 4, maxRad: 0.2, stwFloorMs: 0.5 })).toBeCloseTo(0.2, 9);
  });
  it('preserves heel sign and clamps magnitude', () => {
    expect(leewayRad({ heelRad: -0.5, stwMs: 1, k: 10, maxRad: 0.2, stwFloorMs: 0.5 })).toBeCloseTo(-0.2, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/groove/leeway.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface LeewayArgs {
  /** Heel angle, radians (signed; lee positive). */
  heelRad: number;
  /** Boat speed through water, m/s. */
  stwMs: number;
  /** Coefficient k. 0 disables (returns 0). */
  k: number;
  /** Clamp on |leeway|, radians. */
  maxRad: number;
  /** STW floor used in the denominator to avoid low-speed blow-up. */
  stwFloorMs: number;
}

/** Leeway estimate λ = k·heel / max(STW, floor)², clamped to ±maxRad. */
export function leewayRad(a: LeewayArgs): number {
  if (a.k === 0) return 0;
  const stw = Math.max(a.stwMs, a.stwFloorMs);
  const raw = (a.k * a.heelRad) / (stw * stw);
  if (raw > a.maxRad) return a.maxRad;
  if (raw < -a.maxRad) return -a.maxRad;
  return raw;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/groove/leeway.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/groove/leeway.ts packages/compute/src/groove/leeway.test.ts
git commit -m "feat(groove): heel-based leeway model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Metric formulas (in-groove, VMG-efficiency, VMG, target-Δ)

**Files:**
- Create: `packages/compute/src/groove/metrics.ts`
- Test: `packages/compute/src/groove/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { targetTwaErrorRad, isInGroove, vmgEfficiencyPct, vmgMs } from './metrics.js';

const DEG = Math.PI / 180;

describe('targetTwaErrorRad', () => {
  it('is positive when footing (sailing wider than optimal)', () => {
    expect(targetTwaErrorRad(50 * DEG, 42 * DEG)).toBeCloseTo(8 * DEG, 9);
  });
  it('is negative when pinching', () => {
    expect(targetTwaErrorRad(38 * DEG, 42 * DEG)).toBeCloseTo(-4 * DEG, 9);
  });
});

describe('isInGroove', () => {
  const s = { toleranceRad: 5 * DEG, speedFraction: 0.95 };
  it('upwind: requires angle band AND speed', () => {
    expect(isInGroove({ pointOfSail: 'upwind', twaAbsRad: 44 * DEG, targetTwaRad: 42 * DEG, bspMs: 6, targetSpeedMs: 6, ...s })).toBe(true);
    expect(isInGroove({ pointOfSail: 'upwind', twaAbsRad: 50 * DEG, targetTwaRad: 42 * DEG, bspMs: 6, targetSpeedMs: 6, ...s })).toBe(false); // angle out
    expect(isInGroove({ pointOfSail: 'upwind', twaAbsRad: 44 * DEG, targetTwaRad: 42 * DEG, bspMs: 5, targetSpeedMs: 6, ...s })).toBe(false); // slow
  });
  it('reaching: speed only (angle is set by course)', () => {
    expect(isInGroove({ pointOfSail: 'reaching', twaAbsRad: 90 * DEG, targetTwaRad: 42 * DEG, bspMs: 6, targetSpeedMs: 6, ...s })).toBe(true);
  });
  it('not-sailing: null', () => {
    expect(isInGroove({ pointOfSail: 'not-sailing', twaAbsRad: 90 * DEG, targetTwaRad: 42 * DEG, bspMs: 6, targetSpeedMs: 6, ...s })).toBeNull();
  });
});

describe('vmgEfficiencyPct', () => {
  it('upwind: ratio of actual VMG to target VMG', () => {
    // both at 42°, bsp=target → 100%
    expect(vmgEfficiencyPct({ pointOfSail: 'upwind', twaRad: 42 * DEG, targetTwaRad: 42 * DEG, bspMs: 6, targetSpeedMs: 6 })).toBeCloseTo(100, 4);
  });
  it('downwind: valid (both cos terms negative)', () => {
    const v = vmgEfficiencyPct({ pointOfSail: 'downwind', twaRad: 150 * DEG, targetTwaRad: 150 * DEG, bspMs: 7, targetSpeedMs: 7 });
    expect(v).toBeCloseTo(100, 4);
  });
  it('reaching: plain speed ratio', () => {
    expect(vmgEfficiencyPct({ pointOfSail: 'reaching', twaRad: 90 * DEG, targetTwaRad: 42 * DEG, bspMs: 6, targetSpeedMs: 8 })).toBeCloseTo(75, 4);
  });
  it('clamps to [0,120]', () => {
    expect(vmgEfficiencyPct({ pointOfSail: 'reaching', twaRad: 90 * DEG, targetTwaRad: 42 * DEG, bspMs: 100, targetSpeedMs: 6 })).toBe(120);
  });
  it('null when target speed is non-positive', () => {
    expect(vmgEfficiencyPct({ pointOfSail: 'upwind', twaRad: 42 * DEG, targetTwaRad: 42 * DEG, bspMs: 6, targetSpeedMs: 0 })).toBeNull();
  });
});

describe('vmgMs', () => {
  it('is bsp·cos(twa)', () => {
    expect(vmgMs(6, 0)).toBeCloseTo(6, 9);
    expect(vmgMs(6, Math.PI)).toBeCloseTo(-6, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/groove/metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { PointOfSail } from './point-of-sail.js';

/** |TWA| − targetTwa. Positive = footing (wider than optimal), negative = pinching. */
export function targetTwaErrorRad(twaAbsRad: number, targetTwaRad: number): number {
  return twaAbsRad - targetTwaRad;
}

/** VMG to/from the wind, m/s. */
export function vmgMs(bspMs: number, twaRad: number): number {
  return bspMs * Math.cos(twaRad);
}

export interface InGrooveArgs {
  pointOfSail: PointOfSail;
  twaAbsRad: number;
  targetTwaRad: number;
  bspMs: number;
  targetSpeedMs: number;
  toleranceRad: number;
  speedFraction: number;
}

/** Instantaneous in-groove test. Null when not-sailing. */
export function isInGroove(a: InGrooveArgs): boolean | null {
  if (a.pointOfSail === 'not-sailing') return null;
  if (a.targetSpeedMs <= 0) return null;
  const fastEnough = a.bspMs >= a.speedFraction * a.targetSpeedMs;
  if (a.pointOfSail === 'reaching') return fastEnough;
  const onAngle = Math.abs(a.twaAbsRad - a.targetTwaRad) <= a.toleranceRad;
  return onAngle && fastEnough;
}

export interface VmgEffArgs {
  pointOfSail: PointOfSail;
  /** Signed TWA, radians. */
  twaRad: number;
  /** Optimal-VMG TWA magnitude, radians. */
  targetTwaRad: number;
  bspMs: number;
  targetSpeedMs: number;
}

/** Point-of-sail-correct VMG efficiency %, clamped to [0,120]. Null when target ≤ 0 or not-sailing. */
export function vmgEfficiencyPct(a: VmgEffArgs): number | null {
  if (a.pointOfSail === 'not-sailing' || a.targetSpeedMs <= 0) return null;
  let pct: number;
  if (a.pointOfSail === 'reaching') {
    pct = (a.bspMs / a.targetSpeedMs) * 100;
  } else {
    const vmgActual = a.bspMs * Math.cos(a.twaRad);
    const vmgTarget = a.targetSpeedMs * Math.cos(a.targetTwaRad);
    if (Math.abs(vmgTarget) < 1e-9) return null;
    pct = (vmgActual / vmgTarget) * 100;
  }
  if (!Number.isFinite(pct)) return null;
  if (pct < 0) return 0;
  if (pct > 120) return 120;
  return pct;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/groove/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/groove/metrics.ts packages/compute/src/groove/metrics.test.ts
git commit -m "feat(groove): in-groove / VMG-efficiency / VMG / target-Δ formulas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Groove compute pipeline

**Files:**
- Create: `packages/compute/src/groove/pipeline.ts`
- Test: `packages/compute/src/groove/pipeline.test.ts`

The pipeline caches the latest input per channel, maintains rolling buffers, and (on each `wind.true.angle` / `wind.true.speed` / `boat.speed.water` tick) recomputes and publishes. It reads settings through a getter ref so a settings change applies on the next tick without recreating buffers — the pattern `race/wind-shift.ts` uses.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { Bus, Channels } from '@g5000/core';
import type { Sample } from '@g5000/core';
import { DEFAULT_GROOVE_SETTINGS } from '@g5000/db';
import { startGrooveComputePipeline } from './pipeline.js';

const DEG = Math.PI / 180;
const KN = 0.514444;

function scalar(channel: string, value: number, t: number): Sample {
  return { channel, t_ns: BigInt(Math.round(t * 1e9)), value: { kind: 'scalar', value }, source: 'test' };
}
function enumSample(channel: string, value: string, t: number): Sample {
  return { channel, t_ns: BigInt(Math.round(t * 1e9)), value: { kind: 'enum', value }, source: 'test' };
}

describe('groove pipeline', () => {
  it('publishes point-of-sail and groove metrics on a steady beat', () => {
    const bus = new Bus();
    const settingsRef = { current: { ...DEFAULT_GROOVE_SETTINGS } };
    const handle = startGrooveComputePipeline(bus, settingsRef);

    const seen = new Map<string, Sample>();
    bus.subscribe('groove.**', (s) => seen.set(s.channel, s));

    // Feed a steady upwind segment: TWA 44°, target 42°, bsp≈target, good wind.
    for (let i = 0; i < 20; i++) {
      const t = i * 0.5;
      bus.publish(scalar(Channels.Race.TargetTwa, 42 * DEG, t));
      bus.publish(scalar(Channels.Race.TargetSpeed, 6, t));
      bus.publish(scalar(Channels.Wind.TrueSpeed, 10 * KN, t));
      bus.publish(scalar(Channels.Boat.SpeedWater, 6, t));
      bus.publish(scalar(Channels.Wind.TrueAngle, 44 * DEG, t)); // triggers publish last
    }

    expect(seen.get(Channels.Groove.PointOfSail)?.value).toEqual({ kind: 'enum', value: 'upwind' });
    expect(seen.get(Channels.Groove.InGroove)?.value).toEqual({ kind: 'enum', value: 'in' });
    const tig = seen.get(Channels.Groove.TimeInGroove)?.value;
    expect(tig?.kind).toBe('scalar');
    if (tig?.kind === 'scalar') expect(tig.value).toBeGreaterThan(90);
    const eff = seen.get(Channels.Groove.VmgEfficiency)?.value;
    if (eff?.kind === 'scalar') expect(eff.value).toBeGreaterThan(95);

    handle.dispose();
  });

  it('suppresses sailing metrics and reports not-sailing under engine', () => {
    const bus = new Bus();
    const settingsRef = { current: { ...DEFAULT_GROOVE_SETTINGS } };
    const handle = startGrooveComputePipeline(bus, settingsRef);
    const seen = new Map<string, Sample>();
    bus.subscribe('groove.**', (s) => seen.set(s.channel, s));

    for (let i = 0; i < 5; i++) {
      const t = i;
      bus.publish(scalar(Channels.Race.TargetTwa, 42 * DEG, t));
      bus.publish(scalar(Channels.Race.TargetSpeed, 6, t));
      bus.publish(scalar(Channels.Wind.TrueSpeed, 1 * KN, t)); // below floor
      bus.publish(scalar(Channels.Boat.SpeedWater, 6, t));
      bus.publish(scalar(Channels.Wind.TrueAngle, 44 * DEG, t));
    }
    expect(seen.get(Channels.Groove.PointOfSail)?.value).toEqual({ kind: 'enum', value: 'not-sailing' });
    expect(seen.has(Channels.Groove.TimeInGroove)).toBe(false);
    expect(seen.has(Channels.Groove.VmgEfficiency)).toBe(false);
    handle.dispose();
  });

  it('flags helmSource autopilot when an active mode is present', () => {
    const bus = new Bus();
    const settingsRef = { current: { ...DEFAULT_GROOVE_SETTINGS } };
    const handle = startGrooveComputePipeline(bus, settingsRef);
    const seen = new Map<string, Sample>();
    bus.subscribe('groove.**', (s) => seen.set(s.channel, s));

    bus.publish(enumSample(Channels.Autopilot.Mode, 'Heading Control', 0));
    bus.publish(scalar(Channels.Race.TargetTwa, 42 * DEG, 0.1));
    bus.publish(scalar(Channels.Race.TargetSpeed, 6, 0.1));
    bus.publish(scalar(Channels.Wind.TrueSpeed, 10 * KN, 0.1));
    bus.publish(scalar(Channels.Boat.SpeedWater, 6, 0.1));
    bus.publish(scalar(Channels.Wind.TrueAngle, 44 * DEG, 0.1));

    expect(seen.get(Channels.Groove.HelmSource)?.value).toEqual({ kind: 'enum', value: 'autopilot' });
    handle.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/groove/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { Bus, Channels } from '@g5000/core';
import type { Sample } from '@g5000/core';
import type { GrooveSettings } from '@g5000/db';
import { classifyPointOfSail, type PointOfSail } from './point-of-sail.js';
import { isInGroove, vmgEfficiencyPct, vmgMs, targetTwaErrorRad } from './metrics.js';
import { leewayRad } from './leeway.js';
import {
  timeWeightedFraction,
  circularStdDev,
  coefficientOfVariation,
  reversalsPerMinute,
  maxRisingSlope,
  pruneBefore,
  type FlagSample,
  type NumSample,
} from './windows.js';

const DEG = Math.PI / 180;
const KN_TO_MS = 0.514444;

const ACTIVE_AP_MODES = ['Heading Control', 'Track Control', 'Wind', 'Vane', 'Nav', 'No Drift'];
const isApEngaged = (mode: string): boolean => ACTIVE_AP_MODES.some((m) => mode.includes(m));

export interface GrooveSettingsRef {
  current: GrooveSettings;
}
export interface GroovePipelineHandle {
  dispose(): void;
}

interface Latest {
  twa?: number; // signed rad
  tws?: number; // m/s
  bsp?: number; // m/s
  targetSpeed?: number; // m/s
  targetTwa?: number; // rad magnitude
  rudder?: number; // rad
  heel?: number; // rad
  apMode?: string;
  apModeT_ns?: bigint;
}

export function startGrooveComputePipeline(bus: Bus, settingsRef: GrooveSettingsRef): GroovePipelineHandle {
  const latest: Latest = {};
  const inGrooveBuf: FlagSample[] = [];
  const twaBuf: NumSample[] = [];
  const bspBuf: NumSample[] = [];
  const rudderBuf: NumSample[] = [];
  const unsubs: Array<() => void> = [];

  const publishScalar = (channel: string, value: number, t_ns: bigint, unit: string): void => {
    bus.publish({ channel, t_ns, value: { kind: 'scalar', value, unit }, source: 'groove' });
  };
  const publishEnum = (channel: string, value: string, t_ns: bigint): void => {
    bus.publish({ channel, t_ns, value: { kind: 'enum', value }, source: 'groove' });
  };

  function recompute(t_ns: bigint): void {
    const s = settingsRef.current;
    const windowNs = BigInt(Math.round(s.windowSec * 1e9));
    const cutoff = t_ns - windowNs;

    // Prune all buffers in place.
    for (const buf of [inGrooveBuf, twaBuf, bspBuf, rudderBuf]) {
      const kept = pruneBefore(buf, cutoff);
      buf.length = 0;
      buf.push(...kept);
    }

    // Helm source (always publishable).
    let helmSource: 'human' | 'autopilot' = 'human';
    if (
      latest.apMode !== undefined &&
      latest.apModeT_ns !== undefined &&
      Number(t_ns - latest.apModeT_ns) / 1e9 <= s.helmSourceTtlSec &&
      isApEngaged(latest.apMode)
    ) {
      helmSource = 'autopilot';
    }
    publishEnum(Channels.Groove.HelmSource, helmSource, t_ns);

    // Leeway (publishable whenever heel + bsp known).
    if (latest.heel !== undefined && latest.bsp !== undefined) {
      const lee = leewayRad({
        heelRad: latest.heel,
        stwMs: latest.bsp,
        k: s.leewayK,
        maxRad: s.leewayMaxDeg * DEG,
        stwFloorMs: s.steerageFloorKn * KN_TO_MS,
      });
      publishScalar(Channels.Boat.Leeway, lee, t_ns, 'rad');
    }

    // Steering effort (rudder reversals/min) — independent of point of sail.
    const effort = reversalsPerMinute(rudderBuf, s.rudderDeadbandDeg * DEG);
    if (effort !== null) publishScalar(Channels.Groove.SteeringEffort, effort, t_ns, '1/min');

    if (latest.twa === undefined || latest.tws === undefined || latest.bsp === undefined) return;
    const twaAbs = Math.abs(latest.twa);

    const pos: PointOfSail = classifyPointOfSail({
      twaAbsRad: twaAbs,
      twsMs: latest.tws,
      bspMs: latest.bsp,
      reachingLoRad: s.reachingBandLoDeg * DEG,
      reachingHiRad: s.reachingBandHiDeg * DEG,
      twsFloorMs: s.twsFloorKn * KN_TO_MS,
      steerageFloorMs: s.steerageFloorKn * KN_TO_MS,
    });
    publishEnum(Channels.Groove.PointOfSail, pos, t_ns);

    // Suppress sailing-specific metrics when not-sailing or no target.
    if (pos === 'not-sailing' || latest.targetSpeed === undefined || latest.targetTwa === undefined || latest.targetSpeed <= 0) {
      // Clear in-groove accumulation so a motoring gap doesn't bleed into the next leg.
      inGrooveBuf.length = 0;
      twaBuf.length = 0;
      return;
    }

    const tolerance = s.twaToleranceDeg * DEG * (pos === 'downwind' ? s.downwindToleranceFactor : 1);

    const flag = isInGroove({
      pointOfSail: pos,
      twaAbsRad: twaAbs,
      targetTwaRad: latest.targetTwa,
      bspMs: latest.bsp,
      targetSpeedMs: latest.targetSpeed,
      toleranceRad: tolerance,
      speedFraction: s.speedFraction,
    });
    if (flag !== null) {
      inGrooveBuf.push({ t_ns, flag });
      publishEnum(Channels.Groove.InGroove, flag ? 'in' : 'out', t_ns);
      const tig = timeWeightedFraction(inGrooveBuf);
      if (tig !== null) publishScalar(Channels.Groove.TimeInGroove, tig * 100, t_ns, '%');
    }

    const eff = vmgEfficiencyPct({
      pointOfSail: pos,
      twaRad: latest.twa,
      targetTwaRad: latest.targetTwa,
      bspMs: latest.bsp,
      targetSpeedMs: latest.targetSpeed,
    });
    if (eff !== null) publishScalar(Channels.Groove.VmgEfficiency, eff, t_ns, '%');

    publishScalar(Channels.Groove.Vmg, vmgMs(latest.bsp, latest.twa), t_ns, 'm/s');
    publishScalar(Channels.Groove.TargetTwaError, targetTwaErrorRad(twaAbs, latest.targetTwa), t_ns, 'rad');

    // TWA steadiness + speed CV over the window.
    twaBuf.push({ t_ns, value: latest.twa });
    const sd = circularStdDev(twaBuf.map((x) => x.value));
    if (sd !== null) publishScalar(Channels.Groove.TwaSteadiness, sd, t_ns, 'rad');
    const cv = coefficientOfVariation(bspBuf.map((x) => x.value));
    if (cv !== null) publishScalar(Channels.Groove.SpeedCv, cv, t_ns, '');
    const build = maxRisingSlope(bspBuf);
    if (build !== null) publishScalar(Channels.Groove.BuildRate, build, t_ns, 'm/s^2');
  }

  // --- Subscriptions ---
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueAngle, (s) => {
      if (s.value.kind === 'scalar') {
        latest.twa = s.value.value;
        recompute(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueSpeed, (s) => {
      if (s.value.kind === 'scalar') {
        latest.tws = s.value.value;
        recompute(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Boat.SpeedWater, (s) => {
      if (s.value.kind === 'scalar') {
        latest.bsp = s.value.value;
        bspBuf.push({ t_ns: s.t_ns, value: s.value.value });
        recompute(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Race.TargetSpeed, (s) => {
      if (s.value.kind === 'scalar') latest.targetSpeed = s.value.value;
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Race.TargetTwa, (s) => {
      if (s.value.kind === 'scalar') latest.targetTwa = s.value.value;
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Boat.RudderAngle, (s) => {
      if (s.value.kind === 'scalar') {
        latest.rudder = s.value.value;
        rudderBuf.push({ t_ns: s.t_ns, value: s.value.value });
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Motion.Heel, (s) => {
      if (s.value.kind === 'scalar') latest.heel = s.value.value;
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Autopilot.Mode, (s) => {
      if (s.value.kind === 'enum') {
        latest.apMode = s.value.value;
        latest.apModeT_ns = s.t_ns;
      }
    }),
  );

  return {
    dispose: () => {
      for (const u of unsubs) u();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/compute/src/groove/pipeline.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/groove/pipeline.ts packages/compute/src/groove/pipeline.test.ts
git commit -m "feat(groove): live compute pipeline composing target + true-wind channels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Barrel export + package subpath

**Files:**
- Create: `packages/compute/src/groove/index.ts`
- Modify: `packages/compute/package.json`

- [ ] **Step 1: Create the barrel**

`packages/compute/src/groove/index.ts`:

```ts
export { startGrooveComputePipeline, type GroovePipelineHandle, type GrooveSettingsRef } from './pipeline.js';
export { classifyPointOfSail, type PointOfSail } from './point-of-sail.js';
export { isInGroove, vmgEfficiencyPct, vmgMs, targetTwaErrorRad } from './metrics.js';
export { leewayRad } from './leeway.js';
```

- [ ] **Step 2: Add the `./groove` export**

In `packages/compute/package.json`, add to the `exports` map (after the `./race` entry):

```json
    "./groove": {
      "types": "./dist/groove/index.d.ts",
      "default": "./dist/groove/index.js"
    }
```

- [ ] **Step 3: Build the package**

Run: `npx tsc -b packages/compute`
Expected: builds; emits `dist/groove/index.js` and `.d.ts`.

- [ ] **Step 4: Verify the subpath resolves**

Run: `node -e "import('@g5000/compute/groove').then(m => console.log(typeof m.startGrooveComputePipeline))"` from the repo root.
Expected: prints `function`.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/groove/index.ts packages/compute/package.json
git commit -m "feat(groove): barrel + @g5000/compute/groove subpath export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Boot wiring (groove subsystem)

**Files:**
- Create: `apps/g5000/src/groove-subsystem.ts`
- Modify: `apps/g5000/src/index.ts:204-205`

- [ ] **Step 1: Create the subsystem**

`apps/g5000/src/groove-subsystem.ts`:

```ts
import type { Bus } from '@g5000/core';
import type { ConfigStore, GrooveSettings } from '@g5000/db';
import { startGrooveComputePipeline, type GrooveSettingsRef } from '@g5000/compute/groove';

/**
 * Live groove metrics. Runs in every source mode (live/demo/replay) so replay
 * integration tests exercise the same path. Settings are read through a ref
 * that tracks ConfigStore, so a settings change applies on the next sample.
 */
export async function startGrooveSubsystem(deps: { bus: Bus; store: ConfigStore }): Promise<() => Promise<void>> {
  const { bus, store } = deps;
  const settingsRef: GrooveSettingsRef = { current: store.getGrooveSettings() };
  const sub = store.grooveSettings$.subscribe((s: GrooveSettings) => {
    settingsRef.current = s;
  });
  const handle = startGrooveComputePipeline(bus, settingsRef);
  // eslint-disable-next-line no-console
  console.log('[groove] live compute pipeline online');
  return async () => {
    handle.dispose();
    sub.unsubscribe();
  };
}
```

- [ ] **Step 2: Wire it into boot**

In `apps/g5000/src/index.ts`, add the import near the other subsystem import (`import { startRaceSubsystem } from './race-subsystem.js';`):

```ts
import { startGrooveSubsystem } from './groove-subsystem.js';
```

Then immediately after the existing lines 204-205:

```ts
  const stopRaceSubsystem = await startRaceSubsystem({ bus, store });
  teardown.push(stopRaceSubsystem);
```

add:

```ts
  const stopGrooveSubsystem = await startGrooveSubsystem({ bus, store });
  teardown.push(stopGrooveSubsystem);
```

- [ ] **Step 3: Build the app**

Run: `npx tsc -b apps/g5000`
Expected: builds with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/g5000/src/groove-subsystem.ts apps/g5000/src/index.ts
git commit -m "feat(groove): start live groove pipeline at boot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Helm view groove tiles

**Files:**
- Modify: `packages/web/src/app/helm/page.tsx`

Reuse the existing `HelmTile` component and the `useSse()` hook (returns `channels: Map<string, JsonSafeSample>`).

- [ ] **Step 1: Inspect the current helm page**

Run: `sed -n '1,80p' packages/web/src/app/helm/page.tsx`
Note how it imports `useSse` and `HelmTile`, how it reads a scalar (e.g. `channels.get('boat.speed.water')`), and the value shape (`JsonSafeSample` — `t_ns` is a string; `value` is the same `ChannelValue` union). Match that pattern exactly.

- [ ] **Step 2: Add a groove helper + tiles**

Add these helpers near the top of the component module (after imports), adjusting `getScalar`/`getEnum` to match how the file already reads samples if it has equivalents:

```tsx
const RAD_TO_DEG = 180 / Math.PI;

function grooveSeverity(pct: number | null, good: number, ok: number): 'good' | 'ok' | 'bad' | 'neutral' {
  if (pct === null) return 'neutral';
  if (pct >= good) return 'good';
  if (pct >= ok) return 'ok';
  return 'bad';
}
```

In the JSX, add a groove cluster (read from the `channels` map the page already has). Example block:

```tsx
{(() => {
  const num = (ch: string): number | null => {
    const v = channels.get(ch)?.value;
    return v && v.kind === 'scalar' ? v.value : null;
  };
  const str = (ch: string): string | null => {
    const v = channels.get(ch)?.value;
    return v && v.kind === 'enum' ? v.value : null;
  };
  const tig = num('groove.timeInGroove');
  const eff = num('groove.vmgEfficiency');
  const steadiness = num('groove.twaSteadiness');
  const effort = num('groove.steeringEffort');
  const pos = str('groove.pointOfSail');
  const helm = str('groove.helmSource');
  const steerLabel = helm === 'autopilot' ? 'Pilot activity' : 'Helm steadiness';
  return (
    <>
      <HelmTile
        label="In groove"
        value={tig === null ? '—' : tig.toFixed(0)}
        unit={tig === null ? undefined : '%'}
        severity={grooveSeverity(tig, 80, 50)}
        sub={pos ?? undefined}
      />
      <HelmTile
        label="VMG eff"
        value={eff === null ? '—' : eff.toFixed(0)}
        unit={eff === null ? undefined : '%'}
        severity={grooveSeverity(eff, 98, 90)}
      />
      <HelmTile
        label={steerLabel}
        small
        value={steadiness === null ? '—' : (steadiness * RAD_TO_DEG).toFixed(1)}
        unit={steadiness === null ? undefined : '°σ'}
      >
        {effort !== null && (
          <div className="text-xs text-slate-500">{effort.toFixed(0)} corr·min⁻¹</div>
        )}
      </HelmTile>
    </>
  );
})()}
```

Place this inside the same tile grid container the page already uses.

- [ ] **Step 3: Build the web package**

Run: `npx tsc -b packages/web`
Expected: builds with no type errors.

- [ ] **Step 4: Manual smoke check (DEMO_MODE)**

Run the app in demo mode per the repo's dev instructions (e.g. `DEMO_MODE=1 npm run dev` from `apps/g5000`, or the project's documented dev command — confirm in `apps/g5000/package.json`), open `/helm`, and confirm the three groove tiles render and update. With no polar loaded, "In groove"/"VMG eff" show "—" and the point-of-sail sub-label still appears — that's the expected suppression behaviour.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/helm/page.tsx
git commit -m "feat(web): groove tile cluster on /helm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Mast display formatting for groove channels

**Files:**
- Modify: the mast tile value formatter (locate in Step 1)

The mast layout editor already lists `groove.*` channels automatically (via `knownChannelSet()`), and per-cell threshold colours already exist. This task ensures the numeric formatter renders the new channels with sensible units.

- [ ] **Step 1: Locate the mast value formatter**

Run: `grep -rn "boat.speed.water\|formatValue\|toFixed\|m/s\|knots" packages/web/src/app/mast packages/web/src/lib 2>/dev/null | grep -i "format\|convert\|mast" | head`
Identify the function that converts a channel `{kind:'scalar', value, unit}` sample into the displayed number (it already converts m/s→kn and rad→deg for existing channels). Read it fully before editing.

- [ ] **Step 2: Extend the formatter**

Add cases so that:
- `groove.timeInGroove`, `groove.vmgEfficiency` → render the raw value with 0 decimals and a `%` suffix (value is already a percentage; do **not** convert).
- `groove.twaSteadiness`, `groove.targetTwaError`, `boat.leeway` → convert radians→degrees (multiply by `180/Math.PI`), 1 decimal, `°` suffix.
- `groove.steeringEffort` → raw value, 0 decimals, `/min` suffix.
- `groove.speedCv` → multiply by 100, 0 decimals, `%` suffix.
- `groove.buildRate`, `groove.vmg` → keep existing m/s→kn handling (they carry m/s and m/s² units; `groove.vmg` → kn; `groove.buildRate` → leave in m/s² with 2 decimals).
- `groove.pointOfSail`, `groove.helmSource`, `groove.inGroove` are enums — ensure the formatter renders the enum string verbatim for these (the mast tile already handles enum channels if any exist; if not, add an enum passthrough).

Match the file's existing switch/lookup structure; do not restructure it.

- [ ] **Step 3: Build**

Run: `npx tsc -b packages/web`
Expected: no errors.

- [ ] **Step 4: Add a starter mast preset (optional within this task)**

If the repo seeds a default `mast_layout` (check `packages/db/src/defaults.ts` for a mast layout default), add a one-page preset with tiles for `groove.timeInGroove` (units `pct`), `groove.vmgEfficiency` (`pct`), and `groove.twaSteadiness` (`deg`), each with green/amber/red thresholds. If there is no seedable default layout, skip this step (the user can add tiles via `/mast-config`).

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "feat(web): mast formatter support for groove channels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Correct the stale heel-sensor doc + full build/test

**Files:**
- Modify: `docs/design/hercules-feature-notes.md:82`

- [ ] **Step 1: Fix the stale claim**

Open `docs/design/hercules-feature-notes.md`, find the sentence at/around line 82 stating "Sula doesn't have a heel sensor, mast-rotation sensor, or leeway-angle output". Replace with an accurate statement, e.g.: "Sula has heel and pitch sensors (PGN 127257 attitude). It does **not** have a mast-rotation sensor or a hardware leeway-angle output — leeway is now estimated from heel (see `boat.leeway`)."

- [ ] **Step 2: Full workspace build**

Run: `npx tsc -b`
Expected: the whole workspace builds with no errors.

- [ ] **Step 3: Full groove + touched-package test run**

Run: `npx vitest run packages/compute/src/groove packages/bridge/src/channel-mapper.test.ts packages/db/src/config-store.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add docs/design/hercules-feature-notes.md
git commit -m "docs: correct stale heel-sensor claim for Sula

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Phase 0 + Phase 1 core):**
- Rudder mapping → Task 2. ✅
- Leeway model + `boat.leeway` → Task 6 (pure) + Task 8 (publish). Wiring leeway into `current/math.ts` is intentionally deferred until `leewayK` is calibrated (default 0); noted here as the one deferred Phase-0 item.
- Channel constants / mast selectability → Task 1.
- Groove settings → Task 3.
- Point-of-sail classifier + gating → Task 4 + pipeline suppression in Task 8.
- in-groove / time-in-groove / VMG-efficiency / VMG / target-Δ → Task 7 + Task 8.
- TWA steadiness, Speed CV, build-rate, steering effort → Task 5 (math) + Task 8 (publish).
- Helm-source tagging → Task 8.
- Live display (helm + mast) → Task 11 + Task 12.
- VMC display: `race.vmc` already exists; surface it in the helm tiles alongside groove (add a tile reading `race.vmc` in Task 11 if not already shown — note for executor).
- Deferred (correctly, to follow-on plans): pitch-risk, maneuver cost, puff gain/lag (diagnostics plan); helmNervousness, envelope polar (Phase 2), attribution + scorecard (Phase 3).

**Placeholder scan:** Tasks 12 has two "locate the file" steps (formatter, optional preset) rather than literal line edits, because the exact formatter location/shape must be read first; each gives explicit, concrete edit rules and a grep to find it — not a "TODO". No "add error handling"-style placeholders elsewhere.

**Type consistency:** `PointOfSail` defined once (Task 4), imported by metrics (Task 7) and pipeline (Task 8). `GrooveSettings` defined in Task 3, consumed in Task 8/10. `FlagSample`/`NumSample` defined in Task 5, used in Task 8. Channel constant names (Task 1) match every `Channels.Groove.*` / `Channels.Boat.Leeway` reference in Tasks 8/11/12. `startGrooveComputePipeline(bus, settingsRef)` signature consistent across Tasks 8, 9, 10.
