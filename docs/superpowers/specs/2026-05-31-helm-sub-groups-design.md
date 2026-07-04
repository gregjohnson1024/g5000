# Helm view — Starting / Navigating / Performance sub-groups

**Date:** 2026-05-31
**Status:** design (approved in brainstorming)
**Scope:** `/helm` view reorganization (`packages/web`). UI/structure only — no new channels or compute.

## Summary

The `/helm` page has grown into a single flat grid of ~25 heterogeneous tiles
(boat/wind readouts, 15-min rolling stats, the groove performance cluster, sail
recommendation, position) plus a separate `RaceTiles` row and a header mini-timer
— all in one ~440-line `page.tsx`. Reorganize it into **three task-focused
sub-groups behind segmented tabs** — **Starting**, **Navigating**,
**Performance** — with a small **pinned core strip** visible on every tab.

This is a presentation/decomposition change. No channels, compute, or APIs
change. The `/race` page (race _setup_: timer, line-ping, mark select, wind-shift
plot, settings) is unaffected; the new **Starting** tab is the live start
_readout_, not a second setup surface.

## Goals

- One group visible at a time via a `Starting | Navigating | Performance`
  segmented control, so each group's tiles can be larger and more legible from
  the helm.
- A pinned core strip (`SOG · HDG · COG · Depth · TWS · TWD`) on every tab so the
  essentials are never lost when switching groups.
- Persist the selected group per-device (`localStorage`); default **Navigating**.
- Decompose the 440-line `page.tsx` into focused, independently-readable units
  (one component per group + core strip + tabs), running on a **single** SSE
  connection.
- Alerts panel and MOB button remain always-visible (safety) regardless of tab.

## Non-goals

- No new channels, compute pipelines, or API routes.
- No change to the `/race` setup page or the `/mast` view.
- No auto-switching of tabs (e.g., to Starting when the timer runs) — the header
  mini-timer keeps the start clock visible from any tab; switching is manual.
- No React component-test harness — the web package has none today (every web
  test is pure-logic `.test.ts`); we don't introduce one here.
- No visual redesign of `HelmTile` itself; it's reused as-is.

## Current state (what exists today)

- `packages/web/src/app/helm/page.tsx` (~440 lines): one `useSse()`, the full tile
  grid, inline `AlertsPanel` and `PositionTile`, a `useEffect` polling
  `/api/stats/{sog,cog,hdg,motion}` every 2 s, the sails strip, and overlays
  (`MobButton`, `AudibleAlarm`, `AnnotationDropper`, header `RaceMiniTimer`).
- `packages/web/src/components/RaceTiles.tsx`: a 5-tile row (DTL/TTL/Bias/OCS/VMC)
  rendered at the bottom of `/helm`. Used **only** by `/helm`. Has its own copies
  of `scalar`/`enumStr`/unit constants.
- `HelmTile` (`helm/HelmTile.tsx`): the shared tile component (label/value/unit/
  severity/sub/small/children). Unchanged by this work.
- Channels consumed already exist: `nav.gps.{sog,cog,cog.magnetic,position,depth}`,
  `nav.magvar`, `boat.heading.{true,magnetic}`, `wind.{true.speed,true.angle,
true.direction,apparent.speed,apparent.angle}`, `race.{targetSpeed,targetTwa,
percentPolar,vmc,line.distanceToLine,line.timeToLine,line.bias,line.ocsPredicted,
windShift.bias}`, `groove.*`, `motion.{heel,pitch}`.

## Tab assignment

**Core strip (pinned on every tab):** `SOG` · `HDG` · `COG` · `Depth` · `TWS` ·
`TWD`. Each renders when its channel publishes (`Depth`/`TWS`/`TWD` may be absent
on a minimal rig → that tile shows `—`). HDG keeps today's True-preferred logic
(direct True, else Magnetic + variation, else raw Magnetic); COG keeps
True-preferred-else-Magnetic with a `T`/`M` sub-label.

**Starting** — pre-start line work:

- `DTL` (distance to line), `TTL` (time to line), `Bias` (favored end),
  `OCS` (over-early), `Wind-shift bias` (`race.windShift.bias`), and a race timer
  (reuse `RaceMiniTimer`, or a fuller timer — see Open question below).
- Equivalent to today's `RaceTiles` minus `VMC`, plus the wind-shift indicator.

**Navigating** — getting from A to B:

- `Position` (the `PositionTile` with copy button), `VMC` (made-good to active
  mark), `Avg SOG`, `Avg COG`, `Avg HDG`, `Drift (COG−HDG)`, `Motion` (sea-state
  RMS). Owns the `/api/stats/*` polling.

**Performance** — sailing the boat fast:

- `TWA`, `AWS`, `AWA`, `TBS` (target boat speed), `Target TWA`, `% polar`,
  `In-groove %`, `VMG eff %`, `Helm steadiness / Pilot activity` (+ corrections·
  min⁻¹), `Heel`, `Pitch`, `Sail recommendation` (`SailRecommendationTile`).
- `TWS` is **not** repeated here — it lives in the pinned core strip.

**Always-on (any tab):** header (title, mini race-timer, Live/Reconnecting),
`AlertsPanel` (when an alert is active), sails strip, `MobButton`,
`AnnotationDropper`.

## Architecture

Approach A — decompose into focused components. `page.tsx` becomes a thin shell.

```
helm/page.tsx                 # shell: one useSse(); useHelmGroup(); renders
                              #   header → AlertsPanel → sails strip →
                              #   CoreStrip → HelmTabs → <active group> → overlays
helm/CoreStrip.tsx            # props {channels}; the 6 pinned tiles
helm/HelmTabs.tsx             # segmented control; props {group, onChange}
helm/helm-group.ts            # PURE: HelmGroup type, DEFAULT_GROUP='navigating',
                              #   STORAGE_KEY, normalizeGroup(raw): HelmGroup
helm/use-helm-group.ts        # hook: localStorage + normalizeGroup → [group,setGroup]
helm/use-rolling-stats.ts     # hook: /api/stats/{sog,cog,hdg,motion} polling
helm/tile-helpers.ts          # shared scalar/enumVal/geo + fmt* (replaces the
                              #   copies in page.tsx AND RaceTiles)
helm/AlertsPanel.tsx          # extracted from page.tsx (rendered by shell)
helm/PositionTile.tsx         # extracted from page.tsx (used by NavigatingGroup)
helm/groups/StartingGroup.tsx     # props {channels}; absorbs RaceTiles content
helm/groups/NavigatingGroup.tsx   # props {channels}; uses use-rolling-stats + PositionTile
helm/groups/PerformanceGroup.tsx  # props {channels}; groove cluster + wind + polar + trim
```

**Deleted:** `components/RaceTiles.tsx` (helm-only; its tiles move into
`StartingGroup`, its duplicated helpers replaced by `tile-helpers.ts`).

**One SSE connection.** Today `page.tsx` and `RaceTiles` each call `useSse()` (two
EventSources). The shell calls `useSse()` **once** and passes `channels`
(`ReadonlyMap<string, JsonSafeSample>`) as a prop to `CoreStrip` and the three
group components. Groups are otherwise pure given `channels` (Navigating also
calls `useRollingStats()` for its HTTP-polled averages).

**Group switching.** `useHelmGroup()` returns `[group, setGroup]`. On mount it
reads `localStorage[STORAGE_KEY]` through `normalizeGroup` (unknown/missing →
`DEFAULT_GROUP`). `setGroup` writes through. `HelmTabs` renders three buttons;
`page.tsx` renders exactly one group component for the active `group`. Only the
active group mounts, so only its tiles (and, for Navigating, its stats polling)
are live — switching away from Navigating stops the `/api/stats` polling, which is
fine (the server owns the rolling buffers, so averages survive remount).

## State, persistence, layout

- **Default:** `navigating`. **Persistence:** `localStorage` key
  `g5000.helm.group`, per-device. SSR-safe: read in a `useEffect`/lazy initializer
  guarded for `typeof window` so it doesn't break the Next build.
- **Layout (top→bottom):** header · alerts · sails strip · core strip · segmented
  tabs · active group grid · overlays.
- **Responsive:** core strip `grid-cols-3` → `md:grid-cols-6`; group grids keep
  `grid-cols-2 md:grid-cols-3`. Tabs are large touch targets (helm use, wet/
  gloved) — full-width segmented control, `md` keeps them comfortably sized.
- `/helm` targets tablet/phone/laptop; the portrait 1080×1920 panel is `/mast`
  (unaffected).

## Testing

Matches the repo's pure-logic `.test.ts` pattern (no component harness):

- `helm/helm-group.test.ts` — `normalizeGroup`: each valid value passes through;
  `null`/`''`/unknown → `DEFAULT_GROUP`; `STORAGE_KEY` stable; `DEFAULT_GROUP`
  is `'navigating'`.
- `helm/tile-helpers.test.ts` — `fmtSpeed` (m/s→kn, 1 dp, null→`—`),
  `fmtAngleSigned` (rad→deg signed, null→`—`), `fmtHeadingRad` (normalize to
  [0,360), null→`—`), `scalar`/`enumVal`/`geo` kind-guards return null off-kind.
- **JSX:** verified by `cd packages/web && npx tsc --noEmit` and `npm run build`
  (`next build`), plus a manual DEMO_MODE smoke of `/helm`: all three tabs render,
  the core strip shows on each, selection persists across reload, alerts/MOB stay
  visible. These are the standard pre-deploy gates.

## Edge cases

- **Missing channels:** every tile already renders `—`/neutral when its channel is
  absent (no polar → groove `%` tiles `—`; no masthead → wind tiles `—`; minimal
  rig → Depth `—`). Preserve that behavior per tile; never render `NaN`.
- **localStorage unavailable / SSR:** `normalizeGroup(null)` → default; the hook
  guards `window` so the server render uses the default and hydrates to the stored
  value without a crash.
- **First paint before SSE connects:** core strip + active group render with `—`
  placeholders; identical to today's pre-connect state.

## Open question (resolved for v1)

Starting-tab timer: reuse the existing compact `RaceMiniTimer` inside the Starting
group (in addition to the header one) rather than building a new fuller timer —
keeps scope tight and avoids duplicating timer logic. A larger dedicated timer can
come later if wanted; not in this spec.

## Files (anticipated; the plan refines)

Create: the 10 `helm/*` files above. Modify: `helm/page.tsx` (slim to shell).
Delete: `components/RaceTiles.tsx`. Unchanged: `HelmTile`, `MobButton`,
`RaceMiniTimer`, `AudibleAlarm`, `AnnotationDropper`, `SailRecommendationTile`,
`/race` page, all channels/compute.
