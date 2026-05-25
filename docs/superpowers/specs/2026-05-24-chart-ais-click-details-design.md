# Chart AIS targets — click for detail popup (matching /ais)

**Date:** 2026-05-24
**Status:** Approved design, pre-implementation

## Context

AIS targets on `/chart` render as dots + COG lines + name labels but can't be
inspected. Clicking a target should open a detail popup showing the **same**
fields as the `/ais` page's "Selected" panel.

## Detail content (identical to /ais Selected panel)

8 rows: MMSI · Name · Class · COG (°) · SOG (kn) · Range (NM) · CPA (NM) ·
TCPA (`m:ss` / `past` / `—`). Range/CPA/TCPA come from `computeCpa(own, target)`
(`@g5000/compute`, already client-safe) using the chart's own-boat fix
(`livePos`, which carries `cog`+`sog`); rendered `—` when there's no fix or the
target lacks a position — same as `/ais`.

## Keeping the two in sync

- New `lib/ais-detail.ts`: `fmtTcpa(seconds)` + `aisDetailRows(target, cpa) →
  [label, value][]` with the exact `/ais` formatting/units. Unit-tested.
- `/ais` client-view's Selected panel re-renders from `aisDetailRows` (single
  source of truth — the two can't drift). Its local `fmtTcpa` is replaced by the
  shared one.
- The chart popup renders the same rows.

## Chart wiring

- `AisTargets` gains `own` prop (passed `livePos` from `page.tsx`), kept in a ref
  alongside the latest polled targets so the click handler reads fresh data
  without re-subscribing.
- `map.on('click', 'ais-targets-circle', …)` → look up the full `AisTarget` by
  `mmsi` → compute CPA → show a `maplibregl.Popup` whose DOM is built with
  **`textContent` (XSS-safe**, since names are external data) from
  `aisDetailRows`. `mouseenter`/`mouseleave` toggle a pointer cursor.

## Scope

- Chart only. No new CPA UI on `/ais` beyond the shared-helper refactor.

## Files

- `packages/web/src/lib/ais-detail.ts` (+ test) — new.
- `packages/web/src/components/AisTargets.tsx` — click/hover/popup + `own` prop.
- `packages/web/src/app/chart/page.tsx` — pass `own={livePos}`.
- `packages/web/src/app/ais/client-view.tsx` — Selected panel uses shared helper.

## Verification

- `aisDetailRows` unit tests (formatting, missing fields, null cpa).
- Click a chart target → popup with the 8 rows; values match `/ais` for the same
  target. Off-target click / × closes it.
- `npm run typecheck`, `prettier --check`, `next build` pass.
