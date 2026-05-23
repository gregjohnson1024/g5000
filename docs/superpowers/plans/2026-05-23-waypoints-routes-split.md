# Waypoints / Routes Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `/marks-and-routes` into separate `/waypoints` and `/routes` pages, add a first-class `Route` entity (ordered list of waypoint references), move waypoint+route storage from a JSON file into ConfigStore (SQLite), and make `/chart` display-only (remove the click-to-define plan flow).

**Architecture:** Two new singleton-blob ConfigStore tables (`waypoints` holds `Waypoint[]`, `routes` holds `Route[]`) following the existing `sail_wardrobe` pattern. Web-lib accessors do per-item CRUD via read-modify-write of the whole collection. A boot-time migration imports the legacy `~/.g5000-router/waypoints.json`. New `/routes` page has a list/form route builder with create-on-the-fly waypoints; "Plan" delegates first→last to the existing weather router. The chart keeps `?plan=<id>` display but loses `PlanControls`.

**Tech Stack:** TypeScript (ESM, strict), Next.js 16 App Router, React 19, better-sqlite3 via Drizzle (`@g5000/db`), RxJS, vitest. Spec: `docs/superpowers/specs/2026-05-23-waypoints-routes-split-design.md`.

**Baseline test note:** Route-handler tests that call `getSharedConfigStore()` are red under bare vitest (documented baseline) — test the store + lib accessors directly with `ConfigStore.open(tmpfile)`, per Task patterns below.

---

## File structure

**Create:**
- `packages/db/src/waypoints-routes-types.ts` — `Waypoint`, `Route` interfaces.
- `packages/db/src/waypoints-routes-types.test.ts` — (none; types only — skip).
- `packages/web/src/lib/routes.ts` — route CRUD + referential integrity, ConfigStore-backed.
- `packages/web/src/lib/routes.test.ts`
- `packages/web/src/app/api/routes/route.ts` — GET list, POST create.
- `packages/web/src/app/api/routes/[id]/route.ts` — GET, PUT, DELETE.
- `packages/web/src/app/api/routes/[id]/plan/route.ts` — POST: first→last weather route.
- `packages/web/src/app/waypoints/page.tsx` — waypoint CRUD page (moved from marks-and-routes).
- `packages/web/src/app/routes/page.tsx` — routes list + builder page.
- `packages/web/src/app/routes/RouteBuilder.tsx` — the builder component.
- `packages/web/src/app/marks-and-routes/page.tsx` — replace body with a redirect to `/waypoints`.
- `apps/g5000/src/migrate-waypoints.ts` — boot-time JSON→ConfigStore import.
- `apps/g5000/src/migrate-waypoints.test.ts`

**Modify:**
- `packages/db/src/schema.ts` — add `waypoints`, `routes` tables.
- `packages/db/src/config-store.ts` — CREATE TABLE lines + load + getters/setters for waypoints & routes.
- `packages/db/src/config-store.test.ts` — add waypoints/routes round-trip tests.
- `packages/db/src/index.ts` — export new types + (transitively) new store methods.
- `packages/web/src/lib/waypoints.ts` — refactor from `fs` JSON to ConfigStore; add `waypointInUse` helper.
- `packages/web/src/lib/waypoints.test.ts` — adjust to ConfigStore-backed.
- `packages/web/src/app/api/waypoints/[id]/route.ts` — DELETE gains in-use-by-route guard (409).
- `packages/web/src/app/Navbar.tsx` — replace one nav item with two.
- `packages/web/src/app/chart/page.tsx` — remove PlanControls + start/end/define plumbing; keep `?plan=`.
- `apps/g5000/src/index.ts` — call the migration after ConfigStore opens.

**Delete (after `/waypoints` lands):**
- The waypoint UI sections inside the old `marks-and-routes/page.tsx` (replaced by redirect).

---

## Task 1: Define Waypoint + Route types in @g5000/db

**Files:**
- Create: `packages/db/src/waypoints-routes-types.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create the types file**

```ts
// packages/db/src/waypoints-routes-types.ts

/** A single named point. Stored as one of a Waypoint[] blob in ConfigStore. */
export interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Optional free-form notes. */
  notes?: string;
  /** Set on create, ISO 8601. */
  createdAt: string;
}

/** An ordered list of references to saved waypoints. */
export interface Route {
  id: string;
  name: string;
  /** Ordered waypoint ids. Every id must exist in the waypoints table. */
  waypointIds: string[];
  notes?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

- [ ] **Step 2: Export from the package index**

In `packages/db/src/index.ts`, add near the other type exports:

```ts
export type { Waypoint, Route } from './waypoints-routes-types.js';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @g5000/db`
Expected: passes (no emit errors).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/waypoints-routes-types.ts packages/db/src/index.ts
git commit -m "feat(db): Waypoint + Route types"
```

---

## Task 2: Add waypoints + routes tables to ConfigStore

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/config-store.ts`
- Test: `packages/db/src/config-store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/config-store.test.ts` (follow the existing temp-dir pattern in that file — `ConfigStore.open(path.join(dir,'config.db'))` in `beforeEach`, `store.close()` in `afterEach`):

```ts
import { firstValueFrom } from 'rxjs';
import type { Waypoint, Route } from './waypoints-routes-types.js';

describe('ConfigStore waypoints + routes', () => {
  it('defaults to empty lists', async () => {
    expect(store.getWaypoints()).toEqual([]);
    expect(store.getRoutes()).toEqual([]);
  });

  it('round-trips waypoints', async () => {
    const wps: Waypoint[] = [
      { id: 'a', name: 'A', lat: 41, lon: -71, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    await store.setWaypoints(wps);
    expect(store.getWaypoints()).toEqual(wps);
    expect(await firstValueFrom(store.waypoints$)).toEqual(wps);
  });

  it('round-trips routes', async () => {
    const rts: Route[] = [
      {
        id: 'r1',
        name: 'R1',
        waypointIds: ['a', 'b'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    await store.setRoutes(rts);
    expect(store.getRoutes()).toEqual(rts);
    expect(await firstValueFrom(store.routes$)).toEqual(rts);
  });

  it('persists across reopen', async () => {
    await store.setWaypoints([
      { id: 'x', name: 'X', lat: 0, lon: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    await store.close();
    store = await ConfigStore.open(dbPath); // dbPath captured in beforeEach
    expect(store.getWaypoints().map((w) => w.id)).toEqual(['x']);
  });
});
```

> If `config-store.test.ts` doesn't already keep the db path in a variable, capture it in `beforeEach`: `dbPath = path.join(dir, 'config.db'); store = await ConfigStore.open(dbPath);`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/db/src/config-store.test.ts -t "waypoints + routes"`
Expected: FAIL — `store.getWaypoints is not a function`.

- [ ] **Step 3: Add the schema tables**

In `packages/db/src/schema.ts`, add alongside the other `(id, value)` tables:

```ts
export const waypoints = sqliteTable('waypoints', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded Waypoint[]
});

export const routes = sqliteTable('routes', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded Route[]
});
```

- [ ] **Step 4: Add CREATE TABLE lines**

In `packages/db/src/config-store.ts`, inside the `raw.exec(\`...\`)` block (around line 137, next to `passage_log`), add:

```sql
      CREATE TABLE IF NOT EXISTS waypoints (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS routes (id TEXT PRIMARY KEY, value TEXT NOT NULL);
```

- [ ] **Step 5: Load defaults + wire BehaviorSubjects (mirror the `sails` wiring)**

In `config-store.ts`:

1. Import the tables and types at top:
```ts
import { waypoints as waypointsTable, routes as routesTable } from './schema.js';
import type { Waypoint, Route } from './waypoints-routes-types.js';
```

2. In the static `open()` method, after the other `loadOrInsert` calls, load both (they use the same `SINGLETON` id and the local `loadOrInsert<T>(table, default)` helper):
```ts
const waypointsValue = loadOrInsert<Waypoint[]>(waypointsTable, []);
const routesValue = loadOrInsert<Route[]>(routesTable, []);
```
Pass `waypointsValue` and `routesValue` into the `ConfigStore` constructor call (extend the constructor signature accordingly — match how `sailWardrobe`'s value is threaded through).

3. Add private fields + init in the constructor:
```ts
private readonly waypoints$$: BehaviorSubject<Waypoint[]>;
private readonly routes$$: BehaviorSubject<Route[]>;
// in constructor body:
this.waypoints$$ = new BehaviorSubject<Waypoint[]>(waypointsValue);
this.routes$$ = new BehaviorSubject<Route[]>(routesValue);
```

4. Add public accessors (place near `sails$` / `setSails`):
```ts
get waypoints$(): Observable<Waypoint[]> {
  return this.waypoints$$.asObservable();
}
getWaypoints(): Waypoint[] {
  return this.waypoints$$.value;
}
async setWaypoints(value: Waypoint[]): Promise<void> {
  this.upsert(waypointsTable, value);
  this.waypoints$$.next(value);
}

get routes$(): Observable<Route[]> {
  return this.routes$$.asObservable();
}
getRoutes(): Route[] {
  return this.routes$$.value;
}
async setRoutes(value: Route[]): Promise<void> {
  this.upsert(routesTable, value);
  this.routes$$.next(value);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run packages/db/src/config-store.test.ts -t "waypoints + routes"`
Expected: PASS (all 4).

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck --workspace @g5000/db
git add packages/db/src/schema.ts packages/db/src/config-store.ts packages/db/src/config-store.test.ts
git commit -m "feat(db): waypoints + routes ConfigStore tables"
```

---

## Task 3: Refactor web-lib waypoints accessor to ConfigStore

**Files:**
- Modify: `packages/web/src/lib/waypoints.ts`
- Test: `packages/web/src/lib/waypoints.test.ts`

**Context:** Today `waypoints.ts` reads/writes `~/.g5000-router/waypoints.json` and reseeds 4 hardcoded waypoints on every read. Keep the seed constants and the slug/validation logic; swap the `fs` read/write for `getSharedConfigStore().getWaypoints()` / `setWaypoints()`. Reseeding now means: on read, union the store's list with any missing seeds (by id) and persist if it changed.

- [ ] **Step 1: Write the failing test**

Replace the file-based test with a ConfigStore-backed one. `packages/web/src/lib/waypoints.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore, setSharedConfigStore } from '@g5000/db';
import {
  listWaypoints,
  createWaypoint,
  updateWaypoint,
  deleteWaypoint,
  SEED_WAYPOINT_IDS,
} from './waypoints';

let dir: string;
let store: ConfigStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'g5000-wps-'));
  store = await ConfigStore.open(path.join(dir, 'config.db'));
  setSharedConfigStore(store);
});
afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('waypoints lib (ConfigStore)', () => {
  it('seeds the canonical waypoints into an empty store', async () => {
    const list = await listWaypoints();
    for (const id of SEED_WAYPOINT_IDS) {
      expect(list.find((w) => w.id === id)).toBeDefined();
    }
  });

  it('creates, updates, deletes', async () => {
    const wp = await createWaypoint({ name: 'Test', lat: 41.5, lon: -71.3 });
    expect(wp.id).toBe('test');
    const upd = await updateWaypoint('test', { name: 'Test 2' });
    expect(upd?.name).toBe('Test 2');
    expect(await deleteWaypoint('test')).toBe(true);
    const list = await listWaypoints();
    expect(list.find((w) => w.id === 'test')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/waypoints.test.ts`
Expected: FAIL — `SEED_WAYPOINT_IDS` not exported / functions still read fs.

- [ ] **Step 3: Refactor `waypoints.ts`**

Rewrite the I/O layer; keep the seed constants (NANTUCKET, NEWPORT, BLOCK_ISLAND, MOORE_BROS) and the `slugify`/validation. Replace `readWaypoints`/`writeWaypoints`:

```ts
import { getSharedConfigStore, type Waypoint } from '@g5000/db';

export type { Waypoint };

const SEEDS: Waypoint[] = [NANTUCKET, NEWPORT, BLOCK_ISLAND, MOORE_BROS];
export const SEED_WAYPOINT_IDS = SEEDS.map((w) => w.id);

/** Read the store, union any missing seeds, persist if changed. */
async function readWaypoints(): Promise<Waypoint[]> {
  const store = getSharedConfigStore();
  const current = store.getWaypoints();
  const byId = new Map(current.map((w) => [w.id, w]));
  let changed = false;
  for (const seed of SEEDS) {
    if (!byId.has(seed.id)) {
      byId.set(seed.id, seed);
      changed = true;
    }
  }
  const list = [...byId.values()];
  if (changed) await store.setWaypoints(list);
  return list;
}

async function writeWaypoints(list: Waypoint[]): Promise<void> {
  await getSharedConfigStore().setWaypoints(list);
}
```

Keep `listWaypoints`, `getWaypoint`, `createWaypoint`, `updateWaypoint`, `deleteWaypoint` calling `readWaypoints`/`writeWaypoints` exactly as before — their bodies don't change. Remove the now-unused `fs`/`paths` imports and the `isWaypoint` file-guard if it's no longer referenced.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/waypoints.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck --workspace @g5000/web
git add packages/web/src/lib/waypoints.ts packages/web/src/lib/waypoints.test.ts
git commit -m "refactor(web): waypoints lib backed by ConfigStore"
```

---

## Task 4: Boot-time migration of legacy waypoints.json

**Files:**
- Create: `apps/g5000/src/migrate-waypoints.ts`
- Test: `apps/g5000/src/migrate-waypoints.test.ts`
- Modify: `apps/g5000/src/index.ts`

- [ ] **Step 1: Write the failing test**

`apps/g5000/src/migrate-waypoints.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore } from '@g5000/db';
import { migrateWaypointsJson } from './migrate-waypoints.js';

let dir: string;
let store: ConfigStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'g5000-mig-'));
  store = await ConfigStore.open(path.join(dir, 'config.db'));
});
afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrateWaypointsJson', () => {
  it('imports waypoints and renames the file', async () => {
    const file = path.join(dir, 'waypoints.json');
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'foo', name: 'Foo', lat: 41, lon: -71, createdAt: '2026-01-01T00:00:00.000Z' },
      ]),
    );
    await migrateWaypointsJson(store, file);
    expect(store.getWaypoints().find((w) => w.id === 'foo')).toBeDefined();
    expect(existsSync(file)).toBe(false);
    expect(existsSync(file + '.migrated')).toBe(true);
  });

  it('no-ops when the store already has waypoints', async () => {
    await store.setWaypoints([
      { id: 'x', name: 'X', lat: 0, lon: 0, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const file = path.join(dir, 'waypoints.json');
    writeFileSync(file, JSON.stringify([{ id: 'foo', name: 'Foo', lat: 1, lon: 1, createdAt: 'x' }]));
    await migrateWaypointsJson(store, file);
    expect(store.getWaypoints().map((w) => w.id)).toEqual(['x']);
    expect(existsSync(file)).toBe(true); // untouched
  });

  it('no-ops when the file is absent', async () => {
    await migrateWaypointsJson(store, path.join(dir, 'nope.json'));
    expect(store.getWaypoints()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/g5000/src/migrate-waypoints.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the migration**

`apps/g5000/src/migrate-waypoints.ts`:

```ts
import { readFile, rename } from 'node:fs/promises';
import type { ConfigStore, Waypoint } from '@g5000/db';

/**
 * One-time import of the legacy waypoints.json into ConfigStore. Idempotent:
 * runs only when the store is empty AND the file exists. Renames the file to
 * `.migrated` afterwards so a re-run is a no-op.
 */
export async function migrateWaypointsJson(store: ConfigStore, file: string): Promise<void> {
  if (store.getWaypoints().length > 0) return;
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return; // no file → nothing to migrate
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  const valid = parsed.filter(
    (w): w is Waypoint =>
      typeof w === 'object' &&
      w !== null &&
      typeof (w as Waypoint).id === 'string' &&
      typeof (w as Waypoint).lat === 'number' &&
      typeof (w as Waypoint).lon === 'number',
  );
  if (valid.length > 0) await store.setWaypoints(valid);
  await rename(file, file + '.migrated');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/g5000/src/migrate-waypoints.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Call it at boot**

In `apps/g5000/src/index.ts`, after the `ConfigStore` is opened and published as the shared store, add:

```ts
import { migrateWaypointsJson } from './migrate-waypoints.js';
import { homedir } from 'node:os';
import path from 'node:path';

// One-time import of legacy ~/.g5000-router/waypoints.json into ConfigStore.
const routerRoot = process.env.G5000_ROUTER_ROOT ?? path.join(homedir(), '.g5000-router');
await migrateWaypointsJson(configStore, path.join(routerRoot, 'waypoints.json'));
```

(Use whatever the local variable for the opened store is named — match the existing boot code.)

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck --workspace @g5000/app
git add apps/g5000/src/migrate-waypoints.ts apps/g5000/src/migrate-waypoints.test.ts apps/g5000/src/index.ts
git commit -m "feat(app): migrate legacy waypoints.json into ConfigStore at boot"
```

---

## Task 5: Routes web-lib accessor + referential integrity

**Files:**
- Create: `packages/web/src/lib/routes.ts`
- Test: `packages/web/src/lib/routes.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/src/lib/routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigStore, setSharedConfigStore } from '@g5000/db';
import { listRoutes, createRoute, updateRoute, deleteRoute, routesUsingWaypoint } from './routes';

let dir: string;
let store: ConfigStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'g5000-rts-'));
  store = await ConfigStore.open(path.join(dir, 'config.db'));
  setSharedConfigStore(store);
  await store.setWaypoints([
    { id: 'a', name: 'A', lat: 41, lon: -71, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', name: 'B', lat: 42, lon: -72, createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
});
afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('routes lib', () => {
  it('creates a route referencing existing waypoints', async () => {
    const r = await createRoute({ name: 'R', waypointIds: ['a', 'b'] });
    expect(r.id).toBe('r');
    expect(r.waypointIds).toEqual(['a', 'b']);
    expect((await listRoutes()).length).toBe(1);
  });

  it('rejects unknown waypoint ids', async () => {
    await expect(createRoute({ name: 'Bad', waypointIds: ['a', 'ghost'] })).rejects.toThrow(
      /unknown waypoint/i,
    );
  });

  it('updates and deletes', async () => {
    await createRoute({ name: 'R', waypointIds: ['a'] });
    const upd = await updateRoute('r', { waypointIds: ['a', 'b'] });
    expect(upd?.waypointIds).toEqual(['a', 'b']);
    expect(await deleteRoute('r')).toBe(true);
  });

  it('reports routes using a waypoint', async () => {
    await createRoute({ name: 'R', waypointIds: ['a', 'b'] });
    expect((await routesUsingWaypoint('b')).map((r) => r.name)).toEqual(['R']);
    expect(await routesUsingWaypoint('a')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `routes.ts`**

```ts
// packages/web/src/lib/routes.ts
import { getSharedConfigStore, type Route } from '@g5000/db';

export type { Route };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function read(): Promise<Route[]> {
  return getSharedConfigStore().getRoutes();
}
async function write(list: Route[]): Promise<void> {
  await getSharedConfigStore().setRoutes(list);
}

function assertWaypointsExist(waypointIds: string[]): void {
  const known = new Set(getSharedConfigStore().getWaypoints().map((w) => w.id));
  const unknown = waypointIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`unknown waypoint id(s): ${unknown.join(', ')}`);
  }
}

export async function listRoutes(): Promise<Route[]> {
  return read();
}

export async function getRoute(id: string): Promise<Route | null> {
  return (await read()).find((r) => r.id === id) ?? null;
}

export async function createRoute(input: {
  name: string;
  waypointIds: string[];
  notes?: string;
  id?: string;
}): Promise<Route> {
  assertWaypointsExist(input.waypointIds);
  const list = await read();
  const id = input.id?.trim() || slugify(input.name);
  if (!id) throw new Error('route id could not be derived from name');
  if (list.some((r) => r.id === id)) throw new Error(`route id already exists: ${id}`);
  const now = new Date().toISOString();
  const route: Route = {
    id,
    name: input.name,
    waypointIds: input.waypointIds,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  await write([...list, route]);
  return route;
}

export async function updateRoute(
  id: string,
  patch: Partial<Pick<Route, 'name' | 'waypointIds' | 'notes'>>,
): Promise<Route | null> {
  if (patch.waypointIds) assertWaypointsExist(patch.waypointIds);
  const list = await read();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const updated: Route = { ...list[idx]!, ...patch, updatedAt: new Date().toISOString() };
  list[idx] = updated;
  await write(list);
  return updated;
}

export async function deleteRoute(id: string): Promise<boolean> {
  const list = await read();
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return false;
  await write(next);
  return true;
}

/** Routes that reference the given waypoint id (for the delete guard). */
export async function routesUsingWaypoint(waypointId: string): Promise<Route[]> {
  return (await read()).filter((r) => r.waypointIds.includes(waypointId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/routes.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/routes.ts packages/web/src/lib/routes.test.ts
git commit -m "feat(web): routes lib with referential integrity"
```

---

## Task 6: Waypoint DELETE guard (in-use-by-route)

**Files:**
- Modify: `packages/web/src/app/api/waypoints/[id]/route.ts`

- [ ] **Step 1: Add the guard to DELETE**

In the `DELETE` handler, before calling `deleteWaypoint(id)`:

```ts
import { routesUsingWaypoint } from '../../../../lib/routes';

// ... inside DELETE, after resolving `id`:
const inUse = await routesUsingWaypoint(id);
if (inUse.length > 0) {
  return Response.json(
    {
      ok: false,
      error: {
        code: 'waypoint_in_use',
        message: `Waypoint is used by route(s): ${inUse.map((r) => r.name).join(', ')}`,
        routes: inUse.map((r) => ({ id: r.id, name: r.name })),
      },
    },
    { status: 409 },
  );
}
```

(Adjust the relative import depth to match the file's location.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/waypoints/[id]/route.ts
git commit -m "feat(web): block deleting a waypoint used by a route (409)"
```

---

## Task 7: Routes API — list/create/get/update/delete

**Files:**
- Create: `packages/web/src/app/api/routes/route.ts`
- Create: `packages/web/src/app/api/routes/[id]/route.ts`

- [ ] **Step 1: Implement the collection route**

`packages/web/src/app/api/routes/route.ts` (mirror the existing `api/waypoints/route.ts` shape):

```ts
import { listRoutes, createRoute } from '../../../lib/routes';

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, routes: await listRoutes() });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const b = body as { name?: unknown; waypointIds?: unknown; notes?: unknown; id?: unknown };
  if (typeof b.name !== 'string' || b.name.trim() === '') {
    return Response.json({ ok: false, error: { message: 'name is required' } }, { status: 400 });
  }
  if (!Array.isArray(b.waypointIds) || !b.waypointIds.every((x) => typeof x === 'string')) {
    return Response.json(
      { ok: false, error: { message: 'waypointIds must be string[]' } },
      { status: 400 },
    );
  }
  try {
    const route = await createRoute({
      name: b.name,
      waypointIds: b.waypointIds as string[],
      notes: typeof b.notes === 'string' ? b.notes : undefined,
      id: typeof b.id === 'string' ? b.id : undefined,
    });
    return Response.json({ ok: true, route }, { status: 201 });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : 'create failed' } },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 2: Implement the item route**

`packages/web/src/app/api/routes/[id]/route.ts`:

```ts
import { getRoute, updateRoute, deleteRoute } from '../../../../lib/routes';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const route = await getRoute(id);
  return route
    ? Response.json({ ok: true, route })
    : Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const b = body as { name?: unknown; waypointIds?: unknown; notes?: unknown };
  const patch: { name?: string; waypointIds?: string[]; notes?: string } = {};
  if (typeof b.name === 'string') patch.name = b.name;
  if (Array.isArray(b.waypointIds) && b.waypointIds.every((x) => typeof x === 'string')) {
    patch.waypointIds = b.waypointIds as string[];
  }
  if (typeof b.notes === 'string') patch.notes = b.notes;
  try {
    const route = await updateRoute(id, patch);
    return route
      ? Response.json({ ok: true, route })
      : Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
  } catch (e) {
    return Response.json(
      { ok: false, error: { message: e instanceof Error ? e.message : 'update failed' } },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return (await deleteRoute(id))
    ? Response.json({ ok: true })
    : Response.json({ ok: false, error: { message: 'not found' } }, { status: 404 });
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck --workspace @g5000/web
git add packages/web/src/app/api/routes
git commit -m "feat(web): /api/routes CRUD endpoints"
```

---

## Task 8: Routes "Plan" endpoint (first → last)

**Files:**
- Create: `packages/web/src/app/api/routes/[id]/plan/route.ts`

**Context:** Reuse the existing weather router. The chart's old `onPlan` POSTed `{ start, end, departure, model, polarId, polar, useCurrents }` to `/api/route/plan`. This endpoint resolves the route's first + last waypoint to coordinates and forwards the same request shape, defaulting departure=now and fetching the active polar from `/api/wardrobe/active` server-side.

- [ ] **Step 1: Implement the plan endpoint**

`packages/web/src/app/api/routes/[id]/plan/route.ts`:

```ts
import { getRoute } from '../../../../../lib/routes';
import { getWaypoint } from '../../../../../lib/waypoints';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) return Response.json({ ok: false, error: { message: 'route not found' } }, { status: 404 });
  if (route.waypointIds.length < 2) {
    return Response.json(
      { ok: false, error: { message: 'route needs at least 2 waypoints to plan' } },
      { status: 400 },
    );
  }
  const firstWp = await getWaypoint(route.waypointIds[0]!);
  const lastWp = await getWaypoint(route.waypointIds[route.waypointIds.length - 1]!);
  if (!firstWp || !lastWp) {
    return Response.json(
      { ok: false, error: { message: 'route references a missing waypoint' } },
      { status: 409 },
    );
  }

  // Optional client overrides (model, departure, useCurrents); else defaults.
  let opts: { model?: 'GFS' | 'ECMWF'; departure?: number; useCurrents?: boolean } = {};
  try {
    opts = (await req.json()) as typeof opts;
  } catch {
    /* empty body is fine */
  }

  // Fetch the active polar the same way PlanControls did.
  const origin = new URL(req.url).origin;
  const wRes = await fetch(`${origin}/api/wardrobe/active`, { cache: 'no-store' });
  const wJson = (await wRes.json()) as { ok: boolean; polarId?: string; polar?: unknown };
  if (!wJson.ok || !wJson.polar) {
    return Response.json({ ok: false, error: { message: 'no active polar' } }, { status: 409 });
  }

  const planReq = {
    start: { lat: firstWp.lat, lon: firstWp.lon },
    end: { lat: lastWp.lat, lon: lastWp.lon },
    departure: opts.departure ?? Math.floor(Date.now() / 1000),
    model: opts.model ?? 'GFS',
    polarId: wJson.polarId ?? 'active',
    polar: wJson.polar,
    useCurrents: opts.useCurrents ?? true,
  };

  const planRes = await fetch(`${origin}/api/route/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(planReq),
  });
  const planJson = await planRes.json();
  return Response.json(planJson, { status: planRes.status });
}
```

> Verify the `/api/wardrobe/active` and `/api/route/plan` request/response shapes against the current `PlanControls.tsx` (lines ~68-90) and `api/route/plan/route.ts` before finalizing — match field names exactly.

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck --workspace @g5000/web
git add packages/web/src/app/api/routes/[id]/plan
git commit -m "feat(web): POST /api/routes/[id]/plan — weather-route first→last"
```

---

## Task 9: `/waypoints` page (move waypoint UI)

**Files:**
- Create: `packages/web/src/app/waypoints/page.tsx`

- [ ] **Step 1: Create the page**

Copy the **waypoint** portions of `marks-and-routes/page.tsx` (the new-waypoint form, the saved-waypoints table with inline edit + distance column — lines ~236-428 and their supporting state/handlers at ~49-228) into `packages/web/src/app/waypoints/page.tsx`. **Drop** the "Saved routes" section (lines ~430-462) and its `plans`/`reloadPlans`/`deletePlan` state — that moves to `/routes`. Update the page heading to "Waypoints". Keep the `'use client'` directive and all fetch calls (`/api/waypoints`, `/api/stats/eta`) intact.

Add handling for the new 409 on delete: when `DELETE /api/waypoints/[id]` returns `ok:false` with `error.code === 'waypoint_in_use'`, show `error.message` to the user instead of removing the row.

- [ ] **Step 2: Verify it compiles via the dev server**

The dev server (DEMO_MODE) is running. Run:
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/waypoints`
Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/waypoints/page.tsx
git commit -m "feat(web): /waypoints page (waypoint CRUD)"
```

---

## Task 10: `/routes` page + RouteBuilder

**Files:**
- Create: `packages/web/src/app/routes/RouteBuilder.tsx`
- Create: `packages/web/src/app/routes/page.tsx`
- Test: `packages/web/src/app/routes/reorder.test.ts`

- [ ] **Step 1: Write the failing reorder test**

Pure helper for drag-reorder so it's unit-testable. `packages/web/src/app/routes/reorder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reorder } from './reorder';

describe('reorder', () => {
  it('moves an item from one index to another', () => {
    expect(reorder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(reorder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('is a no-op for equal indices', () => {
    expect(reorder(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/web/src/app/routes/reorder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reorder`**

`packages/web/src/app/routes/reorder.ts`:

```ts
export function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/web/src/app/routes/reorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `RouteBuilder.tsx`**

A client component that manages the ordered `waypointIds`, a searchable add-waypoint picker (over `GET /api/waypoints`), drag-to-reorder using `reorder()`, remove-point, and a "+ New waypoint" inline form (name + a single DMM paste field parsed with `parseLatLon` from `lib/coords`, then `POST /api/waypoints`, then append the new id). Props:

```tsx
'use client';
import { reorder } from './reorder';
import { parseLatLon } from '../../lib/coords';

export interface RouteBuilderProps {
  initial?: { id?: string; name: string; waypointIds: string[]; notes?: string };
  onSaved: () => void; // parent reloads the list
}
```

On save: `POST /api/routes` (create) or `PUT /api/routes/{id}` (edit), then call `onSaved()`. Show server `error.message` on failure (e.g. unknown waypoint id). Render each ordered point by resolving its id against the fetched waypoint list (show name + DMM position).

- [ ] **Step 6: Implement `/routes/page.tsx`**

`'use client'` page: list routes from `GET /api/routes`, each row shows name + waypoint count + total rhumb distance (sum of great-circle/rhumb legs across the resolved waypoints — reuse the distance helper the marks page uses for its distance column). Row actions: Edit (opens `<RouteBuilder initial=…>`), Delete (`DELETE /api/routes/{id}`), and **Plan** (`POST /api/routes/{id}/plan` → on success, navigate to `/chart?plan={returnedPlanId}` if the plan was saved, or surface the result). A "New route" button opens `<RouteBuilder>` empty.

> For "Plan": the existing `/api/route/plan` returns a computed route but may not persist a plan id. If no id is returned, either (a) POST the result to `/api/plans` to save then redirect with `?plan=`, or (b) just toast "planned" — confirm against `api/plans/route.ts` during implementation and pick the path that matches how the chart's old save worked.

- [ ] **Step 7: Verify pages compile**

Run:
`curl -s -o /dev/null -w "routes=%{http_code}\n" http://localhost:3000/routes`
Expected: `200`.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app/routes
git commit -m "feat(web): /routes page + route builder"
```

---

## Task 11: Navigation + /marks-and-routes redirect

**Files:**
- Modify: `packages/web/src/app/Navbar.tsx`
- Modify: `packages/web/src/app/marks-and-routes/page.tsx`

- [ ] **Step 1: Update the nav**

In `Navbar.tsx`, replace the single item (line ~25):

```ts
  { href: '/marks-and-routes', label: 'Marks & routes' },
```

with two:

```ts
  { href: '/waypoints', label: 'Waypoints' },
  { href: '/routes', label: 'Routes' },
```

- [ ] **Step 2: Turn the old page into a redirect**

Replace the entire body of `packages/web/src/app/marks-and-routes/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export default function MarksAndRoutesRedirect(): never {
  redirect('/waypoints');
}
```

(Remove the `'use client'` directive — `redirect()` runs server-side. Delete the old client component code.)

- [ ] **Step 3: Verify**

Run:
`curl -s -o /dev/null -w "redirect=%{http_code}\n" http://localhost:3000/marks-and-routes`
Expected: `307` (Next redirect).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/Navbar.tsx packages/web/src/app/marks-and-routes/page.tsx
git commit -m "feat(web): split nav into Waypoints + Routes; redirect old path"
```

---

## Task 12: Chart cleanup — remove plan-definition flow

**Files:**
- Modify: `packages/web/src/app/chart/page.tsx`
- (Leave `packages/web/src/components/PlanControls.tsx` in the tree, unmounted — one-line revert if ever needed, matching the SeamarkLayer/LaylinesLayer precedent in CLAUDE.md.)

**Context (line refs from exploration):** import at line 7; `start`/`end` state lines 212-213; `onMapClick` lines 452-460; `PlanControls` render line 950; `?plan=` load lines 413-446 (**keep**); start/end readout sections lines 871-924; markers using start/end lines 550-551.

- [ ] **Step 1: Remove the define-a-plan plumbing, keep display**

- Delete the `PlanControls` import (line 7) and its render (line 950).
- Remove `onMapClick`'s start/end-picking (lines 452-460) — pass `undefined`/no-op to the `Map`'s `onClick` (or drop the prop) so map clicks no longer set start/end.
- Remove the start/end readout UI (lines ~871-924) and the start/end-as-markers additions (lines ~550-551).
- Remove the `start`/`end` state and the `onPlan` callback (lines 212-213, 461-480) and any now-unused `saving`/`savedMsg` plan-save state.
- **KEEP** the `?plan=<id>` loader (lines 413-446) and `RoutePolyline` rendering — when a plan id is in the URL, the route still displays. The loader currently calls `setStart`/`setEnd` to seed markers (lines ~435-440); since start/end are gone, drop those two lines but keep `setRoute(j.plan.route)`.
- Remove now-dead `chart:planState` write/restore for the *in-progress definition* (the localStorage seeding for start/end). Keep camera/layers/orientation localStorage keys untouched.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @g5000/web`
Expected: passes (no unused-symbol or missing-ref errors). Fix any dangling references the removals expose.

- [ ] **Step 3: Verify chart still loads + plan display still works**

Run:
`curl -s -o /dev/null -w "chart=%{http_code}\n" http://localhost:3000/chart`
Expected: `200`. (Manual: load `/chart?plan=<an existing plan id>` in the browser and confirm the polyline still renders.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "refactor(web): chart is display-only — remove click-to-define plan flow"
```

---

## Task 13: Full verification + deploy notes

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: the new waypoint/route/migration tests pass; total failures stay at the documented baseline (~4 env-only failures: coastline, getSharedConfigStore route tests, wgrib2). Any *new* failure is blocking.

- [ ] **Step 2: Typecheck everything**

Run: `npm run typecheck`
Expected: passes (the `apps/router` ghost ref was already removed earlier this branch).

- [ ] **Step 3: Manual smoke (dev server on :3000, DEMO_MODE)**

- `/waypoints`: add a waypoint, edit it, try to delete one that a route uses → expect the 409 message.
- `/routes`: create a route from 2+ waypoints, reorder, "+ New waypoint" inside the builder, save, Plan it → confirm a route renders on `/chart`.
- `/marks-and-routes` → redirects to `/waypoints`.
- `/chart`: clicking the map no longer drops start/end; `?plan=<id>` still draws a route.

- [ ] **Step 4: Lint + commit any formatting**

```bash
npm run format
git add -A && git commit -m "chore: format" # only if prettier changed files
```

- [ ] **Step 5: Deploy note (do not auto-run)**

This ships via the normal promote → push → `Deploy to Pi` workflow. The boot migration imports `~/.g5000-router/waypoints.json` into `config.db` on first start and renames it `.migrated`. No extra Pi steps. Verify post-deploy: `curl https://g5000.sulabassana.net/api/waypoints` returns the seeded + migrated set, and `/api/routes` returns `[]` (or any created routes).

---

## Self-review notes

- **Spec coverage:** data model (T1-2), migration (T4), API surface waypoints+routes+plan (T6-8), two pages + builder (T9-10), nav + redirect (T11), chart removal keeping `?plan=` (T12), referential integrity (T5-6), testing (throughout + T13). All spec sections mapped.
- **Type consistency:** `Waypoint`/`Route` defined once in `@g5000/db` (T1), imported everywhere. Store methods `getWaypoints/setWaypoints/getRoutes/setRoutes` named consistently across T2/T3/T5. `routesUsingWaypoint` used by both T5 (lib) and T6 (delete guard).
- **Known soft spots flagged inline:** exact `/api/route/plan` + `/api/wardrobe/active` shapes (T8) and whether `/api/route/plan` persists a plan id for the `?plan=` redirect (T10 step 6) must be confirmed against current code during implementation — both are marked.
