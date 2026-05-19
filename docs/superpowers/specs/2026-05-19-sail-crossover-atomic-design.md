# Sail Crossover — Atomic Sails Refactor

**Status:** Spec
**Date:** 2026-05-19
**Supersedes:** [Sail Crossover — Model A](2026-05-18-sail-crossover-model-a.md)

## Problem with Model A

Model A (PR #17, shipped to Pi) treats a "SailConfig" as an atomic combination — `J0+Full main`, `STJ+Reef1`, `STJReefed+Reef2`, etc. — and assigns ONE winner config per `(TWS, TWA)` cell. To represent a sail wardrobe like Sula's, the skipper has to enumerate every legal combination (~9 for Sula) and paint a single-winner grid.

This collapses a naturally 3D selection problem (one headsail × one mainsail-reef state × one downwind sail) into a 1D winner per cell. The North Sails chart for Sula (`SulaSpecific/Advanced/Sail crossover charts/North SSC_Dazcat1495_Prismo_20250108.pdf`) makes the underlying structure plain: it overlays ten separate blobs — four headsails, three reef states, three downwind sails — on the same (TWS, TWA) plane, with deliberate overlap. The skipper composes a sail plan by picking one valid blob from each independent axis.

## Goals

1. Model individual sails (not combinations) as the unit of editing and storage.
2. Capture overlapping valid regions on a (TWS, TWA) grid with enough resolution to faithfully represent a chart like North's.
3. Recommend the full set of valid sails per category at any operating point, not one winner.
4. Track which sail is currently hoisted in each category for "change recommended" alerts.

## Non-goals

- Per-sail polar performance offsets. Polar is the boat's polar (per mode), not per sail.
- Polygon or freehand region editing — cell toggling is enough.
- Per-leg sail recommendations in routing. Removed; re-add later if needed.
- Back-compat with v2 wardrobe shape — clean cut, best-effort migration.

## Domain model

```ts
type SailCategory = 'headsail' | 'main' | 'downwind';

interface Sail {
  id: string; // 'j0', 'light-jib', 'stj', 'stj-reefed',
  //   'full-main', 'reef1', 'reef2', 'reef3',
  //   'g0', 'hfg', 'a2'
  name: string; // 'J0', 'Reef 1', 'A2'
  category: SailCategory;
  areaSqM?: number; // optional, from North chart
  notes?: string;
  region: { cells: string[] }; // grid cell keys "twsIdx,twaIdx"
}

interface SailWardrobe {
  schemaVersion: 3;
  boatId: string;
  sails: Sail[];
  active: {
    // currently hoisted; one per category, all optional
    headsail?: string; // sail.id
    main?: string;
    downwind?: string;
  };
  activeMode: PolarMode; // unchanged — selects active polar revision
}
```

### Category semantics

The three categories encode mutual exclusivity:

- **headsail** — exactly one flown when sailing; valid range varies by sail
- **main** — exactly one reef state; `full-main` is the unreefed state
- **downwind** — at most one (none in pure upwind); independent of headsail / main

A sail belongs to exactly one category. The recommender groups output by category.

### Region representation

Each sail's `region.cells` is a flat array of `"twsIdx,twaIdx"` strings, marking cells where the sail is valid. Empty array = sail not currently usable. Cell keys reference a **fixed grid** (see below), not the polar's bins.

## Grid

Fixed, decoupled from polar bins:

- **TWS:** 0–40 kn in 1-kt steps → 41 bins, indices 0..40
- **TWA:** 0–180° in 5° steps → 37 bins, indices 0..36

Cell key format: `"${twsIdx},${twaIdx}"`. `twsIdx` is the TWS knots value (`0..40`); `twaIdx` is the TWA-in-5°-units value (`0..36`, so TWA degrees = `twaIdx * 5`). Snapping rules:

- `twsIdx = clamp(round(twsKn), 0, 40)`
- `twaIdx = clamp(round(twaDeg / 5), 0, 36)`

Boundaries (exactly 0.5 kn, exactly 2.5°) round half-to-even per JS `Math.round` convention — operationally fine since wind is noisy.

Rationale: 1 kt × 5° captures the smoothness of the North chart faithfully (Reef boundaries shift ~2 kt per band). The polar's 8 TWS × ~16 TWA bins is too coarse and irregular for region drawing.

The grid parameters are constants in `@g5000/core` — not stored per wardrobe. If a future boat needs a different range, change the constants and re-migrate.

## Storage

### Schema changes

**`sail_wardrobe` table** — same DDL (`id TEXT PRIMARY KEY, value TEXT NOT NULL`), JSON shape changes to v3 as above.

**`crossover_map` table** — dropped entirely. Single-winner model is gone.

**`crossover_settings` table** — retained, but trimmed:

```ts
interface CrossoverSettings {
  recommendationStableSeconds: number; // unchanged, default 30
  forecastIntervalMinutes: number; // unchanged, default 30
  forecastDurationHours: number; // unchanged, default 12
}
```

Fields removed: `chartTwsMaxKn`, `chartTwaMinDeg`, `chartTwaMaxDeg` (grid is fixed).

### Migration v2 → v3

On `ConfigStore` open, if `sail_wardrobe` JSON lacks `schemaVersion === 3`:

1. For each existing `SailConfig` in `configs[]`, derive atomic sails from `mainState`, `headsail`, `downwindSail` string fields, slugified:
   - `cfg.headsail = 'J0'` → atomic sail `{ id: 'j0', name: 'J0', category: 'headsail', region: {cells: []} }`
   - `cfg.mainState = 'Reef1'` → atomic sail `{ id: 'reef1', name: 'Reef 1', category: 'main', region: {cells: []} }`
   - `cfg.downwindSail = 'A2'` → atomic sail `{ id: 'a2', name: 'A2', category: 'downwind', region: {cells: []} }`
   - Dedupe by `id`.
2. If a `crossover_map` row exists for `(boatId, activeMode)`, for each painted cell `(twsIdx, twaIdx) → configId`:
   - Look up the cell's `(TWS knots, TWA degrees)` from the polar's bins.
   - Find the corresponding fixed-grid cell.
   - Mark that cell in each atomic sail derived from `configId`.
3. Set `active.headsail`, `active.main`, `active.downwind` from the old `activeConfigId` config's component sails (best effort; may be undefined if the field is missing).
4. Drop `crossover_map` and the three trimmed fields from `crossover_settings`.

The migration is one-shot and idempotent. Sula's wardrobe currently has ~1 painted cell, so loss of fidelity is acceptable; the skipper will repaint on the new editor.

### Polar binding removed

`SailConfig.modes[mode].activeRevisionId` is dropped. Polar revisions are keyed by `(boat, mode)` only and surfaced via `polar_revisions` as before. The wardrobe's `activeMode` still drives which polar revision is active; sails don't carry polar pointers.

## Compute pipeline

`startSailCrossoverPipeline` is rewritten. Inputs unchanged (wind channels, store observables). Output channel and payload change:

- **Channel:** `sail.recommendation` (unchanged name)
- **Payload `ChannelValue` kind:** `sail_recommendation` (unchanged name; shape changes)

```ts
interface SailRecommendation {
  kind: 'sail_recommendation';
  cellTwsKn: number; // snapped to grid center
  cellTwaDeg: number;
  valid: {
    // sail.id[], sorted by areaSqM desc (largest first);
    // sails without areaSqM sort last, tie-break by id asc
    headsail: string[];
    main: string[];
    downwind: string[];
  };
  active: {
    headsail?: string;
    main?: string;
    downwind?: string;
  };
  changeNeeded: {
    // active sail not in valid set for ≥ stableSeconds
    headsail: boolean;
    main: boolean;
    downwind: boolean;
  };
  enteredAt: number; // UNIX seconds when current valid-set was first seen
  stableSeconds: number;
}
```

### Stability logic

`changeNeeded[cat]` fires only when:

1. `active[cat]` is defined, AND
2. `active[cat]` has been continuously outside its region (i.e., not in `valid[cat]`) for ≥ `stableSeconds`.

When the operating cell changes, a per-category timer resets only for categories whose validity flipped. This avoids puff-induced flapping while staying responsive when conditions actually shift.

If `active[cat]` is undefined, `changeNeeded[cat]` is `false` (nothing to compare against).

## API

### `/api/sails` (was `SailWardrobe` v2)

- `GET` → returns v3 `SailWardrobe`
- `PUT` body: v3 `SailWardrobe`. Validates: all `sails[].id` unique; each `sails[].category` is a known category; each `active[cat]` (when set) references an existing sail of matching `category`. Deleting a sail that is currently `active[cat]` clears `active[cat]` to `undefined` server-side.

### `/api/sails/active`

- `POST` body: `{ category: SailCategory, sailId: string | null }`. Atomically updates `active[category]`. `null` clears.

### `/api/crossover-map`

**Removed entirely.** Region data lives on each sail.

### `/api/sails/[sailId]/region`

- `POST` body: `{ cells: string[] }` — replaces the sail's region. Validates cell keys against fixed grid bounds.

### `/api/crossover-settings`

- `GET` / `POST` — trimmed shape (3 fields).

## UI

### `/sails` (wardrobe)

Three sections, one per category. Each shows the sails in that category as rows: name, area, cell count, edit / delete. "Add sail" button per section. Renaming and deletion in-place.

### `/sails/crossover`

Layout: left rail = recommendation panel; main = chart; right rail = sail picker.

**Recommendation panel** (left):

- Three rows: Headsail / Main / Downwind
- Each row shows:
  - Active sail name (or "—" if unset)
  - Valid alternatives as small chips
  - Red "change" badge when `changeNeeded[cat]` is true
- Footer: current snapped cell `(TWS kn, TWA °)` and stability timer

**Chart** (center):

- Fixed grid background (41 × 37). Light gridlines every 5 kt, 30°.
- **View mode** ("show all"): each sail rendered as a semi-transparent colored region. Color from `lib/config-color.ts` (rekeyed by sail id). Overlaps blend naturally.
- **Edit mode**: pick a sail from the right rail → its region renders solid, others fade. Click a cell to toggle in/out of that sail's region.
- Live wind position drawn as a marker at current (TWS, TWA).
- Toggle between view / edit modes via a chip at top of chart.

**Sail picker** (right):

- Grouped by category, mirrors `/sails` layout but compact.
- Selecting a sail enters edit mode for that sail.
- "Set active" toggle per sail (clicking sets it as `active[category]`).

## Routing

`RouteLeg.configId`, `PlanInput.crossover`, `SailTimelineSegment`, and `computeSailTimeline` are all **removed**. The routing layer no longer recommends sails per leg. If we want to surface "you'll need to change headsails in 2 hours" later, we'll compute it from forecast wind + sail regions at the recommender layer, not at routing time.

## Test surface

New / rewritten tests:

- `packages/db/src/migrate-wardrobe-v3.test.ts` — v2 → v3 migration with config splitting and crossover_map remapping.
- `packages/db/src/config-store-sails-v3.test.ts` — `setSails` validation: id uniqueness, active ref integrity, category checks.
- `packages/db/src/schema-sails-v3.test.ts` — DDL + JSON round-trip.
- `packages/compute/src/sail-crossover/lookup.test.ts` — `snapToFixedGrid(twsMs, twaRad)` returns correct indices at boundaries; out-of-range clamping.
- `packages/compute/src/sail-crossover/pipeline.test.ts` — emits `valid.*` from sail regions, per-category `changeNeeded` stability, payload shape.
- `packages/web/src/app/api/sails/route.test.ts` — v3 PUT validation.
- `packages/web/src/app/api/sails/[sailId]/region/route.test.ts` — region replace, bounds validation.
- `packages/web/src/app/api/crossover-settings/route.test.ts` — trimmed shape.

Removed tests:

- `packages/db/src/config-store-crossover.test.ts` (crossover_map gone)
- `packages/db/src/schema-crossover.test.ts`
- `packages/web/src/app/api/crossover-map/route.test.ts`
- `packages/routing/src/sail-timeline.test.ts`
- `packages/routing/src/plan.crossover.test.ts`

Tests touched in passing: any test referencing `wardrobe.activeConfigId`, `cfg.modes`, `cfg.headsail`, etc.

## Out of scope

- Polygon / freehand region editing.
- Per-sail polar offsets.
- Forecast-driven sail-change predictions ("change in 2h").
- Multi-boat wardrobes (single-boat assumption holds).
- Lasso, bulk-paint, copy-region-from-another-sail editor affordances.
