# Polar Data Model — Design

**Date:** 2026-05-18
**Status:** Drafted (brainstorming complete; awaiting user review before writing-plans)
**Issue:** [#1 Polars!](https://github.com/gregjohnson1024/g5000/issues/1)
**Scope:** Restructure how G5000 stores polars so a single boat install can carry multiple sail-config slots, multiple operating modes per slot, and a full immutable revision history with lineage metadata. Sets the foundation for sibling specs (multi-tenant cal tables, sea-state derate, regression pipeline, mode-switching runtime).

## 1. Context & goal

Today's polar storage is a single global wardrobe of `SailConfig` slots, each embedding one `PolarTable`. `ConfigStore` exposes `activePolar$` which resolves to "the polar of the active slot". One global wardrobe, one polar per slot, no boat scoping, no history.

Issue #1 asks: _"To handle polars in G5000, we want a multi-boat multi-slot capable data model. For a high-performance yacht, what is the correct data model to handle the polars?"_

Goal: a data model that supports

- Per-boat scoping (single active boat per process today; ready for a multi-tenant cal/wardrobe migration tomorrow).
- Multiple operating modes per sail config (e.g. `displacement` / `planing` / `foiling`; `default` for boats with a single regime).
- Immutable polar revisions with lineage metadata (`migrated`, `manual_edit`, `imported_csv`, `imported_pol`, `vpp`, `cfd`, `towing_tank`, `measured`, `regression`, `expert_judgment`).
- Optional heel and leeway grids alongside the boatspeed grid (parallel 2D arrays in the same `PolarTable`).
- Optional scalar `sigma` (m/s) per revision for downstream uncertainty work.
- A backward-compatible runtime surface: `ConfigStore.activePolar$: Observable<PolarTable>` keeps the same signature so routing/compute/H-LINK consumers are unaffected.

## 2. Existing state

- `packages/db/src/defaults.ts` — `PolarTable`, `SailConfig` (carries an inline `polar: PolarTable`), `SailWardrobe` (`{configs, activeConfigId}`). `DEFAULT_POLARS` is the seed polar; `DEFAULT_WARDROBE` wraps it in a single slot.
- `packages/db/src/schema.ts` — `polars` table (vestigial singleton) and `sail_wardrobe` table (singleton row, JSON blob).
- `packages/db/src/config-store.ts:129` — boot-time migration: load legacy `polars` row; if `sail_wardrobe` row is absent, wrap legacy polar in a default wardrobe; else load the existing wardrobe.
- `packages/db/src/config-store.ts:246` — `activePolar$: Observable<PolarTable>` resolves the active slot's polar. `polars$` is a backward-compat alias.
- `packages/compute/src/polars/pipeline.ts` — subscribes to `activePolar$`; publishes target boatspeed / VMG / %polar to the bus.
- `packages/routing/src/plan.ts:157` — `interpolatePolarSpeed(input.polar, tws, |twa|)`, called in the inner fan loop. Performance-sensitive.
- `packages/web/src/app/api/wardrobe/active/route.ts` — read/write API for the wardrobe-active pointer.
- `packages/web/src/app/api/route/plan/route.ts` — already accepts `polar: PolarTable` + `polarId: string`.

## 3. Approach

**Approach B (Hybrid):** Keep the `(id, value JSON)` convention for wardrobe snapshots; add one new SQLite table — `polar_revisions` — for immutable history rows. Wardrobe slots stop embedding polars and instead carry per-mode pointers to revision ids. The `ConfigStore` resolver joins wardrobe + revisions to return the same `PolarTable` shape the existing consumers already expect.

**Rejected alternatives:**

- _Pure JSON convention_ (Approach A): immutable history as an array inside the wardrobe blob — wardrobe rows grow without bound, immutability is by convention not structure, no SQL queryability.
- _Fully normalized polar cells_ (Approach C): one row per `(revisionId, twsIdx, twaIdx)` — wrong shape for the bilinear hot loop, massive convention departure, not faster for this access pattern (the router reads whole polars into RAM).

Sibling-spec proposals also explicitly **out of scope** here (a `Related work` section at the bottom lists them, each linked when written):

1. Multi-tenant migration of _other_ config tables (`boat_config`, `aws_awa_cal`, `bsp_cal`, `compass_deviation`, `damping_config`, `source_priority_config`, `ais_alarm_config`, `passage_log`).
2. Mode-switching runtime — what flips `activeMode` from `displacement` to `planing` (sensor threshold? manual button? SOG hysteresis?).
3. Sea-state derate table + how a derate composes with polar lookup.
4. Crossover / sail-recommendation surface (driving wardrobe suggestions from current wind state).
5. Regression pipeline that produces polar revisions from session-log observations.
6. Polar import: `.pol` (Expedition) / ORC VPP parsers writing to the new revisions table.

## 4. Files manifest

### Create

| File                                                     | Purpose                                                                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/polar-revisions.ts`                     | Repo functions over the new table: `listRevisions`, `getRevision`, `createRevision`, `setActiveRevision`. ULID generation (library choice — see §9). Grid-shape validator.                     |
| `packages/db/src/polar-revisions.test.ts`                | CRUD round-trip, ULID monotonicity, parent-chain integrity, validator rejects mismatched dimensions / non-monotonic bins / non-finite cells, dangling-revisionId fallback to `DEFAULT_POLARS`. |
| `packages/db/src/migrate-wardrobe-v2.ts`                 | One-shot migration helper: detect v1 wardrobe shape, generate `revision-0` rows with `lineageKind='migrated'`, rewrite wardrobe to v2 shape, all in one SQLite transaction.                    |
| `packages/db/src/migrate-wardrobe-v2.test.ts`            | Migration on a v1 fixture produces a valid v2 wardrobe + one revision row per slot. Injected transaction failure rolls back cleanly. v2 input is a no-op.                                      |
| `packages/web/src/app/api/polar/revisions/route.ts`      | GET (list), POST (create). Optional query params `boatId`, `sailConfigId`, `mode`. 400 on invalid grid.                                                                                        |
| `packages/web/src/app/api/polar/revisions/[id]/route.ts` | GET single revision; 404 on miss.                                                                                                                                                              |
| `packages/web/src/app/api/polar/active/route.ts`         | POST `{sailConfigId, mode, revisionId}` → `setActiveRevision`. 404 on unknown revision.                                                                                                        |
| `packages/web/src/app/api/polar/revisions/route.test.ts` | Happy-path list/get/create + 400 invalid grid + 404 unknown.                                                                                                                                   |

### Modify

| File                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/defaults.ts`                       | Add `BoatId`, `PolarMode`, `PolarLineageKind`, `PolarLineage`, `PolarRevision` types. Extend `PolarTable` with optional `heel?: number[][]`, `leeway?: number[][]`. Replace `SailConfig.polar` with `modes: Partial<Record<PolarMode, { activeRevisionId: string }>>`. Add optional `SailConfig` fields: `foilMode`, `mastRotation`, `rigTensionState`, `displacement`. Add `boatId` and `activeMode: PolarMode` to `SailWardrobe`. Update `DEFAULT_WARDROBE` to v2 shape (will be paired with `DEFAULT_POLARS` becoming the revision-0 seed at first boot).                                                                                                            |
| `packages/db/src/schema.ts`                         | Add `polarRevisions` Drizzle table definition: `id PK`, `boat_id`, `sail_config_id`, `mode`, `parent_revision_id` (nullable), `created_at`, `lineage_kind`, `lineage_meta` (nullable JSON), `sigma` (nullable real), `value_json`. Index on `(boat_id, sail_config_id, mode, created_at DESC)`. Keep the legacy `polars` table; mark with a `// DEPRECATED — drop after v2 migration confirmed on Pi` comment.                                                                                                                                                                                                                                                          |
| `packages/db/src/config-store.ts`                   | At boot: read `G5000_BOAT_ID` env (default `"sula"`), store as `this.__activeBoatId`. Run `migrate-wardrobe-v2` after the existing legacy→wardrobe step. Add a `polarRevisions$` observable (BehaviorSubject of `Map<id, PolarRevision>` for the active boat). Rewrite `activePolar$` to `combineLatest([sailWardrobe$, polarRevisions$]).pipe(map(resolve))`. Resolver falls back to `DEFAULT_POLARS` and logs a one-line warning if the active revisionId is missing. Expose `listRevisions`, `getRevision`, `createRevision`, `setActiveRevision` as methods that delegate to `polar-revisions.ts` repo functions. `polars$` alias preserved (still `activePolar$`). |
| `packages/db/src/config-store.test.ts`              | Add: v1→v2 migration cases (wardrobe with N slots; legacy-only no-wardrobe case); transaction rollback on injected DB error mid-migration; `activePolar$` dangling-revisionId fallback; `setActiveRevision` switches `activePolar$` output.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/web/src/app/api/wardrobe/active/route.ts` | Accept optional `activeMode` in the POST body (defaults to `'default'`). Existing callers without the field unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/web/src/app/api/route/plan/route.ts`      | Wire `polarId` to the resolved active-revision id (today it's the slot id). No type change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/compute/src/polars/pipeline.test.ts`      | Add: `setActiveRevision` on the underlying store causes the pipeline to publish updated target boatspeed within one tick.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/autopilot-server/src/index.ts`                | No code change beyond surfacing the new env var in startup logging (one line: "active boat: <boatId>").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `CLAUDE.md`                                         | Add `G5000_BOAT_ID` to the env-var gates section (default `"sula"`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### No change

`packages/compute/src/polars/pipeline.ts`, `packages/compute/src/polars/math.ts`, `packages/routing/src/plan.ts`, `packages/bridge/**` — all consume `PolarTable` and stay on that shape.

## 5. Architecture

### Type definitions (in `packages/db/src/defaults.ts`)

```ts
export type BoatId = string;
export type PolarMode = 'default' | 'displacement' | 'planing' | 'foiling' | string;
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

export interface PolarLineage {
  kind: PolarLineageKind;
  source?: string; // e.g. designer name, file path, run-id
  notes?: string;
}

export interface PolarTable {
  twsBins: number[]; // m/s, strictly increasing
  twaBins: number[]; // radians, strictly increasing, span ⊆ [0, π]
  boatSpeed: number[][]; // [twsIdx][twaIdx], m/s, finite, ≥ 0
  heel?: number[][]; // radians, signed (lee positive); same shape as boatSpeed
  leeway?: number[][]; // radians; same shape as boatSpeed
}

export interface PolarRevision {
  id: string; // ULID
  boatId: BoatId;
  sailConfigId: string;
  mode: PolarMode;
  parentRevisionId: string | null;
  createdAt: number; // unix seconds
  lineage: PolarLineage;
  sigma?: number; // m/s scalar uncertainty
  table: PolarTable;
}

export interface SailConfig {
  id: string;
  name: string;
  mainState?: string;
  headsail?: string;
  downwindSail?: string;
  daggerboard?: 'down' | 'half' | 'up';
  foilMode?: 'displacement' | 'foiling' | 'transition' | string;
  mastRotation?: number; // radians; rotating-rig only
  rigTensionState?: string;
  displacement?: number; // kg
  notes?: string;
  modes: Partial<Record<PolarMode, { activeRevisionId: string }>>;
}

export interface SailWardrobe {
  boatId: BoatId;
  configs: SailConfig[];
  activeConfigId: string;
  activeMode: PolarMode; // defaults to 'default'
}
```

### Schema additions (in `packages/db/src/schema.ts`)

```ts
export const polarRevisions = sqliteTable('polar_revisions', {
  id: text('id').primaryKey(),
  boatId: text('boat_id').notNull(),
  sailConfigId: text('sail_config_id').notNull(),
  mode: text('mode').notNull(),
  parentRevisionId: text('parent_revision_id'),
  createdAt: integer('created_at').notNull(),
  lineageKind: text('lineage_kind').notNull(),
  lineageMeta: text('lineage_meta'), // JSON {source?, notes?}
  sigma: real('sigma'),
  valueJson: text('value_json').notNull(), // JSON-encoded PolarTable
});
// Index: (boat_id, sail_config_id, mode, created_at DESC) for "newest active revision" lookup.
```

### Resolver

```ts
get activePolar$(): Observable<PolarTable> {
  return combineLatest([this.sailWardrobe$, this.polarRevisions$]).pipe(
    map(([wardrobe, revisionsById]) => {
      const cfg = wardrobe.configs.find(c => c.id === wardrobe.activeConfigId);
      const ref = cfg?.modes[wardrobe.activeMode]?.activeRevisionId;
      const rev = ref ? revisionsById.get(ref) : undefined;
      if (!ref || !rev) {
        // Dangling pointer or unset mode → fall back; log once per boot.
        return DEFAULT_POLARS;
      }
      return rev.table;
    }),
  );
}
```

### Data flow

```
ConfigStore boot
  ├─ load polars row (legacy)
  ├─ load sail_wardrobe row
  ├─ run migrate-wardrobe-v2 (idempotent)
  │   └─ if v1 shape: insert revision-0 per slot, rewrite wardrobe to v2
  └─ load all polar_revisions for activeBoatId → in-memory Map

Web client → POST /api/polar/revisions
  → ConfigStore.createRevision(...)  → INSERT new row → update Map → emit on polarRevisions$
  → activePolar$ stays unchanged (caller decides whether to also set-active)

Web client → POST /api/polar/active
  → ConfigStore.setActiveRevision(slotId, mode, revisionId)
  → UPDATE wardrobe JSON  → emit on sailWardrobe$
  → activePolar$ resolves to the new revision's table

Routing / compute / H-LINK
  → subscribe activePolar$  → get PolarTable (unchanged shape)
```

### Active-boat pattern

- Single active boat per process.
- `G5000_BOAT_ID` env var; default `"sula"`. Read once at `ConfigStore` open.
- All wardrobe and revision reads filter on this id.
- Other config tables (`boat_config`, calibrations, source priority, etc.) remain implicitly single-tenant for this spec; their multi-tenant migration is a sibling spec.

## 6. Error handling

| Failure                                                                                                                                | Behavior                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dangling `activeRevisionId` (revisions row deleted out-of-band)                                                                        | `activePolar$` resolves to `DEFAULT_POLARS`; warning logged once per boot. Wardrobe is not auto-repaired (UI surface).                             |
| Invalid grid passed to `createRevision` (mismatched dims, non-monotonic bins, non-finite cells, negative speeds, TWA outside `[0, π]`) | Validator throws before INSERT. `/api/polar/revisions` returns 400.                                                                                |
| Migration error mid-transaction                                                                                                        | SQLite transaction aborts; `ConfigStore` open fails with a descriptive error; next boot retries from the v1 shape. No half-migrated state on disk. |
| `activeMode` missing from the active slot's `modes` map                                                                                | Resolver falls through to `'default'` mode; if that's also missing, fall back to `DEFAULT_POLARS` and log.                                         |
| Concurrent writes to the same wardrobe row                                                                                             | SQLite's default journaling serializes them; last write wins. Acceptable: writes come only from the single Next.js process.                        |

## 7. Testing

- `packages/db/src/polar-revisions.test.ts` (new) — repo CRUD, validator (10+ failure modes from §6), ULID monotonicity, parent-chain navigation, dangling-pointer fallback.
- `packages/db/src/migrate-wardrobe-v2.test.ts` (new) — v1 fixture → v2 result with revision-0 rows; legacy-only fixture (no wardrobe row); transaction-rollback under injected DB error; v2 input is a no-op.
- `packages/db/src/config-store.test.ts` (extend) — `activePolar$` switches output after `setActiveRevision`; `polarRevisions$` emits on create; `polars$` alias still works.
- `packages/compute/src/polars/pipeline.test.ts` (extend) — pipeline republishes target boatspeed within one tick of `setActiveRevision`.
- `packages/web/src/app/api/polar/revisions/route.test.ts` (new) — happy path for list/get/create + 400 on invalid grid + 404 on unknown.
- Property test in `packages/db/`: round-trip `PolarTable → JSON.stringify → JSON.parse → bilinear lookup` is bit-identical for any well-formed grid (fast-check generators matching the validator rules).

## 8. Related work (out of scope; sibling specs)

1. **Multi-tenant migration of other config tables** — `boat_config`, `aws_awa_cal`, `bsp_cal`, `compass_deviation`, `damping_config`, `source_priority_config`, `ais_alarm_config`, `passage_log` all gain a `boatId` column / field, same pattern as wardrobe.
2. **Mode-switching runtime** — what flips `wardrobe.activeMode`. Sensor threshold (SOG hysteresis, foiling sensor), manual button, or both with arbitration.
3. **Sea-state derate** — per-boat lookup table indexed by Hs (or Beaufort), multiplier applied to polar boatspeed at lookup time. Lives in `@g5000/compute` next to `interpolatePolarSpeed`.
4. **Crossover / sail-recommendation surface** — drives wardrobe-active suggestions from current (TWS, TWA). Reads polar revisions to compare predicted boatspeed across slots.
5. **Regression pipeline** — consumes session-log observations + current revision, fits an updated `boatSpeed` grid (and optionally `sigma`), writes a new revision with `lineageKind='regression'`.
6. **Polar imports** — `.pol` (Expedition) and ORC/IMS VPP parsers writing to the revisions table with appropriate lineage.
7. **Drop legacy `polars` table** — once Pi installs have all migrated to v2 wardrobes, remove the `polars` Drizzle table and `loadOrInsert(polars, DEFAULT_POLARS)` step.

## 9. Open questions

None blocking. Items marked for the implementation plan to lock down:

- ULID library choice (`ulid` npm package vs. hand-rolled). The plan picks one.
- Exact `lineage_meta` JSON shape (free-form `{source?, notes?}` for now; can grow without migration since it's JSON).
- Whether `polarRevisions$` emits a `Map` or an `Array` (`Map` keeps O(1) lookup in the resolver; existing config observables emit primitives, so `Map` is the small new pattern).
