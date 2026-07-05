# UK Tide Heights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add UK astronomical tide heights from the ADMIRALTY UK Tidal API — a `TideService` publishing decomposed `tide.*` bus channels for the active (nearest-or-pinned) station, plus a `/tide` planning page — built on a new pure `@g5000/tide` package shared by both.

**Architecture:** Pure tidal math (piecewise-cosine curve, nearest-station, next-event, snapshot) lives in `@g5000/tide` and is unit-tested in isolation. A server-side `admiralty-client` (key from `ADMIRALTY_TIDAL_API_KEY`) fetches stations/events; a `TideService` wired at boot (like `race`/`groove`) does daily fetch + a ~30 s interpolation tick and publishes `tide.*`. `/api/tide/*` routes + a `/tide` page consume it. Graceful-off when the key is unset.

**Tech Stack:** Node ≥22, ESM, strict TypeScript composite refs (`tsc -b`), RxJS bus, SQLite/Drizzle ConfigStore, Next.js 16 + React 19 web, Vitest (node env).

**Spec:** `docs/superpowers/specs/2026-06-02-tide-heights-design.md`

**Conventions:**

- Run one test file: `npx vitest run <path>` from repo root. Web typecheck: `cd packages/web && npx tsc --noEmit`. Full build: `npx tsc -b`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `Bus` (from `@g5000/core`) publishes `{ channel, t_ns: bigint, value: ChannelValue, source }`; `ChannelValue` is `{kind:'scalar',value,unit?}` | `{kind:'enum',value}` | `{kind:'geo',...}` | …. `bus.subscribe(channel, handler)` returns an unsubscribe fn.
- **`ADMIRALTY_TIDAL_API_KEY` is not available during implementation.** Build against the documented response shape with fixtures; the live Phase-0 probe is deferred. The Admiralty parser is isolated so a real-shape correction is one file.

**Shared types (defined Task 2, used everywhere — keep names exact):**

```ts
export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
export interface TidalEvent {
  type: 'HW' | 'LW';
  timeMs: number;
  heightM: number;
} // timeMs = epoch ms; heightM above Chart Datum
export type TideState = 'rising' | 'falling' | 'stand';
```

**File structure:**

- `packages/tide/` — new pure package `@g5000/tide`: `types.ts`, `curve.ts`, `nearest.ts`, `next-event.ts`, `snapshot.ts`, `index.ts` (+ tests).
- `packages/core/src/channels.ts` — add `Tide.*`.
- `packages/db/src/{defaults,schema,config-store}.ts` — `TideConfig`.
- `apps/g5000/src/tide/admiralty-client.ts` — server-side client + pure parsers.
- `apps/g5000/src/tide-subsystem.ts` — `startTideSubsystem`; wired in `apps/g5000/src/index.ts`.
- `packages/web/src/app/api/tide/{stations,events,active,pin}/route.ts`.
- `packages/web/src/app/tide/page.tsx`.
- mast formatter (`packages/web/src/app/mast/format.ts`) — units for `tide.*`.

---

### Task 1: Scaffold the `@g5000/tide` package

**Files:**

- Create: `packages/tide/package.json`, `packages/tide/tsconfig.json`, `packages/tide/src/index.ts`
- Modify: `tsconfig.json` (root refs), `apps/g5000/package.json` (predev build list + deps), `packages/web/package.json` (deps)

- [ ] **Step 1: Create `packages/tide/package.json`** (mirrors `@g5000/mast`; pure — no runtime deps):

```json
{
  "name": "@g5000/tide",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: Create `packages/tide/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"],
  "references": []
}
```

- [ ] **Step 3: Create `packages/tide/src/index.ts`** (placeholder barrel, expanded in Task 6):

```ts
export {};
```

- [ ] **Step 4: Register in the build graph.**
  - In root `tsconfig.json`, add `{ "path": "./packages/tide" }` to the `references` array (place it after the `./packages/grib` entry).
  - In `apps/g5000/package.json`, the `predev` and `prebuild` scripts list packages for `tsc -b`; add `../../packages/tide` to BOTH (place after `../../packages/core`). Also add `"@g5000/tide": "*"` to `apps/g5000/package.json` `dependencies`.
  - In `packages/web/package.json`, add `"@g5000/tide": "*"` to `dependencies`.

- [ ] **Step 5: Install workspace links + build the package**

Run: `npm install` (from repo root — links the new workspace package), then `npx tsc -b packages/tide`.
Expected: install succeeds; `packages/tide/dist/index.js` + `index.d.ts` exist.

- [ ] **Step 6: Commit**

```bash
git add packages/tide tsconfig.json apps/g5000/package.json packages/web/package.json package-lock.json
git commit -m "feat(tide): scaffold @g5000/tide package + wire build refs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Types + curve math

**Files:**

- Create: `packages/tide/src/types.ts`, `packages/tide/src/curve.ts`
- Test: `packages/tide/src/curve.test.ts`

- [ ] **Step 1: Create `packages/tide/src/types.ts`:**

```ts
export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TidalEvent {
  type: 'HW' | 'LW';
  /** Epoch milliseconds (UTC). */
  timeMs: number;
  /** Height in metres above Chart Datum. */
  heightM: number;
}

export type TideState = 'rising' | 'falling' | 'stand';
```

- [ ] **Step 2: Write the failing test `packages/tide/src/curve.test.ts`:**

```ts
import { describe, it, expect } from 'vitest';
import { interpolateHeight, heightNow, tideState } from './curve.js';
import type { TidalEvent } from './types.js';

const min = 60_000;
// LW (1.0 m) at t=0, HW (5.0 m) at t=6h, LW (1.2 m) at t=12h
const events: TidalEvent[] = [
  { type: 'LW', timeMs: 0, heightM: 1.0 },
  { type: 'HW', timeMs: 6 * 60 * min, heightM: 5.0 },
  { type: 'LW', timeMs: 12 * 60 * min, heightM: 1.2 },
];

describe('interpolateHeight', () => {
  it('returns the endpoints exactly', () => {
    expect(interpolateHeight(0, 1, 100, 5, 0)).toBeCloseTo(1, 9);
    expect(interpolateHeight(0, 1, 100, 5, 100)).toBeCloseTo(5, 9);
  });
  it('returns the midpoint mean at the half-time', () => {
    expect(interpolateHeight(0, 1, 100, 5, 50)).toBeCloseTo(3, 9);
  });
  it('works on a falling segment (HW→LW) too', () => {
    expect(interpolateHeight(0, 5, 100, 1, 50)).toBeCloseTo(3, 9);
  });
});

describe('heightNow', () => {
  it('interpolates within the bracketing pair', () => {
    // 3h into the LW→HW segment (half-way) → mean of 1.0 and 5.0 = 3.0
    expect(heightNow(events, 3 * 60 * min)).toBeCloseTo(3.0, 6);
  });
  it('returns null before the first event (no bracket)', () => {
    expect(heightNow(events, -1 * min)).toBeNull();
  });
  it('returns null after the last event', () => {
    expect(heightNow(events, 13 * 60 * min)).toBeNull();
  });
});

describe('tideState', () => {
  it('is rising on a LW→HW segment away from the ends', () => {
    expect(tideState(events, 3 * 60 * min)).toBe('rising');
  });
  it('is falling on a HW→LW segment away from the ends', () => {
    expect(tideState(events, 9 * 60 * min)).toBe('falling');
  });
  it('is stand within the window of an event', () => {
    expect(tideState(events, 6 * 60 * min + 5 * min)).toBe('stand'); // 5 min after HW
  });
  it('is null with no bracketing pair', () => {
    expect(tideState(events, 13 * 60 * min)).toBeNull();
  });
});
```

- [ ] **Step 2b: Run, verify FAIL:** `npx vitest run packages/tide/src/curve.test.ts` (module not found).

- [ ] **Step 3: Implement `packages/tide/src/curve.ts`:**

```ts
import type { TidalEvent, TideState } from './types.js';

/** Piecewise-cosine tide height between two events. Valid for tA ≤ t ≤ tB,
 *  either rising (hB>hA) or falling (hB<hA). */
export function interpolateHeight(
  tA: number,
  hA: number,
  tB: number,
  hB: number,
  t: number,
): number {
  if (tB === tA) return hA;
  const phase = (Math.PI * (t - tA)) / (tB - tA);
  return (hA + hB) / 2 + ((hA - hB) / 2) * Math.cos(phase);
}

/** Find the consecutive event pair bracketing `nowMs` (tA ≤ now < tB).
 *  Assumes `events` is sorted ascending by timeMs. */
function bracket(
  events: ReadonlyArray<TidalEvent>,
  nowMs: number,
): [TidalEvent, TidalEvent] | null {
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i]!.timeMs <= nowMs && nowMs < events[i + 1]!.timeMs) {
      return [events[i]!, events[i + 1]!];
    }
  }
  return null;
}

/** Interpolated height (m above CD) at `nowMs`, or null when no bracketing pair. */
export function heightNow(events: ReadonlyArray<TidalEvent>, nowMs: number): number | null {
  const pair = bracket(events, nowMs);
  if (!pair) return null;
  const [a, b] = pair;
  return interpolateHeight(a.timeMs, a.heightM, b.timeMs, b.heightM, nowMs);
}

/** rising | falling | stand for `nowMs`, or null when no bracketing pair.
 *  `stand` when within `standWindowMs` of either bracketing event (dh/dt≈0). */
export function tideState(
  events: ReadonlyArray<TidalEvent>,
  nowMs: number,
  standWindowMs = 20 * 60_000,
): TideState | null {
  const pair = bracket(events, nowMs);
  if (!pair) return null;
  const [a, b] = pair;
  if (nowMs - a.timeMs <= standWindowMs || b.timeMs - nowMs <= standWindowMs) return 'stand';
  return b.heightM > a.heightM ? 'rising' : 'falling';
}
```

- [ ] **Step 4: Run, verify PASS:** `npx vitest run packages/tide/src/curve.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/tide/src/types.ts packages/tide/src/curve.ts packages/tide/src/curve.test.ts
git commit -m "feat(tide): types + piecewise-cosine curve (heightNow, tideState)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Nearest-station (haversine + hysteresis)

**Files:**

- Create: `packages/tide/src/nearest.ts`
- Test: `packages/tide/src/nearest.test.ts`

- [ ] **Step 1: Write the failing test `packages/tide/src/nearest.test.ts`:**

```ts
import { describe, it, expect } from 'vitest';
import { haversineKm, nearestStation } from './nearest.js';
import type { Station } from './types.js';

const A: Station = { id: 'A', name: 'Alpha', lat: 50.0, lon: -1.0 };
const B: Station = { id: 'B', name: 'Bravo', lat: 50.5, lon: -1.0 };
const stations = [A, B];

describe('haversineKm', () => {
  it('is ~0 for identical points', () => {
    expect(haversineKm(50, -1, 50, -1)).toBeCloseTo(0, 6);
  });
  it('is ~55.6 km for 0.5° of latitude', () => {
    expect(haversineKm(50, -1, 50.5, -1)).toBeGreaterThan(54);
    expect(haversineKm(50, -1, 50.5, -1)).toBeLessThan(57);
  });
});

describe('nearestStation', () => {
  it('picks the closest station with no current', () => {
    expect(nearestStation(stations, { lat: 50.05, lon: -1.0 }, null)?.id).toBe('A');
  });
  it('returns null for an empty list', () => {
    expect(nearestStation([], { lat: 50, lon: -1 }, null)).toBeNull();
  });
  it('keeps the current station inside the hysteresis margin', () => {
    // Boat near the midpoint; B only marginally closer → stay on A.
    const pos = { lat: 50.26, lon: -1.0 };
    expect(nearestStation(stations, pos, A, 5)?.id).toBe('A');
  });
  it('switches when a candidate is closer by more than the margin', () => {
    // Boat right at B → B is far closer than A → switch.
    expect(nearestStation(stations, { lat: 50.5, lon: -1.0 }, A, 5)?.id).toBe('B');
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run packages/tide/src/nearest.test.ts`.

- [ ] **Step 3: Implement `packages/tide/src/nearest.ts`:**

```ts
import type { Station } from './types.js';

const R_KM = 6371;
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Nearest station to `pos`, with hysteresis: if `current` is provided, only
 * switch to a different station when it is closer by more than `switchMarginKm`
 * (prevents GPS-jitter flapping at a Voronoi boundary). Returns null for an
 * empty list.
 */
export function nearestStation(
  stations: ReadonlyArray<Station>,
  pos: { lat: number; lon: number },
  current: Station | null,
  switchMarginKm = 2,
): Station | null {
  if (stations.length === 0) return null;
  let best = stations[0]!;
  let bestD = haversineKm(pos.lat, pos.lon, best.lat, best.lon);
  for (const s of stations) {
    const d = haversineKm(pos.lat, pos.lon, s.lat, s.lon);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  if (!current) return best;
  if (best.id === current.id) return current;
  const curD = haversineKm(pos.lat, pos.lon, current.lat, current.lon);
  return bestD <= curD - switchMarginKm ? best : current;
}
```

- [ ] **Step 4: Run, verify PASS:** `npx vitest run packages/tide/src/nearest.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/tide/src/nearest.ts packages/tide/src/nearest.test.ts
git commit -m "feat(tide): nearest-station with haversine + switch hysteresis

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Next-event + snapshot

**Files:**

- Create: `packages/tide/src/next-event.ts`, `packages/tide/src/snapshot.ts`
- Test: `packages/tide/src/next-event.test.ts`, `packages/tide/src/snapshot.test.ts`

- [ ] **Step 1: Write the failing tests.**

`packages/tide/src/next-event.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextEvent } from './next-event.js';
import type { TidalEvent } from './types.js';

const min = 60_000;
const events: TidalEvent[] = [
  { type: 'LW', timeMs: 0, heightM: 1.0 },
  { type: 'HW', timeMs: 6 * 60 * min, heightM: 5.0 },
];

describe('nextEvent', () => {
  it('returns the first event strictly after now', () => {
    expect(nextEvent(events, 3 * 60 * min)?.type).toBe('HW');
  });
  it('returns null when none remain', () => {
    expect(nextEvent(events, 7 * 60 * min)).toBeNull();
  });
});
```

`packages/tide/src/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { tideSnapshot } from './snapshot.js';
import type { TidalEvent } from './types.js';

const min = 60_000;
const events: TidalEvent[] = [
  { type: 'LW', timeMs: 0, heightM: 1.0 },
  { type: 'HW', timeMs: 6 * 60 * min, heightM: 5.0 },
  { type: 'LW', timeMs: 12 * 60 * min, heightM: 1.2 },
];

describe('tideSnapshot', () => {
  it('composes height, state and next event', () => {
    const s = tideSnapshot(events, 3 * 60 * min);
    expect(s.heightNowM).toBeCloseTo(3.0, 6);
    expect(s.state).toBe('rising');
    expect(s.next?.type).toBe('HW');
    expect(s.next?.timeMs).toBe(6 * 60 * min);
  });
  it('nulls height/state but still finds next when before first event', () => {
    const s = tideSnapshot(events, -1 * min);
    expect(s.heightNowM).toBeNull();
    expect(s.state).toBeNull();
    expect(s.next?.timeMs).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run packages/tide/src/next-event.test.ts packages/tide/src/snapshot.test.ts`.

- [ ] **Step 3: Implement.**

`packages/tide/src/next-event.ts`:

```ts
import type { TidalEvent } from './types.js';

/** First event strictly after `nowMs` (events assumed sorted ascending), or null. */
export function nextEvent(events: ReadonlyArray<TidalEvent>, nowMs: number): TidalEvent | null {
  for (const e of events) {
    if (e.timeMs > nowMs) return e;
  }
  return null;
}
```

`packages/tide/src/snapshot.ts`:

```ts
import type { TidalEvent, TideState } from './types.js';
import { heightNow, tideState } from './curve.js';
import { nextEvent } from './next-event.js';

export interface TideSnapshot {
  heightNowM: number | null;
  state: TideState | null;
  next: TidalEvent | null;
}

/** Compose the live tide readout from a sorted event list at `nowMs`. */
export function tideSnapshot(events: ReadonlyArray<TidalEvent>, nowMs: number): TideSnapshot {
  return {
    heightNowM: heightNow(events, nowMs),
    state: tideState(events, nowMs),
    next: nextEvent(events, nowMs),
  };
}
```

- [ ] **Step 4: Run, verify PASS:** `npx vitest run packages/tide/src/next-event.test.ts packages/tide/src/snapshot.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/tide/src/next-event.ts packages/tide/src/snapshot.ts packages/tide/src/next-event.test.ts packages/tide/src/snapshot.test.ts
git commit -m "feat(tide): next-event + tideSnapshot composer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Barrel export + build

**Files:**

- Modify: `packages/tide/src/index.ts`

- [ ] **Step 1: Replace `packages/tide/src/index.ts`:**

```ts
export type { Station, TidalEvent, TideState } from './types.js';
export { interpolateHeight, heightNow, tideState } from './curve.js';
export { haversineKm, nearestStation } from './nearest.js';
export { nextEvent } from './next-event.js';
export { tideSnapshot, type TideSnapshot } from './snapshot.js';
```

- [ ] **Step 2: Build + verify subpath resolves**

Run: `npx tsc -b packages/tide` then `npx vitest run packages/tide` (all tide tests pass).
Also: `node -e "import('@g5000/tide').then(m => console.log(typeof m.tideSnapshot, typeof m.nearestStation))"` → expect `function function`.

- [ ] **Step 3: Commit**

```bash
git add packages/tide/src/index.ts
git commit -m "feat(tide): barrel export for @g5000/tide

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Tide channel constants

**Files:**

- Modify: `packages/core/src/channels.ts`

- [ ] **Step 1: Add a `Tide` group** to the `Channels` object (after the `Groove` block, before the closing `} as const;`):

```ts
  Tide: {
    /** Active tide station name. */
    Station: 'tide.station',
    /** Interpolated height now, metres above Chart Datum (suppressed when no bracketing pair). */
    HeightNow: 'tide.heightNow',
    /** Tide state: 'rising' | 'falling' | 'stand' (height concept, not current slack). */
    State: 'tide.state',
    /** Next tidal event type: 'HW' | 'LW'. */
    NextEventType: 'tide.nextEventType',
    /** Seconds until the next tidal event. */
    NextEventInSec: 'tide.nextEventInSec',
    /** Height of the next tidal event, metres above Chart Datum. */
    NextEventHeight: 'tide.nextEventHeight',
  },
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc -b packages/core` → clean.

```bash
git add packages/core/src/channels.ts
git commit -m "feat(tide): tide.* channel constants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: TideConfig in ConfigStore

**Files:**

- Modify: `packages/db/src/defaults.ts`, `packages/db/src/schema.ts`, `packages/db/src/config-store.ts`
- Test: `packages/db/src/config-store.test.ts`

Mirror the EXISTING `grooveSettings` pattern end-to-end (read how `grooveSettings`/`GrooveSettings` is done in all four files first, and copy it for `tideConfig`/`TideConfig`).

- [ ] **Step 1: `defaults.ts`** — after `DEFAULT_GROOVE_SETTINGS`, add (import `Station` type from `@g5000/tide` — add `"@g5000/tide": "*"` to `packages/db/package.json` deps and `{ "path": "../tide" }` to `packages/db/tsconfig.json` references if not already present from Task 1; if importing across packages is awkward here, inline a structural `{id;name;lat;lon}` type instead and note it):

```ts
import type { Station } from '@g5000/tide';

export interface TideConfig {
  /** Pinned station id; null = follow nearest-to-boat. */
  pinnedStationId: string | null;
  /** Fallback station when no GPS; null = none. */
  defaultStationId: string | null;
  /** Cached static station list (refreshed ~weekly). */
  stationsCache: { fetchedAtMs: number; stations: Station[] } | null;
}

export const DEFAULT_TIDE_CONFIG: TideConfig = {
  pinnedStationId: null,
  defaultStationId: null,
  stationsCache: null,
};
```

- [ ] **Step 2: `schema.ts`** — after the `grooveSettings` table:

```ts
export const tideConfig = sqliteTable('tide_config', {
  boatId: text('boat_id').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});
```

(Match the exact column style `grooveSettings` uses.)

- [ ] **Step 3: Write the failing test** in `packages/db/src/config-store.test.ts` (mirror the groove settings reopen test; import `DEFAULT_TIDE_CONFIG`):

```ts
it('seeds tide config with defaults and persists a set across reopen', async () => {
  expect(store.getTideConfig()).toEqual(DEFAULT_TIDE_CONFIG);
  const next = { ...DEFAULT_TIDE_CONFIG, pinnedStationId: '0001' };
  await store.setTideConfig(next);
  await store.close();
  store = await ConfigStore.open(dbPath);
  expect(store.getTideConfig()).toEqual(next);
});
```

Run it; confirm FAIL (`getTideConfig` not a function): `npx vitest run packages/db/src/config-store.test.ts -t "tide config"`.

- [ ] **Step 4: Wire `config-store.ts`** exactly like `grooveSettings`: import `DEFAULT_TIDE_CONFIG, type TideConfig`; add a `tideConfig` BehaviorSubject seeded with `DEFAULT_TIDE_CONFIG`; in `open()` add `CREATE TABLE IF NOT EXISTS tide_config (boat_id TEXT PRIMARY KEY, value TEXT NOT NULL)` and the Drizzle load-merge over defaults (copy the groove block, swap names/table); add accessors:

```ts
  get tideConfig$(): Observable<TideConfig> {
    return this.subjects.tideConfig.asObservable();
  }
  getTideConfig(): TideConfig {
    return this.subjects.tideConfig.value;
  }
  async setTideConfig(value: TideConfig): Promise<void> {
    this.raw
      .prepare(
        'INSERT INTO tide_config (boat_id, value) VALUES (?, ?) ON CONFLICT (boat_id) DO UPDATE SET value = excluded.value',
      )
      .run(this.__activeBoatId, JSON.stringify(value));
    this.subjects.tideConfig.next(value);
  }
```

Also add `tideConfig` to the SimpleKey-exclusion comment list (the same comment groove was added to).

- [ ] **Step 5: Run, verify PASS:** `npx vitest run packages/db/src/config-store.test.ts -t "tide config"`, then the full file. Build: `npx tsc -b packages/db` (clean — needs the `@g5000/tide` ref from Step 1).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/defaults.ts packages/db/src/schema.ts packages/db/src/config-store.ts packages/db/src/config-store.test.ts packages/db/package.json packages/db/tsconfig.json package-lock.json
git commit -m "feat(db): TideConfig (pinned/default station + station-list cache)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: ADMIRALTY client + pure parsers

**Files:**

- Create: `packages/tide/src/admiralty-client.ts`
- Test: `packages/tide/src/admiralty-client.test.ts`
- Modify: `packages/tide/src/index.ts` (export the client)

The client lives in `@g5000/tide` (not `apps/g5000`) so BOTH the `TideService` (apps) and the web `/api/tide` routes can import the fetchers — `packages/web` cannot import from `apps/g5000`. The PARSERS are pure (fixture-tested now). The fetchers are thin `fetch` wrappers; not unit-tested here (no key) — Phase-0 verifies them live.

- [ ] **Step 1: Write the failing test `packages/tide/src/admiralty-client.test.ts`** (fixtures use the documented shape):

```ts
import { describe, it, expect } from 'vitest';
import { parseStations, parseTidalEvents } from './admiralty-client.js';

describe('parseStations', () => {
  it('maps GeoJSON-style stations to {id,name,lat,lon}', () => {
    const json = {
      features: [
        {
          properties: { Id: '0001', Name: 'Dover' },
          geometry: { type: 'Point', coordinates: [1.32, 51.12] }, // [lon, lat]
        },
      ],
    };
    expect(parseStations(json)).toEqual([{ id: '0001', name: 'Dover', lat: 51.12, lon: 1.32 }]);
  });
  it('skips features missing id/name/coords', () => {
    const json = { features: [{ properties: {}, geometry: null }] };
    expect(parseStations(json)).toEqual([]);
  });
});

describe('parseTidalEvents', () => {
  it('maps events to {type,timeMs,heightM} sorted ascending', () => {
    const json = [
      { EventType: 'HighWater', DateTime: '2026-06-02T12:00:00', Height: 5.1 },
      { EventType: 'LowWater', DateTime: '2026-06-02T06:00:00', Height: 1.0 },
    ];
    const out = parseTidalEvents(json);
    expect(out).toEqual([
      { type: 'LW', timeMs: Date.parse('2026-06-02T06:00:00Z'), heightM: 1.0 },
      { type: 'HW', timeMs: Date.parse('2026-06-02T12:00:00Z'), heightM: 5.1 },
    ]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run packages/tide/src/admiralty-client.test.ts`.

- [ ] **Step 3: Implement `packages/tide/src/admiralty-client.ts`:**

```ts
import type { Station, TidalEvent } from './types.js';

const BASE = 'https://admiraltyapi.azure-api.net/uktidalapi/api/V1';

export class TideApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TideApiError';
  }
}

/** Parse the /Stations GeoJSON FeatureCollection into Station[]. Pure. */
export function parseStations(json: unknown): Station[] {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const out: Station[] = [];
  for (const f of features) {
    const props = (f as { properties?: { Id?: unknown; Name?: unknown } }).properties;
    const coords = (f as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
    const id = props?.Id;
    const name = props?.Name;
    if (
      typeof id === 'string' &&
      typeof name === 'string' &&
      Array.isArray(coords) &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      out.push({ id, name, lat: coords[1], lon: coords[0] }); // GeoJSON is [lon, lat]
    }
  }
  return out;
}

/** Parse the /TidalEvents array into TidalEvent[], sorted ascending by time.
 *  API DateTime is UTC; treat a bare (no-offset) string as UTC by appending 'Z'. */
export function parseTidalEvents(json: unknown): TidalEvent[] {
  if (!Array.isArray(json)) return [];
  const out: TidalEvent[] = [];
  for (const e of json as Array<{ EventType?: unknown; DateTime?: unknown; Height?: unknown }>) {
    const type = e.EventType === 'HighWater' ? 'HW' : e.EventType === 'LowWater' ? 'LW' : null;
    const dt = e.DateTime;
    const h = e.Height;
    if (type && typeof dt === 'string' && typeof h === 'number') {
      const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(dt) ? dt : `${dt}Z`;
      const timeMs = Date.parse(iso);
      if (!Number.isNaN(timeMs)) out.push({ type, timeMs, heightM: h });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

async function get(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Ocp-Apim-Subscription-Key': key },
  });
  if (!res.ok) throw new TideApiError(`ADMIRALTY ${path} → ${res.status}`, res.status);
  return res.json();
}

export async function listStations(key: string): Promise<Station[]> {
  return parseStations(await get('/Stations', key));
}

export async function getTidalEvents(
  key: string,
  stationId: string,
  duration = 7,
): Promise<TidalEvent[]> {
  const d = Math.max(1, Math.min(7, duration));
  return parseTidalEvents(
    await get(`/Stations/${encodeURIComponent(stationId)}/TidalEvents?duration=${d}`, key),
  );
}
```

- [ ] **Step 4: Run, verify PASS:** `npx vitest run packages/tide/src/admiralty-client.test.ts`.

- [ ] **Step 4b: Export from the barrel** — append to `packages/tide/src/index.ts`:

```ts
export {
  listStations,
  getTidalEvents,
  parseStations,
  parseTidalEvents,
  TideApiError,
} from './admiralty-client.js';
```

Build: `npx tsc -b packages/tide` (clean).

> **Phase-0 note (deferred):** once `ADMIRALTY_TIDAL_API_KEY` exists, run one live `listStations`/`getTidalEvents` call, diff the real JSON against these fixtures, and adjust `parseStations`/`parseTidalEvents` only if the shape differs.

- [ ] **Step 5: Commit**

```bash
git add packages/tide/src/admiralty-client.ts packages/tide/src/admiralty-client.test.ts packages/tide/src/index.ts
git commit -m "feat(tide): ADMIRALTY client + fixture-tested pure parsers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: TideService (bus publisher) + boot wiring

**Files:**

- Create: `apps/g5000/src/tide-subsystem.ts`
- Test: `apps/g5000/src/tide-subsystem.test.ts`
- Modify: `apps/g5000/src/index.ts`

The service is built so the publish step is a pure mapping of a `TideSnapshot` → channels, testable with an injected clock and pre-seeded events (no network).

- [ ] **Step 1: Write the failing test `apps/g5000/src/tide-subsystem.test.ts`:**

```ts
import { describe, it, expect } from 'vitest';
import { Bus, Channels } from '@g5000/core';
import type { Sample } from '@g5000/core';
import type { TidalEvent } from '@g5000/tide';
import { publishTideSnapshot } from './tide-subsystem.js';

const min = 60_000;
const events: TidalEvent[] = [
  { type: 'LW', timeMs: 0, heightM: 1.0 },
  { type: 'HW', timeMs: 6 * 60 * min, heightM: 5.0 },
  { type: 'LW', timeMs: 12 * 60 * min, heightM: 1.2 },
];

describe('publishTideSnapshot', () => {
  it('publishes decomposed tide.* channels from events + nowMs', () => {
    const bus = new Bus();
    const seen = new Map<string, Sample>();
    bus.subscribe('tide.**', (s) => seen.set(s.channel, s));

    publishTideSnapshot(bus, 'Dover', events, 3 * 60 * min);

    expect(seen.get(Channels.Tide.Station)?.value).toEqual({ kind: 'enum', value: 'Dover' });
    const h = seen.get(Channels.Tide.HeightNow)?.value;
    if (h?.kind === 'scalar') expect(h.value).toBeCloseTo(3.0, 6);
    expect(seen.get(Channels.Tide.State)?.value).toEqual({ kind: 'enum', value: 'rising' });
    expect(seen.get(Channels.Tide.NextEventType)?.value).toEqual({ kind: 'enum', value: 'HW' });
    const insec = seen.get(Channels.Tide.NextEventInSec)?.value;
    if (insec?.kind === 'scalar') expect(insec.value).toBeCloseTo(3 * 60 * 60, 0); // 3h
  });

  it('suppresses heightNow/state when there is no bracketing pair', () => {
    const bus = new Bus();
    const seen = new Map<string, Sample>();
    bus.subscribe('tide.**', (s) => seen.set(s.channel, s));
    publishTideSnapshot(bus, 'Dover', events, 13 * 60 * min); // after last event
    expect(seen.has(Channels.Tide.HeightNow)).toBe(false);
    expect(seen.has(Channels.Tide.State)).toBe(false);
    expect(seen.get(Channels.Tide.Station)?.value).toEqual({ kind: 'enum', value: 'Dover' });
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run apps/g5000/src/tide-subsystem.test.ts`.

- [ ] **Step 3: Implement `apps/g5000/src/tide-subsystem.ts`:**

```ts
import { Bus, Channels } from '@g5000/core';
import type { ConfigStore } from '@g5000/db';
import {
  tideSnapshot,
  nearestStation,
  listStations,
  getTidalEvents,
  type Station,
  type TidalEvent,
} from '@g5000/tide';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const TICK_MS = 30_000;
const KN_UNUSED = 0; // (no-op marker; keeps imports honest)

/** Pure: map a tide snapshot at nowMs to published channels. Exported for tests. */
export function publishTideSnapshot(
  bus: Bus,
  stationName: string,
  events: ReadonlyArray<TidalEvent>,
  nowMs: number,
): void {
  const t_ns = BigInt(Math.round(nowMs * 1e6));
  const enumPub = (channel: string, value: string): void =>
    bus.publish({ channel, t_ns, value: { kind: 'enum', value }, source: 'tide' });
  const scalarPub = (channel: string, value: number, unit: string): void =>
    bus.publish({ channel, t_ns, value: { kind: 'scalar', value, unit }, source: 'tide' });

  enumPub(Channels.Tide.Station, stationName);
  const snap = tideSnapshot(events, nowMs);
  if (snap.heightNowM !== null) scalarPub(Channels.Tide.HeightNow, snap.heightNowM, 'm');
  if (snap.state !== null) enumPub(Channels.Tide.State, snap.state);
  if (snap.next) {
    enumPub(Channels.Tide.NextEventType, snap.next.type);
    scalarPub(Channels.Tide.NextEventInSec, Math.max(0, (snap.next.timeMs - nowMs) / 1000), 's');
    scalarPub(Channels.Tide.NextEventHeight, snap.next.heightM, 'm');
  }
}

export interface TideSubsystemDeps {
  bus: Bus;
  store: ConfigStore;
}

/**
 * Tide bus publisher. Graceful-off when ADMIRALTY_TIDAL_API_KEY is unset.
 * - Loads the station list (ConfigStore cache, refreshed weekly).
 * - Active station = pinned, else nearest to nav.gps.position (hysteresis).
 * - Daily fetch of the active station's events (rolling cache keeps a past event).
 * - ~30 s interpolation tick publishes tide.* from the cached events.
 */
export async function startTideSubsystem(deps: TideSubsystemDeps): Promise<() => Promise<void>> {
  const { bus, store } = deps;
  const key = process.env.ADMIRALTY_TIDAL_API_KEY;
  if (!key) {
    // eslint-disable-next-line no-console
    console.log('[tide] ADMIRALTY_TIDAL_API_KEY unset — tide service disabled');
    return async () => {};
  }

  let stations: Station[] = store.getTideConfig().stationsCache?.stations ?? [];
  let active: Station | null = null;
  let activeEvents: TidalEvent[] = [];
  let lastFetchDay = -1;
  let lastPos: { lat: number; lon: number } | null = null;
  const unsubs: Array<() => void> = [];

  async function ensureStations(): Promise<void> {
    const cache = store.getTideConfig().stationsCache;
    if (cache && Date.now() - cache.fetchedAtMs < WEEK_MS && cache.stations.length > 0) {
      stations = cache.stations;
      return;
    }
    try {
      stations = await listStations(key!);
      await store.setTideConfig({
        ...store.getTideConfig(),
        stationsCache: { fetchedAtMs: Date.now(), stations },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[tide] station list fetch failed; using cache', e);
    }
  }

  function resolveActive(): Station | null {
    const cfg = store.getTideConfig();
    if (cfg.pinnedStationId) {
      return stations.find((s) => s.id === cfg.pinnedStationId) ?? active;
    }
    if (lastPos) return nearestStation(stations, lastPos, active);
    if (cfg.defaultStationId) return stations.find((s) => s.id === cfg.defaultStationId) ?? null;
    return active;
  }

  async function refreshEventsIfNeeded(): Promise<void> {
    const next = resolveActive();
    const today = Math.floor(Date.now() / DAY_MS);
    const changed = next?.id !== active?.id;
    if (next && (changed || today !== lastFetchDay)) {
      try {
        const fresh = await getTidalEvents(key!, next.id, 7);
        // Rolling cache: keep the most recent past event so heightNow can bracket "now".
        const now = Date.now();
        const pastKept = activeEvents.filter((e) => e.timeMs <= now).slice(-1);
        const merged = changed
          ? fresh
          : [...pastKept, ...fresh].sort((a, b) => a.timeMs - b.timeMs);
        // De-dup identical timestamps.
        activeEvents = merged.filter((e, i, arr) => i === 0 || e.timeMs !== arr[i - 1]!.timeMs);
        active = next;
        lastFetchDay = today;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[tide] events fetch failed; keeping cached', e);
        active = next;
      }
    } else if (next) {
      active = next;
    }
  }

  await ensureStations();

  unsubs.push(
    bus.subscribe(Channels.Nav.Position, (s) => {
      if (s.value.kind === 'geo') lastPos = { lat: s.value.value.lat, lon: s.value.value.lon };
    }),
  );

  const tick = async (): Promise<void> => {
    await refreshEventsIfNeeded();
    if (active && activeEvents.length > 0) {
      publishTideSnapshot(bus, active.name, activeEvents, Date.now());
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), TICK_MS);

  // eslint-disable-next-line no-console
  console.log('[tide] tide service online');
  return async () => {
    clearInterval(timer);
    for (const u of unsubs) u();
  };
}
```

(Remove the `KN_UNUSED` line — it's a placeholder to delete; if an unused-var lint fires, drop it.)

- [ ] **Step 4: Run, verify PASS:** `npx vitest run apps/g5000/src/tide-subsystem.test.ts`.

- [ ] **Step 5: Wire at boot** in `apps/g5000/src/index.ts`: add `import { startTideSubsystem } from './tide-subsystem.js';` near the other subsystem imports; after the groove subsystem start lines add:

```ts
const stopTideSubsystem = await startTideSubsystem({ bus, store });
teardown.push(stopTideSubsystem);
```

- [ ] **Step 6: Build + commit**

Run: `npx tsc -b apps/g5000` → clean (delete the `KN_UNUSED` line if it trips noUnusedLocals).

```bash
git add apps/g5000/src/tide-subsystem.ts apps/g5000/src/tide-subsystem.test.ts apps/g5000/src/index.ts
git commit -m "feat(tide): TideService bus publisher + boot wiring (graceful-off)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: /api/tide routes

**Files:**

- Create: `packages/web/src/app/api/tide/stations/route.ts`, `.../events/route.ts`, `.../active/route.ts`, `.../pin/route.ts`

These run in the Next server (same process); they read the shared `ConfigStore` (via the app's shared instance — find how other routes get it, e.g. `getSharedConfigStore()` from `@g5000/db`, used by existing routes) and call the Admiralty client server-side. FIRST read an existing route (e.g. `packages/web/src/app/api/settings/route.ts`) to copy the exact ConfigStore-access + response idiom.

- [ ] **Step 1: `stations/route.ts`** — return the cached station list (from `getTideConfig().stationsCache`), or `{ ok:false, error:'tide not configured' }` when the key is unset and no cache:

```ts
import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const store = getSharedConfigStore();
  const cache = store?.getTideConfig().stationsCache ?? null;
  if (!cache)
    return NextResponse.json(
      { ok: false, error: 'tide not configured or station list not yet loaded' },
      { status: 503 },
    );
  return NextResponse.json({ ok: true, stations: cache.stations });
}
```

(Adjust `getSharedConfigStore` to the real accessor used by sibling routes.)

- [ ] **Step 2: `events/route.ts`** — `GET ?stationId=…`; server-side fetch via `getTidalEvents` from `@g5000/tide` (the client lives there per Task 8), cached per (station, UTC day) in a module-level `Map`:

```ts
import { NextResponse } from 'next/server';
import { getTidalEvents } from '@g5000/tide';

export const dynamic = 'force-dynamic';
const cache = new Map<string, { day: number; events: unknown }>();

export async function GET(req: Request): Promise<NextResponse> {
  const key = process.env.ADMIRALTY_TIDAL_API_KEY;
  if (!key) return NextResponse.json({ ok: false, error: 'tide not configured' }, { status: 503 });
  const stationId = new URL(req.url).searchParams.get('stationId');
  if (!stationId)
    return NextResponse.json({ ok: false, error: 'stationId required' }, { status: 400 });
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(stationId);
  if (hit && hit.day === day) return NextResponse.json({ ok: true, events: hit.events });
  try {
    const events = await getTidalEvents(key, stationId, 7);
    cache.set(stationId, { day, events });
    return NextResponse.json({ ok: true, events });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
```

- [ ] **Step 3: `active/route.ts`** — `{ ok, stationId, name, pinned }` from `getTideConfig()` (pinned = `pinnedStationId != null`; resolve name from `stationsCache`).

- [ ] **Step 4: `pin/route.ts`** — `POST { stationId: string | null }` → `store.setTideConfig({ ...cfg, pinnedStationId })`, return `{ ok: true }`. Validate the body is a string or null.

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/web && npx tsc --noEmit` → clean.

```bash
git add packages/web/src/app/api/tide
git commit -m "feat(tide): /api/tide stations/events/active/pin routes (cached, server-side key)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: /tide page

**Files:**

- Create: `packages/web/src/app/tide/page.tsx`

- [ ] **Step 1: Read** an existing page that uses `fetch` + lists + a small SVG (e.g. `app/sessions/page.tsx`, `components/WindShiftPlot.tsx`) to match style.

- [ ] **Step 2: Implement `app/tide/page.tsx`** — a client component that:
  - Fetches `/api/tide/stations` (list) and `/api/tide/active` (current pin/active) on mount.
  - Has a station `<select>`/search filtered over the station list; a "nearest" note; on selection, fetches `/api/tide/events?stationId=…`.
  - Renders the 7-day HW/LW **table** (local time via `toLocaleString`, height `m`).
  - Renders an **SVG height curve** for the selected day window using `interpolateHeight` from `@g5000/tide` sampled every ~10 min between events, with a vertical "now" line and a label showing `heightNow` + `tideState` (import `tideSnapshot` from `@g5000/tide`).
  - **Pin** button → `POST /api/tide/pin {stationId}`; **Un-pin** → `POST {stationId:null}`; reflect `active.pinned`.
  - Labels: "Heights in metres above Chart Datum", "Approximate curve — not for under-keel clearance", "Free Discovery tier: 7-day horizon".
  - Graceful: if `/api/tide/stations` returns `503 not configured`, show "Tide API not configured — set ADMIRALTY_TIDAL_API_KEY."
    Use `@g5000/tide` (`interpolateHeight`, `tideSnapshot`, types) client-side for the curve — `packages/web` already depends on it (Task 1). Keep the SVG simple and consistent with `WindShiftPlot`.

- [ ] **Step 3: Build**

Run: `cd packages/web && npx tsc --noEmit` then `npm run build` → `/tide` in the route manifest.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/tide/page.tsx
git commit -m "feat(web): /tide planning page (table + curve + pin)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Mast formatter for tide channels + full build/test

**Files:**

- Modify: `packages/web/src/app/mast/format.ts` (+ its test)
- Modify: `docs/superpowers/specs/...` not needed

- [ ] **Step 1:** In `packages/web/src/app/mast/format.ts`, ensure the new `tide.*` channels render sensibly (the enum-passthrough added for groove already handles `tide.station`/`tide.state`/`tide.nextEventType`). For scalars, the unit-driven formatter already handles `m` (raw) and `s`. Add/confirm: `tide.heightNow`/`tide.nextEventHeight` show metres (1 dp); `tide.nextEventInSec` shows a countdown — if a generic seconds→"h:mm" rendering isn't already present, render seconds with 0 dp under `raw`. Add a test case in `format.test.ts` for a `tide.heightNow` scalar (m, 1 dp) and `tide.state` enum passthrough.

- [ ] **Step 2: Full workspace build + touched tests**

Run: `npx tsc -b` (whole workspace — must be exit 0; confirms the new `@g5000/tide` ref + db/apps/web all compile).
Run: `npx vitest run packages/tide apps/g5000/src/tide-subsystem.test.ts apps/g5000/src/tide/admiralty-client.test.ts packages/db/src/config-store.test.ts packages/web/src/app/mast/format.test.ts` → all pass.
Run: `cd packages/web && npm run build` → succeeds; `/tide` in manifest.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/mast/format.ts packages/web/src/app/mast/format.test.ts
git commit -m "feat(web): mast formatter support for tide.* channels

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- `@g5000/tide` pure package (curve/nearest/next-event/snapshot) → Tasks 1–5. ✅
- `tide.*` decomposed channels + mast-selectable → Task 6 (+ Task 12 formatter). ✅
- TideConfig (pinned/default/cache) → Task 7. ✅
- ADMIRALTY client + fixture-tested parsers, key server-side, isolated → Task 8 (client relocated to `@g5000/tide` per Task 10 path note so web can import it). ✅
- TideService (nearest/pin/hysteresis, daily fetch, rolling past-event cache, ~30 s tick, graceful-off) + boot → Task 9. ✅
- `/api/tide/*` routes (cached, server-side key) → Task 10. ✅
- `/tide` page (table, curve, pin, datum/approx/horizon labels, not-configured state) → Task 11. ✅
- Curve approximation + boundary (heightNow null with no bracket; rolling past-event) → Tasks 2, 9. ✅
- Testing per repo convention → every task's tests; full build Task 12. ✅
- Phase-0 deferred (build to documented shape, isolated parser, fixtures) → Task 8 note. ✅

**Placeholder scan:** Task 11 (the page) is described in concrete bullets + exact data sources/labels rather than a 150-line verbatim JSX dump, because it's standard fetch+list+SVG glue over already-defined APIs and the `@g5000/tide` curve fn — the implementer reads one existing page for style. Task 8's path note instructs **relocating `admiralty-client.ts` into `@g5000/tide`** so `packages/web` can import the fetchers (resolve this in Task 8; Task 9/10 import from `@g5000/tide`). The `KN_UNUSED` line in Task 9 is explicitly marked for deletion.

**Type consistency:** `Station`/`TidalEvent`/`TideState` defined once (Task 2), imported everywhere. `Channels.Tide.*` names (Task 6) match `publishTideSnapshot` (Task 9) and the formatter (Task 12). `TideConfig` shape (Task 7) matches `getTideConfig()`/`setTideConfig()` usage in Tasks 9–10. `tideSnapshot`/`nearestStation`/`getTidalEvents`/`listStations` signatures consistent across package, service, and routes.
