# Stateful Boat-State Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Annotate the track" box (`AnnotationDropper`) a live boat-state control: per group it shows the current state and changes it, persisting state AND logging a timestamped track annotation — for sails (headsail/main/downwind via the wardrobe), daggerboards (port/stbd, 0–100%), and engines (port/stbd run/stop).

**Architecture:** Sails reuse the existing persisted `wardrobe.active` (`POST /api/sails/active`). Daggerboards + engines get a new `boat_state` ConfigStore singleton-blob table with a `GET/POST /api/boat-state` merge endpoint. `AnnotationDropper` polls `/api/sails` + `/api/boat-state` on its existing 5 s tick and renders dynamic groups; tapping sets state + (when a track is active) appends an annotation. Pure helpers `sailGroups` + `daggerboardLabel` keep rendering logic testable.

**Tech Stack:** TypeScript (ESM, strict; relative imports use `.js` ONLY in the tsc-compiled packages like `@g5000/db` — NOT in `packages/web`, which uses bundler resolution / no extension), Next.js 16, React 19, better-sqlite3 via Drizzle, RxJS, vitest. Spec: `docs/superpowers/specs/2026-05-23-boat-state-annotations-design.md`.

**Current refs:**
- `@g5000/db` `defaults.ts`: `SailCategory='headsail'|'main'|'downwind'`, `SAIL_CATEGORIES`, `Sail={id,name,category,areaSqM?,notes?,region}`, `SailWardrobe={schemaVersion:3,boatId,sails:Sail[],active:{headsail?,main?,downwind?},activeMode}`. All exported from `@g5000/db`.
- ConfigStore singleton-blob pattern (waypoints/routes added this way): `schema.ts` `sqliteTable('x',{id,value})`; `config-store.ts` `CREATE TABLE IF NOT EXISTS x (id TEXT PRIMARY KEY, value TEXT NOT NULL)`, `loadOrInsert<T>(table, default)` in `open()`, a `BehaviorSubject`, and `get x$()`/`getX()`/`async setX()` accessors (setter calls `this.upsert(table, value)` then `.next`).
- `AnnotationDropper.tsx`: polls `GET /api/tracks/active/annotation` every 5 s + on visibility; `post(label, kind)` → `POST .../annotation`; `state.trackId` (null = no track); `open_`/`disabled`; hardcoded `QUICK_BUTTONS` (Tack/Gybe/Reef/Main/J1-3/Spinnaker); Custom field; Start/End period. `variant: 'pill'|'icon'`.
- API: `GET /api/sails` → full `SailWardrobe`; `POST /api/sails/active {category, sailId|null}`.

---

## File structure

**Create:**
- `packages/db/src/boat-state.ts` — `BoatState` type + `DEFAULT_BOAT_STATE`.
- `packages/web/src/app/api/boat-state/route.ts` — GET + POST (merge).
- `packages/web/src/components/sail-groups.ts` + `.test.ts` — `sailGroups(wardrobe)`.
- `packages/web/src/components/daggerboard-label.ts` + `.test.ts` — `daggerboardLabel(side, pct)`.

**Modify:**
- `packages/db/src/schema.ts` — `boat_state` table.
- `packages/db/src/config-store.ts` — CREATE TABLE + load + `boatState$`/`getBoatState`/`setBoatState`.
- `packages/db/src/config-store.test.ts` — boat_state round-trip test.
- `packages/db/src/index.ts` — export `BoatState`, `DEFAULT_BOAT_STATE`.
- `packages/web/src/components/AnnotationDropper.tsx` — poll sails+boat-state; dynamic sail groups (Task 5); daggerboard+engine groups + scroll (Task 6).

---

## Task 1: `boat_state` ConfigStore table + accessors

**Files:**
- Create: `packages/db/src/boat-state.ts`
- Modify: `packages/db/src/schema.ts`, `config-store.ts`, `index.ts`
- Test: `packages/db/src/config-store.test.ts`

- [ ] **Step 1: Create the type**

`packages/db/src/boat-state.ts`:
```ts
/** Persisted live boat state surfaced + controlled by the annotation box. */
export interface BoatState {
  /** Daggerboard position as percent down: 0 = fully up, 100 = fully down. */
  daggerboards: { port: number; starboard: number };
  /** Engine run state per side (rpm deferred). */
  engines: { port: { running: boolean }; starboard: { running: boolean } };
}

export const DEFAULT_BOAT_STATE: BoatState = {
  daggerboards: { port: 0, starboard: 0 },
  engines: { port: { running: false }, starboard: { running: false } },
};
```

- [ ] **Step 2: Write the failing test**

Append to `packages/db/src/config-store.test.ts` (reuse the existing temp-dir harness — `dbPath`/`store` from `beforeEach`):
```ts
import type { BoatState } from './boat-state.js';

describe('ConfigStore boat_state', () => {
  it('defaults to boards up + engines stopped', () => {
    expect(store.getBoatState()).toEqual({
      daggerboards: { port: 0, starboard: 0 },
      engines: { port: { running: false }, starboard: { running: false } },
    });
  });
  it('round-trips a boat state', async () => {
    const s: BoatState = {
      daggerboards: { port: 75, starboard: 50 },
      engines: { port: { running: true }, starboard: { running: false } },
    };
    await store.setBoatState(s);
    expect(store.getBoatState()).toEqual(s);
    expect(await firstValueFrom(store.boatState$)).toEqual(s);
  });
  it('persists across reopen', async () => {
    await store.setBoatState({
      daggerboards: { port: 25, starboard: 100 },
      engines: { port: { running: false }, starboard: { running: true } },
    });
    await store.close();
    store = await ConfigStore.open(dbPath);
    expect(store.getBoatState().daggerboards.starboard).toBe(100);
  });
});
```
Run `npx vitest run packages/db/src/config-store.test.ts -t "boat_state"` → FAIL.

- [ ] **Step 3: Schema table**

In `packages/db/src/schema.ts`, alongside the other `(id, value)` tables:
```ts
export const boatState = sqliteTable('boat_state', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded BoatState
});
```

- [ ] **Step 4: CREATE TABLE + accessors (mirror the waypoints/routes wiring)**

In `config-store.ts`:
- Add to the `raw.exec(`...`)` block: `CREATE TABLE IF NOT EXISTS boat_state (id TEXT PRIMARY KEY, value TEXT NOT NULL);`
- Import `boatState as boatStateTable` from `./schema.js` and `{ type BoatState, DEFAULT_BOAT_STATE }` from `./boat-state.js`.
- In `open()`, load it: `const boatStateValue = loadOrInsert<BoatState>(boatStateTable, DEFAULT_BOAT_STATE);` and thread into the constructor (same way the `waypoints`/`routes` values are threaded).
- Add a `BehaviorSubject<BoatState>` field initialised from the loaded value; and public accessors next to the waypoints/routes ones:
```ts
get boatState$(): Observable<BoatState> {
  return this.boatState$$.asObservable();
}
getBoatState(): BoatState {
  return this.boatState$$.value;
}
async setBoatState(value: BoatState): Promise<void> {
  this.upsert(boatStateTable, value);
  this.boatState$$.next(value);
}
```
Add `this.boatState$$.complete()` in `close()` alongside the others.

- [ ] **Step 5: Export the type**

In `packages/db/src/index.ts`:
```ts
export type { BoatState } from './boat-state.js';
export { DEFAULT_BOAT_STATE } from './boat-state.js';
```

- [ ] **Step 6: Verify + commit**

`npx vitest run packages/db/src/config-store.test.ts -t "boat_state"` → 3 PASS.
`npm run typecheck --workspace @g5000/db` → passes.
```bash
git add packages/db/src/boat-state.ts packages/db/src/schema.ts packages/db/src/config-store.ts packages/db/src/config-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): boat_state ConfigStore table (daggerboards + engines)"
```

---

## Task 2: `/api/boat-state` GET + POST (merge)

**Files:**
- Create: `packages/web/src/app/api/boat-state/route.ts`

- [ ] **Step 1: Implement the route**

`packages/web/src/app/api/boat-state/route.ts` (mirror the conventions of `api/sails/active/route.ts` — `getSharedConfigStore`, `NextResponse`/`Response.json`, `dynamic`/`runtime` exports if the siblings use them):
```ts
import { getSharedConfigStore, type BoatState } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_PCT = new Set([0, 25, 50, 75, 100]);

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, boatState: getSharedConfigStore().getBoatState() });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: { message: 'invalid JSON' } }, { status: 400 });
  }
  const b = body as {
    daggerboards?: { port?: unknown; starboard?: unknown };
    engines?: { port?: { running?: unknown }; starboard?: { running?: unknown } };
  };

  const store = getSharedConfigStore();
  const cur = store.getBoatState();
  const next: BoatState = {
    daggerboards: { ...cur.daggerboards },
    engines: { port: { ...cur.engines.port }, starboard: { ...cur.engines.starboard } },
  };

  for (const side of ['port', 'starboard'] as const) {
    const v = b.daggerboards?.[side];
    if (v !== undefined) {
      if (typeof v !== 'number' || !ALLOWED_PCT.has(v)) {
        return Response.json(
          { ok: false, error: { message: `daggerboard ${side} must be one of 0/25/50/75/100` } },
          { status: 422 },
        );
      }
      next.daggerboards[side] = v;
    }
    const run = b.engines?.[side]?.running;
    if (run !== undefined) {
      if (typeof run !== 'boolean') {
        return Response.json(
          { ok: false, error: { message: `engine ${side} running must be boolean` } },
          { status: 422 },
        );
      }
      next.engines[side] = { running: run };
    }
  }

  await store.setBoatState(next);
  return Response.json({ ok: true, boatState: next });
}
```

- [ ] **Step 2: Verify + commit**

`npm run typecheck --workspace @g5000/web` → passes (run `npx tsc -b packages/db` first if a stale-dist export error for `BoatState`/`getBoatState` appears).
Smoke (dev server :3000):
```
curl -s localhost:3000/api/boat-state
curl -s -X POST localhost:3000/api/boat-state -H 'content-type: application/json' -d '{"daggerboards":{"port":75},"engines":{"starboard":{"running":true}}}' -w "\nHTTP %{http_code}\n"
curl -s localhost:3000/api/boat-state   # confirm merge: port=75, starboard untouched, stbd engine running
curl -s -X POST localhost:3000/api/boat-state -H 'content-type: application/json' -d '{"daggerboards":{"port":33}}' -w "\nHTTP %{http_code}\n"  # expect 422
# reset:
curl -s -X POST localhost:3000/api/boat-state -H 'content-type: application/json' -d '{"daggerboards":{"port":0},"engines":{"starboard":{"running":false}}}'
```
```bash
git add packages/web/src/app/api/boat-state
git commit -m "feat(web): /api/boat-state GET + partial-merge POST"
```

---

## Task 3: `sailGroups` pure helper

**Files:**
- Create: `packages/web/src/components/sail-groups.ts`
- Test: `packages/web/src/components/sail-groups.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/src/components/sail-groups.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sailGroups } from './sail-groups';

const wardrobe = {
  schemaVersion: 3 as const,
  boatId: 'sula',
  activeMode: 'default',
  sails: [
    { id: 'j1', name: 'J1', category: 'headsail', region: { cells: [] } },
    { id: 'j2', name: 'J2', category: 'headsail', region: { cells: [] } },
    { id: 'main', name: 'Main', category: 'main', region: { cells: [] } },
    { id: 'a2', name: 'A2', category: 'downwind', region: { cells: [] } },
  ],
  active: { headsail: 'j2', main: 'main' },
};

describe('sailGroups', () => {
  it('returns headsail/main/downwind in order with sails + active id', () => {
    const g = sailGroups(wardrobe as never);
    expect(g.map((x) => x.category)).toEqual(['headsail', 'main', 'downwind']);
    const head = g[0]!;
    expect(head.label).toBe('Headsail');
    expect(head.sails.map((s) => s.id)).toEqual(['j1', 'j2']);
    expect(head.activeId).toBe('j2');
  });
  it('marks main active, downwind has no active', () => {
    const g = sailGroups(wardrobe as never);
    expect(g[1]!.activeId).toBe('main');
    expect(g[2]!.activeId).toBeUndefined();
    expect(g[2]!.sails.map((s) => s.id)).toEqual(['a2']);
  });
  it('empty category yields an empty sails list, not an error', () => {
    const g = sailGroups({ ...wardrobe, sails: [], active: {} } as never);
    expect(g.every((x) => x.sails.length === 0)).toBe(true);
    expect(g.every((x) => x.activeId === undefined)).toBe(true);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement**

`packages/web/src/components/sail-groups.ts`:
```ts
import { SAIL_CATEGORIES, type SailCategory, type SailWardrobe } from '@g5000/db';

export interface SailGroup {
  category: SailCategory;
  label: string;
  sails: Array<{ id: string; name: string }>;
  activeId?: string;
}

const LABELS: Record<SailCategory, string> = {
  headsail: 'Headsail',
  main: 'Main',
  downwind: 'Downwind',
};

export function sailGroups(wardrobe: SailWardrobe): SailGroup[] {
  return SAIL_CATEGORIES.map((category) => ({
    category,
    label: LABELS[category],
    sails: wardrobe.sails
      .filter((s) => s.category === category)
      .map((s) => ({ id: s.id, name: s.name })),
    activeId: wardrobe.active[category],
  }));
}
```

- [ ] **Step 3: Verify + commit**

Run the test → 3 PASS. `npm run typecheck --workspace @g5000/web` → passes (`npx tsc -b packages/db` first if stale).
```bash
git add packages/web/src/components/sail-groups.ts packages/web/src/components/sail-groups.test.ts
git commit -m "feat(web): sailGroups helper for the annotation box"
```

---

## Task 4: `daggerboardLabel` pure helper

**Files:**
- Create: `packages/web/src/components/daggerboard-label.ts`
- Test: `packages/web/src/components/daggerboard-label.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/src/components/daggerboard-label.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { daggerboardLabel } from './daggerboard-label';

describe('daggerboardLabel', () => {
  it('uses up/down at the extremes', () => {
    expect(daggerboardLabel('port', 0)).toBe('Port board up');
    expect(daggerboardLabel('starboard', 100)).toBe('Stbd board down');
  });
  it('uses percent in the middle', () => {
    expect(daggerboardLabel('port', 75)).toBe('Port board 75%');
    expect(daggerboardLabel('starboard', 50)).toBe('Stbd board 50%');
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement**

`packages/web/src/components/daggerboard-label.ts`:
```ts
export type BoardSide = 'port' | 'starboard';

const SIDE_LABEL: Record<BoardSide, string> = { port: 'Port', starboard: 'Stbd' };

/** Track-annotation label for a daggerboard position change. */
export function daggerboardLabel(side: BoardSide, pct: number): string {
  const s = SIDE_LABEL[side];
  if (pct === 0) return `${s} board up`;
  if (pct === 100) return `${s} board down`;
  return `${s} board ${pct}%`;
}
```

- [ ] **Step 3: Verify + commit**

Run the test → 2 PASS. `npm run typecheck --workspace @g5000/web` → passes.
```bash
git add packages/web/src/components/daggerboard-label.ts packages/web/src/components/daggerboard-label.test.ts
git commit -m "feat(web): daggerboardLabel helper"
```

---

## Task 5: AnnotationDropper — dynamic sail groups

**Files:**
- Modify: `packages/web/src/components/AnnotationDropper.tsx`

- [ ] **Step 1: Poll the wardrobe + hold it in state**

READ the file. Add `wardrobe` state and fetch it on the same 5 s tick that fetches annotations. In the existing poll effect's `tick()`, after the annotation fetch, also:
```ts
try {
  const wr = await fetch('/api/sails', { cache: 'no-store' });
  if (wr.ok && alive) setWardrobe((await wr.json()) as SailWardrobe);
} catch {
  /* keep last wardrobe */
}
```
Add `const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);` and `import { SAIL_CATEGORIES, type SailWardrobe, type SailCategory } from '@g5000/db';` plus `import { sailGroups } from './sail-groups';`.

- [ ] **Step 2: A sail-set action (set active + log)**

Add a callback:
```ts
const setSail = useCallback(
  async (category: SailCategory, sailId: string | null, label: string): Promise<void> => {
    setOpen(false);
    try {
      const res = await fetch('/api/sails/active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, sailId }),
      });
      if (!res.ok) {
        setFlash(`✗ ${label} failed`);
        window.setTimeout(() => setFlash(null), 2500);
        return;
      }
      // refresh wardrobe so the highlight updates immediately
      const wr = await fetch('/api/sails', { cache: 'no-store' });
      if (wr.ok) setWardrobe((await wr.json()) as SailWardrobe);
      // log the change on the track if one is active (secondary effect)
      if (state.trackId) await post(label, 'event');
      else {
        setFlash(`✓ ${label}`);
        window.setTimeout(() => setFlash(null), 1500);
      }
    } catch {
      setFlash(`✗ ${label} failed`);
      window.setTimeout(() => setFlash(null), 2500);
    }
  },
  [post, state.trackId],
);
```
(`post` already closes the panel + flashes on its own path; the `else` branch covers the no-track case so the user still gets feedback.)

- [ ] **Step 3: Replace the hardcoded sail rows with dynamic groups**

Remove the `Main up/down`, `J1/J2/J3`, `Spinnaker up/down`, and `Reef in/out` entries from `QUICK_BUTTONS` (KEEP `Tack` and `Gybe`). Then, in the panel, after the Tack/Gybe row and before the Start/End period button, render the sail groups (only when `wardrobe` is loaded):
```tsx
{wardrobe &&
  sailGroups(wardrobe).map((g) => (
    <div key={g.category} className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {g.label}
        {g.activeId ? (
          <span className="ml-1 text-slate-300">
            — {g.sails.find((s) => s.id === g.activeId)?.name ?? g.activeId}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {g.sails.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => void setSail(g.category, s.id, s.name)}
            className={
              'px-2 py-1 text-xs rounded border ' +
              (g.activeId === s.id
                ? 'bg-amber-500 text-slate-900 border-amber-600'
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
            }
          >
            {s.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void setSail(g.category, null, `${g.label} down`)}
          className={
            'px-2 py-1 text-xs rounded border ' +
            (g.activeId
              ? 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              : 'bg-slate-700 text-slate-100 border-slate-600')
          }
        >
          down
        </button>
      </div>
    </div>
  ))}
```

- [ ] **Step 4: Split the disabled logic**

The Tack/Gybe/Custom/period controls keep `disabled={disabled}` (no active track). The sail group buttons must NOT be disabled by `disabled` (they set wardrobe state regardless) — they have no `disabled` attribute (or `disabled={false}`). Verify the sail buttons render enabled when `state.trackId` is null.

- [ ] **Step 5: Verify + commit**

`npm run typecheck --workspace @g5000/web` → passes.
`curl -s -o /dev/null -w "/chart %{http_code}  /helm " localhost:3000/chart; curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/helm` → 200 200.
```bash
git add packages/web/src/components/AnnotationDropper.tsx
git commit -m "feat(web): annotation box — dynamic sail groups from wardrobe"
```

---

## Task 6: AnnotationDropper — daggerboard + engine groups

**Files:**
- Modify: `packages/web/src/components/AnnotationDropper.tsx`

- [ ] **Step 1: Poll boat-state + hold it**

Add `const [boatState, setBoatState] = useState<BoatState | null>(null);` and `import { type BoatState } from '@g5000/db';`, `import { daggerboardLabel, type BoardSide } from './daggerboard-label';`. In the poll `tick()`, also fetch `/api/boat-state`:
```ts
try {
  const bs = await fetch('/api/boat-state', { cache: 'no-store' });
  if (bs.ok && alive) {
    const j = (await bs.json()) as { ok: boolean; boatState?: BoatState };
    if (j.boatState) setBoatState(j.boatState);
  }
} catch {
  /* keep last */
}
```

- [ ] **Step 2: A boat-state action (merge + log)**

```ts
const postBoatState = useCallback(
  async (patch: Partial<BoatState>, label: string): Promise<void> => {
    setOpen(false);
    try {
      const res = await fetch('/api/boat-state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setFlash(`✗ ${label} failed`);
        window.setTimeout(() => setFlash(null), 2500);
        return;
      }
      const j = (await res.json()) as { ok: boolean; boatState?: BoatState };
      if (j.boatState) setBoatState(j.boatState);
      if (state.trackId) await post(label, 'event');
      else {
        setFlash(`✓ ${label}`);
        window.setTimeout(() => setFlash(null), 1500);
      }
    } catch {
      setFlash(`✗ ${label} failed`);
      window.setTimeout(() => setFlash(null), 2500);
    }
  },
  [post, state.trackId],
);
```

- [ ] **Step 3: Render daggerboard + engine groups**

After the sail groups, render (when `boatState` is loaded):
```tsx
{boatState && (
  <>
    {(['port', 'starboard'] as const).map((side) => (
      <div key={`dagger-${side}`} className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">
          {side === 'port' ? 'Port board' : 'Stbd board'}
          <span className="ml-1 text-slate-300">— {boatState.daggerboards[side]}%</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {[0, 25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() =>
                void postBoatState(
                  { daggerboards: { [side]: pct } as Partial<BoatState['daggerboards']> } as Partial<BoatState>,
                  daggerboardLabel(side as BoardSide, pct),
                )
              }
              className={
                'px-2 py-1 text-xs rounded border ' +
                (boatState.daggerboards[side] === pct
                  ? 'bg-amber-500 text-slate-900 border-amber-600'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
              }
            >
              {pct === 0 ? 'Up' : pct === 100 ? 'Down' : `${pct}%`}
            </button>
          ))}
        </div>
      </div>
    ))}
    {(['port', 'starboard'] as const).map((side) => {
      const running = boatState.engines[side].running;
      const label = side === 'port' ? 'Port engine' : 'Stbd engine';
      return (
        <div key={`engine-${side}`} className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">
            {label}
            <span className="ml-1 text-slate-300">— {running ? 'running' : 'stopped'}</span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() =>
                void postBoatState(
                  { engines: { [side]: { running: true } } as Partial<BoatState['engines']> } as Partial<BoatState>,
                  `${label} on`,
                )
              }
              className={
                'px-2 py-1 text-xs rounded border ' +
                (running
                  ? 'bg-emerald-600 text-white border-emerald-700'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
              }
            >
              Run
            </button>
            <button
              type="button"
              onClick={() =>
                void postBoatState(
                  { engines: { [side]: { running: false } } as Partial<BoatState['engines']> } as Partial<BoatState>,
                  `${label} off`,
                )
              }
              className={
                'px-2 py-1 text-xs rounded border ' +
                (!running
                  ? 'bg-slate-600 text-white border-slate-500'
                  : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700')
              }
            >
              Stop
            </button>
          </div>
        </div>
      );
    })}
  </>
)}
```
> The `as Partial<...>` casts handle the computed `[side]` key under strict TS. If they're noisy, a tiny typed builder (`dbPatch(side, pct)`) is fine — keep it readable.

- [ ] **Step 4: Make the panel scrollable**

The expanded panel `<div>` (the `w-[280px] … p-3 space-y-3` block) now holds many groups. Add `max-h-[70vh] overflow-y-auto` to its className so it scrolls instead of overflowing the viewport, in BOTH variants.

- [ ] **Step 5: Verify + commit**

`npm run typecheck --workspace @g5000/web` → passes.
`curl` `/chart` + `/helm` → 200.
```bash
git add packages/web/src/components/AnnotationDropper.tsx
git commit -m "feat(web): annotation box — daggerboard + engine state groups"
```

---

## Task 7: Verification

- [ ] **Step 1: Tests + typecheck**

`npx vitest run packages/db/src/config-store.test.ts packages/web/src/components/sail-groups.test.ts packages/web/src/components/daggerboard-label.test.ts` → all pass.
`npm run typecheck` (orchestrated) → clean.

- [ ] **Step 2: Browser functional test (Playwright, 1440×900)**

Open `/chart`, open the Annotate-the-track box (the flag icon). Confirm: Headsail/Main/Downwind groups list the wardrobe's sails with the active one highlighted; tapping a headsail highlights it AND (verify via `GET /api/sails`) sets `wardrobe.active.headsail`; the "down" button clears it. Daggerboard rows (Port/Stbd) show Up/25/50/75/100 with the current highlighted; tapping persists (verify `GET /api/boat-state`, and survives a reload). Engine rows (Port/Stbd) Run/Stop toggle + persist. With an active track (DEMO records one), confirm taps also append annotations (`GET /api/tracks/active/annotation`). The panel scrolls. Check `/helm`'s pill variant still opens and shows the same groups. Reset state afterward (boards 0, engines off) via the API.

- [ ] **Step 3: Format**

`npm run format`; commit only if it changed files.

---

## Self-review notes

- **Spec coverage:** boat_state persistence (T1) + API merge/validation (T2); sailGroups (T3) + daggerboardLabel (T4) helpers; dynamic sail groups w/ active highlight + down + set-active-and-log (T5); daggerboard + engine groups w/ merge-and-log + scroll (T6); track-dependence split (T5 step 4, reused in T6 via the `state.trackId` guard in the actions); kept Tack/Gybe/Custom/period, removed Reef/Main/J/Spinnaker hardcodes (T5 step 3). All spec sections mapped.
- **Type consistency:** `BoatState` shape `{ daggerboards:{port,starboard}, engines:{port:{running},starboard:{running}} }` identical across T1/T2/T6; `SailCategory`/`SAIL_CATEGORIES`/`SailWardrobe` from `@g5000/db` used in T3/T5; `BoardSide` from daggerboard-label (T4) used in T6; `daggerboardLabel`/`sailGroups` signatures match their call sites.
- **Soft spots flagged:** the computed-key `Partial<BoatState>` casts in T6 (offered a typed-builder alternative); `.js` extensions are for `@g5000/db` only, NOT packages/web (header note) — the same trap that bit the waypoint-popup helper.
