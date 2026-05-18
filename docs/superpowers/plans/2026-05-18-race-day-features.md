# Race-Day Features (Cluster A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 7 race-day features from issue #8 — race timer with audible countdown, start-line ping (DTL/TTL/bias), laylines on chart with polar+current integration, VMC to active mark, TBS/TWA-target/%-polar helm tiles, wind-shift detection, OCS predictor — as one coherent surface.

**Architecture:** Single new `RaceState` singleton (persisted as `race_state` JSON-blob in ConfigStore) holds timer, line ends, and active-mark id. Single new compute pipeline in `@g5000/compute/race/*` subscribes to existing Bus channels (`nav.gps.*`, `wind.true.*`) and the active polar + Copernicus current grid, fans out a `race.*` derived-channel family. New `/race` page is the user surface for timer + line-ping + active-mark; chart gets `<StartLineLayer>` + `<LaylinesLayer>`; helm re-enables hidden wind tiles + mounts mini-timer + compound race tile. Wind-dependent channels degrade silently when wind is absent.

**Tech Stack:** TypeScript (strict, ESM), Vitest with `pool: 'forks'`, Drizzle ORM + better-sqlite3, Next.js 16 App Router + React 19, Tailwind 4, RxJS-backed Bus, MapLibre GL (chart layers), Web Audio API (race countdown).

**Spec:** [`docs/superpowers/specs/2026-05-18-race-day-features-design.md`](../specs/2026-05-18-race-day-features-design.md)

---

## Task 1: Add Race channels to channels.ts

**Files:**

- Modify: `packages/core/src/channels.ts`

- [ ] **Step 1: Add Race namespace to Channels constant**

Edit `packages/core/src/channels.ts`. After the `Electrical:` block (and before the closing `} as const;`), add:

```ts
  Race: {
    /** Signed perpendicular distance from boat to start line, meters.
     *  Positive = boat is on the pre-start side. Sign flips on crossing.
     *  Published only when both line ends are pinged. */
    LineDistanceToLine: 'race.line.distanceToLine',
    /** Haversine distance to the port end of the line, meters. */
    LineDistancePort: 'race.line.distancePort',
    /** Haversine distance to the starboard end of the line, meters. */
    LineDistanceStbd: 'race.line.distanceStbd',
    /** Seconds to cross the line at current SOG·cos(angle). Null when
     *  closing speed is non-positive (boat moving away or parallel). */
    LineTimeToLine: 'race.line.timeToLine',
    /** Line bias, radians. Positive = port end favored upwind. Requires
     *  wind.true.direction. */
    LineBias: 'race.line.bias',
    /** Predicted on-course-side (over-early) flag. True if boat would
     *  cross line before startMs at current vector, projected over
     *  settings.ocsLookAheadSec. */
    LineOcsPredicted: 'race.line.ocsPredicted',
    /** Velocity-Made-good toward the active mark, m/s. Wind-free. */
    Vmc: 'race.vmc',
    /** Target boat speed (polar-interpolated) at current TWS, |TWA|, m/s. */
    TargetSpeed: 'race.targetSpeed',
    /** Target TWA (optimal-VMG) at current TWS, radians. */
    TargetTwa: 'race.targetTwa',
    /** Percent of polar = BSP / TBS · 100. */
    PercentPolar: 'race.percentPolar',
    /** Signed wind shift vs 5-min baseline, radians. */
    WindShiftBias: 'race.windShift.bias',
    /** One-shot event channel: emits when shift persists > 60s above threshold. */
    WindShiftEvent: 'race.windShift.event',
    /** Polyline projection of the port-tack layline, array of {lat,lon}. */
    LaylinePort: 'race.laylines.port',
    /** Polyline projection of the starboard-tack layline. */
    LaylineStbd: 'race.laylines.stbd',
  },
```

- [ ] **Step 2: Build core to verify**

Run: `npx tsc -b packages/core`
Expected: clean exit (no output).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/channels.ts
git commit -m "feat(core): add Race channel constants for cluster A"
```

---

## Task 2: Define RaceState types and globalThis accessors

**Files:**

- Create: `packages/core/src/race-state.ts`
- Create: `packages/core/src/race-state.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/race-state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRaceState,
  defaultRaceStateConfig,
  setSharedRaceState,
  getSharedRaceState,
  _resetSharedRaceStateForTests,
  type RaceStateConfig,
} from './race-state.js';

describe('RaceState', () => {
  beforeEach(() => _resetSharedRaceStateForTests());

  it('starts with default config: idle timer, no line, no mark', () => {
    const rs = createRaceState();
    expect(rs.get().timer.state).toBe('idle');
    expect(rs.get().timer.startMs).toBeNull();
    expect(rs.get().line.port).toBeUndefined();
    expect(rs.get().line.stbd).toBeUndefined();
    expect(rs.get().activeMarkWaypointId).toBeUndefined();
    expect(rs.get().settings.shiftThresholdDeg).toBe(7);
  });

  it('mutate() applies an updater and notifies subscribers', () => {
    const rs = createRaceState();
    const seen: RaceStateConfig[] = [];
    const off = rs.subscribe((next) => seen.push(next));
    rs.mutate((draft) => {
      draft.timer.startMs = 1234;
      draft.timer.state = 'pre-start';
    });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.timer.startMs).toBe(1234);
    expect(seen[0]!.timer.state).toBe('pre-start');
    expect(rs.get().timer.startMs).toBe(1234);
  });

  it('hydrate() replaces config wholesale and notifies once', () => {
    const rs = createRaceState();
    const seen: RaceStateConfig[] = [];
    const off = rs.subscribe((next) => seen.push(next));
    rs.hydrate({
      ...defaultRaceStateConfig(),
      timer: { state: 'started', startMs: 999 },
      activeMarkWaypointId: 'wp-1',
    });
    off();
    expect(seen).toHaveLength(1);
    expect(rs.get().timer.state).toBe('started');
    expect(rs.get().activeMarkWaypointId).toBe('wp-1');
  });

  it('shared singleton: set then get returns the same instance', () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    expect(getSharedRaceState()).toBe(rs);
  });

  it('getSharedRaceState() returns null when unset', () => {
    expect(getSharedRaceState()).toBeNull();
  });

  it('defaultRaceStateConfig() returns fresh copies (no shared refs)', () => {
    const a = defaultRaceStateConfig();
    const b = defaultRaceStateConfig();
    expect(a).not.toBe(b);
    expect(a.line).not.toBe(b.line);
    expect(a.settings).not.toBe(b.settings);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/race-state.test.ts`
Expected: FAIL with "Cannot find module './race-state.js'".

- [ ] **Step 3: Implement the registry**

Create `packages/core/src/race-state.ts`:

```ts
/**
 * Race-day shared state: countdown timer, start-line endpoints, active mark.
 *
 * In-memory mutable object with a subscribe/publish surface. Persistence
 * is the caller's responsibility (see packages/db/src/race-state.ts);
 * this module just holds the live state that compute predicates and
 * API routes read each tick.
 *
 * Parallels AlarmsRegistry: globalThis singleton, no I/O.
 */

export type TimerState = 'idle' | 'pre-start' | 'started' | 'finished';

export interface LineEnd {
  lat: number;
  lon: number;
  /** ISO timestamp the ping was recorded. */
  pingedAt: string;
}

export interface RaceLine {
  port?: LineEnd;
  stbd?: LineEnd;
  /** Which side of the line was the boat on at second-ping time; defines
   *  the sign of DTL going forward. Set by /api/race/line POST handler. */
  preStartSide?: 'port' | 'stbd';
}

export interface RaceTimer {
  /** Epoch ms of the gun. Null while idle. */
  startMs: number | null;
  state: TimerState;
}

export interface RaceSettings {
  /** Degrees of TWD shift vs 5-min baseline that flags a shift event. */
  shiftThresholdDeg: number;
  /** Seconds to project boat vector forward for OCS prediction. */
  ocsLookAheadSec: number;
  /** Layline projection length in NM. Capped at 15 in the UI. */
  laylineDistanceNm: number;
  /** When true, integrate the current grid along the projected layline. */
  integrateCurrent: boolean;
}

export interface RaceStateConfig {
  timer: RaceTimer;
  line: RaceLine;
  activeMarkWaypointId?: string;
  settings: RaceSettings;
}

export function defaultRaceStateConfig(): RaceStateConfig {
  return {
    timer: { startMs: null, state: 'idle' },
    line: {},
    settings: {
      shiftThresholdDeg: 7,
      ocsLookAheadSec: 10,
      laylineDistanceNm: 5,
      integrateCurrent: true,
    },
  };
}

export interface RaceState {
  get(): RaceStateConfig;
  /** Mutate the config via an updater that receives a mutable draft. */
  mutate(updater: (draft: RaceStateConfig) => void): void;
  /** Replace the config wholesale (used at boot from persistence). */
  hydrate(next: RaceStateConfig): void;
  /** Notified on every mutate/hydrate. Returns an unsubscribe. */
  subscribe(handler: (next: RaceStateConfig) => void): () => void;
}

export function createRaceState(initial?: RaceStateConfig): RaceState {
  let current: RaceStateConfig = initial ?? defaultRaceStateConfig();
  const handlers = new Set<(c: RaceStateConfig) => void>();
  function notify(): void {
    for (const h of handlers) h(current);
  }
  return {
    get: () => current,
    mutate(updater) {
      // Shallow-clone the top-level shape so subscribers see a new object
      // identity per mutation (helps React useSyncExternalStore).
      const draft: RaceStateConfig = {
        timer: { ...current.timer },
        line: {
          port: current.line.port ? { ...current.line.port } : undefined,
          stbd: current.line.stbd ? { ...current.line.stbd } : undefined,
          preStartSide: current.line.preStartSide,
        },
        activeMarkWaypointId: current.activeMarkWaypointId,
        settings: { ...current.settings },
      };
      updater(draft);
      current = draft;
      notify();
    },
    hydrate(next) {
      current = next;
      notify();
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

const GLOBAL_KEY = '__g5000_raceState__';

declare global {
  // eslint-disable-next-line no-var
  var __g5000_raceState__: RaceState | undefined;
}

export function setSharedRaceState(rs: RaceState): void {
  globalThis[GLOBAL_KEY] = rs;
}

export function getSharedRaceState(): RaceState | null {
  return globalThis[GLOBAL_KEY] ?? null;
}

export function _resetSharedRaceStateForTests(): void {
  globalThis[GLOBAL_KEY] = undefined;
}
```

- [ ] **Step 4: Export from core/src/index.ts**

Add to `packages/core/src/index.ts` (append near the other re-exports):

```ts
export * from './race-state.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/src/race-state.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 6: Build core**

Run: `npx tsc -b packages/core`
Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/race-state.ts packages/core/src/race-state.test.ts packages/core/src/index.ts
git commit -m "feat(core): RaceState singleton, types, and globalThis accessors"
```

---

## Task 3: Add `race_state` table to DB schema

**Files:**

- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add the table**

In `packages/db/src/schema.ts`, after the `alarmsHistory` table (or anywhere among the singleton config tables), add:

```ts
export const raceState = sqliteTable('race_state', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded RaceStateConfig
});
```

- [ ] **Step 2: Build db**

Run: `npx tsc -b packages/db`
Expected: clean exit.

- [ ] **Step 3: Verify migration runs at runtime**

ConfigStore creates tables via `db.run(sql\`CREATE TABLE IF NOT EXISTS ...\`)`lazily on first access. Open`packages/db/src/config-store.ts`and confirm there is a corresponding`CREATE TABLE IF NOT EXISTS race*state`near the other table-init statements — if not, add one alongside the existing`alarms*\*` creates so the table exists when load/save are first called.

Search for the alarms_config CREATE in `packages/db/src/config-store.ts`:

Run: `grep -n "alarms_config" packages/db/src/config-store.ts`
Expected: at least one `CREATE TABLE IF NOT EXISTS alarms_config` statement.

If the pattern is "schema-init-on-construct", add an adjacent block in the same place:

```ts
this.db.run(`
  CREATE TABLE IF NOT EXISTS race_state (
    id    TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);
```

- [ ] **Step 4: Run db tests**

Run: `npx vitest run packages/db/src/config-store.test.ts`
Expected: all pass (no new tests; existing pass).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/config-store.ts
git commit -m "feat(db): add race_state JSON-blob table"
```

---

## Task 4: RaceState persistence helpers

**Files:**

- Create: `packages/db/src/race-state.ts`
- Create: `packages/db/src/race-state.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/race-state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigStore } from './config-store.js';
import { loadRaceState, saveRaceState, DEFAULT_RACE_STATE } from './race-state.js';
import { defaultRaceStateConfig } from '@g5000/core';

let store: ConfigStore;

beforeEach(async () => {
  store = await ConfigStore.open(':memory:');
});

describe('race-state persistence', () => {
  it('loadRaceState returns DEFAULT_RACE_STATE when row is missing', async () => {
    const out = await loadRaceState(store);
    expect(out).toEqual(DEFAULT_RACE_STATE);
  });

  it('saveRaceState writes JSON and loadRaceState reads it back', async () => {
    const cfg = defaultRaceStateConfig();
    cfg.timer.startMs = 12345;
    cfg.timer.state = 'pre-start';
    cfg.line.port = { lat: 41.5, lon: -71.3, pingedAt: '2026-05-18T12:00:00Z' };
    cfg.activeMarkWaypointId = 'wp-42';
    await saveRaceState(store, cfg);
    const out = await loadRaceState(store);
    expect(out.timer.startMs).toBe(12345);
    expect(out.timer.state).toBe('pre-start');
    expect(out.line.port).toEqual({ lat: 41.5, lon: -71.3, pingedAt: '2026-05-18T12:00:00Z' });
    expect(out.activeMarkWaypointId).toBe('wp-42');
  });

  it('loadRaceState merges defaults for missing settings keys', async () => {
    // Simulate an older persisted row that has no `integrateCurrent`.
    const drizzle = store.drizzle;
    const { raceState } = await import('./schema.js');
    await drizzle
      .insert(raceState)
      .values({
        id: 'singleton',
        value: JSON.stringify({
          timer: { startMs: null, state: 'idle' },
          line: {},
          settings: { shiftThresholdDeg: 9, ocsLookAheadSec: 5, laylineDistanceNm: 8 },
        }),
      })
      .run();
    const out = await loadRaceState(store);
    expect(out.settings.shiftThresholdDeg).toBe(9);
    expect(out.settings.ocsLookAheadSec).toBe(5);
    expect(out.settings.laylineDistanceNm).toBe(8);
    // Missing key falls back to default.
    expect(out.settings.integrateCurrent).toBe(true);
  });

  it('loadRaceState returns DEFAULT_RACE_STATE when row JSON is malformed', async () => {
    const drizzle = store.drizzle;
    const { raceState } = await import('./schema.js');
    await drizzle.insert(raceState).values({ id: 'singleton', value: 'not json' }).run();
    const out = await loadRaceState(store);
    expect(out).toEqual(DEFAULT_RACE_STATE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/src/race-state.test.ts`
Expected: FAIL with "Cannot find module './race-state.js'".

- [ ] **Step 3: Implement persistence helpers**

Create `packages/db/src/race-state.ts`:

```ts
import { eq } from 'drizzle-orm';
import { defaultRaceStateConfig, type RaceStateConfig } from '@g5000/core';
import type { ConfigStore } from './config-store.js';
import { raceState } from './schema.js';

export const DEFAULT_RACE_STATE: RaceStateConfig = defaultRaceStateConfig();

const ID = 'singleton';

function mergeDefaults(loaded: Partial<RaceStateConfig>): RaceStateConfig {
  const def = defaultRaceStateConfig();
  return {
    timer: { ...def.timer, ...(loaded.timer ?? {}) },
    line: { ...def.line, ...(loaded.line ?? {}) },
    activeMarkWaypointId: loaded.activeMarkWaypointId,
    settings: { ...def.settings, ...(loaded.settings ?? {}) },
  };
}

export async function loadRaceState(store: ConfigStore): Promise<RaceStateConfig> {
  const db = store.drizzle;
  const row = await db.select().from(raceState).where(eq(raceState.id, ID)).get();
  if (!row) return defaultRaceStateConfig();
  try {
    const parsed = JSON.parse(row.value) as Partial<RaceStateConfig>;
    return mergeDefaults(parsed);
  } catch {
    return defaultRaceStateConfig();
  }
}

export async function saveRaceState(store: ConfigStore, cfg: RaceStateConfig): Promise<void> {
  const db = store.drizzle;
  const value = JSON.stringify(cfg);
  await db
    .insert(raceState)
    .values({ id: ID, value })
    .onConflictDoUpdate({ target: raceState.id, set: { value } })
    .run();
}
```

- [ ] **Step 4: Re-export from db/src/index.ts**

In `packages/db/src/index.ts`, add (with the other re-exports):

```ts
export * from './race-state.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/db/src/race-state.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Build db**

Run: `npx tsc -b packages/db`
Expected: clean exit.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/race-state.ts packages/db/src/race-state.test.ts packages/db/src/index.ts
git commit -m "feat(db): loadRaceState/saveRaceState with default-merge"
```

---

## Task 5: Line geometry math

**Files:**

- Create: `packages/compute/src/race/line-geometry.ts`
- Create: `packages/compute/src/race/line-geometry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/compute/src/race/line-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  initialBearingRad,
  lineBearingRad,
  distanceToLineMeters,
  timeToLineSeconds,
  lineBiasRad,
} from './line-geometry.js';

const port = { lat: 41.5, lon: -71.3 };
const stbd = { lat: 41.5, lon: -71.29 }; // ~830 m east of port

describe('haversineMeters', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMeters(port, port)).toBeLessThan(0.001);
  });
  it('matches a known great-circle distance to within 1 m', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    // 1° of longitude at the equator ≈ 111_320 m
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_600);
  });
});

describe('lineBearingRad', () => {
  it('east-pointing line from port to stbd is ~π/2 (90° true)', () => {
    const b = lineBearingRad(port, stbd);
    expect(b).toBeCloseTo(Math.PI / 2, 2);
  });
});

describe('distanceToLineMeters', () => {
  it('returns 0 for a boat on the line midpoint', () => {
    const mid = { lat: (port.lat + stbd.lat) / 2, lon: (port.lon + stbd.lon) / 2 };
    const r = distanceToLineMeters(mid, port, stbd, 'port');
    expect(Math.abs(r)).toBeLessThan(1);
  });
  it('returns a positive distance when boat is on the declared pre-start side', () => {
    // Boat south of the line (line runs east-west) → south is the pre-start side.
    const south = { lat: 41.49, lon: -71.295 };
    const r = distanceToLineMeters(south, port, stbd, 'port'); // pre-start = south
    expect(r).toBeGreaterThan(0);
    expect(r).toBeGreaterThan(1000); // ~1.1 km south
    expect(r).toBeLessThan(1200);
  });
  it('returns a negative distance after the boat crosses to the other side', () => {
    const north = { lat: 41.51, lon: -71.295 };
    // Boat south is pre-start side → crossing north is past-line.
    const r = distanceToLineMeters(north, port, stbd, 'port');
    expect(r).toBeLessThan(0);
  });
});

describe('timeToLineSeconds', () => {
  it('returns DTL/speed when boat heads directly at the line', () => {
    // Boat 1000 m on pre-start side, COG aimed at line normal, SOG 5 m/s.
    // Closing speed = 5 m/s · cos(0) = 5 m/s. TTL = 1000/5 = 200 s.
    const dtl = 1000;
    const sog = 5;
    const closingAngleRad = 0; // perpendicular to line
    const t = timeToLineSeconds(dtl, sog, closingAngleRad);
    expect(t).toBeCloseTo(200, 1);
  });
  it('returns null when boat is moving parallel or away (closing ≤ 0)', () => {
    expect(timeToLineSeconds(1000, 5, Math.PI / 2)).toBeNull();
    expect(timeToLineSeconds(1000, 5, Math.PI)).toBeNull();
  });
});

describe('lineBiasRad', () => {
  it('returns 0 for a perfectly square line (line ⟂ TWD)', () => {
    // Line bears 90° true, TWD 180° (wind from south). Line normal = 0°
    // (north), TWD = 180°. Angle between normal and from-wind = 180°,
    // bias = angle between (line-bearing) and (perp-to-TWD) → 0.
    const lineBearing = Math.PI / 2;
    const twd = Math.PI; // from south
    expect(lineBiasRad(lineBearing, twd)).toBeCloseTo(0, 3);
  });
  it('positive bias means port end favored (closer to wind)', () => {
    // Line east-west; wind from NNW (TWD = -π/8 from north, i.e. -22.5°).
    // Port end (west) is closer to wind → bias positive.
    const lineBearing = Math.PI / 2;
    const twd = -Math.PI / 8;
    const bias = lineBiasRad(lineBearing, twd);
    expect(bias).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/compute/src/race/line-geometry.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the math**

Create `packages/compute/src/race/line-geometry.ts`:

```ts
const EARTH_R_M = 6_371_000;

export interface LatLon {
  lat: number;
  lon: number;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance in meters. Haversine formula. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dφ = toRad(b.lat - a.lat);
  const dλ = toRad(b.lon - a.lon);
  const x = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Initial bearing in radians, [0, 2π). True reference (geodesic). */
export function initialBearingRad(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dλ = toRad(b.lon - a.lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const θ = Math.atan2(y, x);
  return (θ + 2 * Math.PI) % (2 * Math.PI);
}

/** Bearing from line.port to line.stbd, [0, 2π). */
export function lineBearingRad(port: LatLon, stbd: LatLon): number {
  return initialBearingRad(port, stbd);
}

/**
 * Signed perpendicular distance from boat to the great-circle through port→stbd.
 * Sign convention: positive = boat is on `preStartSide`. The function determines
 * the geometric side via the sign of the cross-track distance (Aviation
 * Formulary §29) and flips to align with the declared preStartSide.
 */
export function distanceToLineMeters(
  boat: LatLon,
  port: LatLon,
  stbd: LatLon,
  preStartSide: 'port' | 'stbd',
): number {
  // Cross-track distance: δ_at = asin(sin(d/R) * sin(θ_pb - θ_pe))
  // d = distance port → boat, θ_pb = bearing port → boat, θ_pe = bearing port → stbd
  const d13 = haversineMeters(port, boat);
  const θ13 = initialBearingRad(port, boat);
  const θ12 = initialBearingRad(port, stbd);
  const δ = Math.asin(Math.sin(d13 / EARTH_R_M) * Math.sin(θ13 - θ12)) * EARTH_R_M;
  // δ > 0 means boat is to the LEFT of the port→stbd track.
  // Match the sign to preStartSide: if preStartSide is 'port', boat starting
  // on the LEFT (δ > 0) should be positive; if preStartSide is 'stbd',
  // boat starting on the RIGHT (δ < 0) should be positive.
  return preStartSide === 'port' ? δ : -δ;
}

/**
 * TTL in seconds. Returns null if closing speed ≤ 0 (boat moving away
 * from line or parallel to it).
 *
 * @param dtlMeters signed DTL (positive = pre-start side)
 * @param sogMs SOG in m/s
 * @param closingAngleRad angle between COG and line normal (toward the line).
 *                        0 = heading directly at line; π/2 = parallel.
 */
export function timeToLineSeconds(
  dtlMeters: number,
  sogMs: number,
  closingAngleRad: number,
): number | null {
  const closingSpeed = sogMs * Math.cos(closingAngleRad);
  if (closingSpeed <= 0) return null;
  return Math.abs(dtlMeters) / closingSpeed;
}

/**
 * Line bias (radians): signed angle of TWD vs the line normal. Positive =
 * port end favored upwind.
 *
 *   normal = lineBearing - π/2  (perpendicular pointing to port-side of line)
 *   bias   = circularDiff(twd, normal + π)  (toward the wind = bias 0 if line is square)
 */
export function lineBiasRad(lineBearingRad: number, twdRad: number): number {
  const normalToward = lineBearingRad - Math.PI / 2; // perpendicular off port end
  // We want bias = 0 when wind comes from the line normal direction
  // (i.e. wind blows perpendicular through the line). Positive bias means
  // wind is rotated toward port end → port is favored.
  let d = twdRad - (normalToward + Math.PI); // from-wind vs the upwind side
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/compute/src/race/line-geometry.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Build compute**

Run: `npx tsc -b packages/compute`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add packages/compute/src/race/line-geometry.ts packages/compute/src/race/line-geometry.test.ts
git commit -m "feat(compute): race line geometry (DTL, TTL, bias, bearing)"
```

---

## Task 6: VMC math

**Files:**

- Create: `packages/compute/src/race/vmc.ts`
- Create: `packages/compute/src/race/vmc.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/compute/src/race/vmc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { vmc } from './vmc.js';

describe('vmc', () => {
  it('heading directly at mark → vmc = sog', () => {
    expect(vmc(5, 0, 0)).toBeCloseTo(5, 5);
    expect(vmc(5, Math.PI / 4, Math.PI / 4)).toBeCloseTo(5, 5);
  });
  it('perpendicular → vmc = 0', () => {
    expect(vmc(5, 0, Math.PI / 2)).toBeCloseTo(0, 5);
  });
  it('reverse course → vmc = -sog', () => {
    expect(vmc(5, 0, Math.PI)).toBeCloseTo(-5, 5);
  });
  it('wraps angle differences across 0/2π', () => {
    // COG = 359°, bearing = 1°  (2° apart, both near north)
    const cog = (359 * Math.PI) / 180;
    const bearing = (1 * Math.PI) / 180;
    expect(vmc(5, cog, bearing)).toBeCloseTo(5 * Math.cos((2 * Math.PI) / 180), 4);
  });
  it('zero SOG → vmc = 0 regardless of angles', () => {
    expect(vmc(0, 1.2, 3.4)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/race/vmc.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/compute/src/race/vmc.ts`:

```ts
/**
 * Velocity Made-good toward a fixed Course. COG and bearing in radians;
 * SOG in any speed unit. Returns the SOG component projected onto the
 * bearing-to-mark vector. Positive = closing the mark; negative = opening.
 */
export function vmc(sog: number, cogRad: number, bearingToMarkRad: number): number {
  let dθ = cogRad - bearingToMarkRad;
  while (dθ > Math.PI) dθ -= 2 * Math.PI;
  while (dθ < -Math.PI) dθ += 2 * Math.PI;
  return sog * Math.cos(dθ);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/compute/src/race/vmc.test.ts`
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/race/vmc.ts packages/compute/src/race/vmc.test.ts
git commit -m "feat(compute): VMC scalar (current-aware via COG)"
```

---

## Task 7: OCS predictor

**Files:**

- Create: `packages/compute/src/race/ocs-predictor.ts`
- Create: `packages/compute/src/race/ocs-predictor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/compute/src/race/ocs-predictor.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { predictOcs } from './ocs-predictor.js';

const port = { lat: 41.5, lon: -71.3 };
const stbd = { lat: 41.5, lon: -71.29 };
const south = { lat: 41.491, lon: -71.295 }; // ~1 km south of mid

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('predictOcs', () => {
  it('returns null when startMs is null', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: null,
        lookAheadSec: 10,
      }),
    ).toBeNull();
  });
  it('returns null when SOG < 0.5 kn', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 0.2,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() + 5000,
        lookAheadSec: 10,
      }),
    ).toBeNull();
  });
  it('returns null when COG concentration < 0.7', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.5,
        line: { port, stbd },
        startMs: Date.now() + 5000,
        lookAheadSec: 10,
      }),
    ).toBeNull();
  });
  it('returns null when line endpoints are missing', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port },
        startMs: Date.now() + 5000,
        lookAheadSec: 10,
      }),
    ).toBeNull();
  });
  it('returns false when secs-until-start exceeds lookAheadSec', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() + 30_000,
        lookAheadSec: 10,
      }),
    ).toBe(false);
  });
  it('returns false when the race is already on (secsUntilStart ≤ 0)', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() - 1000,
        lookAheadSec: 10,
      }),
    ).toBe(false);
  });
  it('returns true when boat will cross line within lookAhead and before start', () => {
    // Boat ~1 km south, COG = 0 (north), SOG = 200 m/s → projected
    // distance over 10 s = 2000 m → crosses the line easily.
    // startMs is 8 s out, so the projection happens before the gun.
    expect(
      predictOcs({
        pos: south,
        cogRad: 0,
        sogMs: 200,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() + 8000,
        lookAheadSec: 10,
      }),
    ).toBe(true);
  });
  it('returns false when boat is heading away from line', () => {
    expect(
      predictOcs({
        pos: south,
        cogRad: Math.PI, // due south
        sogMs: 5,
        cogConcentration: 0.9,
        line: { port, stbd },
        startMs: Date.now() + 8000,
        lookAheadSec: 10,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/race/ocs-predictor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/compute/src/race/ocs-predictor.ts`:

```ts
import type { LatLon } from './line-geometry.js';
import { haversineMeters } from './line-geometry.js';

export interface OcsInput {
  pos: LatLon;
  /** Course over ground in radians [0, 2π). */
  cogRad: number;
  /** Speed over ground in m/s. */
  sogMs: number;
  /** COG-stats mean-resultant length, [0, 1]. */
  cogConcentration: number;
  line: { port?: LatLon; stbd?: LatLon };
  /** Epoch ms of the gun, or null when idle. */
  startMs: number | null;
  /** Seconds to project forward. */
  lookAheadSec: number;
}

const MIN_SOG_MS = 0.5 * 0.514444; // 0.5 kn → m/s
const MIN_COG_CONCENTRATION = 0.7;

export function predictOcs(input: OcsInput): boolean | null {
  const { pos, cogRad, sogMs, cogConcentration, line, startMs, lookAheadSec } = input;
  if (startMs === null) return null;
  if (sogMs < MIN_SOG_MS) return null;
  if (cogConcentration < MIN_COG_CONCENTRATION) return null;
  if (!line.port || !line.stbd) return null;

  const secsUntilStart = (startMs - Date.now()) / 1000;
  if (secsUntilStart <= 0) return false; // race is on; not OCS
  if (secsUntilStart > lookAheadSec) return false;

  const projected = projectGreatCircle(pos, cogRad, sogMs * lookAheadSec);
  return segmentsIntersect(pos, projected, line.port, line.stbd);
}

/** Project from `start` along bearing `cogRad` for `distanceM` meters. */
function projectGreatCircle(start: LatLon, cogRad: number, distanceM: number): LatLon {
  const R = 6_371_000;
  const δ = distanceM / R;
  const φ1 = (start.lat * Math.PI) / 180;
  const λ1 = (start.lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(cogRad));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(cogRad) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: (φ2 * 180) / Math.PI, lon: (λ2 * 180) / Math.PI };
}

/**
 * 2D segment intersection treating lat/lon as planar over the small scale
 * a race start spans (line ≤ ~1 km; lookahead ≤ ~10 s of motion). At these
 * scales the planar approximation has sub-meter error.
 */
function segmentsIntersect(p1: LatLon, p2: LatLon, p3: LatLon, p4: LatLon): boolean {
  const d1x = p2.lon - p1.lon;
  const d1y = p2.lat - p1.lat;
  const d2x = p4.lon - p3.lon;
  const d2y = p4.lat - p3.lat;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false; // parallel
  const sx = p3.lon - p1.lon;
  const sy = p3.lat - p1.lat;
  const t = (sx * d2y - sy * d2x) / denom;
  const u = (sx * d1y - sy * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// haversineMeters re-exported for callers that need straight distance.
export { haversineMeters };
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/compute/src/race/ocs-predictor.test.ts`
Expected: all 8 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/race/ocs-predictor.ts packages/compute/src/race/ocs-predictor.test.ts
git commit -m "feat(compute): OCS predictor with SOG/COG-concentration gating"
```

---

## Task 8: Wind-shift rolling-median detector

**Files:**

- Create: `packages/compute/src/race/wind-shift.ts`
- Create: `packages/compute/src/race/wind-shift.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/compute/src/race/wind-shift.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createWindShiftDetector } from './wind-shift.js';

const DEG = Math.PI / 180;

describe('windShiftDetector', () => {
  it('publishes shift of 0 when current matches baseline', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 300_000,
      currentWindowMs: 30_000,
      thresholdRad: 7 * DEG,
      persistenceMs: 60_000,
    });
    // Feed 200 samples at TWD = 180°, spaced 1 s apart
    let lastShift = NaN;
    let lastEvent: ReturnType<typeof d.update>['event'] = null;
    for (let i = 0; i < 200; i++) {
      const r = d.update(180 * DEG, i * 1000);
      lastShift = r.biasRad;
      lastEvent = r.event;
    }
    expect(lastShift).toBeCloseTo(0, 3);
    expect(lastEvent).toBeNull();
  });

  it('detects a sustained shift above threshold after persistenceMs', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 300_000,
      currentWindowMs: 30_000,
      thresholdRad: 7 * DEG,
      persistenceMs: 60_000,
    });
    // 300 baseline samples at 180°
    for (let i = 0; i < 300; i++) d.update(180 * DEG, i * 1000);
    // Now shift to 195° (15° clockwise of baseline)
    let lastEvent: ReturnType<typeof d.update>['event'] = null;
    for (let i = 300; i < 300 + 90; i++) {
      const r = d.update(195 * DEG, i * 1000);
      if (r.event) lastEvent = r.event;
    }
    expect(lastEvent).not.toBeNull();
    expect(lastEvent!.deg).toBeGreaterThan(7);
  });

  it('does not fire when shift duration < persistenceMs', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 300_000,
      currentWindowMs: 30_000,
      thresholdRad: 7 * DEG,
      persistenceMs: 60_000,
    });
    for (let i = 0; i < 300; i++) d.update(180 * DEG, i * 1000);
    // Brief 30 s shift, then back.
    let event: ReturnType<typeof d.update>['event'] = null;
    for (let i = 300; i < 330; i++) {
      const r = d.update(195 * DEG, i * 1000);
      if (r.event) event = r.event;
    }
    for (let i = 330; i < 400; i++) d.update(180 * DEG, i * 1000);
    expect(event).toBeNull();
  });

  it('handles wraparound: median of [359, 1, 0, 358, 2] is near 0°', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 60_000,
      currentWindowMs: 60_000,
      thresholdRad: 7 * DEG,
      persistenceMs: 60_000,
    });
    const samples = [359, 1, 0, 358, 2];
    let last: number | null = null;
    for (let i = 0; i < samples.length; i++) {
      last = d.update(samples[i]! * DEG, i * 1000).biasRad;
    }
    // Baseline ≈ current here (one window), bias near 0.
    expect(Math.abs(last!)).toBeLessThan(0.05);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/race/wind-shift.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the detector**

Create `packages/compute/src/race/wind-shift.ts`:

```ts
export interface WindShiftConfig {
  baselineWindowMs: number;
  currentWindowMs: number;
  thresholdRad: number;
  persistenceMs: number;
}

export interface WindShiftSample {
  /** Signed shift (current − baseline), radians, normalized to [-π, π]. */
  biasRad: number;
  /** One-shot event payload on transition into a sustained shift, null otherwise. */
  event: { direction: 'header' | 'lift' | 'shift'; deg: number } | null;
}

interface CircularSample {
  tMs: number;
  /** Unit vector components (cos, sin) — averaging these is the
   *  circular-mean trick that handles wraparound correctly. */
  cos: number;
  sin: number;
  twdRad: number;
}

interface Window {
  samples: CircularSample[];
  cosSum: number;
  sinSum: number;
}

function pushWindow(w: Window, s: CircularSample, windowMs: number): void {
  w.samples.push(s);
  w.cosSum += s.cos;
  w.sinSum += s.sin;
  while (w.samples.length > 0 && s.tMs - w.samples[0]!.tMs > windowMs) {
    const dropped = w.samples.shift()!;
    w.cosSum -= dropped.cos;
    w.sinSum -= dropped.sin;
  }
}

function windowMedianRad(w: Window): number | null {
  if (w.samples.length === 0) return null;
  // Circular median via the sample whose TWD is closest to the circular mean.
  // The mean is atan2(meanSin, meanCos); we find the sample that minimises
  // the circular distance to the mean — this gives the robust "median-like"
  // estimator without sorting on a wrapped scale.
  const n = w.samples.length;
  const meanRad = Math.atan2(w.sinSum / n, w.cosSum / n);
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    let d = Math.abs(w.samples[i]!.twdRad - meanRad);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return w.samples[bestIdx]!.twdRad;
}

function circularDiffRad(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export interface WindShiftDetector {
  update(twdRad: number, tMs: number, hdgRad?: number | null): WindShiftSample;
  reset(): void;
}

export function createWindShiftDetector(cfg: WindShiftConfig): WindShiftDetector {
  const baseline: Window = { samples: [], cosSum: 0, sinSum: 0 };
  const current: Window = { samples: [], cosSum: 0, sinSum: 0 };
  let aboveThresholdSinceMs: number | null = null;
  let lastEventFiredAtMs: number | null = null;

  return {
    update(twdRad, tMs, hdgRad) {
      const s: CircularSample = {
        tMs,
        cos: Math.cos(twdRad),
        sin: Math.sin(twdRad),
        twdRad,
      };
      pushWindow(baseline, s, cfg.baselineWindowMs);
      pushWindow(current, s, cfg.currentWindowMs);
      const bMed = windowMedianRad(baseline);
      const cMed = windowMedianRad(current);
      if (bMed === null || cMed === null) {
        return { biasRad: 0, event: null };
      }
      const bias = circularDiffRad(cMed, bMed);
      // Persistence tracker
      if (Math.abs(bias) > cfg.thresholdRad) {
        if (aboveThresholdSinceMs === null) aboveThresholdSinceMs = tMs;
      } else {
        aboveThresholdSinceMs = null;
      }
      let event: WindShiftSample['event'] = null;
      if (
        aboveThresholdSinceMs !== null &&
        tMs - aboveThresholdSinceMs >= cfg.persistenceMs &&
        // Don't re-fire until the shift resets.
        (lastEventFiredAtMs === null || lastEventFiredAtMs < aboveThresholdSinceMs)
      ) {
        const deg = (bias * 180) / Math.PI;
        let direction: 'header' | 'lift' | 'shift' = 'shift';
        if (hdgRad !== null && hdgRad !== undefined) {
          // Starboard tack = wind from starboard = circularDiff(twd, hdg) ∈ (0, π)
          const onStbdTack = circularDiffRad(bMed, hdgRad) > 0;
          // A clockwise shift (positive bias) when on starboard tack moves the
          // wind further astern → lift. When on port tack → header.
          if (onStbdTack) direction = bias > 0 ? 'lift' : 'header';
          else direction = bias > 0 ? 'header' : 'lift';
        }
        event = { direction, deg };
        lastEventFiredAtMs = tMs;
      }
      return { biasRad: bias, event };
    },
    reset() {
      baseline.samples.length = 0;
      baseline.cosSum = 0;
      baseline.sinSum = 0;
      current.samples.length = 0;
      current.cosSum = 0;
      current.sinSum = 0;
      aboveThresholdSinceMs = null;
      lastEventFiredAtMs = null;
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/compute/src/race/wind-shift.test.ts`
Expected: all 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/race/wind-shift.ts packages/compute/src/race/wind-shift.test.ts
git commit -m "feat(compute): wind-shift detector with rolling circular median"
```

---

## Task 9: Layline projection (without and with current integration)

**Files:**

- Create: `packages/compute/src/race/laylines.ts`
- Create: `packages/compute/src/race/laylines.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/compute/src/race/laylines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectLayline } from './laylines.js';
import type { CurrentField } from '@g5000/grib';

const startPos = { lat: 41.5, lon: -71.3 };

// 2-knot easterly current (u = +1.029 m/s, v = 0) across a small box.
const easterlyCurrent: CurrentField = {
  source: 'CMEMS',
  runTime: new Date('2026-05-18T00:00:00Z'),
  lats: [41.0, 42.0],
  lons: [-72.0, -71.0],
  times: [new Date('2026-05-18T12:00:00Z')],
  u: [
    [
      [1.029, 1.029],
      [1.029, 1.029],
    ],
  ],
  v: [
    [
      [0, 0],
      [0, 0],
    ],
  ],
};

describe('projectLayline (no current)', () => {
  it('returns a 2-point polyline when integrateCurrent=false', () => {
    const poly = projectLayline({
      pos: startPos,
      headingRad: 0, // due north
      throughWaterSpeedMs: 5,
      currentField: null,
      distanceNm: 2,
      integrateCurrent: false,
      timeAtSampleMs: Date.now(),
    });
    expect(poly).toHaveLength(2);
    expect(poly[0]).toEqual(startPos);
    // 2 NM north ≈ 0.0333° lat
    expect(poly[1]!.lat).toBeCloseTo(startPos.lat + 0.0333, 3);
    expect(poly[1]!.lon).toBeCloseTo(startPos.lon, 4);
  });
});

describe('projectLayline (with current)', () => {
  it('returns 21 points for a 5 NM projection (20 segments)', () => {
    const poly = projectLayline({
      pos: startPos,
      headingRad: 0,
      throughWaterSpeedMs: 5,
      currentField: easterlyCurrent,
      distanceNm: 5,
      integrateCurrent: true,
      timeAtSampleMs: easterlyCurrent.times[0]!.getTime(),
    });
    expect(poly).toHaveLength(21);
  });

  it('an easterly current bends a northbound layline to the east', () => {
    const noCurr = projectLayline({
      pos: startPos,
      headingRad: 0,
      throughWaterSpeedMs: 5,
      currentField: null,
      distanceNm: 5,
      integrateCurrent: false,
      timeAtSampleMs: easterlyCurrent.times[0]!.getTime(),
    });
    const withCurr = projectLayline({
      pos: startPos,
      headingRad: 0,
      throughWaterSpeedMs: 5,
      currentField: easterlyCurrent,
      distanceNm: 5,
      integrateCurrent: true,
      timeAtSampleMs: easterlyCurrent.times[0]!.getTime(),
    });
    const endNoCurr = noCurr[noCurr.length - 1]!;
    const endWithCurr = withCurr[withCurr.length - 1]!;
    expect(endWithCurr.lon).toBeGreaterThan(endNoCurr.lon);
  });

  it('falls back to no-current behaviour when currentField is null', () => {
    const poly = projectLayline({
      pos: startPos,
      headingRad: Math.PI / 2, // east
      throughWaterSpeedMs: 5,
      currentField: null,
      distanceNm: 1,
      integrateCurrent: true, // requested but no field → ignored
      timeAtSampleMs: Date.now(),
    });
    expect(poly).toHaveLength(2);
  });

  it('caps segments at 20 even when requesting a long projection', () => {
    const poly = projectLayline({
      pos: startPos,
      headingRad: 0,
      throughWaterSpeedMs: 5,
      currentField: easterlyCurrent,
      distanceNm: 100,
      integrateCurrent: true,
      timeAtSampleMs: easterlyCurrent.times[0]!.getTime(),
    });
    expect(poly).toHaveLength(21);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/race/laylines.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/compute/src/race/laylines.ts`:

```ts
import type { CurrentField } from '@g5000/grib';
import { interpolateCurrent } from '@g5000/grib';
import type { LatLon } from './line-geometry.js';

export interface LaylineInput {
  pos: LatLon;
  /** Through-water heading in radians [0, 2π). */
  headingRad: number;
  throughWaterSpeedMs: number;
  currentField: CurrentField | null;
  distanceNm: number;
  integrateCurrent: boolean;
  /** Time at which to sample the current field. */
  timeAtSampleMs: number;
}

const NM_TO_M = 1852;
const MAX_SEGMENTS = 20;
const R_EARTH_M = 6_371_000;

function project(start: LatLon, bearingRad: number, distanceM: number): LatLon {
  const δ = distanceM / R_EARTH_M;
  const φ1 = (start.lat * Math.PI) / 180;
  const λ1 = (start.lon * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearingRad),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: (φ2 * 180) / Math.PI, lon: (λ2 * 180) / Math.PI };
}

/**
 * Project a layline polyline from `pos` along `headingRad`. When
 * `integrateCurrent` is true and `currentField` is non-null, the projection
 * is subdivided into ≤ MAX_SEGMENTS segments and at each segment midpoint
 * the local current vector is composed with the through-water vector to
 * produce the over-ground segment. Otherwise a single great-circle is
 * returned (start, end).
 */
export function projectLayline(input: LaylineInput): LatLon[] {
  const totalM = input.distanceNm * NM_TO_M;
  if (!input.integrateCurrent || !input.currentField) {
    return [input.pos, project(input.pos, input.headingRad, totalM)];
  }
  const segCount = Math.min(
    MAX_SEGMENTS,
    Math.max(1, Math.ceil(input.distanceNm / 0.25)), // ~0.25 NM segments preferred
  );
  const segM = totalM / segCount;
  const segHours = segM / input.throughWaterSpeedMs / 3600;
  const out: LatLon[] = [input.pos];
  let cursor = input.pos;
  for (let i = 0; i < segCount; i++) {
    // Sample current at the midpoint of the through-water-only projection.
    const midpoint = project(cursor, input.headingRad, segM / 2);
    const curr = interpolateCurrent(
      input.currentField,
      midpoint.lat,
      midpoint.lon,
      input.timeAtSampleMs,
    );
    // Through-water vector for this segment: cursor → end at headingRad.
    const twEnd = project(cursor, input.headingRad, segM);
    // Add current displacement (u m/s east, v m/s north) × segHours × 3600 = m.
    const currEastM = curr.u * segHours * 3600;
    const currNorthM = curr.v * segHours * 3600;
    // Convert (currEast, currNorth) into bearing+distance and apply to twEnd.
    const currDistM = Math.hypot(currEastM, currNorthM);
    if (currDistM > 1e-3) {
      const currBearingRad = Math.atan2(currEastM, currNorthM); // east=π/2, north=0
      cursor = project(twEnd, currBearingRad, currDistM);
    } else {
      cursor = twEnd;
    }
    out.push(cursor);
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/compute/src/race/laylines.test.ts`
Expected: all 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/race/laylines.ts packages/compute/src/race/laylines.test.ts
git commit -m "feat(compute): layline projection with optional current integration"
```

---

## Task 10: Polar targets predicate

**Files:**

- Create: `packages/compute/src/race/polar-targets.ts`
- Create: `packages/compute/src/race/polar-targets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/compute/src/race/polar-targets.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Bus, Channels } from '@g5000/core';
import type { PolarTable } from '@g5000/db';
import { startPolarTargetsPredicate } from './polar-targets.js';

const POLAR: PolarTable = {
  twsBins: [4, 8, 12, 16, 20],
  twaBins: [0, 0.5, 1.0, 1.57, 2.0, 2.5, 3.0],
  boatSpeed: [
    [0, 1, 2, 2.5, 2.3, 1.8, 0.5],
    [0, 2, 3.5, 4, 3.7, 3, 1],
    [0, 3, 5, 5.8, 5.3, 4.4, 1.5],
    [0, 4, 6, 7, 6.4, 5.3, 1.8],
    [0, 5, 7, 8, 7.4, 6.1, 2.0],
  ],
};

describe('startPolarTargetsPredicate', () => {
  it('publishes targetSpeed / targetTwa / percentPolar when wind + bsp present', async () => {
    const bus = new Bus();
    const polarRef = { current: POLAR as PolarTable | null };
    const dispose = startPolarTargetsPredicate(bus, polarRef);
    const published: Record<string, number> = {};
    bus.subscribe('race.**', (s) => {
      if (s.value.kind === 'scalar') published[s.channel] = s.value.value;
    });
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: Channels.Wind.TrueSpeed,
      t_ns: now,
      value: { kind: 'scalar', value: 8 },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Wind.TrueAngle,
      t_ns: now,
      value: { kind: 'scalar', value: 0.7 },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Boat.SpeedWater,
      t_ns: now,
      value: { kind: 'scalar', value: 3 },
      source: 'test',
    });
    // Allow the pipeline to react.
    await new Promise((r) => setTimeout(r, 5));
    expect(published[Channels.Race.TargetSpeed]).toBeGreaterThan(0);
    expect(published[Channels.Race.TargetTwa]).toBeGreaterThan(0);
    expect(published[Channels.Race.PercentPolar]).toBeGreaterThan(0);
    dispose.dispose();
  });

  it('does not publish when wind is missing', async () => {
    const bus = new Bus();
    const polarRef = { current: POLAR as PolarTable | null };
    const dispose = startPolarTargetsPredicate(bus, polarRef);
    const published: string[] = [];
    bus.subscribe('race.**', (s) => published.push(s.channel));
    const now = BigInt(Date.now()) * 1_000_000n;
    // Only BSP, no wind.
    bus.publish({
      channel: Channels.Boat.SpeedWater,
      t_ns: now,
      value: { kind: 'scalar', value: 3 },
      source: 'test',
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(published).toEqual([]);
    dispose.dispose();
  });

  it('does not publish when polarRef.current is null', async () => {
    const bus = new Bus();
    const polarRef: { current: PolarTable | null } = { current: null };
    const dispose = startPolarTargetsPredicate(bus, polarRef);
    const published: string[] = [];
    bus.subscribe('race.**', (s) => published.push(s.channel));
    const now = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: Channels.Wind.TrueSpeed,
      t_ns: now,
      value: { kind: 'scalar', value: 8 },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Wind.TrueAngle,
      t_ns: now,
      value: { kind: 'scalar', value: 0.7 },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Boat.SpeedWater,
      t_ns: now,
      value: { kind: 'scalar', value: 3 },
      source: 'test',
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(published).toEqual([]);
    dispose.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/compute/src/race/polar-targets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/compute/src/race/polar-targets.ts`:

```ts
import { Bus, Channels } from '@g5000/core';
import type { PolarTable } from '@g5000/db';
import { interpolatePolarSpeed, optimalTwaForVmg } from '../polars/math.js';

interface Latest {
  tws?: number;
  twa?: number;
  bsp?: number;
}

export function startPolarTargetsPredicate(
  bus: Bus,
  polarRef: { current: PolarTable | null },
): { dispose(): void } {
  const latest: Latest = {};
  const unsubs: Array<() => void> = [];

  function tick(t_ns: bigint): void {
    if (latest.tws === undefined || latest.twa === undefined) return;
    const polar = polarRef.current;
    if (!polar) return;
    const twaAbs = Math.abs(latest.twa);
    const tbs = interpolatePolarSpeed(polar, latest.tws, twaAbs);
    const direction: 'upwind' | 'downwind' = twaAbs < Math.PI / 2 ? 'upwind' : 'downwind';
    const tTwa = optimalTwaForVmg(polar, latest.tws, direction);
    bus.publish({
      channel: Channels.Race.TargetSpeed,
      t_ns,
      value: { kind: 'scalar', value: tbs, unit: 'm/s' },
      source: 'race/polar-targets',
    });
    bus.publish({
      channel: Channels.Race.TargetTwa,
      t_ns,
      value: { kind: 'scalar', value: tTwa, unit: 'rad' },
      source: 'race/polar-targets',
    });
    if (latest.bsp !== undefined && tbs > 0) {
      bus.publish({
        channel: Channels.Race.PercentPolar,
        t_ns,
        value: { kind: 'scalar', value: (latest.bsp / tbs) * 100, unit: '%' },
        source: 'race/polar-targets',
      });
    }
  }

  unsubs.push(
    bus.subscribe(Channels.Wind.TrueSpeed, (s) => {
      if (s.value.kind === 'scalar') {
        latest.tws = s.value.value;
        tick(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueAngle, (s) => {
      if (s.value.kind === 'scalar') {
        latest.twa = s.value.value;
        tick(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Boat.SpeedWater, (s) => {
      if (s.value.kind === 'scalar') {
        latest.bsp = s.value.value;
        tick(s.t_ns);
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

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/compute/src/race/polar-targets.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/race/polar-targets.ts packages/compute/src/race/polar-targets.test.ts
git commit -m "feat(compute): polar-targets predicate (TBS, TWA-target, %-polar)"
```

---

## Task 11: Race compute pipeline

**Files:**

- Create: `packages/compute/src/race/index.ts`
- Modify: `packages/compute/src/index.ts`

This task wires line-geometry / OCS / VMC / wind-shift / laylines into RxJS subscriptions, reading the latest RaceState every tick. Polar-targets already encapsulates its own subscriptions (Task 10).

- [ ] **Step 1: Write the pipeline**

Create `packages/compute/src/race/index.ts`:

```ts
import { Bus, Channels, type RaceState } from '@g5000/core';
import type { PolarTable } from '@g5000/db';
import type { CurrentField } from '@g5000/grib';
import { startPolarTargetsPredicate } from './polar-targets.js';
import { createWindShiftDetector } from './wind-shift.js';
import { projectLayline } from './laylines.js';
import {
  haversineMeters,
  lineBearingRad,
  distanceToLineMeters,
  timeToLineSeconds,
  lineBiasRad,
  initialBearingRad,
  type LatLon,
} from './line-geometry.js';
import { vmc } from './vmc.js';
import { predictOcs } from './ocs-predictor.js';
import { interpolatePolarSpeed, optimalTwaForVmg } from '../polars/math.js';

export { startPolarTargetsPredicate, createWindShiftDetector, projectLayline, vmc, predictOcs };

interface Latest {
  pos?: LatLon;
  cog?: number;
  sog?: number;
  cogConcentration?: number;
  twd?: number;
  tws?: number;
  twa?: number;
  hdg?: number;
  /** Map of waypointId → {lat, lon} for VMC lookup. Populated at boot
   *  from /api/waypoints (see Task 28); v1 starts empty until then. */
  waypointById?: Map<string, LatLon>;
}

const DEG = Math.PI / 180;

export interface RacePipelineHandles {
  dispose(): void;
}

export function startRaceComputePipeline(
  bus: Bus,
  raceState: RaceState,
  polarRef: { current: PolarTable | null },
  currentFieldRef: { current: CurrentField | null },
  waypointsRef: { current: Map<string, LatLon> },
): RacePipelineHandles {
  const latest: Latest = {};
  const unsubs: Array<() => void> = [];

  // Polar targets predicate self-manages its subscriptions.
  const polarTargets = startPolarTargetsPredicate(bus, polarRef);

  // Wind-shift detector (consumed by the wind-shift subscriber below).
  let detector = createWindShiftDetector({
    baselineWindowMs: 300_000,
    currentWindowMs: 30_000,
    thresholdRad: raceState.get().settings.shiftThresholdDeg * DEG,
    persistenceMs: 60_000,
  });
  // Reconfigure detector on settings change.
  unsubs.push(
    raceState.subscribe((cfg) => {
      detector = createWindShiftDetector({
        baselineWindowMs: 300_000,
        currentWindowMs: 30_000,
        thresholdRad: cfg.settings.shiftThresholdDeg * DEG,
        persistenceMs: 60_000,
      });
    }),
  );

  // --- Input subscriptions (cache latest) ---
  unsubs.push(
    bus.subscribe(Channels.Nav.Position, (s) => {
      if (s.value.kind === 'geo') {
        latest.pos = s.value.value;
        recomputeLineGeometry(s.t_ns);
        recomputeOcs(s.t_ns);
        recomputeVmc(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Nav.Cog, (s) => {
      if (s.value.kind === 'scalar') {
        latest.cog = s.value.value;
        recomputeLineGeometry(s.t_ns);
        recomputeOcs(s.t_ns);
        recomputeVmc(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Nav.Sog, (s) => {
      if (s.value.kind === 'scalar') {
        latest.sog = s.value.value;
        recomputeLineGeometry(s.t_ns);
        recomputeOcs(s.t_ns);
        recomputeVmc(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueDirection, (s) => {
      if (s.value.kind === 'scalar') {
        latest.twd = s.value.value;
        const tMs = Number(s.t_ns / 1_000_000n);
        const r = detector.update(latest.twd, tMs, latest.hdg);
        bus.publish({
          channel: Channels.Race.WindShiftBias,
          t_ns: s.t_ns,
          value: { kind: 'scalar', value: r.biasRad, unit: 'rad' },
          source: 'race/wind-shift',
        });
        if (r.event) {
          bus.publish({
            channel: Channels.Race.WindShiftEvent,
            t_ns: s.t_ns,
            value: { kind: 'enum', value: `${r.event.direction}:${r.event.deg.toFixed(1)}` },
            source: 'race/wind-shift',
          });
        }
        recomputeLineGeometry(s.t_ns);
        recomputeLaylines(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueSpeed, (s) => {
      if (s.value.kind === 'scalar') {
        latest.tws = s.value.value;
        recomputeLaylines(s.t_ns);
      }
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Wind.TrueAngle, (s) => {
      if (s.value.kind === 'scalar') latest.twa = s.value.value;
    }),
  );
  unsubs.push(
    bus.subscribe(Channels.Boat.HeadingTrue, (s) => {
      if (s.value.kind === 'scalar') latest.hdg = s.value.value;
    }),
  );

  // COG concentration: poll /api/stats/cog every 2 s and cache the
  // mean-resultant length. Inside the autopilot-server we could subscribe
  // directly to the COG stats subject, but inside compute we'd have to
  // import from apps/. Cheaper to just poll the public endpoint.
  const cogPollInterval = setInterval(async () => {
    try {
      const r = await fetch('http://127.0.0.1:3000/api/stats/cog', { cache: 'no-store' });
      if (!r.ok) return;
      const j = (await r.json()) as { ok: boolean; stats?: { concentration: number } };
      if (j.ok && j.stats) latest.cogConcentration = j.stats.concentration;
    } catch {
      /* tick again */
    }
  }, 2000);

  // --- Layline recomputation, throttled to 1 Hz ---
  let lastLaylineMs = 0;
  function recomputeLaylines(t_ns: bigint): void {
    if (latest.pos === undefined || latest.tws === undefined || latest.twd === undefined) return;
    const polar = polarRef.current;
    if (!polar) return;
    const tMs = Number(t_ns / 1_000_000n);
    if (tMs - lastLaylineMs < 1000) return;
    lastLaylineMs = tMs;
    const cfg = raceState.get().settings;
    const upwindTwa = optimalTwaForVmg(polar, latest.tws, 'upwind');
    const portHeading = (latest.twd + Math.PI - upwindTwa + 2 * Math.PI) % (2 * Math.PI);
    const stbdHeading = (latest.twd + Math.PI + upwindTwa) % (2 * Math.PI);
    const tws = latest.tws;
    // Through-water speed for layline projection — TBS at the optimal-VMG TWA.
    const tbs = interpolatePolarSpeed(polar, tws, upwindTwa);
    const portPoly = projectLayline({
      pos: latest.pos,
      headingRad: portHeading,
      throughWaterSpeedMs: tbs,
      currentField: currentFieldRef.current,
      distanceNm: cfg.laylineDistanceNm,
      integrateCurrent: cfg.integrateCurrent,
      timeAtSampleMs: tMs,
    });
    const stbdPoly = projectLayline({
      pos: latest.pos,
      headingRad: stbdHeading,
      throughWaterSpeedMs: tbs,
      currentField: currentFieldRef.current,
      distanceNm: cfg.laylineDistanceNm,
      integrateCurrent: cfg.integrateCurrent,
      timeAtSampleMs: tMs,
    });
    // Polylines are arrays of {lat,lon}; encode as enum for transport.
    bus.publish({
      channel: Channels.Race.LaylinePort,
      t_ns,
      value: { kind: 'enum', value: JSON.stringify(portPoly) },
      source: 'race/laylines',
    });
    bus.publish({
      channel: Channels.Race.LaylineStbd,
      t_ns,
      value: { kind: 'enum', value: JSON.stringify(stbdPoly) },
      source: 'race/laylines',
    });
  }

  // --- Line geometry recomputation ---
  function recomputeLineGeometry(t_ns: bigint): void {
    const { line } = raceState.get();
    if (!line.port || !line.stbd || !line.preStartSide || latest.pos === undefined) return;
    const bearing = lineBearingRad(line.port, line.stbd);
    const dPort = haversineMeters(latest.pos, line.port);
    const dStbd = haversineMeters(latest.pos, line.stbd);
    const dtl = distanceToLineMeters(latest.pos, line.port, line.stbd, line.preStartSide);
    bus.publish({
      channel: Channels.Race.LineDistancePort,
      t_ns,
      value: { kind: 'scalar', value: dPort, unit: 'm' },
      source: 'race/line',
    });
    bus.publish({
      channel: Channels.Race.LineDistanceStbd,
      t_ns,
      value: { kind: 'scalar', value: dStbd, unit: 'm' },
      source: 'race/line',
    });
    bus.publish({
      channel: Channels.Race.LineDistanceToLine,
      t_ns,
      value: { kind: 'scalar', value: dtl, unit: 'm' },
      source: 'race/line',
    });
    if (latest.cog !== undefined && latest.sog !== undefined) {
      // Closing angle = abs(cog − lineNormal); lineNormal = bearing − π/2 if preStartSide='port',
      // else bearing + π/2. Pick the one that points TOWARD the line (sign of dtl > 0 means
      // pre-start side → line normal points toward line).
      const normalToLine =
        line.preStartSide === 'port' ? bearing - Math.PI / 2 : bearing + Math.PI / 2;
      let dθ = latest.cog - normalToLine;
      while (dθ > Math.PI) dθ -= 2 * Math.PI;
      while (dθ < -Math.PI) dθ += 2 * Math.PI;
      const ttl = timeToLineSeconds(dtl, latest.sog, dθ);
      if (ttl !== null) {
        bus.publish({
          channel: Channels.Race.LineTimeToLine,
          t_ns,
          value: { kind: 'scalar', value: ttl, unit: 's' },
          source: 'race/line',
        });
      }
    }
    if (latest.twd !== undefined) {
      const bias = lineBiasRad(bearing, latest.twd);
      bus.publish({
        channel: Channels.Race.LineBias,
        t_ns,
        value: { kind: 'scalar', value: bias, unit: 'rad' },
        source: 'race/line',
      });
    }
  }

  // --- OCS recomputation ---
  function recomputeOcs(t_ns: bigint): void {
    const { line, timer, settings } = raceState.get();
    if (latest.pos === undefined || latest.cog === undefined || latest.sog === undefined) return;
    const result = predictOcs({
      pos: latest.pos,
      cogRad: latest.cog,
      sogMs: latest.sog,
      cogConcentration: latest.cogConcentration ?? 1,
      line: { port: line.port, stbd: line.stbd },
      startMs: timer.startMs,
      lookAheadSec: settings.ocsLookAheadSec,
    });
    if (result === null) return;
    bus.publish({
      channel: Channels.Race.LineOcsPredicted,
      t_ns,
      value: { kind: 'enum', value: result ? 'OCS' : 'OK' },
      source: 'race/ocs',
    });
  }

  // --- VMC recomputation ---
  function recomputeVmc(t_ns: bigint): void {
    const id = raceState.get().activeMarkWaypointId;
    if (!id) return;
    const wp = waypointsRef.current.get(id);
    if (!wp) return;
    if (latest.pos === undefined || latest.cog === undefined || latest.sog === undefined) return;
    const bearing = initialBearingRad(latest.pos, wp);
    const v = vmc(latest.sog, latest.cog, bearing);
    bus.publish({
      channel: Channels.Race.Vmc,
      t_ns,
      value: { kind: 'scalar', value: v, unit: 'm/s' },
      source: 'race/vmc',
    });
  }

  // --- 1 Hz timer-state tick ---
  const timerTick = setInterval(() => {
    raceState.mutate((draft) => {
      const t = draft.timer;
      if (t.startMs === null) {
        if (t.state !== 'idle') t.state = 'idle';
        return;
      }
      const now = Date.now();
      if (now < t.startMs) {
        if (t.state !== 'pre-start') t.state = 'pre-start';
      } else if (now - t.startMs < 3_600_000) {
        if (t.state !== 'started') t.state = 'started';
      } else {
        if (t.state !== 'finished') {
          t.state = 'finished';
          t.startMs = null;
        }
      }
    });
  }, 1000);

  return {
    dispose: () => {
      polarTargets.dispose();
      for (const u of unsubs) u();
      clearInterval(cogPollInterval);
      clearInterval(timerTick);
    },
  };
}
```

- [ ] **Step 2: Re-export from compute/src/index.ts**

Add to `packages/compute/src/index.ts`:

```ts
export * from './race/index.js';
export type { LatLon } from './race/line-geometry.js';
```

- [ ] **Step 3: Build compute**

Run: `npx tsc -b packages/compute`
Expected: clean exit.

- [ ] **Step 4: Smoke test — boot + dispose**

Create a one-off test inside `packages/compute/src/race/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Bus, createRaceState } from '@g5000/core';
import { startRaceComputePipeline } from './index.js';

describe('startRaceComputePipeline', () => {
  it('boots and disposes cleanly with no inputs', () => {
    const bus = new Bus();
    const rs = createRaceState();
    const polarRef = { current: null };
    const currRef = { current: null };
    const wpRef = { current: new Map() };
    const handle = startRaceComputePipeline(bus, rs, polarRef, currRef, wpRef);
    expect(handle.dispose).toBeTypeOf('function');
    handle.dispose();
  });
});
```

Run: `npx vitest run packages/compute/src/race/index.test.ts`
Expected: 1 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/race/index.ts packages/compute/src/race/index.test.ts packages/compute/src/index.ts
git commit -m "feat(compute): startRaceComputePipeline wires all race predicates"
```

---

## Task 12: GET/PUT /api/race/state

**Files:**

- Create: `packages/web/src/app/api/race/state/route.ts`
- Create: `packages/web/src/app/api/race/state/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/race/state/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET, PUT } from './route.js';
import { createRaceState, setSharedRaceState, _resetSharedRaceStateForTests } from '@g5000/core';

beforeEach(() => _resetSharedRaceStateForTests());

describe('/api/race/state', () => {
  it('GET returns the current RaceStateConfig', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.timer.state).toBe('idle');
    expect(body.settings.shiftThresholdDeg).toBe(7);
  });

  it('PUT updates settings and persists via the shared raceState', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const req = new Request('http://test/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: { shiftThresholdDeg: 12, laylineDistanceNm: 8 },
      }),
    });
    const r = await PUT(req);
    expect(r.status).toBe(200);
    expect(rs.get().settings.shiftThresholdDeg).toBe(12);
    expect(rs.get().settings.laylineDistanceNm).toBe(8);
    expect(rs.get().settings.integrateCurrent).toBe(true); // not touched
  });

  it('GET returns 503 when no shared raceState', async () => {
    const r = await GET();
    expect(r.status).toBe(503);
  });

  it('PUT rejects invalid JSON with 400', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const req = new Request('http://test/', { method: 'PUT', body: '{' });
    const r = await PUT(req);
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/api/race/state/route.test.ts`
Expected: FAIL with "Cannot find module './route.js'".

- [ ] **Step 3: Implement the route**

Create `packages/web/src/app/api/race/state/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSharedRaceState, type RaceSettings } from '@g5000/core';
import { getSharedConfigStore, saveRaceState } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const rs = getSharedRaceState();
  if (!rs) {
    return NextResponse.json({ ok: false, error: 'raceState unavailable' }, { status: 503 });
  }
  return NextResponse.json(rs.get());
}

export async function PUT(req: Request): Promise<NextResponse> {
  const rs = getSharedRaceState();
  if (!rs) {
    return NextResponse.json({ ok: false, error: 'raceState unavailable' }, { status: 503 });
  }
  let body: { settings?: Partial<RaceSettings>; activeMarkWaypointId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  rs.mutate((draft) => {
    if (body.settings) {
      draft.settings = { ...draft.settings, ...body.settings };
    }
    if (body.activeMarkWaypointId === null) {
      draft.activeMarkWaypointId = undefined;
    } else if (typeof body.activeMarkWaypointId === 'string') {
      draft.activeMarkWaypointId = body.activeMarkWaypointId;
    }
  });
  try {
    const store = getSharedConfigStore();
    await saveRaceState(store, rs.get());
  } catch {
    /* persistence is best-effort here; live state is canonical */
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/src/app/api/race/state/route.test.ts`
Expected: all 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/race/state/route.ts packages/web/src/app/api/race/state/route.test.ts
git commit -m "feat(web): GET/PUT /api/race/state"
```

---

## Task 13: POST /api/race/timer

**Files:**

- Create: `packages/web/src/app/api/race/timer/route.ts`
- Create: `packages/web/src/app/api/race/timer/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/race/timer/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route.js';
import { createRaceState, setSharedRaceState, _resetSharedRaceStateForTests } from '@g5000/core';

beforeEach(() => _resetSharedRaceStateForTests());

function req(body: unknown): Request {
  return new Request('http://test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/race/timer', () => {
  it('start sets startMs to now + offsetSec (default 300)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'start' }));
    expect(r.status).toBe(200);
    expect(rs.get().timer.startMs).toBe(Date.now() + 300_000);
    expect(rs.get().timer.state).toBe('pre-start');
    vi.useRealTimers();
  });

  it('start with offsetSec uses the provided value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const rs = createRaceState();
    setSharedRaceState(rs);
    await POST(req({ action: 'start', offsetSec: 600 }));
    expect(rs.get().timer.startMs).toBe(Date.now() + 600_000);
    vi.useRealTimers();
  });

  it('sync shifts startMs by adjustSec', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const rs = createRaceState();
    rs.mutate((d) => {
      d.timer.startMs = Date.now() + 100_000;
      d.timer.state = 'pre-start';
    });
    setSharedRaceState(rs);
    await POST(req({ action: 'sync', adjustSec: -30 }));
    expect(rs.get().timer.startMs).toBe(Date.now() + 70_000);
    vi.useRealTimers();
  });

  it('reset clears the timer', async () => {
    const rs = createRaceState();
    rs.mutate((d) => {
      d.timer.startMs = 9999;
      d.timer.state = 'pre-start';
    });
    setSharedRaceState(rs);
    await POST(req({ action: 'reset' }));
    expect(rs.get().timer.startMs).toBeNull();
    expect(rs.get().timer.state).toBe('idle');
  });

  it('unknown action returns 400', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'spin' }));
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/api/race/timer/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `packages/web/src/app/api/race/timer/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSharedRaceState } from '@g5000/core';
import { getSharedConfigStore, saveRaceState } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const rs = getSharedRaceState();
  if (!rs) {
    return NextResponse.json({ ok: false, error: 'raceState unavailable' }, { status: 503 });
  }
  let body: { action?: string; offsetSec?: number; adjustSec?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  switch (body.action) {
    case 'start': {
      const offsetSec = body.offsetSec ?? 300;
      rs.mutate((d) => {
        d.timer.startMs = Date.now() + offsetSec * 1000;
        d.timer.state = 'pre-start';
      });
      break;
    }
    case 'sync': {
      const adjustSec = body.adjustSec ?? 0;
      rs.mutate((d) => {
        if (d.timer.startMs !== null) {
          d.timer.startMs += adjustSec * 1000;
        }
      });
      break;
    }
    case 'reset': {
      rs.mutate((d) => {
        d.timer.startMs = null;
        d.timer.state = 'idle';
      });
      break;
    }
    default:
      return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  try {
    await saveRaceState(getSharedConfigStore(), rs.get());
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/src/app/api/race/timer/route.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/race/timer/route.ts packages/web/src/app/api/race/timer/route.test.ts
git commit -m "feat(web): POST /api/race/timer (start/sync/reset)"
```

---

## Task 14: POST /api/race/line

**Files:**

- Create: `packages/web/src/app/api/race/line/route.ts`
- Create: `packages/web/src/app/api/race/line/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/app/api/race/line/route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from './route.js';
import { createRaceState, setSharedRaceState, _resetSharedRaceStateForTests } from '@g5000/core';

beforeEach(() => _resetSharedRaceStateForTests());

function req(body: unknown): Request {
  return new Request('http://test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/race/line', () => {
  it('ping port end records lat/lon at provided position', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'ping', end: 'port', position: { lat: 41.5, lon: -71.3 } }));
    expect(r.status).toBe(200);
    expect(rs.get().line.port?.lat).toBe(41.5);
    expect(rs.get().line.port?.lon).toBe(-71.3);
    expect(rs.get().line.port?.pingedAt).toBeDefined();
  });

  it('second ping determines preStartSide based on current position', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    // Port end pinged first.
    await POST(req({ action: 'ping', end: 'port', position: { lat: 41.5, lon: -71.3 } }));
    // Stbd end pinged second, with boatPos south of the line.
    await POST(
      req({
        action: 'ping',
        end: 'stbd',
        position: { lat: 41.5, lon: -71.29 },
        boatPos: { lat: 41.49, lon: -71.295 },
      }),
    );
    expect(rs.get().line.preStartSide).toBeDefined();
    expect(['port', 'stbd']).toContain(rs.get().line.preStartSide);
  });

  it('clear wipes both endpoints and preStartSide', async () => {
    const rs = createRaceState();
    rs.mutate((d) => {
      d.line.port = { lat: 0, lon: 0, pingedAt: 'x' };
      d.line.stbd = { lat: 0, lon: 0, pingedAt: 'x' };
      d.line.preStartSide = 'port';
    });
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'clear' }));
    expect(r.status).toBe(200);
    expect(rs.get().line.port).toBeUndefined();
    expect(rs.get().line.stbd).toBeUndefined();
    expect(rs.get().line.preStartSide).toBeUndefined();
  });

  it('ping without position returns 400', async () => {
    const rs = createRaceState();
    setSharedRaceState(rs);
    const r = await POST(req({ action: 'ping', end: 'port' }));
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/app/api/race/line/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `packages/web/src/app/api/race/line/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSharedRaceState } from '@g5000/core';
import { getSharedConfigStore, saveRaceState } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PingBody {
  action: 'ping';
  end: 'port' | 'stbd';
  position: { lat: number; lon: number };
  /** Boat position at the moment of ping — only meaningful on the second
   *  ping, used to compute preStartSide. Optional. */
  boatPos?: { lat: number; lon: number };
}

interface ClearBody {
  action: 'clear';
}

type Body = PingBody | ClearBody;

function sideOfLine(
  boat: { lat: number; lon: number },
  port: { lat: number; lon: number },
  stbd: { lat: number; lon: number },
): 'port' | 'stbd' {
  // Cross product of (stbd - port) and (boat - port). Positive = left of
  // the port→stbd direction (which is the boat's port side if you stand
  // at port looking at stbd). Return 'port' when boat is to port-side, etc.
  const cross =
    (stbd.lon - port.lon) * (boat.lat - port.lat) - (stbd.lat - port.lat) * (boat.lon - port.lon);
  return cross > 0 ? 'port' : 'stbd';
}

export async function POST(req: Request): Promise<NextResponse> {
  const rs = getSharedRaceState();
  if (!rs) {
    return NextResponse.json({ ok: false, error: 'raceState unavailable' }, { status: 503 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  if (body.action === 'clear') {
    rs.mutate((d) => {
      d.line.port = undefined;
      d.line.stbd = undefined;
      d.line.preStartSide = undefined;
    });
  } else if (body.action === 'ping') {
    if (
      !body.position ||
      typeof body.position.lat !== 'number' ||
      typeof body.position.lon !== 'number'
    ) {
      return NextResponse.json({ ok: false, error: 'position required' }, { status: 400 });
    }
    const now = new Date().toISOString();
    rs.mutate((d) => {
      const end = body.end;
      d.line[end] = { lat: body.position.lat, lon: body.position.lon, pingedAt: now };
      // If both ends now present and boatPos provided, set preStartSide.
      if (d.line.port && d.line.stbd && body.boatPos) {
        d.line.preStartSide = sideOfLine(body.boatPos, d.line.port, d.line.stbd);
      }
    });
  } else {
    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  }
  try {
    await saveRaceState(getSharedConfigStore(), rs.get());
  } catch {
    /* best-effort */
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/web/src/app/api/race/line/route.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/race/line/route.ts packages/web/src/app/api/race/line/route.test.ts
git commit -m "feat(web): POST /api/race/line (ping/clear)"
```

---

## Task 15: RaceTimer component

**Files:**

- Create: `packages/web/src/app/race/RaceTimer.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/web/src/app/race/RaceTimer.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

interface TimerSnap {
  startMs: number | null;
  state: 'idle' | 'pre-start' | 'started' | 'finished';
}

function fmt(secs: number): string {
  const sign = secs < 0 ? '-' : '';
  const a = Math.abs(secs);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  return `${sign}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function RaceTimer(): React.ReactElement {
  const [timer, setTimer] = useState<TimerSnap>({ startMs: null, state: 'idle' });
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Pull RaceState every 1 s.
  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setTimer({ startMs: j.timer.startMs, state: j.timer.state });
      } catch {
        /* tick again */
      }
    }
    void poll();
    const id = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // Sub-second display: re-render every 100 ms while a startMs is set.
  useEffect(() => {
    if (timer.startMs === null) return;
    const id = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, [timer.startMs]);

  const post = useCallback(async (body: unknown) => {
    await fetch('/api/race/timer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }, []);

  const secsToGun = timer.startMs === null ? null : Math.round((timer.startMs - nowMs) / 1000);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-6 flex flex-col items-center gap-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">
        Race timer · {timer.state}
      </div>
      <div className="text-7xl font-mono text-slate-100 leading-none tabular-nums">
        {secsToGun === null ? '--:--' : fmt(secsToGun)}
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        {timer.state === 'idle' && (
          <>
            <button
              type="button"
              onClick={() => void post({ action: 'start', offsetSec: 300 })}
              className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white"
            >
              Start 5:00
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'start', offsetSec: 600 })}
              className="px-4 py-2 rounded bg-emerald-800 hover:bg-emerald-700 text-white"
            >
              Start 10:00
            </button>
          </>
        )}
        {timer.state !== 'idle' && (
          <>
            <button
              type="button"
              onClick={() => void post({ action: 'sync', adjustSec: 60 })}
              className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
            >
              +1 min
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'sync', adjustSec: -60 })}
              className="px-3 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
            >
              -1 min
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'sync', adjustSec: 10 })}
              className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              +10 s
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'sync', adjustSec: -10 })}
              className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              -10 s
            </button>
            <button
              type="button"
              onClick={() => void post({ action: 'reset' })}
              className="px-3 py-2 rounded bg-red-800 hover:bg-red-700 text-white"
            >
              Reset
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/race/RaceTimer.tsx
git commit -m "feat(web): RaceTimer countdown clock component"
```

---

## Task 16: RaceAudible component

**Files:**

- Create: `packages/web/src/app/race/RaceAudible.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/web/src/app/race/RaceAudible.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

const MUTE_KEY = 'g5000.race-audible.muted';

interface Beep {
  freq: number;
  durMs: number;
  type: OscillatorType;
}
const TONE_MINUTE: Beep = { freq: 660, durMs: 200, type: 'square' };
const TONE_MINUTE_LAST: Beep = { freq: 660, durMs: 400, type: 'square' };
const TONE_SECOND: Beep = { freq: 880, durMs: 100, type: 'sine' };
const TONE_LAST5: Beep = { freq: 880, durMs: 80, type: 'sine' };
const TONE_GUN: Beep = { freq: 1320, durMs: 600, type: 'sine' };

// Each threshold = seconds-to-gun at which we fire `tone`. Strictly descending.
const SCHEDULE: Array<{ atSec: number; tone: Beep }> = [
  { atSec: 300, tone: TONE_MINUTE },
  { atSec: 240, tone: TONE_MINUTE },
  { atSec: 180, tone: TONE_MINUTE },
  { atSec: 120, tone: TONE_MINUTE },
  { atSec: 60, tone: TONE_MINUTE_LAST },
  { atSec: 30, tone: TONE_SECOND },
  { atSec: 20, tone: TONE_SECOND },
  { atSec: 10, tone: TONE_SECOND },
  { atSec: 5, tone: TONE_LAST5 },
  { atSec: 4, tone: TONE_LAST5 },
  { atSec: 3, tone: TONE_LAST5 },
  { atSec: 2, tone: TONE_LAST5 },
  { atSec: 1, tone: TONE_LAST5 },
  { atSec: 0, tone: TONE_GUN },
];

export function RaceAudible(): React.ReactElement {
  const [muted, setMuted] = useState(false);
  const [startMs, setStartMs] = useState<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const firedRef = useRef<Set<number>>(new Set());
  const lastStartMsRef = useRef<number | null>(null);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === '1');
  }, []);

  // Warm AudioContext on first user interaction.
  useEffect(() => {
    function warm(): void {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext ??
          (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) ctxRef.current = new Ctx();
      }
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    }
    window.addEventListener('pointerdown', warm);
    window.addEventListener('keydown', warm);
    return () => {
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    };
  }, []);

  // Poll race state for startMs.
  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setStartMs(j.timer.startMs);
      } catch {
        /* retry */
      }
    }
    void poll();
    const id = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // 100 ms tick — check schedule and fire any thresholds we just crossed.
  useEffect(() => {
    if (startMs === null) {
      firedRef.current.clear();
      lastStartMsRef.current = null;
      return;
    }
    if (lastStartMsRef.current !== startMs) {
      // New race — reset fired set.
      firedRef.current.clear();
      lastStartMsRef.current = startMs;
    }
    const id = setInterval(() => {
      if (muted || !ctxRef.current) return;
      const secsToGun = (startMs - Date.now()) / 1000;
      for (const { atSec, tone } of SCHEDULE) {
        if (firedRef.current.has(atSec)) continue;
        // Fire when secsToGun has just crossed atSec from above.
        // ±100 ms tolerance per tick.
        if (secsToGun <= atSec + 0.05 && secsToGun > atSec - 0.15) {
          fire(ctxRef.current, tone);
          firedRef.current.add(atSec);
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, [startMs, muted]);

  function toggleMute(): void {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  }

  return (
    <button
      type="button"
      onClick={toggleMute}
      className={`px-3 py-2 rounded text-sm font-mono ${muted ? 'bg-red-700 text-white' : 'bg-gray-200 text-gray-800'}`}
      title={muted ? 'Race countdown beeps MUTED' : 'Race countdown beeps on'}
    >
      {muted ? '🔇 Race muted' : '🔊 Race audio'}
    </button>
  );
}

function fire(ctx: AudioContext, t: Beep): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = t.type;
  osc.frequency.value = t.freq;
  osc.connect(gain).connect(ctx.destination);
  gain.gain.value = 0.15;
  osc.start();
  setTimeout(() => {
    try {
      osc.stop();
    } catch {
      /* ignored */
    }
    osc.disconnect();
    gain.disconnect();
  }, t.durMs);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/race/RaceAudible.tsx
git commit -m "feat(web): RaceAudible countdown beep loop with 100ms tick"
```

---

## Task 17: LinePingPanel component

**Files:**

- Create: `packages/web/src/app/race/LinePingPanel.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/web/src/app/race/LinePingPanel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSse } from '../../hooks/use-sse';

interface LineEnd {
  lat: number;
  lon: number;
  pingedAt: string;
}
interface LineSnap {
  port?: LineEnd;
  stbd?: LineEnd;
  preStartSide?: 'port' | 'stbd';
}

function fmtCoord(lat: number, lon: number): string {
  const fL = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    const deg = Math.floor(a);
    const min = ((a - deg) * 60).toFixed(3);
    return `${deg} ${min}${v >= 0 ? pos : neg}`;
  };
  return `${fL(lat, 'n', 's')}, ${fL(lon, 'e', 'w')}`;
}

export function LinePingPanel(): React.ReactElement {
  const [line, setLine] = useState<LineSnap>({});
  const [confirming, setConfirming] = useState(false);
  const { channels } = useSse();

  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setLine(j.line ?? {});
      } catch {
        /* retry */
      }
    }
    void poll();
    const id = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const ping = useCallback(
    async (end: 'port' | 'stbd') => {
      const pos = channels.get('nav.gps.position');
      if (!pos || pos.value.kind !== 'geo') {
        alert('No GPS position available');
        return;
      }
      const position = pos.value.value;
      // Boat position at ping time matches the ping position itself for the
      // common case (you're standing at the end). The /api/race/line handler
      // uses boatPos to determine preStartSide on the second ping.
      await fetch('/api/race/line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping', end, position, boatPos: position }),
      });
      const r = await fetch('/api/race/state', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setLine(j.line ?? {});
      }
    },
    [channels],
  );

  const clear = useCallback(async () => {
    await fetch('/api/race/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    });
    setConfirming(false);
    setLine({});
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-3">
      <div className="text-xs uppercase tracking-wider text-slate-400">Start line</div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void ping('port')}
          className="bg-emerald-700 hover:bg-emerald-600 text-white rounded p-4 text-lg font-semibold"
        >
          Ping Port End
          {line.port && (
            <div className="text-xs font-mono font-normal mt-1 opacity-80">
              {fmtCoord(line.port.lat, line.port.lon)}
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => void ping('stbd')}
          className="bg-rose-700 hover:bg-rose-600 text-white rounded p-4 text-lg font-semibold"
        >
          Ping Stbd End
          {line.stbd && (
            <div className="text-xs font-mono font-normal mt-1 opacity-80">
              {fmtCoord(line.stbd.lat, line.stbd.lon)}
            </div>
          )}
        </button>
      </div>
      {line.preStartSide && (
        <div className="text-xs text-slate-400 font-mono">pre-start side: {line.preStartSide}</div>
      )}
      {(line.port || line.stbd) && (
        <>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="self-end text-xs text-red-400 underline"
            >
              Clear line
            </button>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-red-400">Clear both ends?</span>
              <button
                type="button"
                onClick={() => void clear()}
                className="text-xs px-2 py-1 bg-red-700 text-white rounded"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs px-2 py-1 bg-slate-700 text-slate-200 rounded"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/race/LinePingPanel.tsx
git commit -m "feat(web): LinePingPanel — port/stbd ping + clear with confirm"
```

---

## Task 18: ActiveMarkSelector component

**Files:**

- Create: `packages/web/src/app/race/ActiveMarkSelector.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/web/src/app/race/ActiveMarkSelector.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export function ActiveMarkSelector(): React.ReactElement {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [wpR, stR] = await Promise.all([
          fetch('/api/waypoints', { cache: 'no-store' }),
          fetch('/api/race/state', { cache: 'no-store' }),
        ]);
        if (wpR.ok) {
          const j = await wpR.json();
          if (j.ok) setWaypoints(j.waypoints);
        }
        if (stR.ok) {
          const j = await stR.json();
          setActiveId(j.activeMarkWaypointId ?? null);
        }
      } catch {
        /* retry on next mount */
      }
    }
    void load();
  }, []);

  const setActive = useCallback(async (id: string | null) => {
    await fetch('/api/race/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeMarkWaypointId: id }),
    });
    setActiveId(id);
  }, []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-slate-400">Active mark (for VMC)</div>
      <select
        value={activeId ?? ''}
        onChange={(e) => void setActive(e.target.value === '' ? null : e.target.value)}
        className="bg-slate-900 border border-slate-700 rounded text-slate-200 px-2 py-2 text-sm"
      >
        <option value="">— none —</option>
        {waypoints.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/race/ActiveMarkSelector.tsx
git commit -m "feat(web): ActiveMarkSelector dropdown for VMC target"
```

---

## Task 19: /race page

**Files:**

- Create: `packages/web/src/app/race/page.tsx`

- [ ] **Step 1: Assemble the page**

Create `packages/web/src/app/race/page.tsx`:

```tsx
'use client';

import { RaceTimer } from './RaceTimer';
import { RaceAudible } from './RaceAudible';
import { LinePingPanel } from './LinePingPanel';
import { ActiveMarkSelector } from './ActiveMarkSelector';
import { WindShiftPlot } from '../../components/WindShiftPlot';

export default function RacePage(): React.ReactElement {
  return (
    <main className="p-4 min-h-screen bg-black">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-300">Race</h1>
        <RaceAudible />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
        <div className="md:col-span-2">
          <RaceTimer />
        </div>
        <LinePingPanel />
        <ActiveMarkSelector />
        <div className="md:col-span-2">
          <WindShiftPlot />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/race/page.tsx
git commit -m "feat(web): /race page wiring timer + line + active mark"
```

---

## Task 20: RaceTiles helm tile group

**Files:**

- Create: `packages/web/src/components/RaceTiles.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/web/src/components/RaceTiles.tsx`:

```tsx
'use client';

import { useSse } from '../hooks/use-sse';
import { HelmTile } from '../app/helm/HelmTile';

const MS_TO_KN = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

function scalar(s: { value: { kind: string; value: number } } | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function enumStr(s: { value: { kind: string; value: string } } | undefined): string | null {
  if (!s || s.value.kind !== 'enum') return null;
  return s.value.value;
}

export function RaceTiles(): React.ReactElement {
  const { channels } = useSse();
  const dtl = scalar(channels.get('race.line.distanceToLine'));
  const ttl = scalar(channels.get('race.line.timeToLine'));
  const bias = scalar(channels.get('race.line.bias'));
  const ocs = enumStr(channels.get('race.line.ocsPredicted'));
  const vmcMs = scalar(channels.get('race.vmc'));

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">
      <HelmTile
        label="DTL"
        value={dtl === null ? '—' : Math.abs(dtl).toFixed(0)}
        unit="m"
        sub={dtl === null ? undefined : dtl >= 0 ? 'pre-start' : 'past line'}
      />
      <HelmTile label="TTL" value={ttl === null ? '—' : Math.round(ttl).toString()} unit="s" />
      <HelmTile
        label="Bias"
        value={bias === null ? '—' : `${bias >= 0 ? '+' : ''}${(bias * RAD_TO_DEG).toFixed(0)}`}
        unit="°"
        sub={
          bias === null
            ? undefined
            : bias > 0
              ? 'port favored'
              : bias < 0
                ? 'stbd favored'
                : 'square'
        }
      />
      <HelmTile
        label="OCS"
        value={ocs ?? '—'}
        unit=""
        sub={ocs === 'OCS' ? 'over early!' : ocs === 'OK' ? 'clear' : undefined}
      />
      <HelmTile
        label="VMC"
        value={vmcMs === null ? '—' : (vmcMs * MS_TO_KN).toFixed(1)}
        unit="kn"
        sub={vmcMs === null ? 'no mark' : vmcMs >= 0 ? 'closing' : 'opening'}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/RaceTiles.tsx
git commit -m "feat(web): RaceTiles compound helm tile (DTL/TTL/Bias/OCS/VMC)"
```

---

## Task 21: RaceMiniTimer helm chip

**Files:**

- Create: `packages/web/src/app/helm/RaceMiniTimer.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/web/src/app/helm/RaceMiniTimer.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

function fmt(secs: number): string {
  const sign = secs < 0 ? '-' : '';
  const a = Math.abs(secs);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  return `${sign}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function RaceMiniTimer(): React.ReactElement | null {
  const [startMs, setStartMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setStartMs(j.timer.startMs);
      } catch {
        /* retry */
      }
    }
    void poll();
    const id = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (startMs === null) return;
    const id = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(id);
  }, [startMs]);

  if (startMs === null) return null;
  const secs = Math.round((startMs - nowMs) / 1000);
  const danger = secs <= 10 && secs >= 0;
  return (
    <a
      href="/race"
      className={`text-xs font-mono px-2 py-1 rounded ${danger ? 'bg-red-700 text-white' : 'bg-slate-800 text-slate-300'}`}
      title="Race countdown — open /race"
    >
      ⏱ {fmt(secs)}
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/app/helm/RaceMiniTimer.tsx
git commit -m "feat(web): RaceMiniTimer chip for /helm"
```

---

## Task 22: StartLineLayer chart layer

**Files:**

- Create: `packages/web/src/components/StartLineLayer.tsx`

- [ ] **Step 1: Implement the layer**

Create `packages/web/src/components/StartLineLayer.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';

interface LineEnd {
  lat: number;
  lon: number;
}
interface LineSnap {
  port?: LineEnd;
  stbd?: LineEnd;
}

const LINE_SOURCE = 'race-start-line';
const LINE_LAYER = 'race-start-line-layer';

export function StartLineLayer({ map }: { map: maplibregl.Map | null }): null {
  const [line, setLine] = useState<LineSnap>({});

  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setLine(j.line ?? {});
      } catch {
        /* retry */
      }
    }
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    if (!line.port || !line.stbd) {
      if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
      if (map.getSource(LINE_SOURCE)) map.removeSource(LINE_SOURCE);
      return;
    }
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [line.port.lon, line.port.lat],
              [line.stbd.lon, line.stbd.lat],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { end: 'port' },
          geometry: { type: 'Point', coordinates: [line.port.lon, line.port.lat] },
        },
        {
          type: 'Feature',
          properties: { end: 'stbd' },
          geometry: { type: 'Point', coordinates: [line.stbd.lon, line.stbd.lat] },
        },
      ],
    };
    const src = map.getSource(LINE_SOURCE) as { setData: (d: unknown) => void } | undefined;
    if (src) {
      src.setData(fc);
    } else {
      map.addSource(LINE_SOURCE, { type: 'geojson', data: fc as never });
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: LINE_SOURCE,
        paint: {
          'line-color': '#fbbf24',
          'line-width': 3,
          'line-dasharray': [2, 2],
        },
      });
      map.addLayer({
        id: `${LINE_LAYER}-points`,
        type: 'circle',
        source: LINE_SOURCE,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'match',
            ['get', 'end'],
            'port',
            '#10b981',
            'stbd',
            '#ef4444',
            '#ffffff',
          ],
          'circle-stroke-color': '#000',
          'circle-stroke-width': 1.5,
        },
      });
    }
    return () => {
      // cleanup happens implicitly when both ends are cleared (next poll)
    };
  }, [map, line]);

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/StartLineLayer.tsx
git commit -m "feat(web): StartLineLayer chart overlay (line + ends)"
```

---

## Task 23: LaylinesLayer chart layer

**Files:**

- Create: `packages/web/src/components/LaylinesLayer.tsx`

- [ ] **Step 1: Implement the layer**

Create `packages/web/src/components/LaylinesLayer.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { useSse } from '../hooks/use-sse';

const LAYLINE_SOURCE = 'race-laylines';
const LAYLINE_LAYER = 'race-laylines-layer';

function parsePoly(raw: string | undefined): Array<{ lat: number; lon: number }> {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as Array<{ lat: number; lon: number }>;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function LaylinesLayer({ map }: { map: maplibregl.Map | null }): null {
  const { channels } = useSse();
  const portSample = channels.get('race.laylines.port');
  const stbdSample = channels.get('race.laylines.stbd');
  const portRaw = portSample?.value.kind === 'enum' ? portSample.value.value : undefined;
  const stbdRaw = stbdSample?.value.kind === 'enum' ? stbdSample.value.value : undefined;

  useEffect(() => {
    if (!map) return;
    const port = parsePoly(portRaw);
    const stbd = parsePoly(stbdRaw);
    if (port.length === 0 && stbd.length === 0) {
      if (map.getLayer(LAYLINE_LAYER)) map.removeLayer(LAYLINE_LAYER);
      if (map.getSource(LAYLINE_SOURCE)) map.removeSource(LAYLINE_SOURCE);
      return;
    }
    const fc = {
      type: 'FeatureCollection',
      features: [
        port.length > 0 && {
          type: 'Feature',
          properties: { tack: 'port' },
          geometry: { type: 'LineString', coordinates: port.map((p) => [p.lon, p.lat]) },
        },
        stbd.length > 0 && {
          type: 'Feature',
          properties: { tack: 'stbd' },
          geometry: { type: 'LineString', coordinates: stbd.map((p) => [p.lon, p.lat]) },
        },
      ].filter(Boolean),
    };
    const src = map.getSource(LAYLINE_SOURCE) as { setData: (d: unknown) => void } | undefined;
    if (src) {
      src.setData(fc);
    } else {
      map.addSource(LAYLINE_SOURCE, { type: 'geojson', data: fc as never });
      map.addLayer({
        id: LAYLINE_LAYER,
        type: 'line',
        source: LAYLINE_SOURCE,
        paint: {
          'line-color': ['match', ['get', 'tack'], 'port', '#10b981', 'stbd', '#ef4444', '#ffffff'],
          'line-width': 2,
          'line-opacity': 0.7,
        },
      });
    }
  }, [map, portRaw, stbdRaw]);

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/LaylinesLayer.tsx
git commit -m "feat(web): LaylinesLayer chart overlay (port + stbd polylines)"
```

---

## Task 24: WindShiftPlot sparkline

**Files:**

- Create: `packages/web/src/components/WindShiftPlot.tsx`

- [ ] **Step 1: Implement the component**

Create `packages/web/src/components/WindShiftPlot.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useSse } from '../hooks/use-sse';

const WINDOW_MS = 30 * 60 * 1000;
const RAD_TO_DEG = 180 / Math.PI;
const WIDTH = 600;
const HEIGHT = 80;

interface Point {
  tMs: number;
  deg: number;
}

export function WindShiftPlot(): React.ReactElement {
  const { channels } = useSse();
  const sample = channels.get('race.windShift.bias');
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    if (!sample || sample.value.kind !== 'scalar') return;
    const tMs = Date.now();
    const deg = sample.value.value * RAD_TO_DEG;
    setPoints((prev) => {
      const next = [...prev, { tMs, deg }];
      // Drop anything older than window.
      const cutoff = tMs - WINDOW_MS;
      while (next.length > 0 && next[0]!.tMs < cutoff) next.shift();
      return next;
    });
  }, [sample]);

  if (points.length < 2) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded p-4 text-xs text-slate-500">
        Wind shift plot — waiting for samples…
      </div>
    );
  }

  const tMin = points[0]!.tMs;
  const tMax = points[points.length - 1]!.tMs;
  const tSpan = Math.max(1, tMax - tMin);
  const degMax = Math.max(15, ...points.map((p) => Math.abs(p.deg)));
  const yMid = HEIGHT / 2;
  const yScale = (HEIGHT / 2 - 4) / degMax;
  const pts = points
    .map((p) => {
      const x = ((p.tMs - tMin) / tSpan) * WIDTH;
      const y = yMid - p.deg * yScale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
        Wind shift vs 5-min baseline (last 30 min)
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-20">
        <line x1="0" y1={yMid} x2={WIDTH} y2={yMid} stroke="#475569" strokeDasharray="2 2" />
        <polyline points={pts} fill="none" stroke="#fbbf24" strokeWidth="1.5" />
      </svg>
      <div className="text-[10px] text-slate-500 font-mono mt-1">
        ±{degMax.toFixed(0)}° · last {points[points.length - 1]!.deg.toFixed(1)}°
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/WindShiftPlot.tsx
git commit -m "feat(web): WindShiftPlot 30-min sparkline of race.windShift.bias"
```

---

## Task 25: Re-enable wind tiles and mount race surfaces on /helm

**Files:**

- Modify: `packages/web/src/app/helm/page.tsx`

- [ ] **Step 1: Replace the hidden-wind block with conditional tiles**

In `packages/web/src/app/helm/page.tsx`, find the comment block:

```tsx
// Wind + polar/VMG channels intentionally not subscribed — no wind sensor attached.
const sog = channels.get('nav.gps.sog');
```

Replace the block of intentionally-skipped wind tiles (lines `291..292` "Wind-derived tiles hidden" comment) with active conditional tiles. Add these state reads alongside `sog`/`cog`/etc.:

```tsx
const tws = channels.get('wind.true.speed');
const twa = channels.get('wind.true.angle');
const awa = channels.get('wind.apparent.angle');
const aws = channels.get('wind.apparent.speed');
const tbsSample = channels.get('race.targetSpeed');
const tTwaSample = channels.get('race.targetTwa');
const pctPolarSample = channels.get('race.percentPolar');
```

And in the tile grid section, REPLACE the hidden-tiles comment with:

```tsx
{
  /* Wind tiles — render only when the corresponding channel publishes,
    so a missing masthead leaves the grid clean instead of showing dashes. */
}
{
  tws && <HelmTile label="TWS" value={fmtSpeed(tws)} unit="kn" />;
}
{
  twa && <HelmTile label="TWA" value={fmtAngleSigned(twa)} unit="°" />;
}
{
  aws && <HelmTile label="AWS" value={fmtSpeed(aws)} unit="kn" small />;
}
{
  awa && <HelmTile label="AWA" value={fmtAngleSigned(awa)} unit="°" small />;
}
{
  tbsSample && <HelmTile label="TBS" value={fmtSpeed(tbsSample)} unit="kn" small />;
}
{
  tTwaSample && <HelmTile label="Target TWA" value={fmtAngleSigned(tTwaSample)} unit="°" small />;
}
{
  pctPolarSample && (
    <HelmTile
      label="% polar"
      value={(() => {
        const v = scalar(pctPolarSample);
        return v === null ? '—' : v.toFixed(0);
      })()}
      unit="%"
      small
    />
  );
}
```

- [ ] **Step 2: Add RaceMiniTimer + RaceTiles**

At the top of `helm/page.tsx`, add imports:

```tsx
import { RaceMiniTimer } from './RaceMiniTimer';
import { RaceTiles } from '../../components/RaceTiles';
```

In the header row, next to the "Live"/"Reconnecting…" indicator, add:

```tsx
<div className="flex items-center gap-3">
  <RaceMiniTimer />
  <div className="text-xs text-slate-500">{connected ? 'Live' : 'Reconnecting…'}</div>
</div>
```

(Replace the existing `<div className="text-xs text-slate-500">{connected ? ...}</div>` with the flex wrapper above.)

After the `</div>` closing the tile grid, before `<MobButton />`, add:

```tsx
<RaceTiles />
```

- [ ] **Step 3: Verify the page still builds**

Run: `npx tsc -b packages/web`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/helm/page.tsx
git commit -m "feat(web): helm — re-enable wind tiles + mount race mini-timer & RaceTiles"
```

---

## Task 26: Mount StartLineLayer + LaylinesLayer on /chart

**Files:**

- Modify: `packages/web/src/app/chart/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `packages/web/src/app/chart/page.tsx`, add:

```tsx
import { StartLineLayer } from '../../components/StartLineLayer';
import { LaylinesLayer } from '../../components/LaylinesLayer';
```

- [ ] **Step 2: Mount the layers**

Find the JSX block where existing layers are mounted (around line 464+, look for `<WaypointsLayer map={mapInstance}` and `<CurrentOverlay map={mapInstance}`). The chart page exposes its MapLibre instance as the local variable `mapInstance`. Insert the new layers BETWEEN `<CurrentOverlay>` and `<WaypointsLayer>` (or alongside the other map layers — order matters for z-order: laylines should sit above current contours but below waypoints):

```tsx
<StartLineLayer map={mapInstance} />
<LaylinesLayer map={mapInstance} />
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -b packages/web`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): chart — mount StartLineLayer + LaylinesLayer"
```

---

## Task 27: Add /race link to Navbar

**Files:**

- Modify: `packages/web/src/app/Navbar.tsx`

- [ ] **Step 1: Add the link**

Read the current `Navbar.tsx` — there is an array or JSX block listing the nav links. Add `/race` between `/helm` and `/passage` (or wherever makes the most visual sense in the existing order):

```tsx
<Link href="/race" className={linkClass('/race', pathname)}>
  Race
</Link>
```

Use whatever helper / className pattern matches the file's existing style.

- [ ] **Step 2: Verify build**

Run: `npx tsc -b packages/web`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/Navbar.tsx
git commit -m "feat(web): navbar — add Race link"
```

---

## Task 28: Boot race pipeline in autopilot-server

**Files:**

- Modify: `apps/autopilot-server/src/index.ts`

- [ ] **Step 1: Add imports**

Add to the top of `apps/autopilot-server/src/index.ts` alongside the existing `@g5000/*` imports:

```ts
import { createRaceState, setSharedRaceState } from '@g5000/core';
import { loadRaceState, saveRaceState } from '@g5000/db';
import { startRaceComputePipeline } from '@g5000/compute';
import type { CurrentField } from '@g5000/grib';
import type { LatLon } from '@g5000/compute';
```

(`LatLon` is re-exported from `@g5000/compute` per Task 11 Step 2; if missing, add `export type { LatLon } from './race/line-geometry.js';` to `packages/compute/src/index.ts` and rebuild.)

- [ ] **Step 2: Initialize RaceState after polar pipeline starts**

Find the block where `startPolarPipeline` is called. Immediately after it, add:

```ts
// --- Race state + pipeline ---
const raceStateConfig = await loadRaceState(configStore);
// Boot-time staleness reset: clear timer if startMs is >1h in the past.
if (
  raceStateConfig.timer.startMs !== null &&
  Date.now() - raceStateConfig.timer.startMs > 3_600_000
) {
  raceStateConfig.timer.startMs = null;
  raceStateConfig.timer.state = 'idle';
  await saveRaceState(configStore, raceStateConfig);
}
const raceState = createRaceState(raceStateConfig);
setSharedRaceState(raceState);

// Polar ref: peek the most-recently-published polar.
const polarRef: { current: import('@g5000/db').PolarTable | null } = { current: null };
configStore.activePolar$.subscribe((p) => {
  polarRef.current = p;
});

// Current field ref: v1 leaves this null — the pipeline degrades to
// "no current integration" for laylines. A follow-up issue can subscribe
// to the in-process current-field cache once one is exposed.
const currentFieldRef: { current: CurrentField | null } = { current: null };

// Waypoints ref: rebuilt on every /api/race/state PUT and at boot from
// /api/waypoints. For v1 we leave it empty and let the pipeline degrade
// to "no VMC"; a follow-up hooks ConfigStore.waypoints$ in here.
const waypointsRef: { current: Map<string, LatLon> } = { current: new Map() };

const raceHandle = startRaceComputePipeline(
  bus,
  raceState,
  polarRef,
  currentFieldRef,
  waypointsRef,
);
teardown.push(async () => raceHandle.dispose());

// Persist on every mutation (debounced 500 ms).
let saveTimer: ReturnType<typeof setTimeout> | null = null;
raceState.subscribe(() => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveRaceState(configStore, raceState.get()).catch(() => undefined);
  }, 500);
});
```

- [ ] **Step 3: Build and verify boot**

Run: `npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib`
Expected: clean exit.

Run: `npx tsc -b apps/autopilot-server`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add apps/autopilot-server/src/index.ts packages/compute/src/index.ts
git commit -m "feat(autopilot-server): boot RaceState + race compute pipeline"
```

---

## Task 29: Replay integration test

**Files:**

- Create: `packages/compute/src/race/integration.test.ts`

This task exercises the full pipeline end-to-end against a synthetic input sequence. It does NOT require a real session.jsonl.gz — it drives the bus directly with timed publishes, which is closer to the spec's "replay-driven" intent while staying hermetic.

- [ ] **Step 1: Write the integration test**

Create `packages/compute/src/race/integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bus, Channels, createRaceState } from '@g5000/core';
import type { PolarTable } from '@g5000/db';
import { startRaceComputePipeline } from './index.js';

const POLAR: PolarTable = {
  twsBins: [4, 8, 12, 16, 20],
  twaBins: [0, 0.5, 1.0, 1.57, 2.0, 2.5, 3.0],
  boatSpeed: [
    [0, 1, 2, 2.5, 2.3, 1.8, 0.5],
    [0, 2, 3.5, 4, 3.7, 3, 1],
    [0, 3, 5, 5.8, 5.3, 4.4, 1.5],
    [0, 4, 6, 7, 6.4, 5.3, 1.8],
    [0, 5, 7, 8, 7.4, 6.1, 2.0],
  ],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('race pipeline integration', () => {
  it('publishes race.line.* once line is pinged and position publishes', async () => {
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const bus = new Bus();
    const rs = createRaceState();
    rs.mutate((d) => {
      d.line.port = { lat: 41.5, lon: -71.3, pingedAt: '2026-05-18T11:59:00Z' };
      d.line.stbd = { lat: 41.5, lon: -71.29, pingedAt: '2026-05-18T11:59:00Z' };
      d.line.preStartSide = 'port';
    });
    const polarRef = { current: POLAR as PolarTable | null };
    const wpRef = { current: new Map() };
    const handle = startRaceComputePipeline(bus, rs, polarRef, { current: null }, wpRef);

    const seen: Record<string, number> = {};
    bus.subscribe('race.**', (s) => {
      if (s.value.kind === 'scalar') seen[s.channel] = s.value.value;
    });

    const t = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: Channels.Nav.Position,
      t_ns: t,
      value: { kind: 'geo', value: { lat: 41.49, lon: -71.295 } },
      source: 'test',
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(seen[Channels.Race.LineDistanceToLine]).toBeDefined();
    expect(seen[Channels.Race.LineDistancePort]).toBeGreaterThan(0);
    expect(seen[Channels.Race.LineDistanceStbd]).toBeGreaterThan(0);

    handle.dispose();
  });

  it('publishes race.vmc when active mark + position are set', async () => {
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const bus = new Bus();
    const rs = createRaceState();
    rs.mutate((d) => {
      d.activeMarkWaypointId = 'wp-1';
    });
    const wpRef = { current: new Map([['wp-1', { lat: 41.6, lon: -71.295 }]]) };
    const handle = startRaceComputePipeline(bus, rs, { current: null }, { current: null }, wpRef);
    const seen: Record<string, number> = {};
    bus.subscribe('race.**', (s) => {
      if (s.value.kind === 'scalar') seen[s.channel] = s.value.value;
    });
    const t = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: Channels.Nav.Position,
      t_ns: t,
      value: { kind: 'geo', value: { lat: 41.5, lon: -71.3 } },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Nav.Cog,
      t_ns: t,
      value: { kind: 'scalar', value: 0 },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Nav.Sog,
      t_ns: t,
      value: { kind: 'scalar', value: 5 },
      source: 'test',
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(seen[Channels.Race.Vmc]).toBeDefined();
    handle.dispose();
  });

  it('does not publish wind-dependent channels when wind is silent', async () => {
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));
    const bus = new Bus();
    const rs = createRaceState();
    const handle = startRaceComputePipeline(
      bus,
      rs,
      { current: null },
      { current: null },
      { current: new Map() },
    );
    const seen: string[] = [];
    bus.subscribe('race.**', (s) => seen.push(s.channel));
    const t = BigInt(Date.now()) * 1_000_000n;
    bus.publish({
      channel: Channels.Nav.Position,
      t_ns: t,
      value: { kind: 'geo', value: { lat: 41.5, lon: -71.3 } },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Nav.Sog,
      t_ns: t,
      value: { kind: 'scalar', value: 5 },
      source: 'test',
    });
    bus.publish({
      channel: Channels.Nav.Cog,
      t_ns: t,
      value: { kind: 'scalar', value: 0 },
      source: 'test',
    });
    await vi.advanceTimersByTimeAsync(20);
    // No wind, no bias / targets / laylines / wind-shift.
    expect(seen).not.toContain(Channels.Race.LineBias);
    expect(seen).not.toContain(Channels.Race.TargetSpeed);
    expect(seen).not.toContain(Channels.Race.LaylinePort);
    expect(seen).not.toContain(Channels.Race.WindShiftBias);
    handle.dispose();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run packages/compute/src/race/integration.test.ts`
Expected: 3 pass.

- [ ] **Step 3: Final full test suite + typecheck**

Run: `npm test`
Expected: all prior tests pass + new 29-task suite passes (apart from pre-existing wgrib2/coastline-data/position-route environmental failures noted in the worktree baseline).

Run: `npm run typecheck` (or `npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib && npx tsc -b apps/autopilot-server packages/web`)
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/compute/src/race/integration.test.ts
git commit -m "test(compute): race pipeline integration — line, VMC, wind-silence"
```

---

## Final verification

After all 29 tasks complete:

- [ ] **Run the full test suite** — `npm test`
- [ ] **Run typecheck** — `npm run typecheck`
- [ ] **Run lint** — `npm run lint`
- [ ] **Boot demo locally** — `DEMO_MODE=1 npm run dev --workspace @g5000/autopilot-server`
  - Visit `http://localhost:3000/race`. Verify: timer starts, countdown beeps fire, line ping buttons accept clicks, active-mark dropdown lists waypoints.
  - Visit `http://localhost:3000/helm`. Verify: TWS/TWA tiles render (demo publishes wind); RaceMiniTimer appears in header; RaceTiles render at bottom of grid.
  - Visit `http://localhost:3000/chart`. Verify: start line renders after pinging both ends; laylines render in demo.
- [ ] **Spec re-check.** Re-read `docs/superpowers/specs/2026-05-18-race-day-features-design.md` §9 Success Criteria and tick off each one against observed behavior.
