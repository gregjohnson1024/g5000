# Stateful boat-state annotations — design

**Date:** 2026-05-23
**Status:** approved (design); implementation plan to follow

## Goal

Turn the chart's "Annotate the track" box (`AnnotationDropper`) into a live
boat-state control that, per group, shows the **current** state and lets you
change it — recording both the persisted state and a timestamped track
annotation. Three kinds of state:

1. **Sails** — headsail / main / downwind, one active sail each, populated from
   the sail wardrobe (existing persisted `wardrobe.active`).
2. **Daggerboards** — Port + Starboard, position 0/25/50/75/100 % down (new
   persisted state).
3. **Engines** — Port + Starboard, Run/Stop each (new persisted state; rpm
   deferred).

The sail buttons are dynamically populated from the wardrobe and update as it
changes; all groups show current state and enforce one selection per group.

## Background / current state

- `AnnotationDropper` (`packages/web/src/components/AnnotationDropper.tsx`):
  floating widget (pill on `/helm`, icon in the chart toolbar) that polls
  `GET /api/tracks/active/annotation` every 5 s and posts events
  `{ label, kind: 'event'|'periodStart'|'periodEnd' }`. Hardcoded
  `QUICK_BUTTONS` (Tack/Gybe/Reef in/out/Main up-down/J1-3/Spinnaker up-down) +
  a Custom label field + Start/End period.
- **Sails:** `SailWardrobe` (from `@g5000/db`, `defaults.ts`):
  `SailCategory = 'headsail' | 'main' | 'downwind'`, `SAIL_CATEGORIES` exported;
  `Sail = { id, name, category, areaSqM?, notes?, region }`;
  `SailWardrobe.active = { headsail?, main?, downwind? }` (one sail id per
  category — already the persisted "current sail"). `GET /api/sails` returns the
  full wardrobe; `POST /api/sails/active { category, sailId|null }` sets the
  active sail for a category. Crossover/recommendation reads `wardrobe.active`.
- **Daggerboards / engines:** no existing state, config, or channel — new.
- `TrackAnnotation = { tsMs, label, kind }`; annotations append to the active
  track via `POST /api/tracks/active/annotation`. The box knows `state.trackId`
  (null when not recording). No per-category "current" derivation exists today.
- ConfigStore uses singleton-blob tables (`CREATE TABLE IF NOT EXISTS x (id, value)`);
  waypoints/routes were added this way (`boatState`/`getBoatState`/`setBoatState`
  mirrors `getWaypoints`/`setWaypoints`).

## Decisions (from brainstorming)

1. **Sail tap = set active + log.** `POST /api/sails/active` (updates current
   state the crossover engine reads) **and** `POST .../annotation` (timestamped
   track log). The box reflects `wardrobe.active`.
2. **Per-group "down / none".** Each group has an explicit option that clears it
   (sail `sailId:null`; daggerboard not applicable — see below; engine = Stop).
3. **Daggerboards + engines persist** in a new `boat_state` store (not
   log-derived) — current state survives reloads, parity with sails.
4. **Engine = Run/Stop only** for v1; rpm deferred.
5. **Two engines, Port + Starboard** (parallel to the daggerboards).

## New persisted state

New ConfigStore singleton-blob table `boat_state`:
```ts
export interface BoatState {
  daggerboards: { port: number; starboard: number }; // % down: 0 (up) … 100 (down)
  engines: { port: { running: boolean }; starboard: { running: boolean } };
}
```
- **Default:** `{ daggerboards: { port: 0, starboard: 0 }, engines: { port: { running: false }, starboard: { running: false } } }`.
- ConfigStore gains `boatState$` (Observable), `getBoatState()`, `setBoatState(value)` — mirroring the waypoints/routes accessors; `BoatState` exported from `@g5000/db`.
- API: `GET /api/boat-state` → `{ ok, boatState }`; `POST /api/boat-state` accepts a **partial merge** `{ daggerboards?: Partial<{port,starboard}>, engines?: Partial<{port,starboard}> }`, validates (board % in {0,25,50,75,100}; running boolean), merges into the stored state, returns the updated `boatState`.

## AnnotationDropper changes

Add a second poll on the existing 5 s tick (and the visibility refetch):
`GET /api/sails` (wardrobe) and `GET /api/boat-state`. Hold both in state.

Replace the hardcoded sail rows with dynamic groups; add daggerboard + engine
groups. Panel content becomes scrollable (`max-h-[70vh] overflow-y-auto`) since
it now holds more.

### Sails (3 groups)
Iterate `SAIL_CATEGORIES`. For each (Headsail / Main / Downwind):
- buttons for each `wardrobe.sails` of that category (label = sail name), the
  one matching `wardrobe.active[category]` highlighted (amber);
- a **"down"** button (clears the group).
- Tap a sail → `POST /api/sails/active { category, sailId }` + annotation
  `{ label: sailName, kind: 'event' }`. Tap down → `POST /api/sails/active
  { category, sailId: null }` + annotation `"<Group> down"`.

### Daggerboards (Port, Starboard)
Two rows. Each: five buttons **Up (0%) · 25% · 50% · 75% · Down (100%)**, the
current `boatState.daggerboards[side]` highlighted. Tap → `POST /api/boat-state
{ daggerboards: { [side]: pct } }` + annotation
(`"Port board 75%"`; at extremes `"Port board up"` (0) / `"Port board down"` (100)).
There is no separate "none" — 0 % (Up) is the cleared position.

### Engines (Port, Starboard)
Two rows. Each: **Run** / **Stop**, with the current
`boatState.engines[side].running` highlighted. Tap Run → `POST /api/boat-state
{ engines: { [side]: { running: true } } }` + annotation `"<Side> engine on"`;
Stop → `{ running: false }` + annotation `"<Side> engine off"`.

### Track-dependence
The state-setting POST (sails/active or boat-state) **always** runs — these are
boat-state controls usable before/without recording. The annotation log is a
secondary effect that only fires when `state.trackId` is non-null. So the sail /
board / engine buttons are **enabled regardless of an active track**; only the
pure-event buttons (Tack / Gybe / Custom / period) keep the current
"disabled when no active track" behavior.

### Kept / removed
- **Kept** as pure-event annotations: Tack, Gybe, Custom label + kind, Start/End
  period.
- **Removed** hardcoded buttons: Reef in/out, Main up/down, J1/J2/J3, Spinnaker
  up/down (subsumed by the dynamic sail groups — reefs are main-category sails).

## Components / files

- **`@g5000/db`:** `BoatState` type (in `defaults.ts` or a small new types file);
  `boat_state` table in `config-store.ts` `CREATE TABLE` block; `boatState$` /
  `getBoatState` / `setBoatState`; export from `index.ts`.
- **New:** `packages/web/src/app/api/boat-state/route.ts` (GET + POST merge).
- **New pure helpers (unit-tested):**
  - `packages/web/src/components/sail-groups.ts` — `sailGroups(wardrobe)` →
    `Array<{ category, label, sails: {id,name}[], activeId?: string }>`.
  - `packages/web/src/components/daggerboard-label.ts` — `daggerboardLabel(side, pct)`
    → e.g. `"Port board 75%"` / `"Port board up"` / `"Port board down"`.
- **Modify:** `AnnotationDropper.tsx` — poll sails + boat-state; render sail /
  daggerboard / engine groups; dual-action handlers; split disabled logic;
  scrollable panel. (`/helm` and the chart both get it — same component; the new
  state is global, so fine.)

## Testing

- Unit-test `sailGroups` (groups by category, marks active, handles empty
  categories) and `daggerboardLabel` (extremes vs mid positions, both sides).
- ConfigStore `boat_state` round-trip + default + persist-across-reopen (mirror
  the waypoints/routes config-store test).
- `/api/boat-state` partial-merge validation (bad %, non-boolean rejected;
  merge preserves untouched fields).
- Browser: groups populate from the wardrobe; tapping a sail highlights it +
  the Sails page reflects the same `active`; daggerboard/engine taps persist
  (survive reload) and log annotations when a track is active; the panel
  scrolls; `/helm` still works.

## Out of scope (future)

- Engine **rpm** capture (run/stop only for v1).
- Daggerboard positions finer than the five buttons (the model stores a number,
  so no schema change needed later).
- Reading engine state from N2K automatically (this is manual annotation).
- A dedicated boat-state page (this rides in the annotation box).

## Risks / notes

- The panel grows tall; the `max-h`/scroll must be verified at the chart's
  icon-variant placement (opens left) and the helm pill placement.
- Dual POST per tap (state + annotation): set state first; if the annotation
  POST fails (or no track), the state change still stands — surface annotation
  failures via the existing flash, don't roll back the state.
- `POST /api/boat-state` merges partials so concurrent board/engine taps don't
  clobber each other; validate the board % against the allowed set server-side.
- Sail buttons enabling without a track is a deliberate behavior change from the
  current all-disabled-when-no-track rule — keep the pure-event buttons gated.
