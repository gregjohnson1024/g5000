# B&G / Simrad Waypoints & Routes app — implications for g5000

Source: Simrad / B&G **Waypoints & Routes App Guide**, English, software v2.1, document version 001, ©2025 Navico Group. Covers the NSS 4, Zeus SR, NSX, and Zeus S MFDs.

The Waypoints & Routes app is a dedicated app on the unit that sits next to the Chart app and shares its database — anything created in one shows up in the other. It is the closest existing-product analogue to g5000's `/marks-and-routes` page, and the gap between the two is large: today we have a flat JSON file of waypoints with no tags, no icons, no first-class routes, and no import/export. This note is a backlog of design candidates, not a spec.

Current state in g5000:

- `packages/web/src/lib/waypoints.ts` — JSON file at `data/waypoints.json`, fields `{ id, name, lat, lon, notes, createdAt }`. Four seeded waypoints (Nantucket, Newport, Block Island, Moore Bros).
- `/api/waypoints` and `/api/waypoints/[id]` — CRUD. No import, no export.
- `/marks-and-routes` — list view with add form, per-row edit, distance column, plans section below.
- `WaypointsLayer.tsx` on the chart — renders dots with names. No icons, no colors.
- "Plans" are computed router outputs (`/api/plans`), not user-authored routes. There is no `routes` entity at all.

## High value — strong fit with g5000's current direction

### Tags (manual p12–14, p26–28)

The single most generally useful concept in the guide. A tag is a free-form string label shared across waypoints, routes, and tracks. The same tag (`'sunset'`, `'snapper'`, `'fuel stop'`, `'NYYC race'`) can be applied to any combination of the three. Each tag shows the count of items it's applied to. Tags drive filtering on every list view.

We have no tagging concept today. The shape is small:

- Add `tags: string[]` to `Waypoint`, to a new `Route`, and to the existing session-log/track records.
- Persist a global tag dictionary in `ConfigStore` (key `tags`) — `Array<{ id: string, name: string, color?: string, createdAt: string }>`. The dictionary is the canonical list; the per-entity `tags: string[]` stores tag *ids* not names so renaming a tag doesn't orphan references.
- Surface filter chips on `/marks-and-routes` and the future routes view.

Worth doing even before the rest of the route work lands — tags retrofit cleanly onto the existing four-waypoint store.

### First-class Routes entity (manual p17)

A route is an ordered list of routepoints navigated from start to end. Each routepoint is either an inline point or a reference to a saved waypoint. The B&G app creates a route by long-pressing locations on the chart; the same route can be edited later (drag routepoints), deleted, exported, or "raced" (B&G-only — see below).

We have **no** route entity. The closest thing is the router's `/api/plans`, which is a computed isochronic-fan result keyed off a destination and a weather window — not a hand-authored ordered list. The mental model is different: a route is user-authored intent, a plan is solver output. Adopting Routes gives us:

- A target for autopilot "navigate route" mode (someday).
- A persistent thing the chart can render with `RoutePolyline` even when no plan is active.
- The base for the race-route integration below.

Storage shape (proposed): `{ id, name, tags: string[], routepoints: Array<{ lat: number, lon: number, name?: string, waypointId?: string }>, notes?: string, createdAt: string, updatedAt: string }`. Persist in `ConfigStore` (single JSON blob under key `routes`). Lives next to the waypoints table; both reference shared tags.

This is a meaningfully bigger lift than tags — new API surface (`/api/routes`, `/api/routes/[id]`), new chart-page mode for editing routepoints, new list view tab. But it's the central concept the rest of the manual hangs off; without it most of the rest of this doc can't land.

### GPX import / export (manual p9–11, p23–25)

The guide says "import from microSD or USB" without naming a format, but the marine-industry standard for waypoint/route interchange is **GPX** (also `.kml` and proprietary `.usr`). Adding GPX import/export to the API:

- `POST /api/waypoints/import` — accepts a GPX file, parses `<wpt>` and `<rte>` (and optionally `<trk>`) elements, dedupes by name + position, returns a diff (added / skipped).
- `GET /api/waypoints/export?ids=…` — emits GPX for the selected ids; `GET /api/routes/export?id=…` same for routes.
- A button on `/marks-and-routes` that drops a file dialog and a "Download all as GPX" link.

Low effort, very high interop value. GPX is what Expedition, OpenCPN, PredictWind, iNavX, and any chartplotter that's been made in the last 15 years speak. Sula's destination set (Bristol Marine, race marks for next season's regattas) lives in third-party tools today and gets typed by hand into g5000.

### One-tap "Plan route to this waypoint" (manual p19)

Today, getting from a waypoint to an active routed destination is: navigate to `/chart`, drop a destination by clicking, wait for the router. The B&G UX is: waypoint list → options → **Plan route** → **Autoroute** → routing starts immediately.

We already have the router (`@g5000/routing` + `/api/route/plan`) and the chart-page destination-handling. The missing piece is a one-button shortcut on the marks-and-routes row that pushes that waypoint into the chart's plan state and navigates over. Days of work, big perceived speed-up for a real-boat task ("we just decided to go to Block Island instead").

### Icons and colors on waypoints (manual p5–7)

Visual differentiation on the chart. The B&G guide shows ~20 icons (anchor, fish, fuel pump, X for race mark, generic dot, flag, etc.) and a small color palette. We render every waypoint identically today, so "Newport (destination)", "Block Island (fuel stop)", and "Moore Bros (Bristol pickup)" all look the same on the chart.

A small fixed set is enough — say eight icons that map to common categories (`generic`, `anchor`, `fuel`, `harbor`, `race-mark`, `hazard`, `flag`, `x`) plus eight colors. Store as `{ icon: string, color: string }` on the Waypoint. `WaypointsLayer.tsx` already iterates the list — swapping the dot for a sprite atlas is a one-component change.

## Medium value — useful but not blocking

### Drag-to-edit routepoints on chart (manual p21)

Once Routes exist, editing them on the chart by dragging handles is much faster than typing coordinates. The Simrad UX: select route → options → Edit → drag points → Done. Implementation note for us: MapLibre's `GeolocateControl`-style drag handles aren't a built-in primitive, but we already have draggable markers on the live boat indicator pattern in `LiveBoatMarker.tsx` — the editing layer would follow that shape.

Couples tightly to Routes; doesn't ship until that does.

### Race route (manual p20 — "B&G devices only")

Convert a normal route into a race-mode route. The guide describes this as the gateway to the race-tactical features the B&G version of the device exposes. We have the **other side** of this — a full race cluster (`startRaceComputePipeline`, laylines, VMC, OCS, wind-shifts, polar targets, start-line geometry — all on the `@g5000/compute/race` subpath) but no UI concept that says "this set of routepoints **is** the race course".

A "Race this route" action would:

- Take the route's routepoints as the active mark sequence (feeds into `ActiveMarkSelector` on `/race`).
- Treat the first leg as the start line (or prompt for explicit start-line geometry if the first leg is too long).
- Switch the chart into race-mode overlays (already implemented for laylines and start-line individually).

This is the most interesting integration on the list — it bridges the navigation side (routes) and the racing side (compute/race) that today have no shared concept. Worth doing **after** Routes + tags + icons are in.

### Filter and sort (manual p15–16, p29–30)

Once we have tags, icons, and colors, filtering by them becomes useful. Sort options the guide offers: alphabetically, by creation date, by proximity. We just added a distance column to `/marks-and-routes`, so by-proximity sort is essentially free.

Rectangle/polygon chart filter (draw a shape, see only waypoints in it) is interesting at MFD scale (hundreds of waypoints) but overkill for Sula's current set. Park it.

### Coordinate-system picker on entry (manual p5)

The B&G "create waypoint" form lets the user pick the input coordinate system. We accept DMM via `lib/coords.ts` (`33 42.232n 66 25.240w`) but the form is one-format. Adding a small DD ↔ DMM ↔ DMS toggle on the add-waypoint form means a user can paste from a chartbook (typically DMS) or a tide app (typically DD) without manual conversion.

Display format stays DMM everywhere per the `lat-lon-format` rule.

### Swipe-to-delete (manual p8, p21)

A small UX nicety on touch devices. The current list-row layout already has an edit button per row; a swipe-to-reveal-delete is the iOS-list pattern. Low value but trivial. Wait for the rest of the redesign and then decide whether to use swipe vs. an explicit row-level delete button.

## Low value — translate poorly to g5000

### microSD / USB import/export (manual p9, p10, p23, p24)

We're a web app served from a Pi. The user doesn't insert media into anything. The interchange concept absolutely matters — it just lives at the API layer (GPX import/export above), not as a file-picker rooted at a removable drive.

### Mobile-app cloud sync (manual p4, footnote)

"Saved waypoints and routes synchronize with the Simrad® or B&G mobile app (when the same account is used on the unit and mobile app). An active internet connection is required."

g5000's deployment model is different — the Pi serves the same UI to any device on Tailscale or the boat networks. There's no separate mobile app and no cloud account. The closest analogue is the public URL at `g5000.sulabassana.net`, and that already syncs by virtue of being the same backend. Nothing to build.

### "Delete all" (manual p8, p22)

Listed as a single-button bulk-delete with an irreversible-warning note. With four seeded waypoints that the system auto-restores on next read, this is mostly a foot-gun. If we add it at all, gate it behind a typed-confirmation (`'delete all'`) and keep the seeded ones immortal so a wrong tap doesn't wipe the Bristol Marine pickup point on the way in.

### Bulk tag operations: "Tag these" / "Tag all" (manual p14, p28)

Useful at MFD scale, premature for ours. Single-item tagging plus the global tag dictionary covers the user need until lists are big enough that bulk-apply matters.

### Dedicated "Waypoints & Routes app" as a sibling of the Chart app

This is the navigational shell of the MFD. We have `/marks-and-routes` already — it grows to match the feature set above without needing to be reified as a separate "app". Don't replicate the MFD's home-screen-tile shape; we don't have that concept.

## Cross-cutting: persistence move

`data/waypoints.json` was fine for four hardcoded seeds. Once tags, routes, icons, and colors land, the entity graph (waypoints ↔ tags ↔ routes ↔ tracks) is too relational for two flat JSON files. The move is to `ConfigStore` keys `waypoints`, `routes`, `tags`, with each row still stored as a JSON blob keyed by id (matching the existing `(id, value JSON)` table convention noted in `CLAUDE.md`). One-time migration on first boot reads the JSON file, writes into the store, and renames the file to `.migrated`. The four seeded waypoints stay reseeded on missing-id.

Do this **before** tags land — the tag dictionary doesn't have a sensible JSON-file home, and shifting the persistence twice is wasteful.

## Suggested ordering

1. Persistence move (waypoints from JSON to ConfigStore; introduce the `tags` table).
2. Tags (add to waypoints; filter-chips on `/marks-and-routes`; tag dictionary CRUD).
3. Icons + colors on waypoints (sprite atlas on the chart layer).
4. Routes entity (`/api/routes`, list view tab on `/marks-and-routes`, RoutePolyline reads from saved routes).
5. GPX import/export (waypoints first, then routes).
6. One-tap "Plan route to waypoint" from the list.
7. Drag-to-edit routepoints on the chart.
8. Race-this-route integration with the existing `@g5000/compute/race` pipeline.

Items 1–3 stand alone and are individually shippable. Items 4–8 chain on Routes.
