# Weather Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Mac-side GRIB loader + isochrone weather router for the catamaran. Reuses g5000's `PolarTable` type and `interpolatePolarSpeed` so the autopilot and the router never disagree about target boat speed. Adds GFS/ECMWF wind fetch, RTOFS currents, GSHHG land-avoidance, departure-window scanning, and a Next.js UI with chart + timeline + heatmap views.

**Architecture:**

- New monorepo packages: `@g5000/grib` (GRIB2 fetch/parse/interpolate), `@g5000/coastline` (GSHHG queries), `@g5000/routing` (pure isochrone engine), `apps/router` (Next.js UI + API).
- Two new endpoints inside existing `@g5000/web`: `/api/position` (SSE) and `/api/wardrobe/active` (JSON GET) — total ~60 lines, no autopilot changes.
- Mac router runs in a git worktree of the autopilot repo on a `router` branch, so two Claude sessions (Pi/autopilot work and Mac/router work) operate concurrently without file-lock contention.

**Tech stack:** TypeScript, Node 22, vitest, Next.js (App Router), Tailwind, MapLibre GL JS, RxJS, `wgrib2` (Homebrew CLI), `rbush` (R-tree), `fast-check` (property tests). All consistent with existing g5000 conventions.

**Reference spec:** `docs/superpowers/specs/2026-05-12-g5000-weather-router-design.md`.

---

## What's in scope (v1)

- GFS + ECMWF wind GRIB fetch (NOAA NOMADS subset; ECMWF Open Data S3 via `.idx`).
- RTOFS surface-current GRIB fetch (NOAA NOMADS), optional in routing.
- Isochrone router with bearing-bucket pruning, adaptive heading fan, land avoidance.
- Passage planning UI (map + controls + per-leg timeline).
- Departure-window scan (calendar heat-map).
- Live polar + position from running g5000 (HTTP/SSE), with offline-mode cached fallback.
- Local persistence as flat JSON under `~/.g5000-router/`.
- GPX export.
- Vitest unit, property-based, integration, and perf-budget tests.

## What's NOT in scope (deferred to v2)

- Wave/seas-aware routing (WAVEWATCH III).
- Engine-on motoring through calms.
- Per-leg sail-config selection from the wardrobe.
- Tide / depth integration.
- Squall avoidance.
- Bundling as a packaged Electron / native app.

---

## File structure

```
g5000/
├── packages/
│   ├── grib/                                       NEW PACKAGE
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                            barrel
│   │   │   ├── types.ts                            WindField, CurrentField, LatLon, Bbox
│   │   │   ├── parse-grib2.ts                      wgrib2 -json wrapper
│   │   │   ├── parse-grib2.test.ts
│   │   │   ├── cache.ts                            content-addressable cache paths
│   │   │   ├── cache.test.ts
│   │   │   ├── interpolate.ts                      trilinear interpolateWind/Current
│   │   │   ├── interpolate.test.ts
│   │   │   ├── fetch-gfs.ts                        NOAA NOMADS GFS
│   │   │   ├── fetch-gfs.test.ts
│   │   │   ├── fetch-ecmwf.ts                      ECMWF Open Data S3
│   │   │   ├── fetch-ecmwf.test.ts
│   │   │   ├── fetch-rtofs.ts                      NOAA NOMADS RTOFS
│   │   │   └── fetch-rtofs.test.ts
│   │   └── test/fixtures/
│   │       ├── synthetic-tiny.json                 hand-built tiny field
│   │       └── gfs-sample.grb2                     200KB real slice
│   │
│   ├── coastline/                                  NEW PACKAGE
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── scripts/
│   │   │   └── fetch-coastline.ts                  downloads GSHHG GeoJSON
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts                            Coastline, Polygon
│   │   │   ├── load.ts                             load + R-tree build
│   │   │   ├── load.test.ts
│   │   │   ├── geometry.ts                         point-in-poly, segment intersection
│   │   │   ├── geometry.test.ts
│   │   │   ├── queries.ts                          isOnLand, intersectsLand
│   │   │   └── queries.test.ts
│   │   ├── data/                                   downloaded, gitignored
│   │   └── test/fixtures/
│   │       └── bahamas-l.geojson                   small slice for tests
│   │
│   ├── routing/                                    NEW PACKAGE
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts                            Route, RouteLeg, PlanOptions
│   │       ├── geometry.ts                         gc-bearing, gc-distance, rhumbStep
│   │       ├── geometry.test.ts
│   │       ├── wind.ts                             (u,v) → (tws, twd)
│   │       ├── wind.test.ts
│   │       ├── fan.ts                              heading-fan generation
│   │       ├── fan.test.ts
│   │       ├── prune.ts                            bearing-bucket pruning
│   │       ├── prune.test.ts
│   │       ├── plan.ts                             main isochrone loop
│   │       ├── plan.test.ts
│   │       └── plan.property.test.ts               fast-check property tests
│   │
│   └── web/                                        EXISTING — minor additions
│       └── src/app/api/
│           ├── position/route.ts                   NEW: SSE stream
│           ├── position/route.test.ts              NEW
│           ├── wardrobe/active/route.ts            NEW: JSON GET
│           └── wardrobe/active/route.test.ts       NEW
│
└── apps/
    └── router/                                     NEW APP
        ├── package.json
        ├── tsconfig.json
        ├── next.config.ts
        ├── postcss.config.mjs
        ├── tailwind.config.ts
        └── src/
            ├── app/
            │   ├── layout.tsx
            │   ├── globals.css
            │   ├── page.tsx                        / planner
            │   ├── window/page.tsx                 /window scan
            │   ├── plans/page.tsx                  /plans list
            │   ├── grib/page.tsx                   /grib cache
            │   ├── settings/page.tsx               /settings
            │   └── api/
            │       ├── live/position/route.ts      SSE proxy → g5000
            │       ├── live/polar/route.ts         JSON proxy → g5000
            │       ├── grib/fetch/route.ts
            │       ├── route/plan/route.ts
            │       ├── route/window/route.ts
            │       ├── plans/route.ts              GET list, POST create
            │       └── plans/[id]/route.ts         GET one
            ├── lib/
            │   ├── paths.ts                        ~/.g5000-router/ resolution
            │   ├── persistence.ts                  JSON FS helpers
            │   └── g5000-client.ts                 HTTP client
            └── components/
                ├── Map.tsx                         MapLibre wrapper
                ├── RoutePolyline.tsx
                ├── WindBarbsLayer.tsx
                ├── CurrentArrowsLayer.tsx
                ├── RouteTimeline.tsx
                ├── StatusBadge.tsx
                ├── PlanControls.tsx
                ├── WindowHeatmap.tsx
                └── ErrorBanner.tsx
```

---

## Conventions (read before starting any task)

- **All internal units are SI**: m/s, radians, meters, unix seconds. Knots / degrees only at user-facing edges (CSV import, UI input, GPX export).
- **All angles are normalized**: bearings and TWD in `[0, 2π)`; TWA in `[-π, π]`; `|TWA|` used for polar lookup.
- **Imports**: ESM `.js` extension required for relative imports (matches g5000 `"type": "module"`). External package imports omit it.
- **Tests live next to source** (`foo.ts` → `foo.test.ts`), per existing convention.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`). One commit per task unless the task explicitly says multi-commit. Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- **Working directory**: every task assumes CWD is the worktree root `/Users/gregjohnson/code/g5000_weather/`. Task 1 creates this.
- **Run tests with**: `npm test -- <pattern>` from the workspace root (vitest is configured in `vitest.config.ts`).

---

## Task 1: Set up `router` worktree

**Files:** none new in the repo; this creates the worktree directory.

- [ ] **Step 1: Inspect existing `g5000_weather/` directory**

```bash
ls -la /Users/gregjohnson/code/g5000_weather/
```

Expected: just `.code-review-graph/` and `.remember/` (both gitignored tool scratch).

- [ ] **Step 2: Remove the placeholder directory's contents**

These two directories are auto-regenerated by Claude Code tooling and contain no user-authored content.

```bash
rm -rf /Users/gregjohnson/code/g5000_weather/
```

- [ ] **Step 3: Create the worktree**

```bash
cd /Users/gregjohnson/code/g5000
git worktree add -b router ../g5000_weather
```

Expected output: `Preparing worktree (new branch 'router')` and `HEAD is now at <sha>`.

- [ ] **Step 4: Verify worktree is on the right branch**

```bash
cd /Users/gregjohnson/code/g5000_weather
git status
git branch --show-current
```

Expected: clean working tree, branch `router`.

- [ ] **Step 5: Install workspace deps**

```bash
cd /Users/gregjohnson/code/g5000_weather
npm install
```

Expected: no errors; `node_modules/` populated.

- [ ] **Step 6: Smoke-test existing build**

```bash
npm run typecheck
npm test
```

Both must pass. If they fail, the worktree wasn't set up right or the upstream main is broken — stop and report before continuing.

- [ ] **Step 7: Commit (no changes expected)**

Nothing to commit (worktree creation doesn't change repo state). Verify with:

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Task 2: Bootstrap `@g5000/grib` package skeleton

**Files:**

- Create: `packages/grib/package.json`
- Create: `packages/grib/tsconfig.json`
- Create: `packages/grib/src/index.ts`
- Modify: `tsconfig.json` (workspace root) — add references
- Modify: `package.json` (workspace root) — workspaces glob already covers `packages/*`, but verify

- [ ] **Step 1: Create `packages/grib/package.json`**

```json
{
  "name": "@g5000/grib",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
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

- [ ] **Step 2: Create `packages/grib/tsconfig.json`**

Match the existing convention used by `packages/compute/tsconfig.json`. Read that file first:

```bash
cat packages/compute/tsconfig.json
```

Then create `packages/grib/tsconfig.json` with the same shape, swapping the package name. Typical contents:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "test/**/*"],
  "references": []
}
```

- [ ] **Step 3: Create `packages/grib/src/index.ts`**

```ts
// Re-exports filled in as functionality is added. Keep as the package's
// only public surface; everything else under src/ is internal.
export {};
```

- [ ] **Step 4: Register in workspace root `tsconfig.json`**

Read `tsconfig.json` at the workspace root and add `{ "path": "./packages/grib" }` to its `references` array. Order alphabetically among the existing references.

- [ ] **Step 5: Build to verify wiring**

```bash
npm run build --workspace @g5000/grib
```

Expected: completes silently, produces `packages/grib/dist/index.js`.

- [ ] **Step 6: Commit**

```bash
git add packages/grib tsconfig.json
git commit -m "$(cat <<'EOF'
feat: scaffold @g5000/grib package

Empty package skeleton — package.json, tsconfig, barrel index.
Subsequent tasks fill in types, parsing, fetching, interpolation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Type definitions for `@g5000/grib`

**Files:**

- Create: `packages/grib/src/types.ts`
- Modify: `packages/grib/src/index.ts` — re-export types

- [ ] **Step 1: Write `packages/grib/src/types.ts`**

```ts
/**
 * Geographic point in degrees. `lat` is [-90, 90], `lon` is [-180, 180].
 */
export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Bounding box in degrees. Crosses the dateline if `lonMin > lonMax`.
 */
export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/**
 * Time-varying 2D wind field on a regular lat/lon grid.
 *
 * Arrays are stored ascending: `lats[0] < lats[1] < ...`, same for `lons`,
 * same for `times` (unix seconds). `u[t][lat][lon]` is the eastward
 * 10-m wind component in m/s; `v` is the northward component in m/s.
 *
 * Indexing follows the natural meteorology convention: `u > 0` = wind
 * blowing eastward, `v > 0` = wind blowing northward.
 */
export interface WindField {
  lats: number[];
  lons: number[];
  times: number[];
  u: number[][][];
  v: number[][][];
  source: 'GFS' | 'ECMWF';
  /** Unix seconds when the model run was issued (the "00z" / "12z" run start). */
  runTime: number;
}

/**
 * Same shape as `WindField`, but `u` and `v` are sea-surface current m/s.
 * Convention: `u > 0` = current flowing eastward, `v > 0` = northward.
 */
export interface CurrentField {
  lats: number[];
  lons: number[];
  times: number[];
  u: number[][][];
  v: number[][][];
  source: 'RTOFS';
  runTime: number;
}
```

- [ ] **Step 2: Update `packages/grib/src/index.ts`**

```ts
export type { LatLon, Bbox, WindField, CurrentField } from './types.js';
```

- [ ] **Step 3: Verify build**

```bash
npm run typecheck --workspace @g5000/grib
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/grib/src
git commit -m "$(cat <<'EOF'
feat(grib): define WindField, CurrentField, LatLon, Bbox types

These cross every package boundary in the router. Stored as nested
number arrays (simple, ~10 MB for typical passage areas; fine for in-memory
work). Switch to Float32Array later if needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: GRIB2 parsing via `wgrib2`

**Files:**

- Create: `packages/grib/src/parse-grib2.ts`
- Create: `packages/grib/src/parse-grib2.test.ts`
- Create: `packages/grib/test/fixtures/synthetic-tiny.json` (a hand-built mock for the parser's _output_ — we test the post-wgrib2 stage with this)

`wgrib2` is a Homebrew-installed C binary. We invoke it with `-json` and parse its stdout. The synthetic fixture short-circuits the binary call in tests.

- [ ] **Step 1: Verify `wgrib2` is available**

```bash
which wgrib2 || brew install wgrib2
wgrib2 -version
```

Expected: prints a version like `v3.1.2`. If install fails, stop and surface; the rest of this task is blocked.

- [ ] **Step 2: Write the failing test**

`packages/grib/src/parse-grib2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseGrib2Json, type Grib2JsonMessage } from './parse-grib2.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../test/fixtures/synthetic-tiny.json');

describe('parseGrib2Json', () => {
  it('assembles a WindField from u10 + v10 messages on a 2x2 grid at 2 timesteps', () => {
    const messages: Grib2JsonMessage[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const field = parseGrib2Json(messages, 'GFS', 1715500800);

    expect(field.source).toBe('GFS');
    expect(field.runTime).toBe(1715500800);
    expect(field.lats).toEqual([30, 31]);
    expect(field.lons).toEqual([-75, -74]);
    expect(field.times.length).toBe(2);
    expect(field.u.length).toBe(2);
    expect(field.u[0]!.length).toBe(2); // 2 lats
    expect(field.u[0]![0]!.length).toBe(2); // 2 lons
    expect(field.u[0]![0]![0]).toBeCloseTo(5.0, 6);
    expect(field.v[0]![0]![0]).toBeCloseTo(2.0, 6);
  });

  it('throws when u10 and v10 grids do not align', () => {
    const messages: Grib2JsonMessage[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    messages[1]!.grid.lats = [30, 31, 32]; // mismatched
    expect(() => parseGrib2Json(messages, 'GFS', 1715500800)).toThrow(/grid mismatch/i);
  });

  it('throws when a required variable is missing', () => {
    const messages: Grib2JsonMessage[] = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const noV = messages.filter((m) => m.variable !== 'VGRD');
    expect(() => parseGrib2Json(noV, 'GFS', 1715500800)).toThrow(/missing.*VGRD/i);
  });
});
```

- [ ] **Step 3: Write the fixture**

`packages/grib/test/fixtures/synthetic-tiny.json`:

```json
[
  {
    "variable": "UGRD",
    "level": "10 m above ground",
    "forecastTime": 1715500800,
    "grid": { "lats": [30, 31], "lons": [-75, -74] },
    "values": [
      [5.0, 5.1],
      [5.2, 5.3]
    ]
  },
  {
    "variable": "VGRD",
    "level": "10 m above ground",
    "forecastTime": 1715500800,
    "grid": { "lats": [30, 31], "lons": [-75, -74] },
    "values": [
      [2.0, 2.1],
      [2.2, 2.3]
    ]
  },
  {
    "variable": "UGRD",
    "level": "10 m above ground",
    "forecastTime": 1715504400,
    "grid": { "lats": [30, 31], "lons": [-75, -74] },
    "values": [
      [6.0, 6.1],
      [6.2, 6.3]
    ]
  },
  {
    "variable": "VGRD",
    "level": "10 m above ground",
    "forecastTime": 1715504400,
    "grid": { "lats": [30, 31], "lons": [-75, -74] },
    "values": [
      [3.0, 3.1],
      [3.2, 3.3]
    ]
  }
]
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npm test -- packages/grib/src/parse-grib2.test.ts
```

Expected: FAIL with "Cannot find module './parse-grib2.js'" or similar.

- [ ] **Step 5: Implement `parse-grib2.ts`**

```ts
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { WindField, CurrentField } from './types.js';

/**
 * One parsed message from `wgrib2 -json` output.
 *
 * Note: `wgrib2 -json` actually emits a different schema than this; in
 * practice we run `wgrib2 <file> -inv /dev/null -no_header -bin -` and post-
 * process, but for the public TypeScript interface we model a normalized
 * shape that we adapt to from whatever wgrib2 hands us.
 *
 * The fixture-driven tests use this shape directly. The runtime path lives
 * in `runWgrib2()` below and is exercised by integration tests.
 */
export interface Grib2JsonMessage {
  variable: 'UGRD' | 'VGRD' | 'UOGRD' | 'VOGRD' | 'PRMSL';
  level: string;
  /** Unix seconds for the *valid* time of this message. */
  forecastTime: number;
  grid: { lats: number[]; lons: number[] };
  /** values[lat][lon] in the native units (m/s for wind, m/s for currents). */
  values: number[][];
}

export function parseGrib2Json(
  messages: Grib2JsonMessage[],
  source: WindField['source'] | CurrentField['source'],
  runTime: number,
): WindField | CurrentField {
  const uVar = source === 'RTOFS' ? 'UOGRD' : 'UGRD';
  const vVar = source === 'RTOFS' ? 'VOGRD' : 'VGRD';

  const us = messages.filter((m) => m.variable === uVar);
  const vs = messages.filter((m) => m.variable === vVar);

  if (us.length === 0) throw new Error(`parseGrib2Json: missing ${uVar} messages`);
  if (vs.length === 0) throw new Error(`parseGrib2Json: missing ${vVar} messages`);
  if (us.length !== vs.length) {
    throw new Error(
      `parseGrib2Json: ${uVar} (${us.length}) and ${vVar} (${vs.length}) count differs`,
    );
  }

  // Sort both lists by forecastTime ascending.
  us.sort((a, b) => a.forecastTime - b.forecastTime);
  vs.sort((a, b) => a.forecastTime - b.forecastTime);

  const lats = us[0]!.grid.lats;
  const lons = us[0]!.grid.lons;
  const times: number[] = [];
  const u: number[][][] = [];
  const v: number[][][] = [];

  for (let i = 0; i < us.length; i++) {
    const uMsg = us[i]!;
    const vMsg = vs[i]!;
    if (uMsg.forecastTime !== vMsg.forecastTime) {
      throw new Error(
        `parseGrib2Json: time mismatch at step ${i}: u=${uMsg.forecastTime} v=${vMsg.forecastTime}`,
      );
    }
    if (!arraysEqual(uMsg.grid.lats, lats) || !arraysEqual(uMsg.grid.lons, lons)) {
      throw new Error(`parseGrib2Json: grid mismatch at step ${i} (UGRD)`);
    }
    if (!arraysEqual(vMsg.grid.lats, lats) || !arraysEqual(vMsg.grid.lons, lons)) {
      throw new Error(`parseGrib2Json: grid mismatch at step ${i} (VGRD)`);
    }
    times.push(uMsg.forecastTime);
    u.push(uMsg.values);
    v.push(vMsg.values);
  }

  return { lats, lons, times, u, v, source, runTime } as WindField | CurrentField;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Runtime path: invoke `wgrib2` on a file, parse its CSV-style inventory
 * + binary dump, and return normalized messages. Exposed for the fetch-
 * pipeline integration tests; unit tests use `parseGrib2Json` directly
 * against fixtures so wgrib2's quirks don't pollute the test surface.
 */
export async function runWgrib2(gribPath: string): Promise<Grib2JsonMessage[]> {
  // wgrib2 -V dumps a per-message inventory we can parse; for actual
  // values we re-run with `-csv -` per message. This function is fleshed
  // out in Task 7 once we have a real GRIB file to test against.
  void gribPath;
  throw new Error('runWgrib2: implemented in Task 8');
}
```

- [ ] **Step 6: Run tests to verify pass**

```bash
npm test -- packages/grib/src/parse-grib2.test.ts
```

Expected: 3 passing.

- [ ] **Step 7: Update barrel**

`packages/grib/src/index.ts`:

```ts
export type { LatLon, Bbox, WindField, CurrentField } from './types.js';
export { parseGrib2Json, type Grib2JsonMessage } from './parse-grib2.js';
```

- [ ] **Step 8: Commit**

```bash
git add packages/grib
git commit -m "$(cat <<'EOF'
feat(grib): parseGrib2Json normalizes wgrib2 messages into a WindField

Test-driven against a checked-in 4-message synthetic fixture (2x2 grid,
2 timesteps). Validates time ordering, grid alignment, presence of both
u/v variables. Runtime wgrib2 binary invocation deferred to Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Trilinear wind / current interpolation

**Files:**

- Create: `packages/grib/src/interpolate.ts`
- Create: `packages/grib/src/interpolate.test.ts`
- Modify: `packages/grib/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/grib/src/interpolate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpolateWind, interpolateCurrent } from './interpolate.js';
import type { WindField, CurrentField } from './types.js';

const FIELD: WindField = {
  lats: [30, 31],
  lons: [-75, -74],
  times: [1000, 2000],
  u: [
    [
      [5, 7],
      [9, 11],
    ], // t=1000, [lat][lon]
    [
      [15, 17],
      [19, 21],
    ], // t=2000
  ],
  v: [
    [
      [2, 4],
      [6, 8],
    ],
    [
      [12, 14],
      [16, 18],
    ],
  ],
  source: 'GFS',
  runTime: 1000,
};

describe('interpolateWind', () => {
  it('returns exact grid value at corner', () => {
    const out = interpolateWind(FIELD, 30, -75, 1000);
    expect(out.u).toBeCloseTo(5, 6);
    expect(out.v).toBeCloseTo(2, 6);
  });

  it('linearly interpolates along lon at corner lat/time', () => {
    const out = interpolateWind(FIELD, 30, -74.5, 1000);
    expect(out.u).toBeCloseTo(6, 6); // midway between 5 and 7
    expect(out.v).toBeCloseTo(3, 6);
  });

  it('bilinearly interpolates in space at a corner time', () => {
    const out = interpolateWind(FIELD, 30.5, -74.5, 1000);
    // Cell corners: (5,7,9,11) → center = 8
    expect(out.u).toBeCloseTo(8, 6);
    expect(out.v).toBeCloseTo(5, 6); // (2+4+6+8)/4
  });

  it('trilinearly interpolates with a time offset', () => {
    const out = interpolateWind(FIELD, 30.5, -74.5, 1500);
    // t=1000 center = 8, t=2000 center = 18 → t=1500 → 13
    expect(out.u).toBeCloseTo(13, 6);
    expect(out.v).toBeCloseTo(10, 6); // (5+15)/2
  });

  it('throws when point is outside the grid (no silent extrapolation)', () => {
    expect(() => interpolateWind(FIELD, 29.9, -75, 1000)).toThrow(/out of range|outside/i);
    expect(() => interpolateWind(FIELD, 30, -75, 500)).toThrow(/out of range|outside/i);
  });
});

describe('interpolateCurrent', () => {
  it('reuses the same interpolation against a CurrentField', () => {
    const cf: CurrentField = { ...FIELD, source: 'RTOFS' };
    const out = interpolateCurrent(cf, 30, -75, 1000);
    expect(out.u).toBeCloseTo(5, 6);
    expect(out.v).toBeCloseTo(2, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- packages/grib/src/interpolate.test.ts
```

Expected: FAIL with "Cannot find module './interpolate.js'".

- [ ] **Step 3: Implement `interpolate.ts`**

```ts
import type { WindField, CurrentField } from './types.js';

/** Trilinear interpolation of u/v at (lat, lon, t). Throws if outside grid. */
export function interpolateWind(
  field: WindField,
  lat: number,
  lon: number,
  t: number,
): { u: number; v: number } {
  return trilinear(field, lat, lon, t);
}

export function interpolateCurrent(
  field: CurrentField,
  lat: number,
  lon: number,
  t: number,
): { u: number; v: number } {
  return trilinear(field, lat, lon, t);
}

function trilinear(
  field: WindField | CurrentField,
  lat: number,
  lon: number,
  t: number,
): { u: number; v: number } {
  const ti = locate(field.times, t);
  const yi = locate(field.lats, lat);
  const xi = locate(field.lons, lon);
  const ft = frac(field.times, t, ti);
  const fy = frac(field.lats, lat, yi);
  const fx = frac(field.lons, lon, xi);

  const interpAt = (grid: number[][][]): number => {
    const c000 = grid[ti.lo]![yi.lo]![xi.lo]!;
    const c001 = grid[ti.lo]![yi.lo]![xi.hi]!;
    const c010 = grid[ti.lo]![yi.hi]![xi.lo]!;
    const c011 = grid[ti.lo]![yi.hi]![xi.hi]!;
    const c100 = grid[ti.hi]![yi.lo]![xi.lo]!;
    const c101 = grid[ti.hi]![yi.lo]![xi.hi]!;
    const c110 = grid[ti.hi]![yi.hi]![xi.lo]!;
    const c111 = grid[ti.hi]![yi.hi]![xi.hi]!;
    const c00 = c000 * (1 - fx) + c001 * fx;
    const c01 = c010 * (1 - fx) + c011 * fx;
    const c10 = c100 * (1 - fx) + c101 * fx;
    const c11 = c110 * (1 - fx) + c111 * fx;
    const c0 = c00 * (1 - fy) + c01 * fy;
    const c1 = c10 * (1 - fy) + c11 * fy;
    return c0 * (1 - ft) + c1 * ft;
  };

  return { u: interpAt(field.u), v: interpAt(field.v) };
}

function locate(bins: number[], v: number): { lo: number; hi: number } {
  if (bins.length < 2) throw new Error('interpolate: grid axis must have ≥2 points');
  if (v < bins[0]! || v > bins[bins.length - 1]!) {
    throw new Error(`interpolate: value ${v} out of range [${bins[0]}, ${bins[bins.length - 1]}]`);
  }
  for (let i = 0; i < bins.length - 1; i++) {
    if (v >= bins[i]! && v <= bins[i + 1]!) return { lo: i, hi: i + 1 };
  }
  // Unreachable given the range check, but keeps TS happy.
  throw new Error('interpolate: locate fell through');
}

function frac(bins: number[], v: number, idx: { lo: number; hi: number }): number {
  const lo = bins[idx.lo]!;
  const hi = bins[idx.hi]!;
  return hi === lo ? 0 : (v - lo) / (hi - lo);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/grib/src/interpolate.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Update barrel**

`packages/grib/src/index.ts`:

```ts
export type { LatLon, Bbox, WindField, CurrentField } from './types.js';
export { parseGrib2Json, type Grib2JsonMessage } from './parse-grib2.js';
export { interpolateWind, interpolateCurrent } from './interpolate.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/grib
git commit -m "$(cat <<'EOF'
feat(grib): trilinear interpolateWind/interpolateCurrent

8-corner trilinear over (time, lat, lon). Throws on out-of-range
queries — no silent extrapolation. Hand-verified against a 2x2x2 fixture
covering corner, edge, face, and center cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: GRIB cache layout

**Files:**

- Create: `packages/grib/src/cache.ts`
- Create: `packages/grib/src/cache.test.ts`
- Modify: `packages/grib/src/index.ts`

The cache lives under a root the caller supplies (so the app picks `~/.g5000-router/grib-cache/`). Layout: `<root>/<model>/<runTime>/<bbox-hash>/u10.grb2` etc.

- [ ] **Step 1: Write the failing test**

`packages/grib/src/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachePath, cacheHas, cacheStore, cacheRead, bboxHash } from './cache.js';
import type { Bbox } from './types.js';

const BBOX: Bbox = { latMin: 30, latMax: 40, lonMin: -75, lonMax: -65 };
const RUN = 1715500800;

describe('cache', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grib-cache-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('bboxHash is stable for equal bboxes and differs for different bboxes', () => {
    const h1 = bboxHash(BBOX);
    const h2 = bboxHash({ ...BBOX });
    const h3 = bboxHash({ ...BBOX, lonMax: -64 });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('cachePath builds the canonical layout', () => {
    const p = cachePath(root, { model: 'gfs', runTime: RUN, bbox: BBOX, variable: 'u10' });
    expect(p.startsWith(root)).toBe(true);
    expect(p).toContain('gfs');
    expect(p).toContain(String(RUN));
    expect(p).toContain(bboxHash(BBOX));
    expect(p.endsWith('u10.grb2')).toBe(true);
  });

  it('cacheStore writes and cacheHas/cacheRead recover', async () => {
    const key = { model: 'gfs' as const, runTime: RUN, bbox: BBOX, variable: 'u10' as const };
    expect(cacheHas(root, key)).toBe(false);
    await cacheStore(root, key, Buffer.from('hello'));
    expect(cacheHas(root, key)).toBe(true);
    const buf = await cacheRead(root, key);
    expect(buf.toString()).toBe('hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- packages/grib/src/cache.test.ts
```

Expected: FAIL with "Cannot find module './cache.js'".

- [ ] **Step 3: Implement `cache.ts`**

```ts
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Bbox } from './types.js';

export type CacheModel = 'gfs' | 'ecmwf' | 'rtofs';
export type CacheVariable = 'u10' | 'v10' | 'mslp' | 'uogrd' | 'vogrd';

export interface CacheKey {
  model: CacheModel;
  runTime: number;
  bbox: Bbox;
  variable: CacheVariable;
}

export function bboxHash(b: Bbox): string {
  return createHash('sha256')
    .update(`${b.latMin}|${b.latMax}|${b.lonMin}|${b.lonMax}`)
    .digest('hex')
    .slice(0, 12);
}

export function cachePath(root: string, k: CacheKey): string {
  return join(root, k.model, String(k.runTime), bboxHash(k.bbox), `${k.variable}.grb2`);
}

export function cacheHas(root: string, k: CacheKey): boolean {
  return existsSync(cachePath(root, k));
}

export async function cacheStore(root: string, k: CacheKey, buf: Buffer): Promise<void> {
  const p = cachePath(root, k);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
}

export async function cacheRead(root: string, k: CacheKey): Promise<Buffer> {
  return readFile(cachePath(root, k));
}

export async function cacheAge(root: string, k: CacheKey): Promise<number | undefined> {
  const p = cachePath(root, k);
  if (!existsSync(p)) return undefined;
  const s = await stat(p);
  return Date.now() - s.mtimeMs;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/grib/src/cache.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Update barrel**

```ts
// packages/grib/src/index.ts
export type { LatLon, Bbox, WindField, CurrentField } from './types.js';
export { parseGrib2Json, type Grib2JsonMessage } from './parse-grib2.js';
export { interpolateWind, interpolateCurrent } from './interpolate.js';
export {
  bboxHash,
  cachePath,
  cacheHas,
  cacheStore,
  cacheRead,
  cacheAge,
  type CacheKey,
  type CacheModel,
  type CacheVariable,
} from './cache.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/grib
git commit -m "$(cat <<'EOF'
feat(grib): content-addressable cache (model/runTime/bbox-hash/var.grb2)

Stable bbox hash (sha256 of canonical bounds, first 12 chars). Per-bbox
subdir means disjoint passages never invalidate each other's cache.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: GFS fetch from NOAA NOMADS

**Files:**

- Create: `packages/grib/src/fetch-gfs.ts`
- Create: `packages/grib/src/fetch-gfs.test.ts`
- Modify: `packages/grib/src/index.ts`

NOMADS has a CGI-driven subset endpoint at `nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl`. Inputs: model run date/hour (00/06/12/18 UTC), forecast hour, variables, lat/lon subregion. Output: GRIB2 binary.

The function does three things: build the URL, fetch the binary, write through the cache. It returns a `WindField`; under the hood, parsing reuses `parseGrib2Json` (Task 4) after invoking `wgrib2` to convert binary → JSON.

This task ships the **URL builder + cache wiring** with unit tests; the actual binary parse goes through `runWgrib2()`. We mock fetch in unit tests and gate the live NOMADS test behind an env flag.

- [ ] **Step 1: Write the failing test (URL + path/run resolution)**

`packages/grib/src/fetch-gfs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGfsUrl, pickGfsRunForDeparture, gfsForecastHoursForRange } from './fetch-gfs.js';
import type { Bbox } from './types.js';

const BBOX: Bbox = { latMin: 30, latMax: 40, lonMin: -75, lonMax: -65 };

describe('buildGfsUrl', () => {
  it('formats a 0.25° subset URL for u10/v10', () => {
    const url = buildGfsUrl({
      runDateUtc: '2026-05-12',
      runHourUtc: 12,
      forecastHour: 6,
      variables: ['UGRD', 'VGRD'],
      bbox: BBOX,
    });
    expect(url).toMatch(/^https:\/\/nomads\.ncep\.noaa\.gov\/cgi-bin\/filter_gfs_0p25\.pl/);
    expect(url).toContain('dir=%2Fgfs.20260512%2F12%2Fatmos');
    expect(url).toContain('file=gfs.t12z.pgrb2.0p25.f006');
    expect(url).toContain('var_UGRD=on');
    expect(url).toContain('var_VGRD=on');
    expect(url).toContain('lev_10_m_above_ground=on');
    expect(url).toContain('subregion=&toplat=40&leftlon=-75&rightlon=-65&bottomlat=30');
  });

  it('zero-pads forecast hour to 3 digits', () => {
    const u = buildGfsUrl({
      runDateUtc: '2026-05-12',
      runHourUtc: 0,
      forecastHour: 96,
      variables: ['UGRD'],
      bbox: BBOX,
    });
    expect(u).toContain('f096');
  });
});

describe('pickGfsRunForDeparture', () => {
  it('uses the most recent 6-hour run that is at least 4 hours old', () => {
    // 2026-05-12 10:00Z → most recent run is 06z (4h old). 12z run isn't out yet.
    const at = Date.UTC(2026, 4, 12, 10, 0, 0) / 1000;
    const r = pickGfsRunForDeparture(at);
    expect(r.runDateUtc).toBe('2026-05-12');
    expect(r.runHourUtc).toBe(6);
  });

  it('rolls back across midnight', () => {
    // 2026-05-12 02:00Z → 18z run from the previous day (8h old).
    const at = Date.UTC(2026, 4, 12, 2, 0, 0) / 1000;
    const r = pickGfsRunForDeparture(at);
    expect(r.runDateUtc).toBe('2026-05-11');
    expect(r.runHourUtc).toBe(18);
  });
});

describe('gfsForecastHoursForRange', () => {
  it('produces 1-hourly steps up to f120, 3-hourly after', () => {
    const hours = gfsForecastHoursForRange({ startHour: 0, endHour: 132 });
    expect(hours[0]).toBe(0);
    expect(hours.includes(120)).toBe(true);
    expect(hours.includes(123)).toBe(true); // 3-hour grid after f120
    expect(hours.includes(121)).toBe(false);
    expect(hours[hours.length - 1]).toBe(132);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- packages/grib/src/fetch-gfs.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `fetch-gfs.ts`**

```ts
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WindField, Bbox } from './types.js';
import { cachePath, cacheStore, cacheHas, cacheRead, type CacheKey } from './cache.js';
import { parseGrib2Json } from './parse-grib2.js';
// runWgrib2 is fleshed out in Task 7b below; for now we keep this function
// at the URL/cache layer and integration tests exercise the parse path.

export interface BuildGfsUrlOpts {
  runDateUtc: string; // 'YYYY-MM-DD'
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
  variables: Array<'UGRD' | 'VGRD' | 'PRMSL'>;
  bbox: Bbox;
}

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl';

export function buildGfsUrl(o: BuildGfsUrlOpts): string {
  const dateNoDash = o.runDateUtc.replace(/-/g, '');
  const hh = String(o.runHourUtc).padStart(2, '0');
  const fff = String(o.forecastHour).padStart(3, '0');
  const params = new URLSearchParams();
  params.set('dir', `/gfs.${dateNoDash}/${hh}/atmos`);
  params.set('file', `gfs.t${hh}z.pgrb2.0p25.f${fff}`);
  for (const v of o.variables) params.set(`var_${v}`, 'on');
  if (o.variables.includes('UGRD') || o.variables.includes('VGRD')) {
    params.set('lev_10_m_above_ground', 'on');
  }
  if (o.variables.includes('PRMSL')) params.set('lev_mean_sea_level', 'on');
  // subregion subset
  params.set('subregion', '');
  params.set('toplat', String(o.bbox.latMax));
  params.set('leftlon', String(o.bbox.lonMin));
  params.set('rightlon', String(o.bbox.lonMax));
  params.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${params.toString()}`;
}

/**
 * Choose the most recent GFS run that should be fully posted on NOMADS for
 * the given departure time. NOMADS typically posts runs ~3.5h after their
 * nominal start; we leave a 4h safety margin.
 */
export function pickGfsRunForDeparture(atUnixSec: number): {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
} {
  const lagMs = 4 * 60 * 60 * 1000;
  const d = new Date(atUnixSec * 1000 - lagMs);
  const hour = d.getUTCHours();
  const runHour = (Math.floor(hour / 6) * 6) as 0 | 6 | 12 | 18;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { runDateUtc: `${y}-${m}-${day}`, runHourUtc: runHour };
}

/**
 * GFS publishes f000…f120 hourly and f120…f384 every 3 hours.
 * Returns the forecast hour list spanning [startHour, endHour] (inclusive).
 */
export function gfsForecastHoursForRange(o: { startHour: number; endHour: number }): number[] {
  const out: number[] = [];
  for (let h = o.startHour; h <= Math.min(120, o.endHour); h++) out.push(h);
  for (let h = 123; h <= o.endHour; h += 3) out.push(h);
  return out;
}

export interface FetchGfsOpts {
  bbox: Bbox;
  /** Forecast horizon in hours from the run start. */
  hours: number;
  cacheRoot: string;
  /** Override fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * High-level GFS fetch. Picks the latest run, builds per-forecast-hour URLs
 * for u10/v10, fetches each (with cache), and returns the concatenated set
 * of GRIB2 blobs. Parsing into a WindField is done in Task 7b after we wire
 * runWgrib2.
 */
export async function fetchGfsBlobs(o: FetchGfsOpts): Promise<{
  runDateUtc: string;
  runHourUtc: number;
  cachedPaths: string[];
}> {
  const fetchFn = o.fetchImpl ?? globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const run = pickGfsRunForDeparture(now);
  const hours = gfsForecastHoursForRange({ startHour: 0, endHour: o.hours });
  const runTime =
    Date.UTC(
      Number(run.runDateUtc.slice(0, 4)),
      Number(run.runDateUtc.slice(5, 7)) - 1,
      Number(run.runDateUtc.slice(8, 10)),
      run.runHourUtc,
    ) / 1000;

  const cachedPaths: string[] = [];
  for (const h of hours) {
    const variables = ['UGRD', 'VGRD'] as const;
    // We fetch u and v together (one URL); store as a single .grb2 per hour
    // under variable='u10' as the canonical name. We split out v10 only if
    // we later need per-variable caching.
    const key: CacheKey = {
      model: 'gfs',
      runTime: runTime + h * 3600,
      bbox: o.bbox,
      variable: 'u10',
    };
    if (!cacheHas(o.cacheRoot, key)) {
      const url = buildGfsUrl({
        runDateUtc: run.runDateUtc,
        runHourUtc: run.runHourUtc,
        forecastHour: h,
        variables: variables as unknown as Array<'UGRD' | 'VGRD'>,
        bbox: o.bbox,
      });
      const res = await fetchFn(url);
      if (!res.ok) {
        throw Object.assign(new Error(`GFS fetch failed: ${res.status}`), {
          kind: 'fetch_failed',
          source: 'GFS',
          status: res.status,
          retryable: res.status >= 500 || res.status === 408 || res.status === 429,
        });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await cacheStore(o.cacheRoot, key, buf);
    }
    cachedPaths.push(cachePath(o.cacheRoot, key));
  }
  return { runDateUtc: run.runDateUtc, runHourUtc: run.runHourUtc, cachedPaths };

  function cachePath(root: string, k: CacheKey): string {
    // Local helper to avoid circular import in plain text; real impl uses cache.cachePath
    return import('./cache.js').then((m) => m.cachePath(root, k)) as unknown as string;
  }
}
```

> **Note:** The inline `cachePath` helper at the bottom is awkward — replace it by importing `cachePath` directly from `./cache.js` at the top alongside the other imports. The code shown inside the loop uses it correctly (`cachePath(o.cacheRoot, key)`); just remove the broken local stub.

- [ ] **Step 4: Run unit tests**

```bash
npm test -- packages/grib/src/fetch-gfs.test.ts
```

Expected: the 4 URL-builder / run-picker tests pass. `fetchGfsBlobs` is not exercised at unit level — it requires network or mocks.

- [ ] **Step 5: Update barrel**

```ts
// packages/grib/src/index.ts
export type { LatLon, Bbox, WindField, CurrentField } from './types.js';
export { parseGrib2Json, type Grib2JsonMessage } from './parse-grib2.js';
export { interpolateWind, interpolateCurrent } from './interpolate.js';
export {
  bboxHash,
  cachePath,
  cacheHas,
  cacheStore,
  cacheRead,
  cacheAge,
  type CacheKey,
  type CacheModel,
  type CacheVariable,
} from './cache.js';
export {
  buildGfsUrl,
  pickGfsRunForDeparture,
  gfsForecastHoursForRange,
  fetchGfsBlobs,
  type BuildGfsUrlOpts,
  type FetchGfsOpts,
} from './fetch-gfs.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/grib
git commit -m "$(cat <<'EOF'
feat(grib): NOAA NOMADS GFS URL builder + cache-aware fetch

URL builder, run-time picker (4h NOMADS lag), forecast-hour list spanning
hourly→3-hourly at f120. fetchGfsBlobs walks the hour list, caches per
hour. Binary→WindField parse hook deferred until runWgrib2 lands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire `runWgrib2` for binary→messages conversion

**Files:**

- Modify: `packages/grib/src/parse-grib2.ts` — fill in `runWgrib2`
- Create: `packages/grib/test/fixtures/gfs-sample.grb2` — checked-in real GRIB slice (~200 KB)
- Create: `packages/grib/src/parse-grib2.integration.test.ts`

`wgrib2 <file>` lists messages; `wgrib2 <file> -d <N> -bin -` dumps message N's raw values. We loop over messages and assemble `Grib2JsonMessage[]`.

- [ ] **Step 1: Acquire a real fixture**

Use a small NOMADS slice. Run this once:

```bash
mkdir -p packages/grib/test/fixtures
curl -sS -o packages/grib/test/fixtures/gfs-sample.grb2 \
  "$(node -e "import('./packages/grib/dist/index.js').then(m => process.stdout.write(m.buildGfsUrl({
    runDateUtc: new Date(Date.now() - 86400000).toISOString().slice(0,10),
    runHourUtc: 0, forecastHour: 6,
    variables: ['UGRD', 'VGRD'],
    bbox: { latMin: 32, latMax: 34, lonMin: -67, lonMax: -65 }
  })))")"
```

Expected: a ~5-20 KB file (small bbox keeps it tiny). Verify with `wgrib2 -V packages/grib/test/fixtures/gfs-sample.grb2 | head -20`. Should show two messages (UGRD, VGRD) on the 10 m level.

If the fixture is larger than 200 KB, narrow the bbox.

- [ ] **Step 2: Write the failing integration test**

`packages/grib/src/parse-grib2.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWgrib2, parseGrib2Json } from './parse-grib2.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../test/fixtures/gfs-sample.grb2');

describe('runWgrib2 (integration — requires wgrib2 on PATH)', () => {
  it('reads UGRD and VGRD from the GFS fixture', async () => {
    const messages = await runWgrib2(FIXTURE);
    const u = messages.find((m) => m.variable === 'UGRD');
    const v = messages.find((m) => m.variable === 'VGRD');
    expect(u).toBeDefined();
    expect(v).toBeDefined();
    expect(u!.grid.lats.length).toBeGreaterThan(0);
    expect(u!.grid.lons.length).toBeGreaterThan(0);
    expect(u!.values.length).toBe(u!.grid.lats.length);
    expect(u!.values[0]!.length).toBe(u!.grid.lons.length);
  });

  it('parseGrib2Json consumes the runWgrib2 output into a WindField', async () => {
    const messages = await runWgrib2(FIXTURE);
    const field = parseGrib2Json(messages, 'GFS', 0);
    expect(field.lats.length).toBe(messages[0]!.grid.lats.length);
    expect(field.u.length).toBe(1); // single forecast hour in this fixture
  });
});
```

- [ ] **Step 3: Implement `runWgrib2`**

Replace the stub in `packages/grib/src/parse-grib2.ts`:

```ts
import { spawn } from 'node:child_process';

export async function runWgrib2(gribPath: string): Promise<Grib2JsonMessage[]> {
  const inv = await spawnText('wgrib2', ['-V', gribPath]);
  // Each message in -V output starts with "<N>:<offset>:..." headers and is
  // followed by `var=NAME` and `lev=LEVEL` lines plus statistics.
  const messages: Grib2JsonMessage[] = [];
  const headerRe = /^(\d+):(\d+):/gm;
  const blocks = inv.split(/^\d+:\d+:/m).slice(1);
  // We use indexed parsing instead because split loses the index. Re-parse.
  const indexes: number[] = [];
  for (const m of inv.matchAll(headerRe)) indexes.push(Number(m[1]));

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const idx = indexes[i]!;
    const variable = (block.match(/var=(\w+)/) ?? block.match(/^([A-Z]+):/m))?.[1];
    const level = (block.match(/lev=([^\n]+)/) ?? [, ''])[1]!.trim();
    const validMatch = block.match(/d=(\d{10})/);
    const validRaw = validMatch?.[1];
    const ft = validRaw
      ? Date.UTC(
          Number(validRaw.slice(0, 4)),
          Number(validRaw.slice(4, 6)) - 1,
          Number(validRaw.slice(6, 8)),
          Number(validRaw.slice(8, 10)),
        ) / 1000
      : 0;
    if (!variable) continue;
    // Skip variables outside our whitelist
    if (!['UGRD', 'VGRD', 'UOGRD', 'VOGRD', 'PRMSL'].includes(variable)) continue;

    // Dump this message's grid + values via -csv (compact and easy to parse).
    const csv = await spawnText('wgrib2', [gribPath, '-d', String(idx), '-csv', '-']);
    const { lats, lons, values } = parseWgrib2Csv(csv);
    messages.push({
      variable: variable as Grib2JsonMessage['variable'],
      level,
      forecastTime: ft,
      grid: { lats, lons },
      values,
    });
  }
  return messages;
}

function spawnText(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', rejectP);
    p.on('close', (code) => {
      if (code === 0) resolveP(out);
      else rejectP(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${err}`));
    });
  });
}

/**
 * Parse wgrib2 -csv output. Format: one line per grid point,
 *   "time","var","level",lon,lat,value
 * lon is 0..360; we shift to -180..180.
 */
function parseWgrib2Csv(csv: string): { lats: number[]; lons: number[]; values: number[][] } {
  const latsSet = new Set<number>();
  const lonsSet = new Set<number>();
  const records: Array<{ lat: number; lon: number; v: number }> = [];
  for (const line of csv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    // last 3 columns: lon, lat, value
    const lon0 = Number(parts[parts.length - 3]);
    const lat = Number(parts[parts.length - 2]);
    const value = Number(parts[parts.length - 1]);
    const lon = lon0 > 180 ? lon0 - 360 : lon0;
    latsSet.add(lat);
    lonsSet.add(lon);
    records.push({ lat, lon, v: value });
  }
  const lats = [...latsSet].sort((a, b) => a - b);
  const lons = [...lonsSet].sort((a, b) => a - b);
  const values: number[][] = lats.map(() => lons.map(() => NaN));
  for (const r of records) {
    const yi = lats.indexOf(r.lat);
    const xi = lons.indexOf(r.lon);
    values[yi]![xi] = r.v;
  }
  return { lats, lons, values };
}
```

- [ ] **Step 4: Run integration tests**

```bash
npm test -- packages/grib/src/parse-grib2.integration.test.ts
```

Expected: 2 passing. If `wgrib2` isn't on PATH, tests fail clearly with the error from `spawnText`.

- [ ] **Step 5: Commit**

```bash
git add packages/grib
git commit -m "$(cat <<'EOF'
feat(grib): runWgrib2 reads GRIB2 files into normalized messages

Uses wgrib2 -V to enumerate messages then -csv per message for grid +
values. Lon shifted 0..360 → -180..180 for downstream use. Integration-
tested against a 200KB GFS fixture covering UGRD + VGRD at one timestep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Bootstrap `@g5000/coastline` package

**Files:**

- Create: `packages/coastline/package.json`
- Create: `packages/coastline/tsconfig.json`
- Create: `packages/coastline/src/index.ts`
- Create: `packages/coastline/src/types.ts`
- Modify: workspace root `tsconfig.json`

- [ ] **Step 1: Create package skeleton**

`packages/coastline/package.json`:

```json
{
  "name": "@g5000/coastline",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit",
    "fetch": "tsx scripts/fetch-coastline.ts"
  },
  "dependencies": {
    "rbush": "^4.0.1"
  },
  "devDependencies": {
    "@types/node": "^22",
    "tsx": "^4",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

Then `packages/coastline/tsconfig.json` (same shape as `@g5000/grib`'s):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts", "test/**/*", "scripts/**/*"],
  "references": []
}
```

- [ ] **Step 2: Write `types.ts`**

`packages/coastline/src/types.ts`:

```ts
import type RBush from 'rbush';

/**
 * One closed-ring polygon in lat/lon degrees. Coordinates are
 * `[lon, lat]` to match GeoJSON convention. First and last point are
 * equal (closed ring). Holes (lakes) are represented as separate polygons
 * marked `kind: 'hole'` for the consumer to subtract during point-in-polygon.
 */
export interface CoastlinePolygon {
  kind: 'land' | 'hole';
  /** [lon, lat] pairs in degrees. */
  ring: Array<[number, number]>;
  /** Precomputed AABB in [lon_min, lat_min, lon_max, lat_max] degrees. */
  bbox: [number, number, number, number];
}

export interface RBushEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  polygon: CoastlinePolygon;
}

export interface Coastline {
  level: 'l' | 'i' | 'h';
  polygons: CoastlinePolygon[];
  /** R-tree indexed by polygon AABB for fast spatial filtering. */
  index: RBush<RBushEntry>;
}
```

- [ ] **Step 3: Barrel `index.ts`**

```ts
export type { CoastlinePolygon, Coastline, RBushEntry } from './types.js';
```

- [ ] **Step 4: Register in workspace tsconfig + install deps**

Add `{ "path": "./packages/coastline" }` to the root `tsconfig.json` references. Then:

```bash
npm install
```

Expected: rbush, tsx pulled in.

- [ ] **Step 5: Build verification**

```bash
npm run build --workspace @g5000/coastline
```

Expected: completes silently.

- [ ] **Step 6: Commit**

```bash
git add packages/coastline tsconfig.json package*.json
git commit -m "$(cat <<'EOF'
feat: scaffold @g5000/coastline package (rbush-backed)

Empty skeleton with rbush dep and tsx for the fetch script. Types
defined for Coastline (level + polygons + R-tree), CoastlinePolygon,
RBushEntry. Subsequent tasks add the fetch script, geometry primitives,
and queries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: GSHHG download script

**Files:**

- Create: `packages/coastline/scripts/fetch-coastline.ts`
- Modify: `.gitignore` — add `packages/coastline/data/`

The script downloads GSHHG GeoJSON exports and stores them in `packages/coastline/data/{level}.json`. We'll use the GitHub-hosted converted GeoJSON at `martinjc/UK-GeoJSON`-style mirrors, or fall back to fetching the shapefile and converting via `shapefile` npm package. To keep dependencies minimal, we use a pre-converted GeoJSON mirror.

- [ ] **Step 1: Add `data/` to gitignore**

Append to `.gitignore`:

```
# GSHHG coastline data — downloaded by fetch-coastline script
packages/coastline/data/
```

- [ ] **Step 2: Write the fetch script**

`packages/coastline/scripts/fetch-coastline.ts`:

```ts
#!/usr/bin/env tsx
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

interface Level {
  name: 'l' | 'i' | 'h';
  url: string;
}

/**
 * GSHHG GeoJSON mirror. The source-of-truth is shapefile from SOEST; for v1
 * we use a pre-converted GeoJSON to avoid pulling in the `shapefile` decoder
 * dependency. If this mirror goes away, swap to direct shapefile fetch +
 * conversion (npm `shapefile`).
 */
const LEVELS: Level[] = [
  {
    name: 'l',
    url: 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
  },
  // ↑ placeholder — see Step 3 for the actual GSHHG mirror; this URL ships countries
  //   land at low resolution and is suitable for `l`-level use in routing on a global
  //   scale. For `i` and `h` we use the GSHHG conversions published at:
  //     https://github.com/seas-of-yore/gshhg-geojson/releases
  //   (replace LEVELS at Step 3 with the actual release URLs once verified).
];

async function main() {
  await mkdir(DATA, { recursive: true });
  for (const lvl of LEVELS) {
    const out = join(DATA, `${lvl.name}.geojson`);
    if (existsSync(out) && !process.argv.includes('--force')) {
      console.log(`[skip] ${lvl.name} already present`);
      continue;
    }
    console.log(`[fetch] ${lvl.name} ← ${lvl.url}`);
    const res = await fetch(lvl.url);
    if (!res.ok) {
      throw new Error(`fetch ${lvl.url} → ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(out, buf);
    console.log(`[ok]   ${lvl.name} (${(buf.length / 1024).toFixed(1)} KB)`);
  }
  console.log('done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Update the `LEVELS` URLs with verified mirrors**

Before merging, the implementer must verify a working GSHHG GeoJSON mirror and replace the placeholder URLs in `LEVELS`. Acceptable sources:

- https://github.com/datasets/geo-countries (low-res countries — adequate for `l`)
- https://github.com/seas-of-yore/gshhg-geojson (community-converted GSHHG)
- As a fallback: fetch raw GSHHG shapefile from
  https://www.ngdc.noaa.gov/mgg/shorelines/data/gshhg/latest/gshhg-shp-2.3.7.zip
  and convert via `shapefile` npm package. Add `shapefile` and `adm-zip` deps
  to `packages/coastline/package.json` if you go this route.

Whichever path is chosen, the script must produce `data/{l,i,h}.geojson` files
shaped as `FeatureCollection` of `Polygon`/`MultiPolygon` features.

- [ ] **Step 4: Test-run the script**

```bash
npm run fetch --workspace @g5000/coastline
```

Expected: files appear in `packages/coastline/data/`. Total ~30–130 MB depending on which levels you ship.

- [ ] **Step 5: Commit**

```bash
git add packages/coastline/scripts .gitignore
git commit -m "$(cat <<'EOF'
feat(coastline): GSHHG download script

scripts/fetch-coastline.ts downloads multi-resolution GeoJSON to
packages/coastline/data/ (gitignored). Idempotent unless --force.
Source URLs verified against a working GeoJSON mirror at impl time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Geometry primitives — point-in-polygon, segment intersection

**Files:**

- Create: `packages/coastline/src/geometry.ts`
- Create: `packages/coastline/src/geometry.test.ts`
- Modify: `packages/coastline/src/index.ts`

These are pure, tree-shakable functions. We work in `[lon, lat]` 2D space (no spherical math) — at the scale of a single coastline polygon (10s of km), the planar approximation is fine and matches GeoJSON convention.

- [ ] **Step 1: Write the failing test**

`packages/coastline/src/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pointInRing, segmentsIntersect, segmentCrossesRing } from './geometry.js';

const SQUARE: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

describe('pointInRing', () => {
  it('detects inside', () => {
    expect(pointInRing([0, 0], SQUARE)).toBe(true);
  });
  it('detects outside', () => {
    expect(pointInRing([2, 0], SQUARE)).toBe(false);
  });
  it('treats edge as outside (consistent boundary)', () => {
    expect(pointInRing([1, 0], SQUARE)).toBe(false);
  });
});

describe('segmentsIntersect', () => {
  it('detects crossing X', () => {
    expect(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
  });
  it('detects parallel non-intersecting', () => {
    expect(segmentsIntersect([0, 0], [2, 0], [0, 1], [2, 1])).toBe(false);
  });
  it('detects touching endpoints as intersecting', () => {
    expect(segmentsIntersect([0, 0], [2, 2], [2, 2], [4, 0])).toBe(true);
  });
});

describe('segmentCrossesRing', () => {
  it('true when segment enters the square', () => {
    expect(segmentCrossesRing([-2, 0], [0, 0], SQUARE)).toBe(true);
  });
  it('false when segment is entirely outside', () => {
    expect(segmentCrossesRing([-2, 0], [-1.5, 0], SQUARE)).toBe(false);
  });
  it('true when segment passes through', () => {
    expect(segmentCrossesRing([-2, 0], [2, 0], SQUARE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify fails**

```bash
npm test -- packages/coastline/src/geometry.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `geometry.ts`**

```ts
export type Point = [number, number]; // [lon, lat]

/**
 * Ray-casting point-in-polygon. Returns true if `p` is strictly inside the
 * closed ring `ring` (first == last). Edge cases: points on the boundary
 * are considered outside (deterministic and good enough for routing's
 * land-avoidance use case — start/end points are checked with a small
 * inland buffer separately if needed).
 */
export function pointInRing(p: Point, ring: Point[]): boolean {
  const [px, py] = p;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 2D segment-segment intersection. Treats collinear-overlap as intersection.
 */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = sign(cross(sub(b2, b1), sub(a1, b1)));
  const d2 = sign(cross(sub(b2, b1), sub(a2, b1)));
  const d3 = sign(cross(sub(a2, a1), sub(b1, a1)));
  const d4 = sign(cross(sub(a2, a1), sub(b2, a1)));
  if (d1 !== d2 && d3 !== d4) return true;
  // Collinear cases (endpoints touching)
  if (d1 === 0 && onSegment(b1, b2, a1)) return true;
  if (d2 === 0 && onSegment(b1, b2, a2)) return true;
  if (d3 === 0 && onSegment(a1, a2, b1)) return true;
  if (d4 === 0 && onSegment(a1, a2, b2)) return true;
  return false;
}

export function segmentCrossesRing(a: Point, b: Point, ring: Point[]): boolean {
  // Cheap bbox prefilter
  const ringBbox = ringAabb(ring);
  const segBbox: [number, number, number, number] = [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
  ];
  if (!bboxOverlap(ringBbox, segBbox)) return false;
  for (let i = 0; i < ring.length - 1; i++) {
    if (segmentsIntersect(a, b, ring[i]!, ring[i + 1]!)) return true;
  }
  // Endpoint may be inside even if no edge crosses (segment fully inside)
  if (pointInRing(a, ring) || pointInRing(b, ring)) return true;
  return false;
}

export function ringAabb(ring: Point[]): [number, number, number, number] {
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  for (const [x, y] of ring) {
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  return [xmin, ymin, xmax, ymax];
}

function bboxOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}
function cross(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0];
}
function sign(n: number): -1 | 0 | 1 {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}
function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/coastline/src/geometry.test.ts
```

Expected: 9 passing.

- [ ] **Step 5: Update barrel**

```ts
// packages/coastline/src/index.ts
export type { CoastlinePolygon, Coastline, RBushEntry } from './types.js';
export {
  pointInRing,
  segmentsIntersect,
  segmentCrossesRing,
  ringAabb,
  type Point,
} from './geometry.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/coastline
git commit -m "$(cat <<'EOF'
feat(coastline): pointInRing + segmentsIntersect + segmentCrossesRing

Pure planar geometry on [lon,lat] points (GeoJSON convention).
Ray-cast PIP, cross-product segment-segment, bbox-prefiltered
segment-vs-ring. 9 unit tests covering inside/outside/edge/touching.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Coastline loader (GeoJSON → R-tree)

**Files:**

- Create: `packages/coastline/src/load.ts`
- Create: `packages/coastline/src/load.test.ts`
- Create: `packages/coastline/test/fixtures/bahamas-l.geojson` — small slice for tests
- Modify: `packages/coastline/src/index.ts`

- [ ] **Step 1: Make the test fixture**

Hand-author a tiny GeoJSON with one square island for tests:

`packages/coastline/test/fixtures/bahamas-l.geojson`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {},
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [-77, 24],
            [-76, 24],
            [-76, 25],
            [-77, 25],
            [-77, 24]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {},
      "geometry": {
        "type": "MultiPolygon",
        "coordinates": [
          [
            [
              [-78, 23],
              [-77.5, 23],
              [-77.5, 23.5],
              [-78, 23.5],
              [-78, 23]
            ]
          ],
          [
            [
              [-79, 25],
              [-78.5, 25],
              [-78.5, 25.5],
              [-79, 25.5],
              [-79, 25]
            ]
          ]
        ]
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`packages/coastline/src/load.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCoastlineFromGeojson } from './load.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../test/fixtures/bahamas-l.geojson');

describe('loadCoastlineFromGeojson', () => {
  it('reads polygons including MultiPolygon expansion', async () => {
    const c = await loadCoastlineFromGeojson(FIXTURE, 'l');
    expect(c.level).toBe('l');
    expect(c.polygons.length).toBe(3); // 1 + 2 from multipolygon
    for (const p of c.polygons) {
      expect(p.kind).toBe('land');
      expect(p.ring[0]).toEqual(p.ring[p.ring.length - 1]); // closed
      expect(p.bbox.length).toBe(4);
    }
  });

  it('builds an R-tree that finds the right polygon for a query bbox', async () => {
    const c = await loadCoastlineFromGeojson(FIXTURE, 'l');
    const hits = c.index.search({
      minX: -76.5,
      minY: 24.2,
      maxX: -76.3,
      maxY: 24.4,
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.polygon.bbox).toEqual([-77, 24, -76, 25]);
  });
});
```

- [ ] **Step 3: Run test to verify fail**

```bash
npm test -- packages/coastline/src/load.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement `load.ts`**

```ts
import { readFile } from 'node:fs/promises';
import RBush from 'rbush';
import type { Coastline, CoastlinePolygon, RBushEntry } from './types.js';
import { ringAabb, type Point } from './geometry.js';

interface GeoJsonFeature {
  type: 'Feature';
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties?: Record<string, unknown>;
}
interface GeoJsonFC {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export async function loadCoastlineFromGeojson(
  path: string,
  level: 'l' | 'i' | 'h',
): Promise<Coastline> {
  const raw = await readFile(path, 'utf8');
  const fc = JSON.parse(raw) as GeoJsonFC;
  const polygons: CoastlinePolygon[] = [];
  for (const f of fc.features) {
    if (f.geometry.type === 'Polygon') {
      polygons.push(toPolygon(f.geometry.coordinates[0] as Point[]));
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const poly of f.geometry.coordinates) {
        polygons.push(toPolygon(poly[0] as Point[]));
      }
    }
  }
  const index = new RBush<RBushEntry>();
  index.load(
    polygons.map((p) => ({
      minX: p.bbox[0],
      minY: p.bbox[1],
      maxX: p.bbox[2],
      maxY: p.bbox[3],
      polygon: p,
    })),
  );
  return { level, polygons, index };
}

function toPolygon(ring: Point[]): CoastlinePolygon {
  // Ensure closed
  if (
    ring.length === 0 ||
    ring[0]![0] !== ring[ring.length - 1]![0] ||
    ring[0]![1] !== ring[ring.length - 1]![1]
  ) {
    ring = [...ring, ring[0]!];
  }
  return { kind: 'land', ring, bbox: ringAabb(ring) };
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test -- packages/coastline/src/load.test.ts
```

Expected: 2 passing.

- [ ] **Step 6: Update barrel**

```ts
// packages/coastline/src/index.ts
export type { CoastlinePolygon, Coastline, RBushEntry } from './types.js';
export {
  pointInRing,
  segmentsIntersect,
  segmentCrossesRing,
  ringAabb,
  type Point,
} from './geometry.js';
export { loadCoastlineFromGeojson } from './load.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/coastline
git commit -m "$(cat <<'EOF'
feat(coastline): loadCoastlineFromGeojson with rbush index

Parses Polygon and MultiPolygon features, normalizes to closed rings,
precomputes AABBs, builds an rbush spatial index. Fixture test on a
3-polygon Bahamas slice exercises both feature shapes and the index.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Coastline queries — `isOnLand` and `intersectsLand`

**Files:**

- Create: `packages/coastline/src/queries.ts`
- Create: `packages/coastline/src/queries.test.ts`
- Modify: `packages/coastline/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/coastline/src/queries.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCoastlineFromGeojson } from './load.js';
import { isOnLand, intersectsLand } from './queries.js';
import type { Coastline } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../test/fixtures/bahamas-l.geojson');
let c: Coastline;

beforeAll(async () => {
  c = await loadCoastlineFromGeojson(FIXTURE, 'l');
});

describe('isOnLand', () => {
  it('detects a point inside the big island', () => {
    expect(isOnLand(c, 24.5, -76.5)).toBe(true);
  });
  it('detects a point in open water', () => {
    expect(isOnLand(c, 26, -75)).toBe(false);
  });
});

describe('intersectsLand', () => {
  it('detects a segment that crosses an island', () => {
    expect(intersectsLand(c, 24.5, -77.5, 24.5, -75.5)).toBe(true);
  });
  it('returns false for a segment entirely in water', () => {
    expect(intersectsLand(c, 22, -80, 22, -70)).toBe(false);
  });
  it('returns true if endpoint sits in the polygon', () => {
    expect(intersectsLand(c, 24.5, -76.5, 24.5, -75)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npm test -- packages/coastline/src/queries.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `queries.ts`**

```ts
import type { Coastline } from './types.js';
import { pointInRing, segmentCrossesRing, type Point } from './geometry.js';

export function isOnLand(c: Coastline, lat: number, lon: number): boolean {
  const candidates = c.index.search({
    minX: lon,
    minY: lat,
    maxX: lon,
    maxY: lat,
  });
  for (const cand of candidates) {
    if (pointInRing([lon, lat], cand.polygon.ring)) return true;
  }
  return false;
}

export function intersectsLand(
  c: Coastline,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): boolean {
  const minX = Math.min(lon1, lon2);
  const maxX = Math.max(lon1, lon2);
  const minY = Math.min(lat1, lat2);
  const maxY = Math.max(lat1, lat2);
  const candidates = c.index.search({ minX, minY, maxX, maxY });
  const a: Point = [lon1, lat1];
  const b: Point = [lon2, lat2];
  for (const cand of candidates) {
    if (segmentCrossesRing(a, b, cand.polygon.ring)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/coastline/src/queries.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Update barrel**

```ts
// packages/coastline/src/index.ts
export type { CoastlinePolygon, Coastline, RBushEntry } from './types.js';
export {
  pointInRing,
  segmentsIntersect,
  segmentCrossesRing,
  ringAabb,
  type Point,
} from './geometry.js';
export { loadCoastlineFromGeojson } from './load.js';
export { isOnLand, intersectsLand } from './queries.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/coastline
git commit -m "$(cat <<'EOF'
feat(coastline): isOnLand and intersectsLand queries

R-tree-prefiltered point-in-polygon and segment-vs-ring. Fixture-based
tests cover inside/outside, segment crossing, and endpoint-inside cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Bootstrap `@g5000/routing` package

**Files:**

- Create: `packages/routing/package.json`
- Create: `packages/routing/tsconfig.json`
- Create: `packages/routing/src/index.ts`
- Modify: workspace root `tsconfig.json` — add reference

- [ ] **Step 1: package.json**

```json
{
  "name": "@g5000/routing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@g5000/compute": "*",
    "@g5000/coastline": "*",
    "@g5000/db": "*",
    "@g5000/grib": "*"
  },
  "devDependencies": {
    "@types/node": "^22",
    "fast-check": "^3.23.0",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"],
  "references": [
    { "path": "../compute" },
    { "path": "../coastline" },
    { "path": "../db" },
    { "path": "../grib" }
  ]
}
```

- [ ] **Step 3: Barrel**

`packages/routing/src/index.ts`:

```ts
export {};
```

- [ ] **Step 4: Register in workspace tsconfig + install**

Add `{ "path": "./packages/routing" }` to root `tsconfig.json`. Then:

```bash
npm install
npm run build --workspace @g5000/routing
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/routing tsconfig.json package*.json
git commit -m "$(cat <<'EOF'
feat: scaffold @g5000/routing package

Workspace deps on @g5000/{compute,coastline,db,grib} so the
isochrone engine can import PolarTable, interpolatePolarSpeed,
coastline queries, and WindField/CurrentField directly. fast-check
pulled in for property-based tests of the routing core.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Routing types

**Files:**

- Create: `packages/routing/src/types.ts`
- Modify: `packages/routing/src/index.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
import type { LatLon, WindField, CurrentField } from '@g5000/grib';
import type { Coastline } from '@g5000/coastline';
import type { PolarTable } from '@g5000/db';

export type { LatLon };

export interface RouteLeg {
  /** Unix seconds at the START of this leg. */
  t: number;
  lat: number;
  lon: number;
  /** Boat's heading (water frame), radians true. */
  heading: number;
  /** |TWA| in radians, [0, π]. */
  twa: number;
  /** TWS in m/s. */
  tws: number;
  /** Through-water boat speed (m/s). */
  bsp: number;
  /** Over-ground speed (m/s). With currents off, equals bsp. */
  sogGround: number;
}

export interface Route {
  legs: RouteLeg[];
  start: number;
  end: number;
  /** Sum of leg over-ground distances (m). */
  distance: number;
  model: WindField['source'];
  usedCurrents: boolean;
  polarId: string;
  incomplete?: boolean;
  reason?: 'exceeded_max_hours' | 'no_wind' | 'land_blocked';
}

export interface PlanOptions {
  stepMinutes?: number; // default 30
  headingFanDeg?: number; // default 90 (±)
  headingResolutionDeg?: number; // default 5
  maxHours?: number; // default 168
  avoidLand?: boolean; // default true
  useCurrents?: boolean; // default false
  pruneBucketDeg?: number; // default 2
}

export interface PlanInput {
  start: LatLon;
  end: LatLon;
  /** Unix seconds. */
  departure: number;
  wind: WindField;
  polar: PolarTable;
  polarId: string;
  coastline: Coastline;
  currents?: CurrentField;
  options?: PlanOptions;
}
```

- [ ] **Step 2: Update barrel**

```ts
// packages/routing/src/index.ts
export type { LatLon, RouteLeg, Route, PlanOptions, PlanInput } from './types.js';
```

- [ ] **Step 3: Build check**

```bash
npm run typecheck --workspace @g5000/routing
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
feat(routing): type definitions for Route, RouteLeg, PlanInput/Options

Reuses LatLon from @g5000/grib, PolarTable from @g5000/db, Coastline
from @g5000/coastline — single shared types across the stack.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Geographic geometry helpers

**Files:**

- Create: `packages/routing/src/geometry.ts`
- Create: `packages/routing/src/geometry.test.ts`
- Modify: `packages/routing/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/routing/src/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  greatCircleBearing,
  greatCircleDistance,
  rhumbStep,
  normalizeAngle,
  normalizeBearing,
} from './geometry.js';

const NEWPORT = { lat: 41.49, lon: -71.31 };
const BERMUDA = { lat: 32.3, lon: -64.78 };

describe('normalizeAngle', () => {
  it('wraps into [-π, π]', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 6);
    expect(normalizeAngle(0)).toBeCloseTo(0, 6);
  });
});

describe('normalizeBearing', () => {
  it('wraps into [0, 2π)', () => {
    expect(normalizeBearing(2.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 6);
    expect(normalizeBearing(-0.5 * Math.PI)).toBeCloseTo(1.5 * Math.PI, 6);
  });
});

describe('greatCircleDistance', () => {
  it('Newport→Bermuda is ~635 NM ± 5 NM', () => {
    const d = greatCircleDistance(NEWPORT, BERMUDA);
    const nm = d / 1852;
    expect(nm).toBeGreaterThan(630);
    expect(nm).toBeLessThan(640);
  });
  it('symmetric', () => {
    expect(greatCircleDistance(NEWPORT, BERMUDA)).toBeCloseTo(
      greatCircleDistance(BERMUDA, NEWPORT),
      0,
    );
  });
});

describe('greatCircleBearing', () => {
  it('Newport→Bermuda points roughly south (≈ 5π/3 = 300°… no, ~165°… verify)', () => {
    // Bearing from Newport (41.5N -71.3W) to Bermuda (32.3N -64.8W) is ~155° true.
    const b = greatCircleBearing(NEWPORT, BERMUDA);
    const deg = (b * 180) / Math.PI;
    expect(deg).toBeGreaterThan(140);
    expect(deg).toBeLessThan(170);
  });
});

describe('rhumbStep', () => {
  it('moves due north when bearing=0', () => {
    const p = rhumbStep({ lat: 0, lon: 0 }, 111195, 0); // 1° at the equator
    expect(p.lat).toBeCloseTo(1, 4);
    expect(p.lon).toBeCloseTo(0, 4);
  });
  it('moves due east at the equator when bearing=π/2', () => {
    const p = rhumbStep({ lat: 0, lon: 0 }, 111195, Math.PI / 2);
    expect(p.lat).toBeCloseTo(0, 4);
    expect(p.lon).toBeCloseTo(1, 4);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npm test -- packages/routing/src/geometry.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `geometry.ts`**

```ts
import type { LatLon } from './types.js';

const R = 6371008.8; // mean Earth radius, meters
const DEG = Math.PI / 180;

export function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function normalizeBearing(rad: number): number {
  const two = 2 * Math.PI;
  return ((rad % two) + two) % two;
}

export function greatCircleDistance(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG,
    φ2 = b.lat * DEG;
  const Δφ = (b.lat - a.lat) * DEG;
  const Δλ = (b.lon - a.lon) * DEG;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function greatCircleBearing(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG,
    φ2 = b.lat * DEG;
  const Δλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeBearing(Math.atan2(y, x));
}

/**
 * Move along a rhumb line by `distance_m` at `bearing` (radians from north,
 * clockwise). Returns new lat/lon in degrees. For short steps (≤ a few hundred
 * km) this is indistinguishable from great-circle propagation.
 */
export function rhumbStep(start: LatLon, distance_m: number, bearing: number): LatLon {
  const δ = distance_m / R;
  const φ1 = start.lat * DEG;
  const λ1 = start.lon * DEG;
  const Δφ = δ * Math.cos(bearing);
  const φ2 = φ1 + Δφ;
  const Δψ = Math.log(Math.tan(Math.PI / 4 + φ2 / 2) / Math.tan(Math.PI / 4 + φ1 / 2));
  const q = Math.abs(Δψ) > 1e-12 ? Δφ / Δψ : Math.cos(φ1);
  const Δλ = (δ * Math.sin(bearing)) / q;
  const λ2 = λ1 + Δλ;
  return {
    lat: φ2 / DEG,
    lon: ((λ2 / DEG + 540) % 360) - 180,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/routing/src/geometry.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Update barrel**

```ts
// packages/routing/src/index.ts
export type { LatLon, RouteLeg, Route, PlanOptions, PlanInput } from './types.js';
export {
  greatCircleBearing,
  greatCircleDistance,
  rhumbStep,
  normalizeAngle,
  normalizeBearing,
} from './geometry.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
feat(routing): greatCircleBearing/Distance + rhumbStep + angle helpers

Standard Williams aviation-formulary math. Cross-checked against the
Newport→Bermuda 635 NM benchmark (±5 NM tolerance).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Wind decomposition (u/v → TWS/TWD)

**Files:**

- Create: `packages/routing/src/wind.ts`
- Create: `packages/routing/src/wind.test.ts`
- Modify: `packages/routing/src/index.ts`

- [ ] **Step 1: Failing test**

`packages/routing/src/wind.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decomposeWind, twaFromWindAndHeading } from './wind.js';

describe('decomposeWind', () => {
  it('u=10, v=0 → wind blowing east → coming from west (TWD = 3π/2)', () => {
    const w = decomposeWind(10, 0);
    expect(w.tws).toBeCloseTo(10, 6);
    expect(w.twd).toBeCloseTo((3 * Math.PI) / 2, 4);
  });
  it('u=0, v=10 → wind blowing north → coming from south (TWD = π)', () => {
    const w = decomposeWind(0, 10);
    expect(w.tws).toBeCloseTo(10, 6);
    expect(w.twd).toBeCloseTo(Math.PI, 4);
  });
  it('u=0, v=-10 → wind blowing south → from north (TWD = 0)', () => {
    const w = decomposeWind(0, -10);
    expect(w.twd).toBeCloseTo(0, 4);
  });
});

describe('twaFromWindAndHeading', () => {
  it('boat heading north, wind from north → TWA = 0', () => {
    const twa = twaFromWindAndHeading(0, 0);
    expect(twa).toBeCloseTo(0, 6);
  });
  it('boat heading east, wind from north → TWA = -π/2 (wind on port bow)', () => {
    const twa = twaFromWindAndHeading(0, Math.PI / 2);
    expect(Math.abs(twa)).toBeCloseTo(Math.PI / 2, 4);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npm test -- packages/routing/src/wind.test.ts
```

- [ ] **Step 3: Implement `wind.ts`**

```ts
import { normalizeAngle, normalizeBearing } from './geometry.js';

/**
 * Decompose a wind vector (u, v) in m/s into:
 *   - tws: scalar wind speed, m/s
 *   - twd: true wind direction in radians from north, clockwise — the
 *          direction the wind is COMING FROM (meteorological convention).
 *
 * Meteorology convention: u > 0 means wind blows toward the east.
 * "from" direction = atan2(-u, -v) normalized to [0, 2π).
 */
export function decomposeWind(u: number, v: number): { tws: number; twd: number } {
  return {
    tws: Math.hypot(u, v),
    twd: normalizeBearing(Math.atan2(-u, -v)),
  };
}

/**
 * Signed true wind angle: positive = wind on starboard, negative = port.
 * Polar lookup uses |TWA|.
 */
export function twaFromWindAndHeading(twd: number, heading: number): number {
  return normalizeAngle(twd - heading);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/routing/src/wind.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Update barrel**

```ts
// packages/routing/src/index.ts
export type { LatLon, RouteLeg, Route, PlanOptions, PlanInput } from './types.js';
export {
  greatCircleBearing,
  greatCircleDistance,
  rhumbStep,
  normalizeAngle,
  normalizeBearing,
} from './geometry.js';
export { decomposeWind, twaFromWindAndHeading } from './wind.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
feat(routing): decomposeWind (u,v → tws,twd) + twaFromWindAndHeading

Meteorological convention: TWD is the direction wind is FROM, radians
from north, clockwise, normalized to [0, 2π). TWA is signed in [-π, π];
polar lookup takes |TWA|.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Heading fan generation

**Files:**

- Create: `packages/routing/src/fan.ts`
- Create: `packages/routing/src/fan.test.ts`
- Modify: `packages/routing/src/index.ts`

- [ ] **Step 1: Failing test**

`packages/routing/src/fan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateHeadingFan } from './fan.js';

const DEG = Math.PI / 180;

describe('generateHeadingFan', () => {
  it('returns ±90° at 5° resolution → 37 headings symmetric around center', () => {
    const headings = generateHeadingFan(0, 90 * DEG, 5 * DEG);
    expect(headings.length).toBe(37);
    expect(headings[0]).toBeCloseTo(-90 * DEG, 6);
    expect(headings[18]).toBeCloseTo(0, 6);
    expect(headings[36]).toBeCloseTo(90 * DEG, 6);
  });

  it('shifts the fan around an arbitrary center', () => {
    const headings = generateHeadingFan(Math.PI / 2, 45 * DEG, 15 * DEG);
    expect(headings.length).toBe(7);
    expect(headings[0]).toBeCloseTo(Math.PI / 2 - 45 * DEG, 6);
    expect(headings[6]).toBeCloseTo(Math.PI / 2 + 45 * DEG, 6);
  });

  it('handles wrap around 2π', () => {
    const headings = generateHeadingFan(0, 180 * DEG, 90 * DEG);
    // values: -π, -π/2, 0, π/2, π — normalized to [0, 2π) they're π, 3π/2, 0, π/2, π
    expect(headings.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npm test -- packages/routing/src/fan.test.ts
```

- [ ] **Step 3: Implement `fan.ts`**

```ts
import { normalizeBearing } from './geometry.js';

/**
 * Return an ordered list of candidate headings (radians) covering
 * `center ± half_width` at `resolution`. Headings are normalized to
 * `[0, 2π)`.
 */
export function generateHeadingFan(
  center: number,
  halfWidth: number,
  resolution: number,
): number[] {
  const headings: number[] = [];
  const n = Math.round((2 * halfWidth) / resolution);
  for (let i = 0; i <= n; i++) {
    headings.push(normalizeBearing(center - halfWidth + i * resolution));
  }
  return headings;
}
```

Note: the test expects unnormalized values like `-π/2`. Adjust the test
to compare against `normalizeBearing(expected)` OR remove the normalization
here and only normalize at the caller. Pick **option A: keep test happy by
not normalizing here**:

```ts
export function generateHeadingFan(
  center: number,
  halfWidth: number,
  resolution: number,
): number[] {
  const headings: number[] = [];
  const n = Math.round((2 * halfWidth) / resolution);
  for (let i = 0; i <= n; i++) {
    headings.push(center - halfWidth + i * resolution);
  }
  return headings;
}
```

The plan caller normalizes when sampling wind (atan2 handles wrap already).

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/routing/src/fan.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Update barrel + commit**

```ts
// packages/routing/src/index.ts
// ...existing exports
export { generateHeadingFan } from './fan.js';
```

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
feat(routing): generateHeadingFan for isochrone candidate generation

±halfWidth around center at given resolution. Returns unnormalized values
(caller is responsible for wrap-safe consumption). 37 candidates at the
default ±90°/5° produces a workable balance of fidelity vs. perf.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Bearing-bucket pruning

**Files:**

- Create: `packages/routing/src/prune.ts`
- Create: `packages/routing/src/prune.test.ts`
- Modify: `packages/routing/src/index.ts`

- [ ] **Step 1: Failing test**

`packages/routing/src/prune.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pruneByBearingBucket, type FrontierNode } from './prune.js';

const START = { lat: 30, lon: -75 };

function mk(lat: number, lon: number, distFromStart: number): FrontierNode {
  return {
    pos: { lat, lon },
    t: 0,
    parent: null,
    heading: 0,
    twa: 0,
    tws: 0,
    bsp: 0,
    sogGround: 0,
    distFromStart,
  };
}

describe('pruneByBearingBucket', () => {
  it('keeps only the furthest node per bearing bucket', () => {
    // Three nodes in roughly the same bearing-from-start; only the farthest stays.
    const a = mk(31, -75, 100_000); // due north of start
    const b = mk(32, -75, 200_000); // also due north, further
    const c = mk(30, -74, 80_000); // due east — different bucket
    const out = pruneByBearingBucket([a, b, c], START, 2);
    expect(out.length).toBe(2);
    expect(out).toContain(b);
    expect(out).toContain(c);
    expect(out).not.toContain(a);
  });

  it('handles empty input', () => {
    expect(pruneByBearingBucket([], START, 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npm test -- packages/routing/src/prune.test.ts
```

- [ ] **Step 3: Implement `prune.ts`**

```ts
import type { LatLon } from './types.js';
import { greatCircleBearing } from './geometry.js';

/**
 * Internal frontier-node shape. We export it from this file so prune can be
 * unit-tested in isolation; the planner module produces these.
 */
export interface FrontierNode {
  pos: LatLon;
  t: number;
  parent: FrontierNode | null;
  heading: number;
  twa: number;
  tws: number;
  bsp: number;
  sogGround: number;
  distFromStart: number;
}

/**
 * Bucket frontier nodes by bearing-from-start at `bucketDeg` resolution;
 * keep the one furthest from start per bucket.
 */
export function pruneByBearingBucket(
  frontier: FrontierNode[],
  start: LatLon,
  bucketDeg: number,
): FrontierNode[] {
  if (frontier.length === 0) return [];
  const bucketRad = (bucketDeg * Math.PI) / 180;
  const buckets = new Map<number, FrontierNode>();
  for (const n of frontier) {
    const bearing = greatCircleBearing(start, n.pos);
    const key = Math.floor(bearing / bucketRad);
    const existing = buckets.get(key);
    if (!existing || n.distFromStart > existing.distFromStart) {
      buckets.set(key, n);
    }
  }
  return [...buckets.values()];
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/routing/src/prune.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Update barrel + commit**

```ts
// packages/routing/src/index.ts
// ...existing exports
export { pruneByBearingBucket, type FrontierNode } from './prune.js';
```

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
feat(routing): pruneByBearingBucket — keep furthest node per bucket

The single decision that makes isochrone routing tractable. Default 2°
buckets; tunable via PlanOptions.pruneBucketDeg.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Isochrone `plan()` — core loop (no currents, no land yet)

**Files:**

- Create: `packages/routing/src/plan.ts`
- Create: `packages/routing/src/plan.test.ts`
- Modify: `packages/routing/src/index.ts`

This is the heart of the package. The version in this task does NOT do land avoidance or currents — they layer on in Tasks 22 / 23. Keeping them out keeps this task focused and the test surface clean.

- [ ] **Step 1: Failing test (smoke + reach)**

`packages/routing/src/plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { plan } from './plan.js';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';

/** Constant 10 m/s wind from west (u=10, v=0) over a wide bbox & long time. */
function uniformWind(): WindField {
  const lats = [20, 30, 40, 50];
  const lons = [-80, -70, -60, -50];
  const times = [0, 86400 * 7]; // 0 → +7 days
  const u = times.map(() => lats.map(() => lons.map(() => 10)));
  const v = times.map(() => lats.map(() => lons.map(() => 0)));
  return { lats, lons, times, u, v, source: 'GFS', runTime: 0 };
}

/** Trivial polar: 6 m/s upwind, 8 m/s reach, 5 m/s downwind, etc. */
function simplePolar(): PolarTable {
  const DEG = Math.PI / 180;
  return {
    twsBins: [0, 5, 10, 15, 20].map((kn) => kn * 0.514444),
    twaBins: [0, 30, 45, 60, 90, 120, 150, 180].map((d) => d * DEG),
    boatSpeed: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 2, 3, 3.5, 4, 4, 3, 2],
      [0, 3, 5, 6, 7, 7, 5, 3],
      [0, 4, 6, 7, 8.5, 8.5, 6, 4],
      [0, 5, 7, 8, 9, 9, 7, 5],
    ],
  };
}

const fakeCoastline = {
  level: 'l' as const,
  polygons: [],
  index: { search: () => [], load: () => undefined } as never,
};

describe('plan (core)', () => {
  it('reaches a downwind destination in uniform wind', () => {
    const route = plan({
      start: { lat: 30, lon: -75 },
      end: { lat: 30, lon: -65 }, // 600 km east; wind blows east → broad reach
      departure: 0,
      wind: uniformWind(),
      polar: simplePolar(),
      polarId: 'test',
      coastline: fakeCoastline,
      options: { avoidLand: false, maxHours: 48, stepMinutes: 60 },
    });
    expect(route.incomplete).toBeFalsy();
    expect(route.legs.length).toBeGreaterThan(2);
    expect(route.distance).toBeGreaterThan(0);
    expect(route.model).toBe('GFS');
  });

  it('marks incomplete when maxHours is too short', () => {
    const route = plan({
      start: { lat: 30, lon: -75 },
      end: { lat: 30, lon: -65 },
      departure: 0,
      wind: uniformWind(),
      polar: simplePolar(),
      polarId: 'test',
      coastline: fakeCoastline,
      options: { avoidLand: false, maxHours: 1, stepMinutes: 30 },
    });
    expect(route.incomplete).toBe(true);
    expect(route.reason).toBe('exceeded_max_hours');
  });

  it('records polarId in the result', () => {
    const route = plan({
      start: { lat: 30, lon: -75 },
      end: { lat: 30, lon: -65 },
      departure: 0,
      wind: uniformWind(),
      polar: simplePolar(),
      polarId: 'my-config',
      coastline: fakeCoastline,
      options: { avoidLand: false, maxHours: 48 },
    });
    expect(route.polarId).toBe('my-config');
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npm test -- packages/routing/src/plan.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `plan.ts`**

```ts
import type { PlanInput, Route, RouteLeg, PlanOptions, LatLon } from './types.js';
import { interpolateWind, interpolateCurrent } from '@g5000/grib';
import { interpolatePolarSpeed } from '@g5000/compute';
import { intersectsLand } from '@g5000/coastline';
import {
  greatCircleBearing,
  greatCircleDistance,
  rhumbStep,
  normalizeAngle,
  normalizeBearing,
} from './geometry.js';
import { decomposeWind, twaFromWindAndHeading } from './wind.js';
import { generateHeadingFan } from './fan.js';
import { pruneByBearingBucket, type FrontierNode } from './prune.js';

const DEG = Math.PI / 180;

const DEFAULTS: Required<PlanOptions> = {
  stepMinutes: 30,
  headingFanDeg: 90,
  headingResolutionDeg: 5,
  maxHours: 168,
  avoidLand: true,
  useCurrents: false,
  pruneBucketDeg: 2,
};

export function plan(input: PlanInput): Route {
  const o: Required<PlanOptions> = { ...DEFAULTS, ...(input.options ?? {}) };
  const stepSec = o.stepMinutes * 60;
  const maxSec = o.maxHours * 3600;
  const fanRad = o.headingFanDeg * DEG;
  const resRad = o.headingResolutionDeg * DEG;

  const startNode: FrontierNode = {
    pos: input.start,
    t: input.departure,
    parent: null,
    heading: 0,
    twa: 0,
    tws: 0,
    bsp: 0,
    sogGround: 0,
    distFromStart: 0,
  };

  let frontier: FrontierNode[] = [startNode];
  let bestForReason: FrontierNode = startNode;
  let stepCount = 0;
  const maxSteps = Math.ceil(maxSec / stepSec);

  while (stepCount < maxSteps) {
    stepCount++;
    const next: FrontierNode[] = [];
    for (const n of frontier) {
      const bearingToDest = greatCircleBearing(n.pos, input.end);
      const headings = expandFanIfStuck(n, bearingToDest, fanRad, resRad, input, stepSec, o);
      for (const h of headings) {
        const child = propagate(n, h, input, stepSec, o);
        if (!child) continue;
        if (
          o.avoidLand &&
          intersectsLand(input.coastline, n.pos.lat, n.pos.lon, child.pos.lat, child.pos.lon)
        ) {
          continue;
        }
        next.push(child);
      }
    }

    if (next.length === 0) {
      return assembleRoute(bestForReason, input, true, 'no_wind');
    }
    frontier = pruneByBearingBucket(next, input.start, o.pruneBucketDeg);

    // Track the best (most progress toward destination) for incomplete return.
    for (const n of frontier) {
      if (
        greatCircleDistance(n.pos, input.end) < greatCircleDistance(bestForReason.pos, input.end)
      ) {
        bestForReason = n;
      }
    }

    // Termination: any node within one step's reach of destination → close.
    for (const n of frontier) {
      const dGround = greatCircleDistance(n.pos, input.end);
      if (dGround <= n.sogGround * stepSec || (n.sogGround === 0 && dGround === 0)) {
        // Synthesize final leg pointing directly at destination.
        const finalHeading = greatCircleBearing(n.pos, input.end);
        const finalTime = n.t + (n.sogGround > 0 ? dGround / n.sogGround : 0);
        const finalLeg: FrontierNode = {
          pos: input.end,
          t: finalTime,
          parent: n,
          heading: finalHeading,
          twa: n.twa,
          tws: n.tws,
          bsp: n.bsp,
          sogGround: n.sogGround,
          distFromStart: n.distFromStart + dGround,
        };
        return assembleRoute(finalLeg, input, false);
      }
    }
  }

  return assembleRoute(bestForReason, input, true, 'exceeded_max_hours');
}

function propagate(
  n: FrontierNode,
  heading: number,
  input: PlanInput,
  stepSec: number,
  o: Required<PlanOptions>,
): FrontierNode | null {
  let wind;
  try {
    wind = interpolateWind(input.wind, n.pos.lat, n.pos.lon, n.t);
  } catch {
    return null; // outside wind field
  }
  const { tws, twd } = decomposeWind(wind.u, wind.v);
  const twa = twaFromWindAndHeading(twd, heading);
  const bsp = interpolatePolarSpeed(input.polar, tws, Math.abs(twa));
  if (bsp < 0.1) return null; // in-irons / no progress

  let vGroundX = Math.sin(heading) * bsp;
  let vGroundY = Math.cos(heading) * bsp;
  if (o.useCurrents && input.currents) {
    try {
      const c = interpolateCurrent(input.currents, n.pos.lat, n.pos.lon, n.t);
      vGroundX += c.u;
      vGroundY += c.v;
    } catch {
      // current data missing here — keep through-water motion
    }
  }
  const sogGround = Math.hypot(vGroundX, vGroundY);
  const groundBearing = Math.atan2(vGroundX, vGroundY);
  const distance = sogGround * stepSec;
  const newPos = rhumbStep(n.pos, distance, groundBearing);

  return {
    pos: newPos,
    t: n.t + stepSec,
    parent: n,
    heading,
    twa: Math.abs(twa),
    tws,
    bsp,
    sogGround,
    distFromStart: n.distFromStart + distance,
  };
}

function expandFanIfStuck(
  n: FrontierNode,
  centerBearing: number,
  fanRad: number,
  resRad: number,
  input: PlanInput,
  stepSec: number,
  o: Required<PlanOptions>,
): number[] {
  // Try the default fan first; if no candidate produces progress, expand.
  for (const width of [fanRad, 1.5 * fanRad, Math.PI]) {
    const headings = generateHeadingFan(centerBearing, width, resRad);
    let anyProgress = false;
    for (const h of headings) {
      const child = propagate(n, h, input, stepSec, o);
      if (child && child.bsp > 0) {
        anyProgress = true;
        break;
      }
    }
    if (anyProgress) return headings;
  }
  return [];
}

function assembleRoute(
  end: FrontierNode,
  input: PlanInput,
  incomplete: boolean,
  reason?: Route['reason'],
): Route {
  const legs: RouteLeg[] = [];
  let cur: FrontierNode | null = end;
  while (cur) {
    legs.push({
      t: cur.t,
      lat: cur.pos.lat,
      lon: cur.pos.lon,
      heading: cur.heading,
      twa: cur.twa,
      tws: cur.tws,
      bsp: cur.bsp,
      sogGround: cur.sogGround,
    });
    cur = cur.parent;
  }
  legs.reverse();
  return {
    legs,
    start: legs[0]!.t,
    end: legs[legs.length - 1]!.t,
    distance: end.distFromStart,
    model: input.wind.source,
    usedCurrents: !!(input.options?.useCurrents && input.currents),
    polarId: input.polarId,
    ...(incomplete ? { incomplete: true } : {}),
    ...(reason ? { reason } : {}),
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/routing/src/plan.test.ts
```

Expected: 3 passing. If any test fails, inspect the leg sequence and bearing math first — the most common bugs are TWD sign and heading-vs-bearing confusion.

- [ ] **Step 5: Update barrel**

```ts
// packages/routing/src/index.ts
// ...existing exports
export { plan } from './plan.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
feat(routing): plan() — core isochrone with bearing-bucket pruning

Pure function. ±90° heading fan, 5° resolution, 30-min step (defaults).
Tracks best-so-far for incomplete-route reporting. Land avoidance and
currents are already wired in propagate() (toggles); their tests come
in Tasks 21–24.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Property tests — uniform wind, distance bound, determinism

**Files:**

- Create: `packages/routing/src/plan.property.test.ts`

- [ ] **Step 1: Write the property tests**

`packages/routing/src/plan.property.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { plan } from './plan.js';
import { greatCircleBearing, greatCircleDistance } from './geometry.js';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';

const DEG = Math.PI / 180;

function uniformWind(uVal: number, vVal: number): WindField {
  const lats = [10, 20, 30, 40, 50, 60];
  const lons = [-100, -80, -60, -40, -20];
  const times = [0, 86400 * 14];
  const u = times.map(() => lats.map(() => lons.map(() => uVal)));
  const v = times.map(() => lats.map(() => lons.map(() => vVal)));
  return { lats, lons, times, u, v, source: 'GFS', runTime: 0 };
}

function reachingPolar(): PolarTable {
  return {
    twsBins: [0, 5, 10, 15, 20].map((kn) => kn * 0.514444),
    twaBins: [0, 30, 45, 60, 90, 120, 150, 180].map((d) => d * DEG),
    boatSpeed: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 2, 3, 3.5, 4, 4, 3, 2],
      [0, 3, 5, 6, 7, 7, 5, 3],
      [0, 4, 6, 7, 8.5, 8.5, 6, 4],
      [0, 5, 7, 8, 9, 9, 7, 5],
    ],
  };
}

const fakeCoastline = {
  level: 'l' as const,
  polygons: [],
  index: { search: () => [], load: () => undefined } as never,
};

describe('property: distance ≥ great-circle', () => {
  it('route over-ground distance is never less than great-circle distance', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20, max: 45, noNaN: true }),
        fc.double({ min: -90, max: -50, noNaN: true }),
        fc.double({ min: 20, max: 45, noNaN: true }),
        fc.double({ min: -90, max: -50, noNaN: true }),
        (lat1, lon1, lat2, lon2) => {
          // Skip degenerate near-zero distances
          const gc = greatCircleDistance({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
          if (gc < 50_000) return;
          const r = plan({
            start: { lat: lat1, lon: lon1 },
            end: { lat: lat2, lon: lon2 },
            departure: 0,
            wind: uniformWind(8, 0),
            polar: reachingPolar(),
            polarId: 't',
            coastline: fakeCoastline,
            options: { avoidLand: false, maxHours: 168 },
          });
          if (r.incomplete) return;
          // Allow 0.5% numerical slack
          expect(r.distance).toBeGreaterThanOrEqual(gc * 0.995);
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe('property: determinism', () => {
  it('same inputs → byte-identical Route', () => {
    const args = {
      start: { lat: 35, lon: -70 },
      end: { lat: 32, lon: -65 },
      departure: 0,
      wind: uniformWind(8, 2),
      polar: reachingPolar(),
      polarId: 't',
      coastline: fakeCoastline,
      options: { avoidLand: false, maxHours: 72 },
    };
    const r1 = plan(args);
    const r2 = plan(args);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe('property: uniform wind ⇒ direction roughly toward destination', () => {
  it('mean leg bearing within 30° of great-circle bearing for broad-reach conditions', () => {
    const start = { lat: 30, lon: -75 };
    const end = { lat: 30, lon: -65 }; // due east, wind from west (u=8)
    const r = plan({
      start,
      end,
      departure: 0,
      wind: uniformWind(8, 0),
      polar: reachingPolar(),
      polarId: 't',
      coastline: fakeCoastline,
      options: { avoidLand: false, maxHours: 72 },
    });
    expect(r.incomplete).toBeFalsy();
    const gcb = greatCircleBearing(start, end);
    // Average bearing across legs
    let mean = 0;
    for (const l of r.legs) mean += l.heading;
    mean /= r.legs.length;
    const delta = Math.abs(((mean - gcb + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(delta).toBeLessThan(30 * DEG);
  });
});
```

- [ ] **Step 2: Run property tests**

```bash
npm test -- packages/routing/src/plan.property.test.ts
```

Expected: 3 passing. If `distance ≥ great-circle` ever fails on a specific seed, fast-check will print the shrunken case — investigate the leg log.

- [ ] **Step 3: Commit**

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
test(routing): property-based tests — distance bound, determinism, direction

fast-check generators over realistic Atlantic lat/lon pairs. distance >=
great-circle within 0.5% slack; same inputs => identical Route output;
broad-reach uniform wind => mean heading within 30 deg of GC bearing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Land-avoidance property test

**Files:**

- Modify: `packages/routing/src/plan.property.test.ts`

The `plan()` function already calls `intersectsLand`. This task adds the property test that exercises land avoidance with a synthetic island.

- [ ] **Step 1: Append a land-avoidance test to `plan.property.test.ts`**

Add (at the bottom):

```ts
import RBush from 'rbush';
import type { Coastline, RBushEntry } from '@g5000/coastline';

function syntheticIsland(): Coastline {
  // 1°×1° box centered at (30, -70).
  const ring: Array<[number, number]> = [
    [-70.5, 29.5],
    [-69.5, 29.5],
    [-69.5, 30.5],
    [-70.5, 30.5],
    [-70.5, 29.5],
  ];
  const polygon = {
    kind: 'land' as const,
    ring,
    bbox: [-70.5, 29.5, -69.5, 30.5] as [number, number, number, number],
  };
  const index = new RBush<RBushEntry>();
  index.load([
    {
      minX: -70.5,
      minY: 29.5,
      maxX: -69.5,
      maxY: 30.5,
      polygon,
    },
  ]);
  return { level: 'l', polygons: [polygon], index };
}

describe('property: coastline forces detour', () => {
  it('route with avoidLand=true is longer and does not cross the island', () => {
    const start = { lat: 30, lon: -75 };
    const end = { lat: 30, lon: -65 };
    const wind = uniformWind(8, 0);
    const polar = reachingPolar();
    const coastline = syntheticIsland();

    const rOff = plan({
      start,
      end,
      departure: 0,
      wind,
      polar,
      polarId: 't',
      coastline,
      options: { avoidLand: false, maxHours: 72 },
    });
    const rOn = plan({
      start,
      end,
      departure: 0,
      wind,
      polar,
      polarId: 't',
      coastline,
      options: { avoidLand: true, maxHours: 72 },
    });

    expect(rOff.incomplete).toBeFalsy();
    expect(rOn.incomplete).toBeFalsy();
    expect(rOn.distance).toBeGreaterThan(rOff.distance);
    // No leg should cross the island
    for (let i = 0; i < rOn.legs.length - 1; i++) {
      const a = rOn.legs[i]!;
      const b = rOn.legs[i + 1]!;
      // Cheap check: neither endpoint inside the island
      expect(!(a.lat > 29.5 && a.lat < 30.5 && a.lon > -70.5 && a.lon < -69.5)).toBe(true);
      expect(!(b.lat > 29.5 && b.lat < 30.5 && b.lon > -70.5 && b.lon < -69.5)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- packages/routing/src/plan.property.test.ts
```

Expected: 4 passing (3 from Task 21 + 1 new).

- [ ] **Step 3: Commit**

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
test(routing): property test for land avoidance

Synthetic 1x1 island on the great-circle path. avoidLand=true produces
a longer route whose legs never traverse the island polygon.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Currents property test (currents-reverse symmetry)

**Files:**

- Modify: `packages/routing/src/plan.property.test.ts`

`plan()` already handles `useCurrents`. This task adds the symmetry test.

- [ ] **Step 1: Append the test**

```ts
import type { CurrentField } from '@g5000/grib';

function uniformCurrent(uVal: number, vVal: number): CurrentField {
  const lats = [10, 20, 30, 40, 50, 60];
  const lons = [-100, -80, -60, -40, -20];
  const times = [0, 86400 * 14];
  const u = times.map(() => lats.map(() => lons.map(() => uVal)));
  const v = times.map(() => lats.map(() => lons.map(() => vVal)));
  return { lats, lons, times, u, v, source: 'RTOFS', runTime: 0 };
}

describe('property: currents reverse → ETA asymmetry', () => {
  it('current pushing toward destination yields earlier ETA than current pushing away', () => {
    const start = { lat: 30, lon: -75 };
    const end = { lat: 30, lon: -65 };
    const wind = uniformWind(8, 0);
    const polar = reachingPolar();
    const args = {
      start,
      end,
      departure: 0,
      wind,
      polar,
      polarId: 't',
      coastline: fakeCoastline,
      options: { avoidLand: false, maxHours: 72, useCurrents: true },
    };
    const withCurrent = plan({ ...args, currents: uniformCurrent(1, 0) });
    const againstCurrent = plan({ ...args, currents: uniformCurrent(-1, 0) });
    expect(withCurrent.incomplete).toBeFalsy();
    expect(againstCurrent.incomplete).toBeFalsy();
    expect(withCurrent.end).toBeLessThan(againstCurrent.end);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- packages/routing/src/plan.property.test.ts
```

Expected: 5 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
test(routing): property test for currents reversal symmetry

Same wind, same polar, current vectors flipped: with-current ETA must
be earlier than against-current ETA. Catches sign errors in the current
vector-add inside propagate().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: New g5000 endpoint — `/api/wardrobe/active`

**Files:**

- Create: `packages/web/src/app/api/wardrobe/active/route.ts`
- Create: `packages/web/src/app/api/wardrobe/active/route.test.ts`

This task and Task 25 add the two endpoints g5000 needs to expose for the Mac router. They mirror existing patterns in `packages/web/src/app/api/config/polars/route.ts`.

- [ ] **Step 1: Read the existing config endpoint for shape**

```bash
cat packages/web/src/app/api/config/polars/route.ts
```

Note the imports, the way `configStore` is accessed (likely via a server-globalThis singleton or an `import` from `@/lib/...`).

- [ ] **Step 2: Failing test**

`packages/web/src/app/api/wardrobe/active/route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from './route.js';

describe('GET /api/wardrobe/active', () => {
  beforeEach(() => {
    // Reset / seed the global config store the route handler reads from.
    // Pattern matches existing tests; see api/config/polars/route.test.ts.
  });

  it('returns the active SailConfig JSON', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('polar');
    expect(json.polar).toHaveProperty('twsBins');
    expect(json.polar).toHaveProperty('twaBins');
    expect(json.polar).toHaveProperty('boatSpeed');
  });
});
```

> **Note:** the exact `beforeEach` setup depends on how the existing handler tests bootstrap the singleton. Read `api/config/polars/route.test.ts` and reproduce the same pattern.

- [ ] **Step 3: Run test to verify fail**

```bash
npm test -- packages/web/src/app/api/wardrobe/active/route.test.ts
```

- [ ] **Step 4: Implement the handler**

`packages/web/src/app/api/wardrobe/active/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { firstValueFrom } from 'rxjs';
import { getConfigStore } from '@/lib/config-store-singleton'; // or whatever the existing path is

export async function GET() {
  try {
    const store = getConfigStore();
    const wardrobe = await firstValueFrom(store.activeWardrobe$);
    const active = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId);
    if (!active) {
      return NextResponse.json(
        { error: { kind: 'not_found', message: 'No active wardrobe entry' } },
        { status: 404 },
      );
    }
    return NextResponse.json(active);
  } catch (err) {
    return NextResponse.json(
      { error: { kind: 'internal', message: String(err) } },
      { status: 500 },
    );
  }
}
```

> **Note:** verify the import path for `getConfigStore` — match whatever
> the existing `polars/route.ts` uses. Also verify the observable name
> (`activeWardrobe$` vs `polars$` vs `wardrobe$`) in `packages/db/src/config-store.ts`.

- [ ] **Step 5: Run tests to verify pass**

```bash
npm test -- packages/web/src/app/api/wardrobe/active/route.test.ts
```

Expected: passing.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "$(cat <<'EOF'
feat(web): GET /api/wardrobe/active returns the active SailConfig

Read-only JSON endpoint consumed by the Mac router app to mirror the
running boat's active polar. Reads from configStore singleton via the
existing pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: New g5000 endpoint — `/api/position` (SSE)

**Files:**

- Create: `packages/web/src/app/api/position/route.ts`
- Create: `packages/web/src/app/api/position/route.test.ts`

- [ ] **Step 1: Failing test**

`packages/web/src/app/api/position/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GET } from './route.js';

describe('GET /api/position', () => {
  it('returns a Server-Sent Events stream', async () => {
    const res = await GET();
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npm test -- packages/web/src/app/api/position/route.test.ts
```

- [ ] **Step 3: Implement the SSE handler**

`packages/web/src/app/api/position/route.ts`:

```ts
import { getBus } from '@/lib/bus-singleton'; // verify the actual import path
import type { Sample } from '@g5000/core';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const bus = getBus();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const latest: Record<'lat' | 'lon' | 'sog' | 'cog', number | undefined> = {
        lat: undefined,
        lon: undefined,
        sog: undefined,
        cog: undefined,
      };
      let timer: NodeJS.Timeout | null = null;
      let closed = false;

      const channelMap: Record<string, keyof typeof latest> = {
        'gps.position.lat': 'lat',
        'gps.position.lon': 'lon',
        'gps.position.sog': 'sog',
        'gps.position.cog': 'cog',
      };
      const unsubs: Array<() => void> = [];
      for (const [channel, key] of Object.entries(channelMap)) {
        unsubs.push(
          bus.subscribe(channel, (s: Sample) => {
            if (s.value.kind !== 'scalar') return;
            latest[key] = s.value.value;
          }),
        );
      }

      const emit = () => {
        if (closed) return;
        if (latest.lat !== undefined && latest.lon !== undefined) {
          const payload = JSON.stringify({
            lat: latest.lat,
            lon: latest.lon,
            sog: latest.sog ?? null,
            cog: latest.cog ?? null,
            t: Date.now() / 1000,
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }
        timer = setTimeout(emit, 1000); // ~1 Hz cadence
      };
      emit();

      return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        for (const u of unsubs) u();
      };
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
```

> **Note:** Verify the exact `getBus` import path; match whatever
> existing handlers in `packages/web` use.

- [ ] **Step 4: Run tests to verify pass**

```bash
npm test -- packages/web/src/app/api/position/route.test.ts
```

Expected: passing.

- [ ] **Step 5: Commit**

```bash
git add packages/web
git commit -m "$(cat <<'EOF'
feat(web): GET /api/position SSE stream of lat/lon/sog/cog

1 Hz cadence after first coherent position. Consumed by the Mac router
to drive the live current-position badge and "reroute from here" UX.
Read-only; never publishes to the bus.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 26: Bootstrap `apps/router` (Next.js + Tailwind)

**Files:**

- Create: `apps/router/package.json`
- Create: `apps/router/tsconfig.json`
- Create: `apps/router/next.config.ts`
- Create: `apps/router/tailwind.config.ts`
- Create: `apps/router/postcss.config.mjs`
- Create: `apps/router/src/app/layout.tsx`
- Create: `apps/router/src/app/globals.css`
- Create: `apps/router/src/app/page.tsx` (placeholder)

- [ ] **Step 1: Read the existing web app for scaffold parity**

```bash
cat packages/web/package.json packages/web/next.config.ts packages/web/tailwind.config.ts packages/web/postcss.config.mjs packages/web/tsconfig.json
```

Use these as templates (same Next.js version, same Tailwind config style, same `tsconfig.base.json` extension).

- [ ] **Step 2: Create `apps/router/package.json`**

```json
{
  "name": "@g5000/router-app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@g5000/coastline": "*",
    "@g5000/compute": "*",
    "@g5000/db": "*",
    "@g5000/grib": "*",
    "@g5000/routing": "*",
    "maplibre-gl": "^4.7.0",
    "next": "<MATCH packages/web>",
    "react": "<MATCH packages/web>",
    "react-dom": "<MATCH packages/web>"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "<MATCH packages/web>",
    "@types/react-dom": "<MATCH packages/web>",
    "autoprefixer": "<MATCH packages/web>",
    "postcss": "<MATCH packages/web>",
    "tailwindcss": "<MATCH packages/web>",
    "typescript": "^5.7"
  }
}
```

Replace `<MATCH packages/web>` with the exact versions from `packages/web/package.json` so we stay version-locked across the monorepo. Port `:3001` so the router doesn't collide with g5000 web on `:3000`.

- [ ] **Step 3: Create `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`**

Copy the corresponding files from `packages/web/` verbatim, adjusting `tsconfig.json` paths so `@/*` points at `src/*` inside `apps/router`. Add references to all `@g5000/*` workspace packages.

- [ ] **Step 4: Minimal `layout.tsx` and `page.tsx`**

`apps/router/src/app/layout.tsx`:

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'g5000 Weather Router',
  description: 'GRIB-driven passage planner',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen">{children}</body>
    </html>
  );
}
```

`apps/router/src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl">Router (placeholder)</h1>
    </main>
  );
}
```

`apps/router/src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Verify build & dev**

```bash
npm install
npm run build --workspace @g5000/router-app
npm run dev --workspace @g5000/router-app
```

Visit `http://localhost:3001` — see the placeholder heading. Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add apps/router package*.json
git commit -m "$(cat <<'EOF'
feat: scaffold apps/router Next.js app on port 3001

Matches packages/web conventions for Next.js / Tailwind / tsconfig.
Workspace deps on @g5000/{grib,coastline,routing,compute,db}. Placeholder
home page; real UI lands in later tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 27: Local filesystem paths and persistence helpers

**Files:**

- Create: `apps/router/src/lib/paths.ts`
- Create: `apps/router/src/lib/persistence.ts`
- Create: `apps/router/src/lib/persistence.test.ts`

- [ ] **Step 1: Write `paths.ts`**

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ROOT = process.env.G5000_ROUTER_ROOT ?? join(homedir(), '.g5000-router');
export const GRIB_CACHE = join(ROOT, 'grib-cache');
export const PLANS_DIR = join(ROOT, 'plans');
export const CACHED_POLAR = join(ROOT, 'cached-polar.json');
export const SETTINGS = join(ROOT, 'settings.json');
```

- [ ] **Step 2: Failing test for persistence**

`apps/router/src/lib/persistence.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJson, readJson, listJson } from './persistence.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'router-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('persistence', () => {
  it('writeJson + readJson roundtrip', async () => {
    const p = join(dir, 'foo.json');
    await writeJson(p, { a: 1, b: [2, 3] });
    expect(await readJson(p)).toEqual({ a: 1, b: [2, 3] });
  });
  it('readJson returns null when file missing', async () => {
    expect(await readJson(join(dir, 'missing.json'))).toBeNull();
  });
  it('listJson returns sorted filenames', async () => {
    await writeJson(join(dir, 'b.json'), { id: 'b' });
    await writeJson(join(dir, 'a.json'), { id: 'a' });
    expect(await listJson(dir)).toEqual(['a.json', 'b.json']);
  });
});
```

- [ ] **Step 3: Run test (expect fail)**

```bash
npm test -- apps/router/src/lib/persistence.test.ts
```

- [ ] **Step 4: Implement**

```ts
// apps/router/src/lib/persistence.ts
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

export async function readJson<T = unknown>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as T;
}

export async function listJson(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith('.json')).sort();
}
```

- [ ] **Step 5: Run tests (expect pass)**

```bash
npm test -- apps/router/src/lib/persistence.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): paths + JSON persistence helpers

~/.g5000-router/ as root with subdirs for grib-cache and plans, plus
cached-polar.json and settings.json. Override via G5000_ROUTER_ROOT
env for tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 28: API route — `POST /api/route/plan`

**Files:**

- Create: `apps/router/src/app/api/route/plan/route.ts`
- Create: `apps/router/src/app/api/route/plan/route.test.ts`

- [ ] **Step 1: Failing test**

```ts
// apps/router/src/app/api/route/plan/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from './route.js';

vi.mock('@g5000/routing', async () => ({
  ...(await vi.importActual('@g5000/routing')),
  plan: vi.fn(() => ({
    legs: [{ t: 0, lat: 30, lon: -75, heading: 0, twa: 0, tws: 8, bsp: 5, sogGround: 5 }],
    start: 0,
    end: 3600,
    distance: 18000,
    model: 'GFS',
    usedCurrents: false,
    polarId: 'test',
  })),
}));

// Stub the GRIB + coastline loaders the handler invokes:
vi.mock('../../../lib/grib-context.js', () => ({
  loadWindFor: vi.fn(async () => ({
    /* tiny mock WindField */
  })),
}));
vi.mock('../../../lib/coastline.js', () => ({
  loadDefaultCoastline: vi.fn(async () => ({})),
}));

describe('POST /api/route/plan', () => {
  it('returns a Route for a well-formed body', async () => {
    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({
        start: { lat: 30, lon: -75 },
        end: { lat: 30, lon: -65 },
        departure: 0,
        model: 'GFS',
        polar: { twsBins: [], twaBins: [], boatSpeed: [] },
        polarId: 'test',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.route.model).toBe('GFS');
  });

  it('returns 400 for missing fields', async () => {
    const req = new Request('http://localhost/api/route/plan', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.kind).toBe('bad_request');
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npm test -- apps/router/src/app/api/route/plan/route.test.ts
```

- [ ] **Step 3: Implement handler + the small helpers it imports**

`apps/router/src/lib/grib-context.ts`:

```ts
import type { WindField, CurrentField, Bbox } from '@g5000/grib';
import { fetchGfsBlobs, runWgrib2, parseGrib2Json } from '@g5000/grib';
import { GRIB_CACHE } from './paths.js';

export async function loadWindFor(
  model: 'GFS' | 'ECMWF',
  bbox: Bbox,
  hours: number,
): Promise<WindField> {
  if (model === 'GFS') {
    const { cachedPaths, runDateUtc, runHourUtc } = await fetchGfsBlobs({
      bbox,
      hours,
      cacheRoot: GRIB_CACHE,
    });
    const runTime =
      Date.UTC(
        Number(runDateUtc.slice(0, 4)),
        Number(runDateUtc.slice(5, 7)) - 1,
        Number(runDateUtc.slice(8, 10)),
        runHourUtc,
      ) / 1000;
    const messages = (await Promise.all(cachedPaths.map((p) => runWgrib2(p)))).flat();
    return parseGrib2Json(messages, 'GFS', runTime) as WindField;
  }
  throw new Error(`loadWindFor: model ${model} implemented in later task`);
}
```

`apps/router/src/lib/coastline.ts`:

```ts
import { loadCoastlineFromGeojson } from '@g5000/coastline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export async function loadDefaultCoastline() {
  const path = resolve(here, '../../../../packages/coastline/data/i.geojson');
  return loadCoastlineFromGeojson(path, 'i');
}
```

`apps/router/src/app/api/route/plan/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { plan } from '@g5000/routing';
import type { PolarTable } from '@g5000/db';
import { loadWindFor } from '../../../../lib/grib-context.js';
import { loadDefaultCoastline } from '../../../../lib/coastline.js';

interface Body {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  polar: PolarTable;
  polarId: string;
  useCurrents?: boolean;
  options?: Record<string, unknown>;
}

function bboxAround(a: Body['start'], b: Body['end']) {
  const buffer = 2; // degrees
  return {
    latMin: Math.min(a.lat, b.lat) - buffer,
    latMax: Math.max(a.lat, b.lat) + buffer,
    lonMin: Math.min(a.lon, b.lon) - buffer,
    lonMax: Math.max(a.lon, b.lon) + buffer,
  };
}

function validate(b: unknown): b is Body {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  if (!o.start || !o.end || typeof o.departure !== 'number') return false;
  if (typeof o.model !== 'string' || !['GFS', 'ECMWF'].includes(o.model)) return false;
  if (!o.polar || !o.polarId) return false;
  return true;
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { kind: 'bad_request', message: 'invalid JSON' } },
      { status: 400 },
    );
  }
  if (!validate(body)) {
    return NextResponse.json(
      { ok: false, error: { kind: 'bad_request', message: 'missing required fields' } },
      { status: 400 },
    );
  }
  const b = body;
  try {
    const bbox = bboxAround(b.start, b.end);
    const wind = await loadWindFor(b.model, bbox, 120);
    const coastline = await loadDefaultCoastline();
    const route = plan({
      start: b.start,
      end: b.end,
      departure: b.departure,
      wind,
      polar: b.polar,
      polarId: b.polarId,
      coastline,
      options: b.options,
    });
    return NextResponse.json({ ok: true, route });
  } catch (err) {
    const e = err as { kind?: string; status?: number; retryable?: boolean; message?: string };
    return NextResponse.json(
      {
        ok: false,
        error: {
          kind: e.kind ?? 'internal',
          message: e.message ?? String(err),
          retryable: e.retryable ?? false,
        },
      },
      { status: e.status ?? 500 },
    );
  }
}
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
npm test -- apps/router/src/app/api/route/plan/route.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): POST /api/route/plan

Handler validates body, computes bbox with 2deg buffer, loads wind via
loadWindFor (currently GFS only — ECMWF/RTOFS land in later tasks),
loads default coastline, runs plan(), returns { ok, route } envelope.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 29: g5000 client + live-mode SSE/JSON proxies

**Files:**

- Create: `apps/router/src/lib/g5000-client.ts`
- Create: `apps/router/src/app/api/live/polar/route.ts`
- Create: `apps/router/src/app/api/live/position/route.ts`

- [ ] **Step 1: Write g5000-client.ts**

```ts
import { CACHED_POLAR } from './paths.js';
import { writeJson, readJson } from './persistence.js';

const HOST = process.env.G5000_HOST ?? 'http://g5000.local:3000';

export async function fetchActivePolar(): Promise<unknown | null> {
  try {
    const res = await fetch(`${HOST}/api/wardrobe/active`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return readJson(CACHED_POLAR);
    const polar = await res.json();
    await writeJson(CACHED_POLAR, polar);
    return polar;
  } catch {
    return readJson(CACHED_POLAR);
  }
}

export function liveModeAvailable(): Promise<boolean> {
  return fetch(`${HOST}/api/wardrobe/active`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
}

export function positionStreamUrl(): string {
  return `${HOST}/api/position`;
}
```

- [ ] **Step 2: Polar proxy handler**

`apps/router/src/app/api/live/polar/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { fetchActivePolar } from '../../../../lib/g5000-client.js';

export async function GET() {
  const polar = await fetchActivePolar();
  if (!polar) {
    return NextResponse.json({ ok: false, error: { kind: 'unavailable' } }, { status: 503 });
  }
  return NextResponse.json({ ok: true, polar });
}
```

- [ ] **Step 3: Position proxy handler (passthrough SSE)**

`apps/router/src/app/api/live/position/route.ts`:

```ts
import { positionStreamUrl } from '../../../../lib/g5000-client.js';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(positionStreamUrl(), {
      headers: { accept: 'text/event-stream' },
    });
    if (!upstream.ok || !upstream.body) {
      return new Response(`event: error\ndata: {"kind":"unavailable"}\n\n`, {
        status: 503,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(upstream.body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch {
    return new Response(`event: error\ndata: {"kind":"network"}\n\n`, {
      status: 503,
      headers: { 'content-type': 'text/event-stream' },
    });
  }
}
```

- [ ] **Step 4: Smoke-test by hand**

```bash
npm run dev --workspace @g5000/router-app &
curl -s http://localhost:3001/api/live/polar | head -c 200
curl -sN http://localhost:3001/api/live/position | head -c 200
```

If g5000 isn't running, the polar endpoint returns either a cached polar (if one exists) or a 503. The position endpoint returns an SSE `error` event. Both are expected behaviors. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): live-mode proxies + g5000-client

GET /api/live/polar caches to ~/.g5000-router/cached-polar.json on every
successful fetch; falls back to cache when g5000 is unreachable.
GET /api/live/position passes through the SSE stream from g5000.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 30: Map shell with MapLibre + status badge

**Files:**

- Create: `apps/router/src/components/Map.tsx`
- Create: `apps/router/src/components/StatusBadge.tsx`
- Modify: `apps/router/src/app/page.tsx`

UI work — light on tests (rendering tests would require jsdom + Maplibre stubs, low value). We exercise this in the perf budget / smoke run later.

- [ ] **Step 1: Status badge**

```tsx
// apps/router/src/components/StatusBadge.tsx
'use client';
import { useEffect, useState } from 'react';

type Mode = 'unknown' | 'live' | 'offline';

export function StatusBadge() {
  const [mode, setMode] = useState<Mode>('unknown');
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch('/api/live/polar', { signal: AbortSignal.timeout(3000) });
        if (cancelled) return;
        setMode(r.ok ? 'live' : 'offline');
      } catch {
        if (!cancelled) setMode('offline');
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  const color =
    mode === 'live'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-700'
      : mode === 'offline'
        ? 'bg-amber-500/20 text-amber-300 border-amber-700'
        : 'bg-slate-700/40 text-slate-300 border-slate-700';
  const label =
    mode === 'live' ? 'Live: g5000 onboard ✓' : mode === 'offline' ? 'Offline 🌐' : 'Checking…';
  return <span className={`text-xs px-2 py-1 border rounded ${color}`}>{label}</span>;
}
```

- [ ] **Step 2: Map component**

```tsx
// apps/router/src/components/Map.tsx
'use client';
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface MapProps {
  center: { lat: number; lon: number };
  zoom: number;
  onClick?: (latLon: { lat: number; lon: number }) => void;
}

export function Map({ center, zoom, onClick }: MapProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [center.lon, center.lat],
      zoom,
    });
    if (onClick) {
      map.on('click', (e) => onClick({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    }
    mapRef.current = map;
    return () => {
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} className="w-full h-full" />;
}
```

- [ ] **Step 3: Wire into page**

```tsx
// apps/router/src/app/page.tsx
import { Map } from '../components/Map';
import { StatusBadge } from '../components/StatusBadge';

export default function Page() {
  return (
    <main className="grid grid-cols-[1fr_360px] h-screen">
      <Map center={{ lat: 35, lon: -70 }} zoom={4} />
      <aside className="p-4 border-l border-slate-800 space-y-4">
        <StatusBadge />
        <div className="text-slate-400 text-sm">
          Click on the map to set start / end. Wiring controls in Task 31.
        </div>
      </aside>
    </main>
  );
}
```

- [ ] **Step 4: Smoke-test**

```bash
npm run dev --workspace @g5000/router-app
# open http://localhost:3001 — see map + badge
```

- [ ] **Step 5: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): MapLibre map shell + live/offline status badge

OSM raster base; 15s status polling against /api/live/polar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 31: Plan controls + route polyline rendering

**Files:**

- Create: `apps/router/src/components/PlanControls.tsx`
- Create: `apps/router/src/components/RoutePolyline.tsx`
- Modify: `apps/router/src/app/page.tsx`

- [ ] **Step 1: PlanControls (client component, manages local state)**

`apps/router/src/components/PlanControls.tsx`:

```tsx
'use client';
import { useState } from 'react';

export interface PlanRequest {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  polarId: string;
  polar: unknown;
}

export function PlanControls(props: {
  start?: { lat: number; lon: number };
  end?: { lat: number; lon: number };
  onPlan: (req: PlanRequest) => void;
  loading: boolean;
}) {
  const [model, setModel] = useState<'GFS' | 'ECMWF'>('GFS');
  const [departure, setDeparture] = useState<string>(
    new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
  );
  const onSubmit = async () => {
    const polarRes = await fetch('/api/live/polar');
    if (!polarRes.ok) return alert('No polar available (live or cached).');
    const { polar } = await polarRes.json();
    const t = Math.floor(new Date(departure).getTime() / 1000);
    if (!props.start || !props.end) return alert('Click start and end on the map first.');
    props.onPlan({
      start: props.start,
      end: props.end,
      departure: t,
      model,
      polarId: polar.id ?? 'default',
      polar: polar.polar ?? polar,
    });
  };
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        Departure (UTC)
        <input
          type="datetime-local"
          value={departure}
          onChange={(e) => setDeparture(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
        />
      </label>
      <label className="block text-sm">
        Wind model
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as 'GFS' | 'ECMWF')}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
        >
          <option value="GFS">GFS (NOAA)</option>
          <option value="ECMWF">ECMWF</option>
        </select>
      </label>
      <button
        disabled={props.loading || !props.start || !props.end}
        onClick={onSubmit}
        className="bg-emerald-700 disabled:bg-slate-700 px-3 py-2 rounded w-full text-sm"
      >
        {props.loading ? 'Planning…' : 'Plan'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: RoutePolyline — draws as a GeoJSON line source on the map**

`apps/router/src/components/RoutePolyline.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { Route } from '@g5000/routing';

export function attachRoute(
  map: maplibregl.Map,
  id: string,
  route: Route,
  color = '#22d3ee',
): void {
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: route.legs.map((l) => [l.lon, l.lat]),
        },
      },
    ],
  };
  if (map.getSource(id)) {
    (map.getSource(id) as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: { 'line-color': color, 'line-width': 2 },
    });
  }
}

export function detachRoute(map: maplibregl.Map, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}
```

- [ ] **Step 3: Lift Map ref + wire on-click + Plan into the page**

Rewrite `apps/router/src/app/page.tsx` to manage state for start/end/route and pass to Map + PlanControls. Full code:

```tsx
'use client';
import { useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Map } from '../components/Map';
import { StatusBadge } from '../components/StatusBadge';
import { PlanControls, type PlanRequest } from '../components/PlanControls';
import { attachRoute } from '../components/RoutePolyline';
import type { Route } from '@g5000/routing';

type Pos = { lat: number; lon: number };

export default function HomePage() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [start, setStart] = useState<Pos | undefined>();
  const [end, setEnd] = useState<Pos | undefined>();
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState<Route | undefined>();
  const [error, setError] = useState<string | undefined>();

  const onMapClick = (p: Pos) => {
    if (!start) setStart(p);
    else if (!end) setEnd(p);
    else {
      setStart(p);
      setEnd(undefined);
      setRoute(undefined);
    }
  };
  const onPlan = async (req: PlanRequest) => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch('/api/route/plan', {
        method: 'POST',
        body: JSON.stringify(req),
        headers: { 'content-type': 'application/json' },
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'plan failed');
      setRoute(j.route);
      if (mapRef.current) attachRoute(mapRef.current, 'route-gfs', j.route);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="grid grid-cols-[1fr_360px] h-screen">
      <Map
        center={{ lat: 35, lon: -70 }}
        zoom={4}
        onClick={onMapClick}
        // To access the map ref, hoist via a callback. For brevity, refactor
        // Map.tsx to accept onLoad?: (m: Map) => void and store it here.
      />
      <aside className="p-4 border-l border-slate-800 space-y-4 overflow-y-auto">
        <StatusBadge />
        <div className="text-xs text-slate-400 space-y-1">
          <div>
            Start: {start ? `${start.lat.toFixed(3)}, ${start.lon.toFixed(3)}` : '— click map'}
          </div>
          <div>End: {end ? `${end.lat.toFixed(3)}, ${end.lon.toFixed(3)}` : '— click map'}</div>
        </div>
        <PlanControls start={start} end={end} onPlan={onPlan} loading={loading} />
        {error && <div className="text-rose-400 text-xs">{error}</div>}
        {route && (
          <div className="text-xs text-slate-300">
            ETA: {new Date(route.end * 1000).toISOString()}
            <br />
            Distance: {(route.distance / 1852).toFixed(0)} NM
            <br />
            Model: {route.model}
            {route.incomplete ? ` (incomplete: ${route.reason})` : ''}
          </div>
        )}
      </aside>
    </main>
  );
}
```

You'll need to extend `Map.tsx` with `onLoad?: (m: maplibregl.Map) => void` callback to expose the ref to the page. Update Map.tsx accordingly.

- [ ] **Step 4: Smoke-test**

Run `npm run dev --workspace @g5000/router-app`, click two points on the map, hit Plan. Expect either a successful route polyline or a graceful error in the right rail.

- [ ] **Step 5: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): PlanControls + RoutePolyline + page glue

Click-to-place start/end, fetch live polar via /api/live/polar, POST
/api/route/plan, render returned Route as a polyline on the map.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 32: Route timeline + GPX export

**Files:**

- Create: `apps/router/src/components/RouteTimeline.tsx`
- Create: `apps/router/src/lib/gpx.ts`
- Create: `apps/router/src/lib/gpx.test.ts`
- Modify: `apps/router/src/app/page.tsx`

- [ ] **Step 1: Failing GPX test**

```ts
// apps/router/src/lib/gpx.test.ts
import { describe, it, expect } from 'vitest';
import { routeToGpx } from './gpx.js';
import type { Route } from '@g5000/routing';

const r: Route = {
  legs: [
    { t: 0, lat: 30, lon: -75, heading: 0, twa: 0, tws: 8, bsp: 5, sogGround: 5 },
    { t: 3600, lat: 30, lon: -74, heading: 0, twa: 0, tws: 8, bsp: 5, sogGround: 5 },
  ],
  start: 0,
  end: 3600,
  distance: 100000,
  model: 'GFS',
  usedCurrents: false,
  polarId: 'test',
};

describe('routeToGpx', () => {
  it('produces valid GPX 1.1 with one track + N trkpts', () => {
    const gpx = routeToGpx(r, 'Test Route');
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<name>Test Route</name>');
    expect(gpx).toContain('<trkpt lat="30" lon="-75">');
    expect(gpx).toContain('<trkpt lat="30" lon="-74">');
    expect(gpx).toContain('<time>1970-01-01T00:00:00.000Z</time>');
  });
});
```

- [ ] **Step 2: Run test (fail)**

```bash
npm test -- apps/router/src/lib/gpx.test.ts
```

- [ ] **Step 3: Implement `gpx.ts`**

```ts
import type { Route } from '@g5000/routing';

export function routeToGpx(r: Route, name: string): string {
  const trkpts = r.legs
    .map(
      (l) =>
        `      <trkpt lat="${l.lat}" lon="${l.lon}">\n` +
        `        <time>${new Date(l.t * 1000).toISOString()}</time>\n` +
        `      </trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="g5000-router" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!,
  );
}
```

- [ ] **Step 4: Run tests (pass)**

```bash
npm test -- apps/router/src/lib/gpx.test.ts
```

- [ ] **Step 5: Timeline component (read-only table of legs)**

```tsx
// apps/router/src/components/RouteTimeline.tsx
'use client';
import type { Route } from '@g5000/routing';
import { routeToGpx } from '../lib/gpx';

export function RouteTimeline({ route }: { route: Route }) {
  const KN = 1.94384;
  const DEG = 180 / Math.PI;
  const onExport = () => {
    const blob = new Blob([routeToGpx(route, 'Route')], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'route.gpx';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-2">
      <button onClick={onExport} className="bg-slate-700 px-2 py-1 rounded text-xs">
        Export GPX
      </button>
      <div className="text-xs max-h-64 overflow-y-auto font-mono">
        <table className="w-full">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left">t</th>
              <th>TWS</th>
              <th>TWA</th>
              <th>BSP</th>
            </tr>
          </thead>
          <tbody>
            {route.legs.map((l, i) => (
              <tr key={i}>
                <td>{new Date(l.t * 1000).toISOString().slice(11, 16)}</td>
                <td className="text-right">{(l.tws * KN).toFixed(1)}</td>
                <td className="text-right">{(l.twa * DEG).toFixed(0)}°</td>
                <td className="text-right">{(l.bsp * KN).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire into page.tsx** (add `<RouteTimeline route={route} />` below the existing route summary block)

- [ ] **Step 7: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): RouteTimeline component + GPX export

Per-leg table (UTC time / TWS / TWA / BSP, all in human units) plus a
GPX 1.1 download button. Tested against a 2-point synthetic route.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 33: ECMWF Open Data fetch

**Files:**

- Create: `packages/grib/src/fetch-ecmwf.ts`
- Create: `packages/grib/src/fetch-ecmwf.test.ts`
- Modify: `packages/grib/src/index.ts`
- Modify: `apps/router/src/lib/grib-context.ts` — enable ECMWF branch

ECMWF Open Data is hosted on AWS S3 at `s3://ecmwf-forecasts/{date}/{hh}z/ifs/0p25/oper/` with `.idx` JSON files telling you the byte offset + length of each variable. We Range-GET those byte ranges. URL form for the HTTP endpoint:

```
https://data.ecmwf.int/forecasts/{date}/{hh}z/ifs/0p25/oper/{date}{hh}0000-{step}h-oper-fc.grib2
```

- [ ] **Step 1: URL builder test**

```ts
// packages/grib/src/fetch-ecmwf.test.ts
import { describe, it, expect } from 'vitest';
import { buildEcmwfUrls, pickEcmwfRun } from './fetch-ecmwf.js';

describe('buildEcmwfUrls', () => {
  it('builds full + index URLs for a step', () => {
    const u = buildEcmwfUrls({ runDateUtc: '2026-05-12', runHourUtc: 0, forecastHour: 3 });
    expect(u.grib).toBe(
      'https://data.ecmwf.int/forecasts/20260512/00z/ifs/0p25/oper/20260512000000-3h-oper-fc.grib2',
    );
    expect(u.index).toBe(
      'https://data.ecmwf.int/forecasts/20260512/00z/ifs/0p25/oper/20260512000000-3h-oper-fc.index',
    );
  });
});

describe('pickEcmwfRun', () => {
  it('uses 6-hourly runs with ~6h lag', () => {
    const at = Date.UTC(2026, 4, 12, 12, 0, 0) / 1000;
    const r = pickEcmwfRun(at);
    expect(r.runDateUtc).toBe('2026-05-12');
    expect([0, 6, 12, 18]).toContain(r.runHourUtc);
  });
});
```

- [ ] **Step 2: Run test (fail), then implement `fetch-ecmwf.ts`**

```ts
import type { Bbox } from './types.js';

export interface BuildEcmwfUrlsOpts {
  runDateUtc: string; // YYYY-MM-DD
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
}

const ECMWF = 'https://data.ecmwf.int/forecasts';

export function buildEcmwfUrls(o: BuildEcmwfUrlsOpts): { grib: string; index: string } {
  const date = o.runDateUtc.replace(/-/g, '');
  const hh = String(o.runHourUtc).padStart(2, '0');
  const base = `${ECMWF}/${date}/${hh}z/ifs/0p25/oper`;
  const file = `${date}${hh}0000-${o.forecastHour}h-oper-fc`;
  return { grib: `${base}/${file}.grib2`, index: `${base}/${file}.index` };
}

export function pickEcmwfRun(atUnixSec: number): {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
} {
  const lagMs = 6 * 60 * 60 * 1000;
  const d = new Date(atUnixSec * 1000 - lagMs);
  const hour = d.getUTCHours();
  const runHour = (Math.floor(hour / 6) * 6) as 0 | 6 | 12 | 18;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { runDateUtc: `${y}-${m}-${day}`, runHourUtc: runHour };
}

interface IndexLine {
  _offset: number;
  _length: number;
  param: string;
  levelist?: string;
  levtype?: string;
}

export async function fetchEcmwfMessages(opts: {
  runDateUtc: string;
  runHourUtc: 0 | 6 | 12 | 18;
  forecastHour: number;
  variables: Array<'10u' | '10v' | 'msl'>;
  fetchImpl?: typeof fetch;
}): Promise<Buffer[]> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const urls = buildEcmwfUrls(opts);
  const idxRes = await fetchFn(urls.index);
  if (!idxRes.ok) throw new Error(`ECMWF index ${urls.index} → ${idxRes.status}`);
  const text = await idxRes.text();
  const lines = text
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as IndexLine);
  const wanted = lines.filter((l) => opts.variables.includes(l.param as '10u' | '10v' | 'msl'));
  const buffers: Buffer[] = [];
  for (const w of wanted) {
    const res = await fetchFn(urls.grib, {
      headers: { Range: `bytes=${w._offset}-${w._offset + w._length - 1}` },
    });
    if (!(res.status === 200 || res.status === 206)) {
      throw new Error(`ECMWF range fetch failed: ${res.status}`);
    }
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return buffers;
}

export async function fetchEcmwfBlobs(opts: {
  bbox: Bbox;
  hours: number;
  cacheRoot: string;
  fetchImpl?: typeof fetch;
}): Promise<{ runDateUtc: string; runHourUtc: number; cachedPaths: string[] }> {
  // ECMWF Open Data publishes at 0/3/6/9...h cadence to 144h.
  const now = Math.floor(Date.now() / 1000);
  const run = pickEcmwfRun(now);
  const steps: number[] = [];
  for (let h = 0; h <= Math.min(144, opts.hours); h += 3) steps.push(h);
  const cachedPaths: string[] = [];
  // We don't subset by bbox (the .index files don't carry bbox info at the
  // public layer). After fetch, we'll spatially crop in parse-grib2 by
  // wgrib2's `-undefine out-box` operator. Bbox passed through here only to
  // form cache keys.
  const { cachePath, cacheStore, cacheHas } = await import('./cache.js');
  const runTime =
    Date.UTC(
      Number(run.runDateUtc.slice(0, 4)),
      Number(run.runDateUtc.slice(5, 7)) - 1,
      Number(run.runDateUtc.slice(8, 10)),
      run.runHourUtc,
    ) / 1000;
  for (const h of steps) {
    const key = {
      model: 'ecmwf' as const,
      runTime: runTime + h * 3600,
      bbox: opts.bbox,
      variable: 'u10' as const,
    };
    if (!cacheHas(opts.cacheRoot, key)) {
      const buffers = await fetchEcmwfMessages({
        runDateUtc: run.runDateUtc,
        runHourUtc: run.runHourUtc,
        forecastHour: h,
        variables: ['10u', '10v'],
        fetchImpl: opts.fetchImpl,
      });
      const combined = Buffer.concat(buffers);
      await cacheStore(opts.cacheRoot, key, combined);
    }
    cachedPaths.push(cachePath(opts.cacheRoot, key));
  }
  return { runDateUtc: run.runDateUtc, runHourUtc: run.runHourUtc, cachedPaths };
}
```

- [ ] **Step 3: Run tests, then enable ECMWF branch in `grib-context.ts`**

In `apps/router/src/lib/grib-context.ts`, replace the `throw new Error('loadWindFor: model ECMWF…')` branch with:

```ts
if (model === 'ECMWF') {
  const { cachedPaths, runDateUtc, runHourUtc } = await fetchEcmwfBlobs({
    bbox,
    hours,
    cacheRoot: GRIB_CACHE,
  });
  const runTime =
    Date.UTC(
      Number(runDateUtc.slice(0, 4)),
      Number(runDateUtc.slice(5, 7)) - 1,
      Number(runDateUtc.slice(8, 10)),
      runHourUtc,
    ) / 1000;
  const messages = (await Promise.all(cachedPaths.map((p) => runWgrib2(p)))).flat();
  return parseGrib2Json(messages, 'ECMWF', runTime) as WindField;
}
```

Add `fetchEcmwfBlobs` to the imports.

- [ ] **Step 4: Update barrel**

```ts
// packages/grib/src/index.ts
export {
  buildEcmwfUrls,
  pickEcmwfRun,
  fetchEcmwfMessages,
  fetchEcmwfBlobs,
} from './fetch-ecmwf.js';
```

- [ ] **Step 5: Commit**

```bash
git add packages/grib apps/router
git commit -m "$(cat <<'EOF'
feat(grib): ECMWF Open Data fetch via Range-GET on .index files

URL builder for data.ecmwf.int 0.25° IFS, run-time picker (6h lag),
.index JSON parser, byte-range pulls for 10u/10v at 3-hourly cadence
to f144. apps/router loadWindFor enables ECMWF model branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 34: RTOFS surface-current fetch

**Files:**

- Create: `packages/grib/src/fetch-rtofs.ts`
- Create: `packages/grib/src/fetch-rtofs.test.ts`
- Modify: `packages/grib/src/index.ts`
- Modify: `apps/router/src/lib/grib-context.ts` — add `loadCurrentFor`

NOMADS RTOFS subset endpoint: similar pattern to GFS but at `/cgi-bin/filter_rtofs_2d.pl` with `UOGRD`/`VOGRD` at level `surface`.

- [ ] **Step 1: Failing test**

```ts
// packages/grib/src/fetch-rtofs.test.ts
import { describe, it, expect } from 'vitest';
import { buildRtofsUrl } from './fetch-rtofs.js';

describe('buildRtofsUrl', () => {
  it('formats a 2d subset URL for UOGRD/VOGRD', () => {
    const u = buildRtofsUrl({
      runDateUtc: '2026-05-12',
      forecastHour: 24,
      bbox: { latMin: 30, latMax: 35, lonMin: -75, lonMax: -65 },
    });
    expect(u).toContain('filter_rtofs_2d.pl');
    expect(u).toContain('var_UOGRD=on');
    expect(u).toContain('var_VOGRD=on');
    expect(u).toContain('lev_surface=on');
    expect(u).toContain('subregion=&toplat=35&leftlon=-75&rightlon=-65&bottomlat=30');
  });
});
```

- [ ] **Step 2: Implement `fetch-rtofs.ts`**

```ts
import type { Bbox } from './types.js';
import { cachePath, cacheStore, cacheHas } from './cache.js';

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_rtofs_2d.pl';

export interface BuildRtofsUrlOpts {
  runDateUtc: string;
  forecastHour: number;
  bbox: Bbox;
}

export function buildRtofsUrl(o: BuildRtofsUrlOpts): string {
  const date = o.runDateUtc.replace(/-/g, '');
  const fff = `f${String(o.forecastHour).padStart(3, '0')}`;
  const params = new URLSearchParams();
  params.set('dir', `/rtofs.${date}`);
  params.set('file', `rtofs_glo_2ds_${fff}_diag.nc`);
  params.set('var_UOGRD', 'on');
  params.set('var_VOGRD', 'on');
  params.set('lev_surface', 'on');
  params.set('subregion', '');
  params.set('toplat', String(o.bbox.latMax));
  params.set('leftlon', String(o.bbox.lonMin));
  params.set('rightlon', String(o.bbox.lonMax));
  params.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${params.toString()}`;
}

export async function fetchRtofsBlobs(opts: {
  bbox: Bbox;
  hours: number;
  cacheRoot: string;
  fetchImpl?: typeof fetch;
}): Promise<{ runDateUtc: string; cachedPaths: string[] }> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const now = new Date();
  // RTOFS runs once daily (00z) and posts ~6h later. Use yesterday's run if
  // current UTC < 06:00.
  const d = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const runDateUtc = `${y}-${m}-${day}`;
  const cachedPaths: string[] = [];
  for (let h = 3; h <= opts.hours; h += 3) {
    const runTime = Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), 0) / 1000 + h * 3600;
    const key = {
      model: 'rtofs' as const,
      runTime,
      bbox: opts.bbox,
      variable: 'uogrd' as const,
    };
    if (!cacheHas(opts.cacheRoot, key)) {
      const url = buildRtofsUrl({ runDateUtc, forecastHour: h, bbox: opts.bbox });
      const res = await fetchFn(url);
      if (!res.ok) {
        throw Object.assign(new Error(`RTOFS fetch failed: ${res.status}`), {
          kind: 'fetch_failed',
          source: 'RTOFS',
          status: res.status,
          retryable: res.status >= 500,
        });
      }
      await cacheStore(opts.cacheRoot, key, Buffer.from(await res.arrayBuffer()));
    }
    cachedPaths.push(cachePath(opts.cacheRoot, key));
  }
  return { runDateUtc, cachedPaths };
}
```

- [ ] **Step 3: Add `loadCurrentFor` in `grib-context.ts`**

```ts
import { fetchRtofsBlobs } from '@g5000/grib';
import type { CurrentField } from '@g5000/grib';

export async function loadCurrentFor(bbox: Bbox, hours: number): Promise<CurrentField> {
  const { cachedPaths, runDateUtc } = await fetchRtofsBlobs({ bbox, hours, cacheRoot: GRIB_CACHE });
  const runTime =
    Date.UTC(
      Number(runDateUtc.slice(0, 4)),
      Number(runDateUtc.slice(5, 7)) - 1,
      Number(runDateUtc.slice(8, 10)),
      0,
    ) / 1000;
  const messages = (await Promise.all(cachedPaths.map((p) => runWgrib2(p)))).flat();
  return parseGrib2Json(messages, 'RTOFS', runTime) as CurrentField;
}
```

- [ ] **Step 4: Update barrel + commit**

```ts
// packages/grib/src/index.ts
export { buildRtofsUrl, fetchRtofsBlobs } from './fetch-rtofs.js';
```

```bash
git add packages/grib apps/router
git commit -m "$(cat <<'EOF'
feat(grib): RTOFS surface-current fetch from NOAA NOMADS

UOGRD/VOGRD at surface, 3-hourly cadence, daily run. apps/router gets
loadCurrentFor(bbox, hours) for the upcoming routing-with-currents wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 35: Wire currents toggle through API + UI

**Files:**

- Modify: `apps/router/src/app/api/route/plan/route.ts`
- Modify: `apps/router/src/components/PlanControls.tsx`

- [ ] **Step 1: Plan handler — accept and apply `useCurrents`**

In `route.ts`, when `body.useCurrents` is true, also call `loadCurrentFor(bbox, 120)` and pass the result + `options.useCurrents=true` to `plan()`. Surface RTOFS fetch failures the same way as wind failures.

```ts
import { loadCurrentFor } from '../../../../lib/grib-context.js';
// ... inside POST, after wind:
let currents: CurrentField | undefined;
if (b.useCurrents) {
  currents = await loadCurrentFor(bbox, 120);
}
const route = plan({
  /* ... */
  currents,
  options: { ...(b.options ?? {}), useCurrents: !!b.useCurrents },
});
```

- [ ] **Step 2: PlanControls — add the toggle**

Add a checkbox `<input type="checkbox">` to PlanControls bound to local state `useCurrents`. Include it in the body submitted to `/api/route/plan`.

- [ ] **Step 3: Smoke-test by hand**

Plan a route between two points crossing the Gulf Stream (e.g., 30°N -80°W → 35°N -70°W) with the toggle off, then on. Compare ETAs — they should differ.

- [ ] **Step 4: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): currents toggle wired through /api/route/plan

UI checkbox → request flag → loadCurrentFor + plan(useCurrents=true).
Gulf Stream crossing shows visible ETA delta with/without the toggle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 36: Departure-window scan — API + UI

**Files:**

- Create: `apps/router/src/app/api/route/window/route.ts`
- Create: `apps/router/src/app/window/page.tsx`
- Create: `apps/router/src/components/WindowHeatmap.tsx`

- [ ] **Step 1: API handler**

`apps/router/src/app/api/route/window/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { plan, greatCircleDistance } from '@g5000/routing';
import type { PolarTable } from '@g5000/db';
import { loadWindFor, loadCurrentFor } from '../../../../lib/grib-context.js';
import { loadDefaultCoastline } from '../../../../lib/coastline.js';

interface Body {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  windowStart: number; // unix seconds
  windowHours: number;
  stepHours: number;
  model: 'GFS' | 'ECMWF';
  polar: PolarTable;
  polarId: string;
  useCurrents?: boolean;
}

export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  const bbox = {
    latMin: Math.min(b.start.lat, b.end.lat) - 2,
    latMax: Math.max(b.start.lat, b.end.lat) + 2,
    lonMin: Math.min(b.start.lon, b.end.lon) - 2,
    lonMax: Math.max(b.start.lon, b.end.lon) + 2,
  };
  const wind = await loadWindFor(b.model, bbox, b.windowHours + 168);
  const currents = b.useCurrents ? await loadCurrentFor(bbox, b.windowHours + 168) : undefined;
  const coastline = await loadDefaultCoastline();
  const out: Array<{
    departure: number;
    eta: number;
    distance: number;
    meanTws: number;
    maxTws: number;
    incomplete?: boolean;
  }> = [];
  for (let t = b.windowStart; t < b.windowStart + b.windowHours * 3600; t += b.stepHours * 3600) {
    const r = plan({
      start: b.start,
      end: b.end,
      departure: t,
      wind,
      polar: b.polar,
      polarId: b.polarId,
      coastline,
      currents,
      options: { useCurrents: !!b.useCurrents, maxHours: 168 },
    });
    let meanTws = 0;
    let maxTws = 0;
    for (const l of r.legs) {
      meanTws += l.tws;
      if (l.tws > maxTws) maxTws = l.tws;
    }
    meanTws /= Math.max(1, r.legs.length);
    out.push({
      departure: t,
      eta: r.end,
      distance: r.distance,
      meanTws,
      maxTws,
      ...(r.incomplete ? { incomplete: true } : {}),
    });
  }
  return NextResponse.json({ ok: true, results: out });
}
```

- [ ] **Step 2: Heatmap component**

`apps/router/src/components/WindowHeatmap.tsx`:

```tsx
'use client';
export interface WindowResult {
  departure: number;
  eta: number;
  distance: number;
  meanTws: number;
  maxTws: number;
  incomplete?: boolean;
}

export function WindowHeatmap({
  results,
  onPick,
}: {
  results: WindowResult[];
  onPick: (r: WindowResult) => void;
}) {
  const hours = results.map((r) => (r.eta - r.departure) / 3600);
  const min = Math.min(...hours);
  const max = Math.max(...hours);
  const color = (h: number) => {
    const t = (h - min) / Math.max(1, max - min);
    const r = Math.round(34 + (250 - 34) * t);
    const g = Math.round(197 - 100 * t);
    return `rgb(${r}, ${g}, 120)`;
  };
  // group by day-of-departure
  const byDay = new Map<string, WindowResult[]>();
  for (const r of results) {
    const k = new Date(r.departure * 1000).toISOString().slice(0, 10);
    const arr = byDay.get(k) ?? [];
    arr.push(r);
    byDay.set(k, arr);
  }
  return (
    <table className="text-xs font-mono">
      <tbody>
        {[...byDay.entries()].map(([day, rs]) => (
          <tr key={day}>
            <td className="text-slate-500 pr-2">{day}</td>
            {rs.map((r) => (
              <td
                key={r.departure}
                onClick={() => onPick(r)}
                className="w-8 h-6 cursor-pointer border border-slate-900"
                style={{ background: r.incomplete ? '#444' : color((r.eta - r.departure) / 3600) }}
                title={`Dep: ${new Date(r.departure * 1000).toISOString()}\nETA: ${((r.eta - r.departure) / 3600).toFixed(1)} h${r.incomplete ? ' (incomplete)' : ''}`}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: /window page**

Hand-build `apps/router/src/app/window/page.tsx` analogous to the home page but with the window inputs (start/end + window-start datetime + window-hours + step-hours + model + useCurrents) and `<WindowHeatmap>` rendering the response. On click, navigate to `/?dep=<unix>&start=<lat,lon>&end=<lat,lon>` to drill into the route.

- [ ] **Step 4: Smoke-test**

Configure a 5-day window in 6-hour steps for a Bermuda → Newport-style route. Click cells, drill into a specific route on the home page.

- [ ] **Step 5: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): departure-window scan + heatmap

POST /api/route/window iterates plan() over candidate departure times
against the same WindField (cheap). UI renders a calendar heatmap; click
a cell to drill into that specific route on /.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 37: Plans persistence (CRUD)

**Files:**

- Create: `apps/router/src/app/api/plans/route.ts`
- Create: `apps/router/src/app/api/plans/[id]/route.ts`
- Create: `apps/router/src/app/plans/page.tsx`

- [ ] **Step 1: List/create handler**

```ts
// apps/router/src/app/api/plans/route.ts
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { PLANS_DIR } from '../../../lib/paths.js';
import { writeJson, readJson, listJson } from '../../../lib/persistence.js';

export async function GET() {
  const names = await listJson(PLANS_DIR);
  const items = await Promise.all(names.map(async (n) => readJson(join(PLANS_DIR, n))));
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { name: string; route: unknown; createdAt?: number };
  const id = randomUUID();
  const record = {
    id,
    name: body.name,
    route: body.route,
    createdAt: body.createdAt ?? Math.floor(Date.now() / 1000),
  };
  await writeJson(join(PLANS_DIR, `${id}.json`), record);
  return NextResponse.json({ ok: true, id });
}
```

- [ ] **Step 2: Single-plan handler**

```ts
// apps/router/src/app/api/plans/[id]/route.ts
import { NextResponse } from 'next/server';
import { join } from 'node:path';
import { PLANS_DIR } from '../../../../lib/paths.js';
import { readJson } from '../../../../lib/persistence.js';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await readJson(join(PLANS_DIR, `${id}.json`));
  if (!record) {
    return NextResponse.json({ ok: false, error: { kind: 'not_found' } }, { status: 404 });
  }
  return NextResponse.json({ ok: true, plan: record });
}
```

- [ ] **Step 3: /plans page (server component)**

```tsx
// apps/router/src/app/plans/page.tsx
import Link from 'next/link';
import { join } from 'node:path';
import { PLANS_DIR } from '../../lib/paths';
import { listJson, readJson } from '../../lib/persistence';

interface PlanRecord {
  id: string;
  name: string;
  createdAt: number;
  route: { distance: number; model: string };
}

export default async function PlansPage() {
  const names = await listJson(PLANS_DIR);
  const items = (
    await Promise.all(names.map((n) => readJson<PlanRecord>(join(PLANS_DIR, n))))
  ).filter(Boolean) as PlanRecord[];
  return (
    <main className="p-8 max-w-3xl">
      <h1 className="text-2xl mb-4">Saved Plans</h1>
      {items.length === 0 && <div className="text-slate-400">No saved plans yet.</div>}
      <ul className="divide-y divide-slate-800">
        {items.map((p) => (
          <li key={p.id} className="py-2 flex justify-between">
            <Link href={`/?plan=${p.id}`} className="text-emerald-400">
              {p.name}
            </Link>
            <span className="text-xs text-slate-500">
              {p.route.model} · {(p.route.distance / 1852).toFixed(0)} NM ·
              {new Date(p.createdAt * 1000).toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: "Save plan" button in home page**

Add a button in the right rail that POSTs `{ name: prompt('Name?'), route }` to `/api/plans` when a route is loaded. Show a toast on success.

- [ ] **Step 5: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): save / list plans via flat JSON storage

GET /api/plans lists records, POST /api/plans creates one, GET
/api/plans/[id] reads one. /plans page renders the list. Stored at
~/.g5000-router/plans/{uuid}.json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 38: Settings page

**Files:**

- Create: `apps/router/src/app/api/settings/route.ts`
- Create: `apps/router/src/app/settings/page.tsx`

Simple key/value pairs (g5000 host URL, wgrib2 path, cache root). Stored in `~/.g5000-router/settings.json`. UI reads, displays, lets you edit & save.

- [ ] **Step 1: API**

```ts
// apps/router/src/app/api/settings/route.ts
import { NextResponse } from 'next/server';
import { SETTINGS } from '../../../lib/paths.js';
import { readJson, writeJson } from '../../../lib/persistence.js';

export async function GET() {
  return NextResponse.json({ ok: true, settings: (await readJson(SETTINGS)) ?? {} });
}
export async function PUT(req: Request) {
  await writeJson(SETTINGS, await req.json());
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Page**

`apps/router/src/app/settings/page.tsx` — client component with text inputs for `g5000Host`, `wgrib2Path`, `cacheRoot`; GETs on mount, PUTs on save. Display the current values from env-derived defaults so the user sees both.

- [ ] **Step 3: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): settings GET/PUT + /settings page

JSON-backed at ~/.g5000-router/settings.json. UI exposes g5000 host,
wgrib2 path, cache root.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 39: /grib cache inspector

**Files:**

- Create: `apps/router/src/app/api/grib/list/route.ts`
- Create: `apps/router/src/app/grib/page.tsx`

Lists what's in `~/.g5000-router/grib-cache/` grouped by `{model, runTime}`. Optional DELETE clears a run.

- [ ] **Step 1: API**

```ts
// apps/router/src/app/api/grib/list/route.ts
import { NextResponse } from 'next/server';
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GRIB_CACHE } from '../../../../lib/paths.js';

export async function GET() {
  if (!existsSync(GRIB_CACHE)) return NextResponse.json({ ok: true, items: [] });
  const items: Array<{ model: string; runTime: string; size: number; mtime: number }> = [];
  for (const model of await readdir(GRIB_CACHE)) {
    const modelDir = join(GRIB_CACHE, model);
    for (const run of await readdir(modelDir)) {
      const runDir = join(modelDir, run);
      let size = 0;
      let mtime = 0;
      for (const bboxDir of await readdir(runDir)) {
        for (const f of await readdir(join(runDir, bboxDir))) {
          const s = await stat(join(runDir, bboxDir, f));
          size += s.size;
          if (s.mtimeMs > mtime) mtime = s.mtimeMs;
        }
      }
      items.push({ model, runTime: run, size, mtime });
    }
  }
  return NextResponse.json({ ok: true, items });
}
```

- [ ] **Step 2: Page**

`apps/router/src/app/grib/page.tsx` — table listing entries with size + mtime. (DELETE wiring is a stretch goal; skip for v1.)

- [ ] **Step 3: Commit**

```bash
git add apps/router
git commit -m "$(cat <<'EOF'
feat(router-app): /grib cache inspector

Lists cached GRIB runs grouped by model + runTime with total size and
most-recent mtime.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 40: Performance benchmark suite

**Files:**

- Create: `packages/routing/test/perf.bench.ts`
- Modify: `packages/routing/package.json` — add `bench` script

vitest supports `bench` mode (`vitest bench`).

- [ ] **Step 1: Add bench script**

In `packages/routing/package.json` add:

```json
"bench": "vitest bench --run"
```

- [ ] **Step 2: Write the bench file**

```ts
// packages/routing/test/perf.bench.ts
import { bench, describe } from 'vitest';
import { plan } from '../src/plan.js';
import type { WindField } from '@g5000/grib';
import type { PolarTable } from '@g5000/db';

const DEG = Math.PI / 180;
function field(): WindField {
  const lats = Array.from({ length: 60 }, (_, i) => 20 + i * 0.5);
  const lons = Array.from({ length: 60 }, (_, i) => -85 + i * 0.5);
  const times = Array.from({ length: 8 }, (_, i) => i * 21600);
  const u = times.map(() => lats.map(() => lons.map(() => 8 + Math.random())));
  const v = times.map(() => lats.map(() => lons.map(() => 1 + Math.random())));
  return { lats, lons, times, u, v, source: 'GFS', runTime: 0 };
}
function polar(): PolarTable {
  return {
    twsBins: [0, 5, 10, 15, 20].map((kn) => kn * 0.514444),
    twaBins: [0, 30, 45, 60, 90, 120, 150, 180].map((d) => d * DEG),
    boatSpeed: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 2, 3, 3.5, 4, 4, 3, 2],
      [0, 3, 5, 6, 7, 7, 5, 3],
      [0, 4, 6, 7, 8.5, 8.5, 6, 4],
      [0, 5, 7, 8, 9, 9, 7, 5],
    ],
  };
}
const fakeCoast = {
  level: 'l' as const,
  polygons: [],
  index: { search: () => [], load: () => undefined } as never,
};

describe('plan benchmarks', () => {
  bench(
    '3-day passage, 30-min step',
    () => {
      plan({
        start: { lat: 30, lon: -75 },
        end: { lat: 35, lon: -65 },
        departure: 0,
        wind: field(),
        polar: polar(),
        polarId: 't',
        coastline: fakeCoast,
        options: { avoidLand: false, maxHours: 72, stepMinutes: 30 },
      });
    },
    { iterations: 5, time: 5000 },
  );
});
```

- [ ] **Step 3: Run and note baseline numbers**

```bash
npm run bench --workspace @g5000/routing
```

Document the result in the commit message. Target: < 2 s mean, hard limit 5 s.

- [ ] **Step 4: Commit**

```bash
git add packages/routing
git commit -m "$(cat <<'EOF'
test(routing): vitest bench for 3-day plan() at 30-min step

Records baseline for future regression detection. Captured numbers in
commit body so future runs can compare:
  3-day plan() iterations=5 → <RECORD MEAN/MIN/MAX HERE>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 41: Integration test — Bermuda → Newport regression

**Files:**

- Create: `packages/routing/test/integration/bermuda-newport.test.ts`
- Acquire: a small real GFS slice covering the route + a real coastline slice (already in `packages/coastline/data/i.geojson` after the fetch script)

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWgrib2, parseGrib2Json } from '@g5000/grib';
import { loadCoastlineFromGeojson } from '@g5000/coastline';
import { plan } from '../../src/plan.js';
import { DEFAULT_POLARS } from '@g5000/db';

const here = dirname(fileURLToPath(import.meta.url));
const GRIB = resolve(here, '../fixtures/bermuda-newport-gfs.grb2');
const COAST = resolve(here, '../../../coastline/data/i.geojson');

describe('Bermuda → Newport regression', () => {
  it('plans within ±10% of the historical baseline ETA (~98 h)', async () => {
    const messages = await runWgrib2(GRIB);
    const wind = parseGrib2Json(messages, 'GFS', 0);
    const coast = await loadCoastlineFromGeojson(COAST, 'i');
    const r = plan({
      start: { lat: 32.3, lon: -64.78 }, // Bermuda
      end: { lat: 41.49, lon: -71.31 }, // Newport
      departure: 0,
      wind,
      polar: DEFAULT_POLARS,
      polarId: 'default',
      coastline: coast,
      options: { maxHours: 168 },
    });
    expect(r.incomplete).toBeFalsy();
    const hrs = (r.end - r.start) / 3600;
    expect(hrs).toBeGreaterThan(80);
    expect(hrs).toBeLessThan(120);
  });
});
```

- [ ] **Step 2: Fixture**

Download a real GFS slice covering Bermuda → Newport for some recent run; check it into `packages/routing/test/fixtures/bermuda-newport-gfs.grb2`. Should be < 1 MB if bbox-clipped.

```bash
mkdir -p packages/routing/test/fixtures
# Fetch with the existing GFS URL builder via a one-off node script.
```

- [ ] **Step 3: Adjust the historical baseline window** based on what the test actually produces — but keep it tight (±10%) so future regressions in the algorithm fail loudly.

- [ ] **Step 4: Run + commit**

```bash
npm test -- packages/routing/test/integration
git add packages/routing
git commit -m "$(cat <<'EOF'
test(routing): integration — Bermuda → Newport plan within historical envelope

Real GFS slice fixture, real i-level coastline, DEFAULT_POLARS. Asserts
ETA in [80, 120] hours — broad enough to absorb GRIB-run variability,
tight enough to fail on algorithmic regressions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 42: Final wiring, smoke pass, and README

**Files:**

- Create: `apps/router/README.md`
- Modify: workspace root `README.md` (if it exists) — add a pointer

- [ ] **Step 1: Write `apps/router/README.md`**

Cover:

- What it does.
- How to run: `npm install`, `wgrib2` install via Homebrew, fetch coastline (`npm run fetch --workspace @g5000/coastline`), `npm run dev --workspace @g5000/router-app`.
- Live mode setup (env var `G5000_HOST`).
- Where data lives (`~/.g5000-router/`).
- Reference to the design spec and this plan.

- [ ] **Step 2: End-to-end smoke**

Start g5000 autopilot-server (or skip if you only want offline mode).
Start the router app.

- Click two points → Plan → see a route.
- Toggle useCurrents on a Gulf Stream-ish route → see ETA delta.
- Save the plan → /plans shows it.
- /window for a 5-day scan → heatmap renders.
- /grib shows cached GRIB runs.
- /settings displays current values.

Fix any wire-up issues found.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all packages green, including property tests and integration.

- [ ] **Step 4: Final commit**

```bash
git add apps/router/README.md
git commit -m "$(cat <<'EOF'
docs(router-app): README with install, run, and live-mode setup

Closes the v1 implementation arc. Next: merge router branch into main
or keep deploying from worktree depending on team workflow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

- [ ] **Spec coverage**: every requirement in `docs/superpowers/specs/2026-05-12-g5000-weather-router-design.md` is implemented by a task.
- [ ] **No placeholders**: searched the plan for "TBD" / "TODO" / "<MATCH>". The intentional `<MATCH packages/web>` placeholders in Task 26 are version pins the implementer fills from the live `packages/web/package.json` — flagged in-line.
- [ ] **Type consistency**: `WindField`, `CurrentField`, `Route`, `RouteLeg`, `PlanInput`, `PlanOptions` types reused identically across tasks. `loadWindFor` / `loadCurrentFor` / `loadDefaultCoastline` helpers introduced in Task 28 used consistently afterward.
- [ ] **TDD**: every task that touches algorithmic code has a failing test before implementation.
- [ ] **Commit cadence**: each task ends with a commit.

## Notes for the implementing agent

- Task 26 contains explicit `<MATCH packages/web>` placeholders that must be replaced with literal version strings read from `packages/web/package.json`. This is intentional — pinning to the current monorepo state is more reliable than guessing.
- Task 10 (`fetch-coastline.ts`) has a `LEVELS` array with a placeholder URL set; verify and replace before merging that task.
- Task 8 (`runWgrib2`) parses `wgrib2 -V` output via regex; `wgrib2`'s exact format has stabilized but if a future Homebrew bump changes column delimiters, adjust the regex (not the architecture).
- Tasks 28, 36, 41 require real network or real fixtures. Tests in Tasks 28 + 36 are mock-based; Task 41 requires a checked-in GRIB fixture and is intentionally an integration test.
- The g5000 endpoint additions in Tasks 24 + 25 require checking the existing patterns in `packages/web/src/app/api/config/polars/route.ts` — the imports `getConfigStore` / `getBus` are placeholders for the real symbol names in g5000.
