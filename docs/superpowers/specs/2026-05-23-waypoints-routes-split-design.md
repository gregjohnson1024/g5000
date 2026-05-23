# Waypoints / Routes split — design

**Date:** 2026-05-23
**Status:** approved (design); implementation plan to follow

## Goal

Split the single `/marks-and-routes` page into two first-class concerns:

- **Waypoints** — CRUD for individual named points.
- **Routes** — CRUD for routes, where a route is an **ordered list of waypoints**.

Introduce a real `Route` entity (none exists today), move both waypoints and
routes into `ConfigStore` (SQLite), and remove the chart's click-to-define
plan flow. The weather router survives but its entry point moves to the Routes
tab.

## Background / current state

- `packages/web/src/lib/waypoints.ts` — waypoints persisted as a flat
  `data/waypoints.json`, shape `{ id, name, lat, lon, notes?, createdAt }`,
  4 hardcoded seeds (Nantucket, Newport, Block Island, Moore Bros).
- `/api/waypoints` + `/api/waypoints/[id]` — CRUD against the JSON file.
- `/marks-and-routes/page.tsx` — single page: waypoint list/add/edit with a
  distance column, plus a "plans" section.
- **No `Route` entity exists.** The chart's `PlanControls` + `onMapClick`
  start/end picking is the entry point to the **weather router**
  (`/api/route/plan`, isochronic fan + currents), which produces a **plan**
  (`/api/plans`). A plan (solver output) is conceptually distinct from a
  route (user-authored ordered list).
- Chart `RoutePolyline` renders the active plan's route; `?plan=<id>` loads a
  saved plan and seeds the markers.

This split is item 1 + part of item 4 from
`docs/design/waypoints-routes-feature-notes.md`. Tags, icons/colors, GPX,
and race-route integration remain future work and are explicitly **out of
scope** here.

## Decisions (from brainstorming)

1. **Weather router:** keep it; move its entry point off the chart. You build
   a route in the Routes tab, then "Plan" it through the router there. The
   main `/chart` becomes display-only for routes/plans.
2. **Route composition:** an ordered list of **references to saved waypoints**
   (the Expedition / Adrena model — no orphan inline points), with a
   **create-on-the-fly** "+ New waypoint" affordance inside the builder.
3. **Route builder UX:** list/form-based, **no map**, for v1. (A simple
   chart-based way to define routes *and* waypoints is a desired future
   direction — see Future work — but is out of scope here.)
4. **Persistence:** move **both** waypoints and routes into `ConfigStore`
   (`config.db`) now, rather than adding a parallel `routes.json`.
5. **"Plan" behavior:** v1 weather-routes **first → last waypoint only**,
   reusing the existing router untouched. Intermediate waypoints are
   display-only until leg-by-leg routing lands later.

## Data model

Two new ConfigStore tables in `config.db`. **Note the actual ConfigStore
pattern:** each table holds a *single* row (keyed by the internal `SINGLETON`
id) whose `value` is the whole collection as one JSON blob — exactly how
`sailWardrobe` stores its list of sails. So `waypoints` is one blob holding
`Waypoint[]` and `routes` is one blob holding `Route[]`. ConfigStore gains
typed getters/setters/observables for each (mirroring `sails$` / `setSails`);
per-item CRUD is read-modify-write of the whole collection in the web-lib
accessors.

### `waypoints`

```ts
interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  notes?: string;
  createdAt: string; // ISO 8601
}
```

Same shape as today — no new fields. Icons/colors/tags are deferred.

### `routes`

```ts
interface Route {
  id: string;
  name: string;
  waypointIds: string[]; // ordered references into the waypoints table
  notes?: string;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
}
```

A route holds **only** waypoint ids in order — no embedded coordinates, no
inline points. Resolving a route to coordinates is done by joining against the
`waypoints` table at read time.

### Referential integrity

- Creating/updating a route validates that **every** `waypointId` exists;
  unknown ids → 400 with the offending ids listed.
- Deleting a waypoint that is referenced by one or more routes is **blocked**
  → 409 with the list of route names using it. The user removes the waypoint
  from those routes first. (Chosen over silently mutating routes — explicit
  and safe.)

## Persistence & migration

- **Table definitions** (Drizzle schema for the `waypoints` and `routes`
  tables) live in `@g5000/db` alongside the other ConfigStore tables.
- **Accessor wrappers** stay in `packages/web/src/lib` where `waypoints.ts`
  lives today: refactor `waypoints.ts` to read/write via
  `getSharedConfigStore()` instead of `fs`, and add a parallel `routes.ts`.
  Each entity is stored as one JSON blob keyed by id, per the
  `(id, value JSON)` convention.
- **One-time migration at app boot:** waypoints today live at
  `${G5000_ROUTER_ROOT}/waypoints.json` (default `~/.g5000-router/waypoints.json`
  — the router root, **not** the app's `data/` dir). At boot, if that file
  exists and the ConfigStore `waypoints` table is still empty, read the file,
  write the list via `setWaypoints`, then rename the file to
  `waypoints.json.migrated`. Idempotent (empty-table guard + rename).
- **Seeds stay immortal:** the 4 hardcoded seeds are reseeded on missing id so
  an empty store still contains Newport / Block Island / Nantucket / Moore Bros.
- Routes start empty (no seeds).
- **Pi note:** `~/.g5000-router/` is a persistent disk cache that was **not**
  touched by today's app-dir rename, so the Pi's `waypoints.json` is intact at
  its original path. A normal deploy + restart runs the migration once; no
  extra Pi steps.

## API surface

- `GET /api/waypoints`, `POST /api/waypoints` — unchanged contract, now
  ConfigStore-backed.
- `GET/PUT/DELETE /api/waypoints/[id]` — DELETE gains the in-use-by-route
  guard (409 on conflict).
- `GET /api/routes`, `POST /api/routes` — new. POST validates waypoint ids.
- `GET/PUT/DELETE /api/routes/[id]` — new. PUT validates waypoint ids.
- `POST /api/routes/[id]/plan` — new. Resolves the route's first and last
  waypoint to coordinates and delegates to the existing `/api/route/plan`
  router, returning a plan exactly as the chart does today. (First→last only
  in v1.)

## UI

Replace the single `/marks-and-routes` page with two pages.

### `/waypoints`

The existing waypoint UI carried over: list with name, position (DMM), notes,
distance column, add form, per-row edit/delete. Delete surfaces the
in-use-by-route error when applicable.

### `/routes`

- **List:** each route row shows name, waypoint count, and total rhumb-line
  distance across the ordered points. Row actions: edit, delete, **Plan**.
- **Builder (create/edit):**
  - Name field.
  - Searchable waypoint picker that **appends** an existing waypoint to the
    ordered list.
  - **Drag-to-reorder** the list; remove-point per row.
  - **"+ New waypoint"** opens a small form (name + DMM coordinate entry via
    the existing `lib/coords.ts`) → creates the waypoint (it joins the
    waypoints table) and appends its id to the route.
  - Save → POST/PUT `/api/routes`.

### Navigation

- The nav-bar `Marks & Routes` entry becomes two: **Waypoints** and **Routes**.
- `/marks-and-routes` issues a redirect to `/waypoints` so existing bookmarks
  don't 404.

## Chart changes

- **Remove** `PlanControls`, the `onMapClick` start/end picking, and the
  now-dead `start` / `end` / `chart:planState` *definition* plumbing.
- **Keep** `RoutePolyline` and the `?plan=<id>` load path — the chart still
  **displays** a plan/route when one is loaded; it just no longer **defines**
  one.
- `CogExtension`, `WaypointsLayer`, range rings, etc. are unaffected.

## Testing

- Unit tests for the ConfigStore-backed waypoint + route stores: CRUD,
  referential-integrity guard (delete-blocked, unknown-id-rejected), and the
  JSON→ConfigStore migration (runs once, seeds immortal).
- API route tests for `/api/routes*` validation (note: route handlers that hit
  `getSharedConfigStore()` are red under bare vitest per the documented
  baseline — these need the ConfigStore test harness or are exercised via the
  store-level unit tests).
- Route-builder reorder logic (pure function) unit-tested.
- Follows existing `*.test.ts(x)` co-located patterns.

## Out of scope (future work)

- **Chart-based route/waypoint definition** — a simple way to define routes
  *and* waypoints directly on `/chart`. Explicitly desired later; deliberately
  not in this change.
- **Leg-by-leg weather routing** — "Plan" honoring intermediate waypoints with
  chained ETAs.
- Tags, icons/colors, GPX import/export, "Plan route to this waypoint"
  one-tap, race-this-route integration (all from the feature-notes backlog).

## Risks / notes

- The `/marks-and-routes` → `/waypoints` redirect must be in place before
  removing the old page to avoid dead nav links.
- The plans concept (`/api/plans`, router output) is **unchanged** and remains
  distinct from routes. The Routes "Plan" action produces a plan via the same
  router; it does not replace the `/plans` page.
- Deleting the chart's plan-definition plumbing must not break `?plan=<id>`
  loading — that path stays.
