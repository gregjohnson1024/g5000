# Chart follow mode + orientation + off-screen vessel indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/chart`'s one-shot "Center on boat" button into a B&G-style stateful Follow toggle, add a North/Course/Heading orientation cycle button (with course/heading-up driving an implicit lookahead), and add an off-screen vessel pill that doubles as a re-center.

**Architecture:** All non-visual logic lives in a `useChartCamera` hook (state, persistence, MapLibre subscriptions, programmatic-move filtering, COG/heading dead-band). Two thin visual components render the hook's state. The chart page consumes the hook and forwards state.

**Tech Stack:** Next.js 16 App Router · React 19 · MapLibre GL JS · TypeScript strict (`noUncheckedIndexedAccess`) · Vitest.

**Spec:** `docs/superpowers/specs/2026-05-20-chart-follow-mode-design.md`

---

## File Structure

| File                                                       | Purpose                                                                                                                                                      | Status   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `packages/web/src/app/chart/use-chart-camera.ts`           | Hook: follow + orientation state, localStorage, map subscriptions, easeTo calls. Exports pure helpers `cycleOrientation` and `wrapBearingDelta` for testing. | new      |
| `packages/web/src/app/chart/use-chart-camera.test.ts`      | Vitest covering the pure helpers and localStorage initializers.                                                                                              | new      |
| `packages/web/src/app/chart/ChartFollowControl.tsx`        | Two stacked buttons (Follow toggle + Orientation cycle). Stateless.                                                                                          | new      |
| `packages/web/src/app/chart/OffscreenVesselIndicator.tsx`  | Edge-anchored pill with bearing arrow + distance. Subscribes to map `move` + `livePos`.                                                                      | new      |
| `packages/web/src/app/chart/offscreen-vessel-edge.ts`      | Pure edge-projection math (clamp boat's projected pixel position to viewport rectangle, choose closest edge).                                                | new      |
| `packages/web/src/app/chart/offscreen-vessel-edge.test.ts` | Vitest for the edge math.                                                                                                                                    | new      |
| `packages/web/src/app/chart/page.tsx`                      | Replace the inline center-on-boat button block with the new components + hook.                                                                               | modified |

`packages/web/src/components/LiveBoatMarker.tsx` is **not** modified — `LivePos` already exposes `cog`/`hdg` in radians.

---

## Task 1: Pure helpers + tests

**Files:**

- Create: `packages/web/src/app/chart/use-chart-camera.ts` (helpers only in this task; full hook in Task 2)
- Create: `packages/web/src/app/chart/use-chart-camera.test.ts`

Start with the small, pure pieces. They're easy to test and they pin down the types the rest of the hook will use.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/chart/use-chart-camera.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  cycleOrientation,
  wrapBearingDelta,
  readFollowFromStorage,
  readOrientationFromStorage,
} from './use-chart-camera';

describe('cycleOrientation', () => {
  it('walks north → course → heading → north', () => {
    expect(cycleOrientation('north')).toBe('course');
    expect(cycleOrientation('course')).toBe('heading');
    expect(cycleOrientation('heading')).toBe('north');
  });
});

describe('wrapBearingDelta', () => {
  it('handles unwrapped deltas', () => {
    expect(wrapBearingDelta(10, 20)).toBe(10);
    expect(wrapBearingDelta(170, 175)).toBe(5);
  });
  it('handles wrap across 0/360', () => {
    expect(wrapBearingDelta(350, 10)).toBe(20);
    expect(wrapBearingDelta(10, 350)).toBe(20);
    expect(wrapBearingDelta(0, 359)).toBe(1);
  });
  it('is symmetric and non-negative', () => {
    expect(wrapBearingDelta(180, 0)).toBe(180);
    expect(wrapBearingDelta(0, 180)).toBe(180);
  });
});

describe('readFollowFromStorage', () => {
  it('defaults to true on missing storage', () => {
    expect(readFollowFromStorage(null)).toBe(true);
  });
  it('parses stored true / false', () => {
    expect(readFollowFromStorage('true')).toBe(true);
    expect(readFollowFromStorage('false')).toBe(false);
  });
  it('falls back to true on bad JSON', () => {
    expect(readFollowFromStorage('not json')).toBe(true);
    expect(readFollowFromStorage('null')).toBe(true);
  });
});

describe('readOrientationFromStorage', () => {
  it('defaults to north on missing storage', () => {
    expect(readOrientationFromStorage(null)).toBe('north');
  });
  it('accepts known values', () => {
    expect(readOrientationFromStorage('north')).toBe('north');
    expect(readOrientationFromStorage('course')).toBe('course');
    expect(readOrientationFromStorage('heading')).toBe('heading');
  });
  it('falls back to north on garbage', () => {
    expect(readOrientationFromStorage('something else')).toBe('north');
    expect(readOrientationFromStorage('')).toBe('north');
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx vitest run packages/web/src/app/chart/use-chart-camera.test.ts
```

Expected: fail with `Cannot find module './use-chart-camera'`.

- [ ] **Step 3: Implement the helpers**

Create `packages/web/src/app/chart/use-chart-camera.ts`:

```ts
'use client';

export type Orientation = 'north' | 'course' | 'heading';

export function cycleOrientation(o: Orientation): Orientation {
  if (o === 'north') return 'course';
  if (o === 'course') return 'heading';
  return 'north';
}

/**
 * Smallest absolute angular delta between two bearings in degrees, wrapping
 * across the 0/360 seam. Always non-negative, always ≤ 180.
 */
export function wrapBearingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function readFollowFromStorage(raw: string | null): boolean {
  if (raw === null) return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed === true || parsed === false ? parsed : true;
  } catch {
    return true;
  }
}

export function readOrientationFromStorage(raw: string | null): Orientation {
  if (raw === 'north' || raw === 'course' || raw === 'heading') return raw;
  return 'north';
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run packages/web/src/app/chart/use-chart-camera.test.ts
```

Expected: 11 passing tests (3 + 3 + 3 + 3, minus the 1 description-only test in the cycleOrientation block = 11). Verify the actual count matches.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

If stale-dist errors mention `@g5000/db` or `@g5000/core`:

```bash
npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib packages/routing packages/coastline
```

then re-typecheck.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/chart/use-chart-camera.ts packages/web/src/app/chart/use-chart-camera.test.ts
git commit -m "feat(web): chart camera pure helpers (orientation cycle, bearing delta, storage)

Foundation for the useChartCamera hook. Pure functions only at this
stage so they can be unit-tested cleanly: cycleOrientation walks the
three-mode union, wrapBearingDelta returns the smallest absolute
angle across the 0/360 seam, and the storage readers default safely
on missing / bad input."
```

---

## Task 2: useChartCamera hook (full implementation)

**Files:**

- Modify: `packages/web/src/app/chart/use-chart-camera.ts`

Layer the React hook on top of the pure helpers from Task 1.

- [ ] **Step 1: Extend `use-chart-camera.ts` with the hook**

Append the following to `packages/web/src/app/chart/use-chart-camera.ts` (after the existing exports):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LivePos } from '../../components/LiveBoatMarker';

const RAD_TO_DEG = 180 / Math.PI;
const BEARING_DEADBAND_DEG = 3;
const EASE_DURATION_MS = 300;
const BEARING_EASE_MS = 500;
const LOOKAHEAD_TOP_FRACTION = 0.3;

export interface ChartCameraHandle {
  follow: boolean;
  orientation: Orientation;
  toggleFollow: () => void;
  enterFollow: () => void;
  cycleOrientation: () => void;
}

/**
 * Owns chart-follow + chart-orientation state, persists each to localStorage,
 * and drives the MapLibre camera in response to position updates and
 * orientation changes.
 *
 * Programmatic-move filtering: MapLibre fires `dragend` with `e.originalEvent`
 * undefined for our own easeTo calls and with a real MouseEvent/TouchEvent
 * for user pans. We only flip `follow` off when the originating event was a
 * user gesture.
 *
 * Bearing dead-band: COG/HDG arrive at ~1 Hz with sensor noise. Re-easing the
 * bearing on every tiny wiggle produces visible jitter. We re-ease only when
 * the next target differs from the last applied bearing by at least
 * BEARING_DEADBAND_DEG.
 *
 * Lookahead: in course/heading orientation while following, set
 * `map.setPadding({ top: 30% * height })` so the viewport center sits below
 * the geometric center — the boat ends up ~30% from the bottom edge and the
 * user sees more ahead than behind.
 */
export function useChartCamera({
  map,
  livePos,
}: {
  map: maplibregl.Map | null;
  livePos: LivePos | null;
}): ChartCameraHandle {
  const [follow, setFollow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return readFollowFromStorage(window.localStorage.getItem('chart:follow'));
  });
  const [orientation, setOrientation] = useState<Orientation>(() => {
    if (typeof window === 'undefined') return 'north';
    return readOrientationFromStorage(window.localStorage.getItem('chart:orientation'));
  });

  // Persist
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('chart:follow', JSON.stringify(follow));
    } catch {
      /* private-mode / quota — ignore */
    }
  }, [follow]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('chart:orientation', orientation);
    } catch {
      /* ignore */
    }
  }, [orientation]);

  // Stale-closure-safe refs for use inside map event handlers
  const followRef = useRef(follow);
  followRef.current = follow;
  const lastAppliedBearingRef = useRef<number>(0);

  // Pan-exit: user-initiated drag drops follow mode
  useEffect(() => {
    if (!map) return;
    const onDragEnd = (e: { originalEvent?: MouseEvent | TouchEvent }): void => {
      if (!e.originalEvent) return; // programmatic move, ignore
      if (followRef.current) setFollow(false);
    };
    map.on('dragend', onDragEnd);
    return () => {
      map.off('dragend', onDragEnd);
    };
  }, [map]);

  // Lookahead padding
  useEffect(() => {
    if (!map) return;
    const lookahead = follow && orientation !== 'north';
    if (lookahead) {
      const h = map.getCanvas().clientHeight;
      map.setPadding({
        top: Math.round(h * LOOKAHEAD_TOP_FRACTION),
        bottom: 0,
        left: 0,
        right: 0,
      });
    } else {
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    }
  }, [map, follow, orientation]);

  // Follow: re-center on each position update
  useEffect(() => {
    if (!map || !follow || !livePos) return;
    map.easeTo({ center: [livePos.lon, livePos.lat], duration: EASE_DURATION_MS });
  }, [map, follow, livePos]);

  // Orientation: apply bearing, with dead-band to suppress jitter
  useEffect(() => {
    if (!map) return;
    let target = 0;
    if (orientation === 'course' && livePos?.cog != null) {
      target = (((livePos.cog * RAD_TO_DEG) % 360) + 360) % 360;
    } else if (orientation === 'heading' && livePos?.hdg != null) {
      target = (((livePos.hdg * RAD_TO_DEG) % 360) + 360) % 360;
    } else if (orientation === 'heading' && livePos?.cog != null) {
      // Heading source missing — fall back to course
      target = (((livePos.cog * RAD_TO_DEG) % 360) + 360) % 360;
    }
    if (wrapBearingDelta(target, lastAppliedBearingRef.current) < BEARING_DEADBAND_DEG) {
      return;
    }
    lastAppliedBearingRef.current = target;
    map.easeTo({ bearing: target, duration: BEARING_EASE_MS });
  }, [map, orientation, livePos?.cog, livePos?.hdg]);

  const toggleFollow = useCallback(() => setFollow((v) => !v), []);
  const enterFollow = useCallback(() => setFollow(true), []);
  const cycleOrientationCb = useCallback(() => setOrientation((o) => cycleOrientation(o)), []);

  return {
    follow,
    orientation,
    toggleFollow,
    enterFollow,
    cycleOrientation: cycleOrientationCb,
  };
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 3: Re-run the helper tests to confirm nothing regressed**

```bash
npx vitest run packages/web/src/app/chart/use-chart-camera.test.ts
```

Expected: still passing.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/chart/use-chart-camera.ts
git commit -m "feat(web): useChartCamera hook — follow + orientation + lookahead

Owns chart:follow and chart:orientation state, persists each to
localStorage, and drives the MapLibre camera. Exit-follow filtering
uses MapLibre's e.originalEvent convention (undefined ⇒ programmatic,
real DOM event ⇒ user gesture). Bearing changes apply a 3° dead-band
to suppress COG/HDG sensor jitter. Course/heading orientation while
following sets a 30% top padding so the vessel sits in the lower
third — that's the lookahead."
```

---

## Task 3: ChartFollowControl visual component

**Files:**

- Create: `packages/web/src/app/chart/ChartFollowControl.tsx`

Two stacked buttons. Stateless. No automated test (visual smoke covers it).

- [ ] **Step 1: Create the component**

Create `packages/web/src/app/chart/ChartFollowControl.tsx`:

```tsx
'use client';
import type { Orientation } from './use-chart-camera';

/**
 * Top-left chart-page controls: Follow toggle + Orientation cycle.
 *
 * Stateless — all state lives in `useChartCamera`. This component just
 * renders the current values and reports clicks.
 *
 * When `hasFix` is false (no GPS fix yet), both buttons render in a
 * disabled style; the click handlers are still wired but the parent's
 * follow logic will no-op without a position.
 */
export function ChartFollowControl({
  follow,
  orientation,
  hasFix,
  onToggleFollow,
  onCycleOrientation,
}: {
  follow: boolean;
  orientation: Orientation;
  hasFix: boolean;
  onToggleFollow: () => void;
  onCycleOrientation: () => void;
}) {
  const followLabel = follow ? '⊙ Follow' : '⊕ Follow';
  const orientationLabel =
    orientation === 'north' ? 'N' : orientation === 'course' ? '↑COG' : '↑HDG';

  const baseBtn = 'px-3 py-1.5 text-sm rounded border shadow w-[110px] text-left';
  const enabledFollow = follow
    ? 'bg-slate-100 text-slate-900 border-slate-100 hover:bg-slate-200'
    : 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800';
  const enabledOrientation = 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800';
  const disabled = 'bg-slate-900/40 text-slate-500 border-slate-800 cursor-not-allowed';

  return (
    <div className="absolute top-3 left-3 flex flex-col gap-2 items-start z-10">
      <button
        type="button"
        aria-pressed={follow}
        aria-label="Toggle follow vessel"
        onClick={onToggleFollow}
        disabled={!hasFix}
        className={`${baseBtn} ${hasFix ? enabledFollow : disabled}`}
        title={follow ? 'Currently following — tap to release' : 'Tap to follow the boat'}
      >
        {followLabel}
      </button>
      <button
        type="button"
        aria-label={`Orientation: ${orientationLabel}, tap to cycle`}
        onClick={onCycleOrientation}
        disabled={!hasFix}
        className={`${baseBtn} ${hasFix ? enabledOrientation : disabled}`}
        title="Cycle: North up → Course up → Heading up"
      >
        {orientationLabel}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/chart/ChartFollowControl.tsx
git commit -m "feat(web): ChartFollowControl — Follow toggle + Orientation cycle

Two stacked buttons in the top-left corner of /chart. Stateless;
the page wires the hook's state and callbacks through. When there's
no GPS fix yet, both buttons render in a disabled style so the
layout doesn't pop in on first fix."
```

---

## Task 4: OffscreenVesselIndicator edge-projection math + tests

**Files:**

- Create: `packages/web/src/app/chart/offscreen-vessel-edge.ts`
- Create: `packages/web/src/app/chart/offscreen-vessel-edge.test.ts`

The math that picks where the pill should sit. Pure, testable.

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/app/chart/offscreen-vessel-edge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeOffscreenAnchor } from './offscreen-vessel-edge';

const viewport = { width: 800, height: 600 };
const PAD = 24; // anchor inset

describe('computeOffscreenAnchor', () => {
  it('returns null when the boat is inside the viewport', () => {
    expect(
      computeOffscreenAnchor({ projected: { x: 400, y: 300 }, viewport, pad: PAD }),
    ).toBeNull();
  });

  it('clamps a boat off the right to the right edge', () => {
    const a = computeOffscreenAnchor({ projected: { x: 1200, y: 300 }, viewport, pad: PAD });
    expect(a).not.toBeNull();
    expect(a!.x).toBe(800 - PAD);
    expect(a!.y).toBe(300);
  });

  it('clamps a boat off the left to the left edge', () => {
    const a = computeOffscreenAnchor({ projected: { x: -100, y: 300 }, viewport, pad: PAD });
    expect(a!.x).toBe(PAD);
    expect(a!.y).toBe(300);
  });

  it('clamps a boat off the top to the top edge', () => {
    const a = computeOffscreenAnchor({ projected: { x: 400, y: -50 }, viewport, pad: PAD });
    expect(a!.x).toBe(400);
    expect(a!.y).toBe(PAD);
  });

  it('clamps a boat off the bottom to the bottom edge', () => {
    const a = computeOffscreenAnchor({ projected: { x: 400, y: 700 }, viewport, pad: PAD });
    expect(a!.x).toBe(400);
    expect(a!.y).toBe(600 - PAD);
  });

  it('clamps a corner case (off both axes) into the corner', () => {
    const a = computeOffscreenAnchor({ projected: { x: 1200, y: 700 }, viewport, pad: PAD });
    expect(a!.x).toBe(800 - PAD);
    expect(a!.y).toBe(600 - PAD);
  });

  it("reports the boat's screen-space bearing in degrees, clockwise from up", () => {
    // boat off to the right at same y as center: bearing should be 90°
    const a = computeOffscreenAnchor({
      projected: { x: 1200, y: 300 },
      viewport,
      pad: PAD,
    });
    expect(a!.bearingDeg).toBeCloseTo(90, 0);

    // boat directly above center: bearing should be 0°
    const b = computeOffscreenAnchor({
      projected: { x: 400, y: -50 },
      viewport,
      pad: PAD,
    });
    expect(b!.bearingDeg).toBeCloseTo(0, 0);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
npx vitest run packages/web/src/app/chart/offscreen-vessel-edge.test.ts
```

Expected: fail with `Cannot find module './offscreen-vessel-edge'`.

- [ ] **Step 3: Implement the math**

Create `packages/web/src/app/chart/offscreen-vessel-edge.ts`:

```ts
export interface OffscreenAnchor {
  /** Pixel x of the pill anchor, in viewport coordinates. */
  x: number;
  /** Pixel y of the pill anchor, in viewport coordinates. */
  y: number;
  /**
   * Screen-space bearing from viewport center to the boat, in degrees.
   * 0 = boat directly above; 90 = boat to the right; 180 = below; 270 = left.
   */
  bearingDeg: number;
}

/**
 * Given the boat's projected pixel position (which may be outside the
 * viewport), the viewport size, and a padding inset for the pill, return
 * the on-edge anchor point closest to the boat plus the screen-space
 * bearing to the boat from the viewport center. Returns null when the
 * boat is inside the viewport — caller should hide the indicator.
 */
export function computeOffscreenAnchor(args: {
  projected: { x: number; y: number };
  viewport: { width: number; height: number };
  pad: number;
}): OffscreenAnchor | null {
  const { projected, viewport, pad } = args;
  const { x, y } = projected;
  const { width, height } = viewport;
  const inside = x >= 0 && x <= width && y >= 0 && y <= height;
  if (inside) return null;
  const clampedX = Math.min(Math.max(x, pad), width - pad);
  const clampedY = Math.min(Math.max(y, pad), height - pad);
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  const dy = y - cy;
  // atan2(dx, -dy) puts 0° at "up" and increases clockwise.
  const rad = Math.atan2(dx, -dy);
  const bearingDeg = ((rad * 180) / Math.PI + 360) % 360;
  return { x: clampedX, y: clampedY, bearingDeg };
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run packages/web/src/app/chart/offscreen-vessel-edge.test.ts
```

Expected: 8 passing tests.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/chart/offscreen-vessel-edge.ts packages/web/src/app/chart/offscreen-vessel-edge.test.ts
git commit -m "feat(web): offscreen-vessel edge-projection math + tests

Pure helper for the OffscreenVesselIndicator. Given the boat's
projected pixel position, the viewport size, and a pill inset,
returns the closest on-edge anchor plus a screen-space bearing
(0° = up, clockwise). Returns null when the boat is inside the
viewport so the caller can hide the indicator."
```

---

## Task 5: OffscreenVesselIndicator component

**Files:**

- Create: `packages/web/src/app/chart/OffscreenVesselIndicator.tsx`

Visual component that uses the Task 4 math and subscribes to map move + livePos.

- [ ] **Step 1: Create the component**

Create `packages/web/src/app/chart/OffscreenVesselIndicator.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { LivePos } from '../../components/LiveBoatMarker';
import { computeOffscreenAnchor, type OffscreenAnchor } from './offscreen-vessel-edge';

const PILL_PAD = 32;

/**
 * Corner pill that appears when the vessel is OUT of the viewport AND
 * follow mode is OFF. Anchored to the viewport edge closest to the
 * boat with a chevron pointing toward it and the great-circle-ish
 * straight-line distance in NM.
 *
 * Tap to re-enter follow mode (caller handles the re-centering via
 * the useChartCamera hook).
 */
export function OffscreenVesselIndicator({
  map,
  livePos,
  visible,
  onTap,
}: {
  map: maplibregl.Map | null;
  livePos: LivePos | null;
  visible: boolean;
  onTap: () => void;
}) {
  const [anchor, setAnchor] = useState<OffscreenAnchor | null>(null);
  const [distanceNm, setDistanceNm] = useState<number | null>(null);

  useEffect(() => {
    if (!map || !livePos || !visible) {
      setAnchor(null);
      setDistanceNm(null);
      return;
    }
    const recompute = (): void => {
      const canvas = map.getCanvas();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const projected = map.project([livePos.lon, livePos.lat]);
      setAnchor(
        computeOffscreenAnchor({
          projected: { x: projected.x, y: projected.y },
          viewport: { width, height },
          pad: PILL_PAD,
        }),
      );
      const center = map.getCenter();
      setDistanceNm(haversineNm(center.lat, center.lng, livePos.lat, livePos.lon));
    };
    recompute();
    map.on('move', recompute);
    return () => {
      map.off('move', recompute);
    };
  }, [map, livePos, visible]);

  if (!anchor || distanceNm === null) return null;
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`Vessel ${distanceNm.toFixed(1)} NM, tap to follow`}
      title="Vessel is off-screen — tap to follow"
      className="absolute z-10 flex items-center gap-1 px-2 h-8 rounded-full bg-amber-500/95 text-slate-900 text-xs font-semibold shadow border border-amber-700"
      style={{
        left: `${anchor.x}px`,
        top: `${anchor.y}px`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <span
        aria-hidden="true"
        style={{ transform: `rotate(${anchor.bearingDeg}deg)`, display: 'inline-block' }}
      >
        ▲
      </span>
      <span>{distanceNm.toFixed(1)} NM</span>
    </button>
  );
}

const NM_PER_KM = 1 / 1.852;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R_KM = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_KM * c * NM_PER_KM;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/chart/OffscreenVesselIndicator.tsx
git commit -m "feat(web): OffscreenVesselIndicator — corner pill with bearing arrow

Renders only when follow is off AND the vessel has been panned out
of the viewport. Anchored on the closest viewport edge using the
pure edge-projection helper; shows a screen-space-bearing chevron
plus great-circle-ish distance in NM. Tap → caller re-enters follow
mode."
```

---

## Task 6: Wire chart page

**Files:**

- Modify: `packages/web/src/app/chart/page.tsx`

Replace the existing inline center-on-boat button block with the new components. Wire up the hook.

- [ ] **Step 1: Add imports near the existing component imports**

Open `packages/web/src/app/chart/page.tsx`. Near the top component imports (around line 23–25), add:

```ts
import { ChartFollowControl } from './ChartFollowControl';
import { OffscreenVesselIndicator } from './OffscreenVesselIndicator';
import { useChartCamera } from './use-chart-camera';
```

- [ ] **Step 2: Instantiate the hook**

Find the `[livePos, setLivePos]` state declaration (around line 54). Immediately after the existing related state declarations and before the page's first effect, add:

```tsx
const camera = useChartCamera({ map: mapInstance, livePos });
```

(Note: `mapInstance` is the map state; the hook tolerates `null` until the map is ready.)

- [ ] **Step 3: Replace the inline "Center on boat" block**

Find this block, currently around lines 559–578:

```tsx
<div className="absolute top-3 left-3 flex flex-col gap-2 items-start">
  {livePos && (
    <button
      type="button"
      onClick={() => {
        if (mapRef.current) {
          mapRef.current.flyTo({
            center: [livePos.lon, livePos.lat],
            zoom: Math.max(mapRef.current.getZoom(), 9),
            speed: 1.4,
          });
        }
      }}
      className="px-3 py-1.5 bg-slate-900/85 hover:bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded shadow"
      title="Pan map to boat's current position"
    >
      ⊕ Center on boat
    </button>
  )}
</div>
```

Replace it ENTIRELY with:

```tsx
        <ChartFollowControl
          follow={camera.follow}
          orientation={camera.orientation}
          hasFix={livePos !== null}
          onToggleFollow={camera.toggleFollow}
          onCycleOrientation={camera.cycleOrientation}
        />
        <OffscreenVesselIndicator
          map={mapInstance}
          livePos={livePos}
          visible={!camera.follow}
          onTap={camera.enterFollow}
        />
```

Verify with `grep -n 'Center on boat' packages/web/src/app/chart/page.tsx` — it should return nothing after the edit.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck --workspace @g5000/web
```

Expected: clean.

- [ ] **Step 5: Full test suite**

```bash
npm test
```

Expected: all new tests pass; pre-existing environmental failures (missing wgrib2, ConfigStore-not-booted, missing coastline data) acceptable. Any new failure is a bug.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: clean for the files touched in this task. Ignore pre-existing nags elsewhere.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/app/chart/page.tsx
git commit -m "feat(web): mount Follow / Orientation controls and offscreen indicator on /chart

Drops the one-shot 'Center on boat' button in favour of:
  - ChartFollowControl (stateful Follow toggle + Orientation cycle)
  - OffscreenVesselIndicator (edge pill that doubles as re-center)
All logic lives in useChartCamera; the page is just the wiring.

Default state: follow=true, orientation=north — first-time visitors
land on a chart that follows the boat with the OSM basemap north-up.
Toggle orientation to course/heading-up for an implicit lookahead
(vessel sits at 30% from the bottom edge)."
```

---

## Task 7: Manual verification

**Files:**

- Modify: none.

End-to-end smoke before declaring done.

- [ ] **Step 1: Free port 3000 and start dev server from this worktree**

```bash
lsof -ti :3000 2>/dev/null | xargs -r kill -9
cd /Users/gregjohnson/code/g5000/.worktrees/chart-follow-mode
npm run dev --workspace @g5000/autopilot-server
```

Wait for `[autopilot] web UI on http://0.0.0.0:3000` in the log.

- [ ] **Step 2: Fresh-profile load**

Clear `chart:*` localStorage in your browser (or open an incognito window). Navigate to `http://localhost:3000/chart`.

Expected: Follow button (top-left, second from top of left column) shows filled state ("⊙ Follow"). Orientation button below shows "N". Boat marker visible and chart roughly centered on it (will follow on each position update).

- [ ] **Step 3: Pan to exit follow**

Drag the chart. Follow button switches to outlined ("⊕ Follow"). If you pan far enough to push the boat out of view, the amber off-screen pill appears at the closest viewport edge with a bearing arrow and "X.X NM" distance.

- [ ] **Step 4: Tap off-screen pill**

Click the pill. Follow button switches back to filled, the chart re-centers on the boat, and the pill disappears.

- [ ] **Step 5: Cycle orientation**

Click the orientation button. Label cycles "N" → "↑COG" → "↑HDG" → "N". In course/heading modes:

- The map rotates so COG/HDG points up.
- The boat sits at ~30% from the bottom of the viewport (lookahead).

If COG is unavailable (boat at zero SOG), course-up should fall back to north-up without errors in the console.

- [ ] **Step 6: Persistence**

Set follow OFF and orientation to `↑COG`. Refresh the page. Both should persist: Follow remains outlined, Orientation remains "↑COG".

- [ ] **Step 7: Done — no further commit required**

The work is shippable from Task 6's commit. Stop here unless verification surfaced a bug.

---

## Self-review

**Spec coverage:**

- Follow mode as a stateful toggle → Task 2 (hook), Task 3 (button), Task 6 (wire-up) ✓
- localStorage persistence under `chart:follow`, `chart:orientation` → Task 2 ✓
- Pan-exit via `e.originalEvent`-undefined filter → Task 2 ✓
- Orientation cycle (north → course → heading → north) → Task 1 (pure helper), Task 2 (state), Task 3 (button) ✓
- Bearing dead-band to suppress jitter → Task 1 (pure helper), Task 2 (effect) ✓
- Lookahead padding (30% top in course/heading + follow) → Task 2 ✓
- Off-screen indicator with closest-edge math → Task 4 (math), Task 5 (component), Task 6 (wire-up) ✓
- Default: follow=true, orientation=north → Task 1 (defaults), Task 2 (hook init) ✓
- Disabled button state when no GPS fix → Task 3 ✓
- Heading fallback to course when heading is unavailable → Task 2 ✓
- Distance in NM on the pill → Task 5 (haversine helper) ✓
- Tests cover the pure pieces (cycle, wrap-delta, storage readers, edge-projection) → Task 1, Task 4 ✓
- Manual verification list → Task 7 ✓

**Placeholder scan:** none — every step has the actual code, an exact command, or specific expected output.

**Type consistency:**

- `Orientation` type defined once in Task 1, used everywhere downstream — `ChartFollowControl` prop, `useChartCamera` state, the cycle helper. ✓
- `ChartCameraHandle` defined in Task 2 with `follow`, `orientation`, `toggleFollow`, `enterFollow`, `cycleOrientation`. The chart-page wire-up (Task 6) accesses exactly those keys. ✓
- `OffscreenAnchor` (Task 4) returned by `computeOffscreenAnchor` and consumed by `OffscreenVesselIndicator` (Task 5) — same shape `{ x, y, bearingDeg }`. ✓
- `LivePos` (existing, in `LiveBoatMarker.tsx`) is the source of `lat`, `lon`, `cog`, `hdg`, used by the hook (Task 2) and the indicator (Task 5). Not modified. ✓
