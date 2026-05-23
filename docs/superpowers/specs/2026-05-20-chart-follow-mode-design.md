# Chart follow mode + orientation + off-screen vessel indicator

**Issue:** Standalone UX work inspired by the B&G Zeus SR Charting manual.
**Status:** Approved, ready for plan.
**Date:** 2026-05-20.

## Summary

Three tightly-coupled chart-page UX upgrades that together turn `/chart` from a "static map you sometimes recenter" into a follow-the-boat plotter with optional course-up lookahead:

1. **Follow mode as a state, not an action.** The existing top-left "Center on boat" button becomes a sticky toggle. When on, the chart re-centers on every position update. Any user-initiated pan exits follow mode automatically.
2. **Orientation cycle button.** A second button below the follow toggle cycles through _North up → Course up → Heading up → North up_. Course-up and Heading-up rotate the map AND nudge the center so the vessel sits in the lower-third of the viewport — that's the lookahead.
3. **Off-screen vessel indicator.** When follow mode is OFF and the vessel has been panned out of the visible area, a small pill appears on the viewport edge in the direction of the vessel, with a bearing arrow. Tap → re-enter follow mode + recenter.

All three states (follow on/off, orientation mode) persist in `localStorage` under existing `chart:*` keys.

## Why

`/chart` today is a survey tool: you pan around freely, occasionally click "Center on boat" to jump back. That works at anchor but is friction-heavy underway, where you mostly want the chart to follow the boat and you mostly want to look ahead of it, not all around it. The B&G Zeus SR Charting manual codifies the canonical chartplotter pattern (manual p10–11): a stateful center-vessel button and a tap-to-cycle orientation indicator that together cover both "follow" and "lookahead" without a settings panel. Mirroring that pattern is small work and a meaningful step toward parity with the muscle memory of any mariner who's used a B&G/Garmin/Raymarine plotter.

## Design

### Follow mode

**State:** a boolean `follow` held in React state on the chart page, persisted to `localStorage` under `chart:follow` (default `true` — first-time visitors land on a chart that follows the boat).

**Entering follow:**

- Tap the follow button.
- Tap the off-screen vessel indicator (it re-centers AND enters follow in one tap).

**Exiting follow:**

- Tap the follow button while in follow.
- Any user-initiated map pan. (Programmatic recenters caused by follow itself must NOT exit; see _Programmatic-move filtering_ below.)

**Behaviour while in follow:** every position update from `LiveBoatMarker.onUpdate` triggers `map.easeTo({ center: [lon, lat], duration: 300 })`. `easeTo` (smooth interpolation) is preferred over `setCenter` (snap) — at the typical 1 Hz GPS update rate, snaps look jittery. 300 ms feels live without lagging behind.

**Behaviour while NOT in follow:** position updates do nothing to the camera (the existing `LiveBoatMarker` still updates the marker layer; that's unchanged).

**Programmatic-move filtering** is the only subtle bit. MapLibre fires the same `dragend`/`movestart` events for user pans AND for our own `easeTo` calls. We need to distinguish:

- `e.originalEvent` on these events is `MouseEvent | TouchEvent | undefined`. It's `undefined` for purely programmatic moves and a real DOM event for user pans.
- The pan-exit handler subscribes to `dragend` and checks `if (!e.originalEvent) return;` before flipping `follow` off.

This is the canonical MapLibre pattern for telling user input from programmatic input.

### Orientation

**Modes (the union type):** `'north' | 'course' | 'heading'`. Held in React state, persisted to `localStorage` under `chart:orientation` (default `'north'`).

**Cycle:** the orientation button label shows the _current_ mode (`N`, `↑COG`, `↑HDG`). Each tap advances to the next mode.

**Sources:**

- `north`: bearing = 0.
- `course`: bearing = current COG in degrees true. COG comes from `LiveBoatMarker`'s existing `onUpdate` callback (we'll extend it to include `cog` — it doesn't pass it today). Falls back to `'north'` when COG is unavailable.
- `heading`: bearing = current heading. Heading isn't currently piped through `LiveBoatMarker`; we'll subscribe via the same SSE feed that `LiveBoatMarker` uses, or expose heading on the existing `livePos` state shape. If heading is unavailable, falls back to course; if course is also unavailable, north.

**Apply:** when orientation changes OR (in non-north modes) when COG/heading updates by more than a small dead-band (e.g. ≥3°), call `map.easeTo({ bearing: targetBearing, duration: 500 })`. The dead-band prevents jitter on noisy COG.

**Lookahead positioning:** When orientation is `course` or `heading` AND `follow` is on, set `map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 })` to a value that pushes the camera target up the screen — i.e. `padding.top = viewportHeight * 0.3` and `padding.bottom = 0`. The vessel ends up at ~30% from the bottom edge; the viewport shows ~70% of its area ahead of the boat. When orientation is `north`, padding resets to 0 on all sides (vessel centered).

### Buttons (replacing the existing top-left center button)

Two stacked buttons in the same top-left container that currently holds Center-on-boat (page.tsx lines 559–578). Both render as compact dark pills, ~36×36 px square. Visual state:

| Button      | Off state                                                 | On state                                                              |
| ----------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Follow      | outlined dark, ⊕ glyph, label "Follow"                    | filled dark with light fg, ⊙ glyph                                    |
| Orientation | outlined dark, current mode label (`N` / `↑COG` / `↑HDG`) | n/a (orientation is always set, button always shows the current mode) |

The orientation button's job is just to cycle. It's not a toggle.

When `livePos` is null (no GPS fix yet), both buttons render disabled-state (greyed, no click). Same rule the existing button uses (it just doesn't render at all today — we'll change to render-disabled so the layout doesn't pop in on first fix).

### Off-screen vessel indicator

**When it renders:** only when `follow === false` AND a valid `livePos` exists AND the vessel's `(lon, lat)` is outside `map.getBounds()`.

**Where it renders:** a small pill (~32px tall, ~80–120 px wide) docked to the viewport edge closest to the vessel. The closest-edge logic projects the boat position onto screen space using `map.project(LngLat)`, then clamps the projected point to the viewport rectangle. The clamped point is the pill's anchor.

**What it contains:**

- A small triangle/chevron pointing at the boat's direction (computed from the un-clamped projection vector).
- Distance to the boat in NM, e.g. "12.4 NM →".

**Tap behaviour:** entering follow mode (which also triggers the recenter via the existing follow-mode behaviour).

**Update cadence:** recomputed on every map `move` event AND on every position update. Both are cheap (~simple geometry).

### Component layout

Three new files; one modified.

| File                                                      | Purpose                                                                                                                                                                                           | Status   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `packages/web/src/app/chart/ChartFollowControl.tsx`       | The Follow + Orientation buttons. Stateless, props-driven.                                                                                                                                        | new      |
| `packages/web/src/app/chart/OffscreenVesselIndicator.tsx` | The corner pill. Subscribes to map move + position.                                                                                                                                               | new      |
| `packages/web/src/app/chart/use-chart-camera.ts`          | Custom hook that owns the follow/orientation state, persistence, the map subscriptions, and the `easeTo` calls. The chart page consumes the hook and forwards state to the two visual components. | new      |
| `packages/web/src/app/chart/page.tsx`                     | Replace the inline center-on-boat button with `<ChartFollowControl/>` and `<OffscreenVesselIndicator/>`. Wire up the hook.                                                                        | modified |

Splitting the _logic_ (`use-chart-camera.ts`) from the _visual components_ keeps each file small enough to hold in context. The hook is the only piece with non-trivial logic: state machine, MapLibre subscriptions, persistence, and the COG/heading dead-band.

### Why a hook instead of putting it all in page.tsx

`page.tsx` is already 1100+ lines. The hook keeps follow/orientation logic localised in ~120 lines that can be tested in isolation if we ever want to. The chart page becomes:

```tsx
const camera = useChartCamera({ map: mapInstance, livePos });
// ...
<ChartFollowControl
  follow={camera.follow}
  orientation={camera.orientation}
  onToggleFollow={camera.toggleFollow}
  onCycleOrientation={camera.cycleOrientation}
  hasFix={livePos !== null}
/>
<OffscreenVesselIndicator
  map={mapInstance}
  livePos={livePos}
  visible={!camera.follow}
  onTap={camera.enterFollow}
/>
```

## File scope

| File                                                      | Action                                                                          | Approx LOC  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------- |
| `packages/web/src/app/chart/use-chart-camera.ts`          | new — follow/orientation state, persistence, map.on subscriptions, easeTo calls | ~140        |
| `packages/web/src/app/chart/ChartFollowControl.tsx`       | new — two buttons, stateless                                                    | ~90         |
| `packages/web/src/app/chart/OffscreenVesselIndicator.tsx` | new — pill that anchors to viewport edge                                        | ~110        |
| `packages/web/src/app/chart/page.tsx`                     | modified — drop inline center-on-boat block, mount the new pieces               | ~30 changed |

`LiveBoatMarker.tsx` is **not** modified — its existing `LivePos` shape already carries `cog` and `hdg` (in radians), which is exactly what the hook needs.

No new dependencies. No backend, no bus channels, no DB, no compute pipeline.

## Persistence keys

| Key                 | Shape                              | Default   |
| ------------------- | ---------------------------------- | --------- |
| `chart:follow`      | `boolean`                          | `true`    |
| `chart:orientation` | `'north' \| 'course' \| 'heading'` | `'north'` |

Both written on every change, read on mount with try/catch fallbacks. Same pattern as the existing `chart:camera`, `chart:layers`, etc.

## Testing

### Automated

Unit tests for the small computable bits — the parts where logic could regress silently:

- `use-chart-camera.test.ts`: localStorage initialiser correctness across the four branches (SSR no-window, key missing, valid value, parse error). Verify `cycleOrientation` walks the union type correctly.
- `OffscreenVesselIndicator` edge-projection math: pass a fake `map.project` return and verify the clamped anchor lands on the correct edge for boats above/below/left/right of viewport.

Skip a full mount-with-MapLibre test — JSDOM + MapLibre is more pain than it's worth, manual verification covers it.

### Manual

1. Fresh profile (clear `chart:*` localStorage). Load `/chart`. Follow button is filled (default on). Boat icon visible roughly centered.
2. Pan the chart with the mouse. Follow button switches to outlined. Off-screen indicator appears at the edge if you panned far enough to put the boat out of view.
3. Tap follow button → boat recenters, follow re-engages, off-screen indicator disappears.
4. Tap orientation button. Label changes: `N` → `↑COG`. Map rotates so the COG points up; boat sits at ~30% from bottom.
5. Tap again → `↑HDG`. Behaviour as above but using heading.
6. Tap again → `N`. Map rotates back to north-up; boat returns to centered.
7. Refresh page. Follow state, orientation state both survive.
8. Disconnect/stub the GPS feed (drop `livePos`). Both buttons render disabled-state. Off-screen indicator does not render.
9. With COG missing (e.g. boat at zero SOG): orientation set to `course` falls back to north-up. Don't crash, don't show garbage bearing.

## Non-goals

- Wind-up, Target-up, and Start-line orientations (B&G p12). Defer — they're useful only when race overlay is active, and the race mode UI is in flux.
- Two-finger gesture rotation (B&G p13). Defer — adds gesture handling complexity and only matters when the user wants a non-discrete bearing.
- Previous-position button (B&G p10 button C). Defer — small UX win, can add later.
- Cursor mirroring across panels (B&G p15). Out of scope; we don't have grouped-panel architecture.
- A unified tap-to-inspect context menu (B&G p14). Worthwhile but a much larger refactor; separate ticket.

## Risk

Low. No data-model changes, no protocol work. The MapLibre subscriptions are well-trodden patterns. Worst case: programmatic-move filtering has a corner case I missed (e.g. mouse-wheel zoom firing `dragend` somehow), and follow accidentally exits on a wheel zoom — observable bug, recoverable by tapping follow again. The dead-band on COG/heading is the other place a subtle bug could live; tests cover the obvious branches.
