# Race Settings UI Panel Implementation Plan

> **For agentic workers:** Issue #18 follow-up to Cluster A (#8). The issue body is the spec — no separate design doc.

**Goal:** Expose the four `RaceSettings` knobs (`shiftThresholdDeg`, `ocsLookAheadSec`, `laylineDistanceNm`, `integrateCurrent`) through a collapsible panel on `/race`, with explicit-Save UX. Refactor the wind-shift detector so changing the threshold mid-race no longer wipes its 5-min baseline window.

**Architecture:** Backend is already wired — `PUT /api/race/state { settings: { ... } }` accepts partial updates and `raceState.subscribe(...)` propagates them. The compute pipeline currently _recreates_ the wind-shift detector when settings change (`compute/race/index.ts:66-75`), which discards rolling history. This plan replaces that with a `getThresholdRad: () => number` callback the detector reads per `update()`, eliminating the recreate.

**Tech Stack:** TypeScript (strict, ESM), React 19 client component, Tailwind 4, Vitest.

**Spec:** [`gh issue view 18`](https://github.com/gregjohnson1024/g5000/issues/18) — the issue itself.

---

## Task 1: Refactor wind-shift detector to read threshold via getter

**Files:**

- Modify: `packages/compute/src/race/wind-shift.ts`
- Modify: `packages/compute/src/race/wind-shift.test.ts`

The current `createWindShiftDetector({ thresholdRad, ... })` bakes the threshold into the closure. Replace with `getThresholdRad: () => number` that the `update()` body calls per tick. This makes the detector stateless w.r.t. threshold — change the value, the next tick uses it.

- [ ] Update `WindShiftConfig` to swap `thresholdRad: number` for `getThresholdRad: () => number`.
- [ ] Update `update()` to call `cfg.getThresholdRad()` instead of `cfg.thresholdRad`.
- [ ] Update all test call sites to pass `getThresholdRad: () => 7 * DEG` (or whatever).
- [ ] Verify tests pass: `npx vitest run packages/compute/src/race/wind-shift.test.ts`.
- [ ] Commit.

## Task 2: Drop the recreate-on-change subscriber in the race pipeline

**Files:**

- Modify: `packages/compute/src/race/index.ts`

The pipeline currently wires `raceState.subscribe((cfg) => { detector = createWindShiftDetector(...); })` to recreate the detector whenever settings change. With Task 1's refactor, that subscriber is no longer needed — the detector reads `raceState.get().settings.shiftThresholdDeg` via the getter each tick.

- [ ] Replace the `let detector = ...` + `raceState.subscribe(...)` block with a single `const detector = createWindShiftDetector({ ..., getThresholdRad: () => raceState.get().settings.shiftThresholdDeg * DEG })`.
- [ ] Remove the `let` reassignment.
- [ ] Verify all tests still pass: `npx vitest run packages/compute/src/race/`.
- [ ] Commit.

## Task 3: Create the `<RaceSettings>` component

**Files:**

- Create: `packages/web/src/app/race/RaceSettings.tsx`

Collapsible panel with:

- Header row: "Settings" + a `▸`/`▾` chevron, plus a small `●` indicator when there are unsaved changes. Click header to toggle expand. Collapsed by default.
- Body (when expanded): four labeled inputs in a 1-col stack on mobile, 2-col on md+:
  - **Wind shift threshold** — number input, range 1–30, unit `°`, hint `default 7`.
  - **OCS look-ahead** — number input, range 3–60, unit `s`, hint `default 10`.
  - **Layline distance** — number input, range 1–15, unit `NM`, hint `default 5`.
  - **Integrate current in laylines** — checkbox, hint `default on`.
- Save row: `Save` button (emerald, disabled when no changes), `Revert` button (slate, only visible when there are changes).

Load defaults from `/api/race/state` at mount and on every save (round-trip the truth so we display the persisted state). Edits are local-only until Save fires `PUT /api/race/state { settings: { ... } }`.

Validation: number inputs clamp to their range with `min`/`max` attrs; on Save, recheck and refuse the PUT if any value is out of range (defensive — keyboard input bypasses spinner clamps).

- [ ] Implement the component.
- [ ] Verify `tsc -b packages/web` clean.
- [ ] Commit.

## Task 4: Mount `<RaceSettings>` on `/race`

**Files:**

- Modify: `packages/web/src/app/race/page.tsx`

Insert below `<WindShiftPlot />`, full-width (`md:col-span-2`).

- [ ] Add import + JSX mount.
- [ ] Verify `tsc -b packages/web` clean.
- [ ] Commit.

## Task 5: Component test for `<RaceSettings>`

**Files:**

- Create: `packages/web/src/app/race/RaceSettings.test.tsx`

Cover:

- Initial render fetches `/api/race/state` and seeds the form with current values.
- Editing a field marks the panel as modified; Save button enables; Revert button appears.
- Click Save → PUT with partial settings body that includes only the changed keys (or all keys, your call — verify the actual behavior).
- Click Revert → fields restore to last-fetched values; modified marker clears.
- Out-of-range input on Save is rejected client-side (no PUT fires).

Use `@testing-library/react` (already a dep) + `vi.fn()` for fetch mocking.

- [ ] Write tests.
- [ ] Verify they pass: `npx vitest run packages/web/src/app/race/RaceSettings.test.tsx`.
- [ ] Commit.

## Task 6: Quick smoke test for `<WindShiftPlot>` (issue #18 also flagged)

**Files:**

- Create: `packages/web/src/components/WindShiftPlot.test.tsx`

Mount the component with a stubbed `useSse` that yields a fixed `race.windShift.bias` sample. Assert the placeholder ("waiting for samples…") shows before any sample, and the SVG polyline renders after ≥2 samples arrive.

- [ ] Write the test.
- [ ] Verify it passes.
- [ ] Commit.

## Final verification

- [ ] `npm test` — all green apart from the 4 known env failures (wgrib2 ×2, coastline data, position-route ConfigStore).
- [ ] `npx tsc -b packages/core packages/db packages/grib packages/compute packages/bridge packages/routing packages/coastline && npx tsc -b apps/autopilot-server packages/web` — clean.
- [ ] `npm run lint` — clean (or at least no new failures from this work).
- [ ] Smoke test live: boot dev server, navigate to `/race`, expand Settings, change `laylineDistanceNm` from 5 → 3, save, verify `GET /api/race/state` reflects the change.
