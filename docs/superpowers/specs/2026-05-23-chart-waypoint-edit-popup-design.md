# Chart waypoint select + edit popup — design

**Date:** 2026-05-23
**Status:** approved (design); implementation plan to follow

## Goal

Click a waypoint on the chart to select it and open an anchored bubble showing
its details, ready for in-place editing (name, position, notes) with save and
delete. Selection is active only when the waypoint-drop mode is off.

## Background / current state

- `WaypointsLayer` (`packages/web/src/components/WaypointsLayer.tsx`): renders
  marks as a MapLibre `circle` layer (`waypoints-dot`, plus a `waypoints-ring`)
  and one HTML label `Marker` per mark. Props: `{ map, marks: MarkLike[] }`.
  `MarkLike` is `{ lat, lon, name, … }` — it does NOT currently carry the
  waypoint `id`, so a click can't identify which waypoint was hit. The dot
  GeoJSON features use index-based ids (`id: '${i}'`). No click handler today.
- `chart/page.tsx`: holds `waypoints` state `Array<{ id, name, lat, lon }>`
  (fetched from `/api/waypoints` on mount) and maps it to `MarkLike` for the
  layer (dropping `id`). It already has `waypointDropActive` state + the
  click-to-drop mode (gated `<Map onClick>`), `mapInstance`, and `setError`.
- API: `PUT /api/waypoints/{id}` (edit; returns updated waypoint),
  `DELETE /api/waypoints/{id}` (returns 200, or **409** `{ error: { code:
  'waypoint_in_use', message, routes:[{id,name}] } }` when a route references
  it). `GET /api/waypoints`. Coord parsing/formatting in `lib/coords` /
  `lib/format-coords` (`parseLatLon`, `parseCoordinate`, `formatCoordinate`).

## Decisions (from brainstorming)

1. **Editable: name, position, notes — full** (mirrors the `/waypoints` edit
   form), plus **Delete** (respecting the in-use-by-route 409 guard).
2. **Anchored bubble**: a React overlay card positioned at the waypoint via
   `map.project()`, re-projected on map move/zoom so it tracks the point.
3. **Selection vs drop-mode**: clicking a dot selects it (opens the popup) ONLY
   when `waypointDropActive` is false. While drop-mode is active, map clicks
   create new waypoints (selection paused).

## Architecture

### `WaypointsLayer` changes
- Add `id?: string` to `MarkLike`; include it in each dot feature's
  `properties` (`{ id }`). The chart's mark mapping carries `id` through.
- Add prop `onSelectWaypoint?: (id: string) => void`.
- In the mount-once effect, register `map.on('click', DOT_LAYER, handler)` (and
  the matching `off` in cleanup). The handler reads
  `e.features?.[0]?.properties?.id` and, if present and `onSelectWaypoint` is
  set, calls `onSelectWaypoint(id)`. Also set a pointer cursor on
  `mouseenter`/`mouseleave` of `DOT_LAYER` when `onSelectWaypoint` is provided.
- When `onSelectWaypoint` is undefined (drop-mode on), the handler is a no-op
  (guard inside the handler reads the latest callback via a ref, so toggling
  drop-mode doesn't require re-binding the listener).

### `WaypointEditPopup` (new) — `packages/web/src/components/WaypointEditPopup.tsx`
A React card anchored to a waypoint:
- Props: `{ map, waypoint: { id, name, lat, lon, notes? }, onSaved(updated), onDeleted(id), onClose }`.
- Projects `waypoint` lat/lon → screen px via `map.project([lon,lat])`; stores
  the px in state; re-projects on map `move` + `zoom` (subscribe in an effect,
  unsubscribe on cleanup) so the card tracks the point. Absolutely positioned
  over the map.
- Form: **Name** input; **Position** DMM paste field (prefilled via
  `formatCoordinate` 'dmm'; parsed with `parseLatLon` on save); **Notes**
  textarea. Buttons: **Save**, **Delete**, **Close** (✕). Esc closes.
- **Save**: `PUT /api/waypoints/{id}` with `{ name, lat, lon, notes }`; on ok
  call `onSaved(updated)`; on error show an inline message.
- **Delete**: `DELETE /api/waypoints/{id}`; on 200 call `onDeleted(id)`; on 409
  show `error.message` (the route names) inline and keep the popup open.

### `chart/page.tsx` wiring
- Add `selectedWaypointId: string | null` state.
- Map `waypoints` → marks WITH `id`: `marks={waypoints.map((w) => ({ id: w.id, lat: w.lat, lon: w.lon, name: w.name }))}`.
- Pass `onSelectWaypoint={waypointDropActive ? undefined : (id) => setSelectedWaypointId(id)}` to `WaypointsLayer`.
- When `selectedWaypointId` is set and the waypoint exists, render
  `<WaypointEditPopup map={mapInstance} waypoint={selected} onSaved={…} onDeleted={…} onClose={() => setSelectedWaypointId(null)} />`.
  - `onSaved(updated)`: replace that entry in `waypoints` state; keep it
    selected (or close — keep selected so the user sees the move).
  - `onDeleted(id)`: remove from `waypoints` state; clear selection.
- Entering drop-mode clears any current selection (so the two modes don't
  visually overlap): when `waypointDropActive` becomes true, `setSelectedWaypointId(null)`.

## Testing

- The coordinate round-trip (parse DMM → lat/lon, format lat/lon → DMM) is
  already-tested library code; reuse it. If a small pure helper emerges (e.g.
  building the PUT body from form state), unit-test it.
- Browser verification (Playwright): click a dot (drop-mode off) → bubble opens
  at the waypoint; edit the name + move the position via DMM → Save → the dot
  moves and the label updates; Delete a waypoint not used by a route → it
  disappears; attempt to delete one used by a route → 409 message names the
  route and the waypoint stays; toggling drop-mode on suppresses selection.

## Out of scope (future)

- Drag-to-move a waypoint marker on the chart (position edit is via the DMM
  field for now).
- Multi-select; bulk operations.
- Selecting/editing route polylines or annotations on the chart.

## Risks / notes

- The dot-layer click and the `<Map onClick>` drop handler can both fire for a
  single click. Because selection is gated to `!waypointDropActive` and drop to
  `waypointDropActive`, only one is ever live — no hit-test needed. Verify a
  click in drop-mode over an existing dot creates a new waypoint (does not
  select), and a click off drop-mode over a dot selects (does not drop).
- The popup must re-project on map move/zoom or it will visually detach from
  the waypoint while panning. Subscribe to both events; throttling isn't needed
  at chart interaction rates but keep the handler cheap (just `project` + set
  state).
- Position edits change the dot location; ensure `WaypointsLayer` re-syncs marks
  (it already re-runs its sync on `marks` change).
