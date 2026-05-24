# Chart toolbar icon stack — design

**Date:** 2026-05-23
**Status:** approved (design); implementation plan to follow

## Goal

Turn the chart's top-right Layers button into a vertical stack of three
identically-sized (`w-9 h-9`) icon buttons:

1. **Layers** (existing) — the `LayersControl` popover.
2. **Annotation** (new icon) — opens the EXISTING track `AnnotationDropper`
   (timestamped tack/gybe/event on the active track), restyled from its current
   pill into a toolbar icon.
3. **Waypoint** (new) — a click-to-drop mode that creates an auto-named waypoint
   at the clicked map location.

## Background / current state

- `LayersControl` (`packages/web/src/app/chart/LayersControl.tsx`) positions
  ITSELF at `absolute top-2 right-2 z-10`; its `w-9 h-9` button opens a popover
  BELOW via `mt-2`.
- `AnnotationDropper` (`packages/web/src/components/AnnotationDropper.tsx`) is a
  separate floating pill, mounted on `/chart` at `top-2 right-28`. It logs
  timestamped track events (tack/gybe/sail/custom) and open/close periods via
  `GET`/`POST /api/tracks/active/annotation`, polling every 5s. Self-contained,
  needs no map.
- `<Map>` (`packages/web/src/components/Map.tsx`) already exposes an optional
  `onClick?: ({lat,lon}) => void` prop wired to maplibre's `click` event, but
  the chart no longer passes it (the plan start/end picking that used it was
  removed). `window.__g5kMap` also exposes the instance.
- The chart fetches `/api/waypoints` into `waypoints` state on mount and renders
  them via `<WaypointsLayer marks={...}/>`. `POST /api/waypoints {name,lat,lon}`
  creates one (auto-slugs the id from the name; 409 on duplicate id).
- There is no chart-based waypoint creation today.

## Decisions (from brainstorming)

1. **Annotation icon = reuse the track AnnotationDropper**, restyled as a
   `w-9 h-9` icon in the stack. No map-click, no new storage — same logic +
   polling, new trigger + position.
2. **Waypoint flow = auto-name** (no on-chart text prompt). Click icon → click
   map → instantly create `"WP N"` → exit drop-mode. One waypoint per
   activation. Rename later on `/waypoints`.
3. **Vertical stack**, panels open to the LEFT so an open panel never displaces
   the icons beneath it or runs off the right edge.

## Architecture

### `ChartToolbar` (new) — `packages/web/src/app/chart/ChartToolbar.tsx`

Container: `absolute top-2 right-2 z-10 flex flex-col gap-2 items-end`. Renders
the three controls as a uniform icon rail. A shared `w-9 h-9 rounded border …`
button style (extracted from the current Layers button) keeps them identical.
The toolbar owns no domain state itself — it lays out and forwards to the three
controls.

### 1. Layers
`LayersControl` keeps all its logic. Change: its outer wrapper drops the
`absolute top-2 right-2` self-positioning (the toolbar positions it), and its
popover changes from `mt-2` (in-flow, below) to `absolute right-full mr-2 top-0`
(overlay, left) so it doesn't push the Annotation/Waypoint icons down.

### 2. Annotation
The existing `AnnotationDropper` panel logic (presets, custom label, period
start/stop, 5s poll, `/api/tracks/active/annotation`) is unchanged. Change: its
trigger becomes a `w-9 h-9` toolbar icon (a flag/marker glyph) instead of the
`+ marker` pill, and its expanded panel opens left (`absolute right-full mr-2
top-0`) instead of below. Remove the old `position="top-2 right-28"` mount on
`/chart` (the toolbar now hosts it). The icon shows a subtle active indicator
when a timing period is open (preserving the current "⏺ open period" affordance,
e.g. a small dot badge).

### 3. Waypoint drop mode
New `WaypointDropButton` (in `ChartToolbar.tsx` or a small sibling) toggles a
`waypointDropMode: boolean` owned by `chart/page.tsx`:
- **Enter:** button highlighted; set the map canvas cursor to `crosshair`; arm
  the `<Map onClick>` handler.
- **Map click:** capture `{lat, lon}`; auto-name `"WP N"` (N chosen so the
  slugified id `wp-n` doesn't collide with an existing waypoint — compute from
  the current waypoint list, retry/increment on a 409); `POST /api/waypoints
  {name, lat, lon}`; on success append the returned waypoint to the chart's
  `waypoints` state (so `WaypointsLayer` shows the pin immediately) — or re-fetch
  `/api/waypoints`; then exit drop-mode + reset the cursor.
- **Cancel:** clicking the icon again, or pressing `Esc`, exits drop-mode
  without creating anything.

### Map wiring (`chart/page.tsx`)
Pass `<Map onClick={waypointDropMode ? handleDropClick : undefined}>`. When not
in drop-mode the handler is `undefined`, so normal map clicks stay inert (the
chart is otherwise display-only). The cursor change uses
`mapInstance.getCanvas().style.cursor`.

## Auto-name scheme

`"WP N"` where N = 1 + the highest existing `WP <n>` (parse names matching
`/^WP (\d+)$/`), so ids are `wp-1`, `wp-2`, …. If a `POST` still 409s on a race,
increment N and retry once. Keeps names short and rename-friendly.

## Components / files

- **Create:** `packages/web/src/app/chart/ChartToolbar.tsx` — the icon rail +
  the waypoint button + shared icon-button style.
- **Modify:** `packages/web/src/app/chart/LayersControl.tsx` — keep it a self-
  contained button+popover unit, but change its outer wrapper from `absolute
  top-2 right-2 z-10` to `relative` (the `ChartToolbar` flex-col positions it),
  and change the popover from `mt-2` to `absolute right-full mr-2 top-0` (opens
  left). Same pattern applied to `AnnotationDropper`. This keeps each control
  self-contained — the toolbar only supplies the flex-col wrapper + uniform
  sizing — which is the smallest, lowest-risk diff.
- **Modify:** `packages/web/src/components/AnnotationDropper.tsx` — icon trigger
  + left-opening panel + open-period dot; keep all track logic.
- **Modify:** `packages/web/src/app/chart/page.tsx` — mount `<ChartToolbar>` in
  place of the separate `LayersControl` + `AnnotationDropper` mounts; add
  `waypointDropMode` state + `handleDropClick` + cursor handling; pass
  `<Map onClick>` gated on the mode; the auto-name + POST + waypoint-list refresh.

## Testing

- Pure helper `nextWaypointName(existingNames: string[]): string` → unit-tested
  (`'WP 1'` from empty, increments past the highest `WP N`, ignores non-matching
  names). Lives in `ChartToolbar.tsx` or a small `waypoint-name.ts`.
- Dev-server + browser-screenshot verification: the three icons stack and are
  identical size; the Layers popover and Annotation panel open to the left; the
  Waypoint icon enters crosshair mode and a map click drops a pin that appears
  immediately; Esc/re-click cancels.

## Out of scope (future)

- On-chart name prompt / rename, and multi-drop "stay in mode" (trivial toggle
  later).
- Editing/moving existing waypoints on the chart; chart-based route building
  (the broader deferred "define routes/waypoints on the chart" idea).
- Annotation as a map-location marker (this reuses the track-event annotation).

## Risks / notes

- Left-opening panels must not run off the LEFT edge into the map at narrow
  widths — they're `w-44`/`w-[280px]`; at `right-2` + opening left they have
  ample room, but verify on a narrow viewport.
- Removing `AnnotationDropper`'s `position` prop usage on `/chart`: the `/helm`
  mount (if any) is unaffected — only the chart mount moves into the toolbar.
  Confirm `/helm`'s AnnotationDropper still works.
- The waypoint drop handler must read the LATEST `waypoints` list when computing
  the next name (use the state/ref correctly to avoid a stale closure).
