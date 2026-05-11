# G5000 Plan 4 — AWS/AWA Cal Editor + Tack-Test Wizard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make the AWS/AWA cal table editable from the browser, both by manual cell entry and by the tack-test wizard — the killer feature for actually getting calibration done at sea. After this plan lands, you can sail upwind, tap two buttons (one per tack), see the suggested correction, and apply it with one more tap. The change hot-reloads into the compute pipeline immediately.

**Architecture:**

- New cal-tools module in `@g5000/compute` with pure-function helpers: `findNearestCalCell`, `applyAngleCorrectionToCell`, `computeTackCorrection`.
- Two new React hooks in `@g5000/web/src/hooks/`: `useSse` (latest sample per channel) and `useChannelHistory` (sliding window of recent samples with averaging helpers).
- React components: `CalHeatmap` (visualizes the AWS/AWA grid), `CellEditor` (manual cell value entry), `TackTestWizard` (state-machine UI for capture → suggest → apply).
- New page at `/calibration/wind` combining the heatmap, the editor, and the wizard.
- No new packages, no new runtime deps. All math is pure-function TDD; React parts get manual smoke testing.

**Tech Stack additions:** none. We already have Next.js 16, React 19, Tailwind v4, SSE, and the REST PUT endpoint.

**Reference spec:** `docs/superpowers/specs/2026-05-08-g5000-design.md`. Implements build-sequence step 13 (cal-table editor + tack-test wizard).

---

## What's in scope

- Cal-tools math helpers (find nearest cell by AWS/|AWA|, apply correction to a cell, compute tack correction from two captures).
- Two reusable React hooks for SSE consumption with sliding-window averaging.
- A visual heatmap component for the AWS/AWA cal grid (cells colored by `angleCorrection` value, click to select).
- Manual cell editor: enter explicit values for the selected cell, save.
- Tack-test wizard with state machine: idle → capturing port → idle → capturing starboard → review correction → applied.
- `/calibration/wind` page combining the above.
- The wizard updates the cal grid in-place via `PUT /api/config/aws-awa`.

## What's NOT in scope

- Auto-detection of "sailing steady" (rate-of-turn-near-zero, AWA variance low). User triggers capture manually via the "Capture" button.
- BSP cal, compass-deviation cal, boat-config form. These are simpler and land in Plan 5.
- Polars editor, target boat speed, %polar. Plan 6.
- Multi-cell spreading of corrections via bilinear weights — we snap to the nearest cell. Bilinear-spread is cleaner mathematically but harder to explain in the UI.
- Undo / history. Apply is irreversible; user can manually re-enter the previous value if needed.
- Auth on the API. LAN-only as before.

---

## File structure

```
autopilot/
├── packages/
│   ├── compute/
│   │   └── src/
│   │       ├── cal-tools/
│   │       │   ├── find-cell.ts                    NEW
│   │       │   ├── find-cell.test.ts               NEW
│   │       │   ├── tack-correction.ts              NEW
│   │       │   └── tack-correction.test.ts         NEW
│   │       └── index.ts                            MODIFY: re-export cal-tools
│   └── web/
│       └── src/
│           ├── hooks/
│           │   ├── use-sse.ts                      NEW
│           │   └── use-channel-history.ts          NEW
│           └── app/
│               └── calibration/
│                   └── wind/
│                       ├── page.tsx                NEW (server component shell)
│                       ├── CalHeatmap.tsx          NEW
│                       ├── CellEditor.tsx          NEW
│                       └── TackTestWizard.tsx      NEW
```

---

## Task 1: Cal-tools — `findNearestCalCell` + `applyAngleCorrectionToCell` (TDD)

**Files:**

- Create: `packages/compute/src/cal-tools/find-cell.ts`
- Test: `packages/compute/src/cal-tools/find-cell.test.ts`

`findNearestCalCell` takes an AWS and |AWA| (radians, already absolute-valued) plus the cal table's bin arrays, and returns the index of the nearest bin in each dimension. Snap-to-nearest, not interpolation.

`applyAngleCorrectionToCell` takes the cal table, a cell index pair, and a correction delta, and returns a new cal table with that cell's `angleCorrection` value incremented by the delta (immutable update — does not mutate input).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { findNearestCalCell, applyAngleCorrectionToCell, type CellIndex } from './find-cell.js';
import { DEFAULT_AWS_AWA_CAL, type AwsAwaCalTable } from '@g5000/db';

describe('findNearestCalCell', () => {
  const cal = DEFAULT_AWS_AWA_CAL; // 8 AWS bins [2,4,...,20], 13 AWA bins [0,15°,…,180°]

  it('returns (0, 0) for AWS below all bins and AWA at 0', () => {
    const idx = findNearestCalCell(cal, 0.5, 0);
    expect(idx).toEqual({ awsIdx: 0, awaIdx: 0 });
  });

  it('returns the last indices for inputs above all bins', () => {
    const idx = findNearestCalCell(cal, 100, Math.PI * 2);
    expect(idx).toEqual({
      awsIdx: cal.awsBins.length - 1,
      awaIdx: cal.awaBins.length - 1,
    });
  });

  it('snaps to the nearest bin in each dimension', () => {
    // AWS bins: 2, 4, 6, 8, ... ; AWA bins: 0, 15°, 30°, 45°, ...
    // AWS = 5 is between 4 and 6, equidistant — implementation may pick either,
    // so we just assert the index is 1 or 2.
    const idx1 = findNearestCalCell(cal, 4.6, 0);
    expect(idx1.awsIdx).toBe(1); // closer to 4
    const idx2 = findNearestCalCell(cal, 5.4, 0);
    expect(idx2.awsIdx).toBe(2); // closer to 6

    // AWA = 50° = 0.873 rad is between bins 3 (45° = 0.785) and 4 (60° = 1.047).
    const fiftyDeg = (50 * Math.PI) / 180;
    const idx3 = findNearestCalCell(cal, 6, fiftyDeg);
    expect(idx3.awaIdx).toBe(3); // closer to 45° than to 60°
  });
});

describe('applyAngleCorrectionToCell', () => {
  it('returns a new table with the targeted cell incremented by the delta', () => {
    const cal = DEFAULT_AWS_AWA_CAL;
    const next = applyAngleCorrectionToCell(cal, { awsIdx: 2, awaIdx: 4 }, 0.123);
    expect(next).not.toBe(cal); // immutable: returns a new object
    expect(next.angleCorrection[2]![4]).toBeCloseTo(0.123, 6);
    // Untouched cells preserved.
    expect(next.angleCorrection[0]![0]).toBe(0);
    expect(next.angleCorrection[2]![3]).toBe(0);
  });

  it('does not mutate the input table', () => {
    const cal = DEFAULT_AWS_AWA_CAL;
    const before = cal.angleCorrection[1]![1];
    applyAngleCorrectionToCell(cal, { awsIdx: 1, awaIdx: 1 }, 0.5);
    expect(cal.angleCorrection[1]![1]).toBe(before);
  });

  it('throws on an out-of-range cell index', () => {
    const cal = DEFAULT_AWS_AWA_CAL;
    expect(() => applyAngleCorrectionToCell(cal, { awsIdx: 999, awaIdx: 0 }, 0.1)).toThrow();
    expect(() => applyAngleCorrectionToCell(cal, { awsIdx: 0, awaIdx: -1 }, 0.1)).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect failure (module not found)**

```
npx vitest run packages/compute/src/cal-tools/find-cell.test.ts
```

- [ ] **Step 3: Implement `packages/compute/src/cal-tools/find-cell.ts`**

```ts
import type { AwsAwaCalTable } from '@g5000/db';

export interface CellIndex {
  awsIdx: number;
  awaIdx: number;
}

/**
 * Return the indices of the cal cell whose bin centers are closest to
 * the given AWS / |AWA|. Snap-to-nearest, not interpolating — when the
 * wizard applies a correction to "the cell at AWS=5.4, |AWA|=50°", the
 * user sees one specific cell change rather than four cells weighted.
 *
 * `awaAbs` is expected to already be non-negative (callers should pass
 * Math.abs(awa)). The cal grid is symmetric across the boat centerline.
 */
export function findNearestCalCell(cal: AwsAwaCalTable, aws: number, awaAbs: number): CellIndex {
  return {
    awsIdx: nearestIndex(cal.awsBins, aws),
    awaIdx: nearestIndex(cal.awaBins, awaAbs),
  };
}

function nearestIndex(bins: number[], v: number): number {
  if (bins.length === 0) return 0;
  if (v <= bins[0]!) return 0;
  if (v >= bins[bins.length - 1]!) return bins.length - 1;
  // Linear scan — bin counts here are tiny (≤ 20).
  let bestIdx = 0;
  let bestDist = Math.abs(v - bins[0]!);
  for (let i = 1; i < bins.length; i++) {
    const d = Math.abs(v - bins[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Return a new cal table with one cell's angle correction incremented
 * by `delta`. The input table is not mutated (deep-ish copy of the
 * angleCorrection grid; speedMultiplier is shared since we don't touch it).
 */
export function applyAngleCorrectionToCell(
  cal: AwsAwaCalTable,
  cell: CellIndex,
  delta: number,
): AwsAwaCalTable {
  if (
    cell.awsIdx < 0 ||
    cell.awsIdx >= cal.awsBins.length ||
    cell.awaIdx < 0 ||
    cell.awaIdx >= cal.awaBins.length
  ) {
    throw new Error(
      `applyAngleCorrectionToCell: cell index out of range ` +
        `(awsIdx=${cell.awsIdx}/${cal.awsBins.length}, awaIdx=${cell.awaIdx}/${cal.awaBins.length})`,
    );
  }
  const newAngleCorr = cal.angleCorrection.map((row) => row.slice());
  newAngleCorr[cell.awsIdx]![cell.awaIdx] += delta;
  return {
    ...cal,
    angleCorrection: newAngleCorr,
  };
}
```

- [ ] **Step 4: Run — expect pass**

```
npx vitest run packages/compute/src/cal-tools/find-cell.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/compute/src/cal-tools/find-cell.ts packages/compute/src/cal-tools/find-cell.test.ts
git commit -m "feat(compute): cal-tools — findNearestCalCell and applyAngleCorrectionToCell"
```

---

## Task 2: Cal-tools — `computeTackCorrection` (TDD)

**Files:**

- Create: `packages/compute/src/cal-tools/tack-correction.ts`
- Test: `packages/compute/src/cal-tools/tack-correction.test.ts`
- Modify: `packages/compute/src/index.ts` — re-export cal-tools

The math:

On both tacks of a steady-state upwind run, the true wind direction (TWD) must be identical, because the wind itself isn't tacking — only the boat is. So if our calibration is wrong, the observed TWD will differ between tacks. The difference is exactly twice the angle correction we should add at the AWS/|AWA| sailed:

```
TWD_observed_port      = TWD_true + error_port
TWD_observed_starboard = TWD_true + error_starboard
With symmetric cal error: error_port = -error_starboard (one tack reads "fatter",
   the other reads "tighter" by the same amount).
Therefore: TWD_port - TWD_starboard = 2 × error_port
And the cal cell needs `angleCorrection` increased by error_port to make port
   read closer to true (and starboard simultaneously closer to true on its side).
```

The wizard takes two captures (port-tack and starboard-tack averages) and returns:

- The target cell (AWS/|AWA| based on the captured port tack — both tacks should agree on these).
- The suggested `delta` to add to that cell's `angleCorrection`.

Sign convention: `delta = -(TWD_port - TWD_starboard) / 2`. The negative sign is because:

- If port reads HIGHER TWD than starboard, port's AWA is too positive ("rotated outward more than it should").
- The cal correction `angleCorrection` is _added_ to AWA in the math (after multiplying by sign(awa)).
- On port (positive AWA), we want awa to come _down_ — so the cal correction is negative.
- We're computing the delta to ADD to whatever the cell already holds.

We'll write tests with synthetic capture data that asserts both magnitude and sign.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { computeTackCorrection, type TackCapture } from './tack-correction.js';
import { DEFAULT_AWS_AWA_CAL } from '@g5000/db';

const cap = (overrides: Partial<TackCapture>): TackCapture => ({
  twd: 0,
  tws: 5,
  awa: 0.6,
  aws: 5,
  ...overrides,
});

describe('computeTackCorrection', () => {
  it('returns zero delta when both tacks agree on TWD', () => {
    const port = cap({ twd: Math.PI / 2, awa: 0.6 });
    const starboard = cap({ twd: Math.PI / 2, awa: -0.6 });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    expect(r.delta).toBeCloseTo(0, 6);
    // Cell selection based on AWS/|AWA| — both captures should land in
    // the same cell, but we report the port-side coords.
    expect(r.cell.awsIdx).toBeGreaterThanOrEqual(0);
    expect(r.cell.awaIdx).toBeGreaterThanOrEqual(0);
  });

  it('produces delta = -(TWD_port - TWD_starboard) / 2', () => {
    // Port reads TWD = 90° + 4° = 94°; starboard reads 90° - 4° = 86°.
    // Difference = 8°. Correction = -4° = -0.0698 rad.
    const port = cap({ twd: (94 * Math.PI) / 180 });
    const starboard = cap({ twd: (86 * Math.PI) / 180, awa: -0.6 });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    expect(r.delta).toBeCloseTo(-(4 * Math.PI) / 180, 4);
  });

  it('handles the TWD wraparound at 0/2π', () => {
    // Port reads 358°; starboard reads 2°. Naive diff = -356°; modular diff = 4°.
    const port = cap({ twd: (358 * Math.PI) / 180 });
    const starboard = cap({ twd: (2 * Math.PI) / 180, awa: -0.6 });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    // (-356 mod 360 → 4°) / 2 = 2°, with a sign of - → delta should be -2° in rad.
    expect(r.delta).toBeCloseTo(-(2 * Math.PI) / 180, 3);
  });

  it('returns the cell snapped to the average AWS and |AWA| of the port capture', () => {
    const port = cap({ aws: 6, awa: 0.785 }); // AWS=6, |AWA|=45°
    const starboard = cap({ aws: 6, awa: -0.785 });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    // AWS = 6 is exactly at bin index 2 in the default grid.
    expect(r.cell.awsIdx).toBe(2);
    // |AWA| = 45° = π/4 rad is exactly at bin index 3.
    expect(r.cell.awaIdx).toBe(3);
  });

  it('returns the previewed table after applying the delta to the cell', () => {
    const port = cap({ twd: (94 * Math.PI) / 180, aws: 6, awa: 0.785 });
    const starboard = cap({
      twd: (86 * Math.PI) / 180,
      aws: 6,
      awa: -0.785,
    });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    expect(r.previewed.angleCorrection[r.cell.awsIdx]![r.cell.awaIdx]).toBeCloseTo(r.delta, 6);
    // Untouched cells preserved.
    expect(r.previewed.angleCorrection[0]![0]).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect failure (module not found)**

- [ ] **Step 3: Implement `packages/compute/src/cal-tools/tack-correction.ts`**

```ts
import type { AwsAwaCalTable } from '@g5000/db';
import { findNearestCalCell, applyAngleCorrectionToCell, type CellIndex } from './find-cell.js';

/**
 * One steady-state capture during the tack-test wizard. Each field is the
 * captured average over a few seconds of close-hauled sailing.
 */
export interface TackCapture {
  /** True wind direction (compass-style from north), radians [0, 2π). */
  twd: number;
  /** True wind speed, m/s. */
  tws: number;
  /** Apparent wind angle (signed, from bow), radians. */
  awa: number;
  /** Apparent wind speed, m/s. */
  aws: number;
}

export interface TackCorrectionResult {
  /** Cell that will be updated. */
  cell: CellIndex;
  /** Angle correction delta in radians (to be ADDED to the cell's current value). */
  delta: number;
  /** A preview of the cal table with the delta applied — for displaying before/after. */
  previewed: AwsAwaCalTable;
  /** TWD difference between tacks, after wrap normalization, radians. */
  twdDiff: number;
}

/**
 * Compute the cal-cell correction needed to make two tack captures agree on TWD.
 *
 * The math:
 *   twdDiff = wrapToPi(twd_port - twd_starboard)
 *   delta   = -twdDiff / 2
 *
 * The cell is found from the port capture's AWS and |AWA| (snap-to-nearest).
 * The cal grid is symmetric across the centerline, so starboard's same-magnitude
 * |AWA| lands in the same cell.
 */
export function computeTackCorrection(
  cal: AwsAwaCalTable,
  port: TackCapture,
  starboard: TackCapture,
): TackCorrectionResult {
  const twdDiff = wrapToPi(port.twd - starboard.twd);
  const delta = -twdDiff / 2;
  const cell = findNearestCalCell(cal, port.aws, Math.abs(port.awa));
  const previewed = applyAngleCorrectionToCell(cal, cell, delta);
  return { cell, delta, previewed, twdDiff };
}

/** Normalize an angle to the range (-π, π]. */
function wrapToPi(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
```

- [ ] **Step 4: Update `packages/compute/src/index.ts`**

```ts
export * from './true-wind/math.js';
export * from './true-wind/pipeline.js';
export * from './cal-tools/find-cell.js';
export * from './cal-tools/tack-correction.js';
```

- [ ] **Step 5: Run — expect pass**

```
npx vitest run packages/compute
```

All 5 new tests pass; all 16 prior compute tests still pass.

- [ ] **Step 6: Verify typecheck**

```
npx tsc -b packages/compute
```

Clean.

- [ ] **Step 7: Commit**

```bash
git add packages/compute/src/cal-tools/tack-correction.ts packages/compute/src/cal-tools/tack-correction.test.ts packages/compute/src/index.ts
git commit -m "feat(compute): cal-tools — computeTackCorrection with wraparound-safe math"
```

---

## Task 3: Rebuild compute to dist (so Next.js can consume it)

**Files:**

- Modify: `packages/compute/package.json` — point `main` at `dist/`
- Modify: `apps/autopilot-server/package.json` — extend `predev`/`prebuild` to build compute

`@g5000/web` needs to import `findNearestCalCell` and `computeTackCorrection` from `@g5000/compute`. Next.js consumes workspace packages via their compiled `dist/` (the Plan 1 finding), so `compute` must follow the same pattern as `core` and `db`.

- [ ] **Step 1: Update `packages/compute/package.json`**

Change `main` and `types`:

```json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
```

- [ ] **Step 2: Build it**

```
npm run build --workspace=@g5000/compute
```

Verify `packages/compute/dist/index.js`, `packages/compute/dist/index.d.ts`, and per-source artifacts.

- [ ] **Step 3: Extend the autopilot-server lifecycle scripts**

In `apps/autopilot-server/package.json`, update `predev` and `prebuild`:

```json
"predev": "tsc -b ../../packages/core ../../packages/db ../../packages/compute",
"prebuild": "tsc -b ../../packages/core ../../packages/db ../../packages/compute",
```

- [ ] **Step 4: Add `@g5000/compute` to `packages/web/package.json` deps**

Insert after `@g5000/db`:

```json
"@g5000/compute": "*",
```

Run `npm install`.

- [ ] **Step 5: Update Next.js `serverExternalPackages`**

In `packages/web/next.config.ts`, the `serverExternalPackages` array currently contains `['@g5000/core', '@g5000/db']`. Add `@g5000/compute`:

```ts
serverExternalPackages: ['@g5000/core', '@g5000/db', '@g5000/compute'],
```

(For pure-JS packages this is optional, but consistent with the pattern. Without it the dynamic import works but Turbopack may try to bundle the cjs-vs-esm mix awkwardly. Better to be explicit.)

- [ ] **Step 6: Verify typecheck**

```
npm run typecheck --workspace=@g5000/web
```

- [ ] **Step 7: Commit**

```bash
git add packages/compute/package.json packages/web/package.json packages/web/next.config.ts apps/autopilot-server/package.json package-lock.json
git commit -m "chore: compute ships from dist, web depends on compute"
```

---

## Task 4: `useSse` React hook

**Files:**

- Create: `packages/web/src/hooks/use-sse.ts`

A reusable hook that subscribes to `/api/stream`, maintains a `Map<channel, JsonSafeSample>` of latest values per channel, and returns it. Behavior matches the existing `/inspect` page's effect but factored into a hook so the wizard and editor can share it.

- [ ] **Step 1: Implement `packages/web/src/hooks/use-sse.ts`**

```ts
'use client';

import { useEffect, useState } from 'react';
import type { JsonSafeSample } from '@g5000/core';

export interface UseSseResult {
  /** Latest sample per channel. Updated as SSE events arrive. */
  channels: ReadonlyMap<string, JsonSafeSample>;
  /** True after the EventSource has confirmed connection. */
  connected: boolean;
}

/**
 * Subscribe to `/api/stream` for the lifetime of the component. Returns a
 * Map keyed by channel name with the latest sample. Component re-renders
 * on every new event (small payloads, batched server-side).
 */
export function useSse(): UseSseResult {
  const [channels, setChannels] = useState<Map<string, JsonSafeSample>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onopen = () => setConnected(true);
    es.onmessage = (ev) => {
      try {
        const { channel, sample } = JSON.parse(ev.data) as {
          channel: string;
          sample: JsonSafeSample;
        };
        setChannels((prev) => {
          const next = new Map(prev);
          next.set(channel, sample);
          return next;
        });
      } catch {
        /* ignore malformed payloads */
      }
    };
    es.onerror = () => {
      setConnected(false);
    };
    return () => {
      es.close();
    };
  }, []);

  return { channels, connected };
}
```

- [ ] **Step 2: Verify the hook typechecks**

```
npm run typecheck --workspace=@g5000/web
```

Clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hooks/use-sse.ts
git commit -m "feat(web): useSse hook for live channel subscription"
```

---

## Task 5: `useChannelHistory` React hook

**Files:**

- Create: `packages/web/src/hooks/use-channel-history.ts`

A hook that maintains a rolling buffer of the last N seconds of samples on a specific channel, with averaging helpers. The wizard uses this during capture: subscribe to TWD, TWA, etc., let the user say "now", then compute averages over the past few seconds.

- [ ] **Step 1: Implement `packages/web/src/hooks/use-channel-history.ts`**

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import type { JsonSafeSample } from '@g5000/core';

export interface ChannelHistoryPoint {
  t_ms: number;
  value: number;
}

export interface UseChannelHistoryResult {
  /** Most-recent value, or null if no samples have arrived yet. */
  latest: number | null;
  /** Rolling buffer of samples within the configured window. */
  history: readonly ChannelHistoryPoint[];
  /**
   * Average of all samples in the buffer at the moment of the call.
   * Returns null if the buffer is empty.
   */
  average(): number | null;
  /**
   * Standard deviation of all samples in the buffer. Useful for assessing
   * "is the boat sailing steady?". Returns null if fewer than 2 samples.
   */
  stdDev(): number | null;
}

/**
 * Maintain a rolling buffer of the last `windowMs` milliseconds of samples
 * on the given scalar channel. Samples outside the window are evicted on
 * each new arrival. Returns helpers to read the latest value and aggregate
 * over the buffer.
 *
 * `sample` is provided by the parent (typically from useSse().channels);
 * the hook trims based on `t_ms` from the sample.
 */
export function useChannelHistory(
  sample: JsonSafeSample | undefined,
  windowMs: number,
): UseChannelHistoryResult {
  const historyRef = useRef<ChannelHistoryPoint[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!sample || sample.value.kind !== 'scalar') return;
    const now = sample.t_ms;
    const cutoff = now - windowMs;
    historyRef.current = [
      ...historyRef.current.filter((p) => p.t_ms >= cutoff),
      { t_ms: now, value: sample.value.value },
    ];
    setTick((t) => t + 1);
  }, [sample, windowMs]);

  const history = historyRef.current;
  const latest = history.length > 0 ? history[history.length - 1]!.value : null;

  return {
    latest,
    history,
    average() {
      if (history.length === 0) return null;
      const sum = history.reduce((s, p) => s + p.value, 0);
      return sum / history.length;
    },
    stdDev() {
      if (history.length < 2) return null;
      const mean = this.average()!;
      const sumSq = history.reduce((s, p) => s + (p.value - mean) ** 2, 0);
      return Math.sqrt(sumSq / (history.length - 1));
    },
  };
}
```

- [ ] **Step 2: Verify typecheck**

```
npm run typecheck --workspace=@g5000/web
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hooks/use-channel-history.ts
git commit -m "feat(web): useChannelHistory hook with rolling window and stats"
```

---

## Task 6: `CalHeatmap` component

**Files:**

- Create: `packages/web/src/app/calibration/wind/CalHeatmap.tsx`

A visual grid of the AWS/AWA cal table. Rows = AWS bins, columns = |AWA| bins. Each cell colored by its `angleCorrection` value (red for negative, blue for positive, gray for zero). Click a cell to select it; selected cell highlighted with a ring.

- [ ] **Step 1: Implement `CalHeatmap.tsx`**

```tsx
'use client';

import type { AwsAwaCalTable } from '@g5000/db';

export interface CalHeatmapProps {
  cal: AwsAwaCalTable;
  selected?: { awsIdx: number; awaIdx: number };
  onSelect?: (cell: { awsIdx: number; awaIdx: number }) => void;
}

const RAD_TO_DEG = 180 / Math.PI;

export function CalHeatmap({ cal, selected, onSelect }: CalHeatmapProps) {
  const maxAbs = Math.max(1e-6, ...cal.angleCorrection.flat().map(Math.abs));

  const cellColor = (v: number): string => {
    if (Math.abs(v) < 1e-9) return 'bg-slate-800';
    const intensity = Math.min(1, Math.abs(v) / maxAbs);
    const hex = Math.floor(intensity * 200 + 30)
      .toString(16)
      .padStart(2, '0');
    return v < 0 ? `bg-[#${hex}1818]` : `bg-[#1818${hex}]`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs font-mono">
        <thead>
          <tr>
            <th className="p-1 text-slate-500">AWS \ |AWA|</th>
            {cal.awaBins.map((awa, i) => (
              <th key={i} className="p-1 text-slate-500 text-right">
                {(awa * RAD_TO_DEG).toFixed(0)}°
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cal.awsBins.map((aws, awsIdx) => (
            <tr key={awsIdx}>
              <th className="p-1 text-slate-500 text-right pr-2">{aws.toFixed(0)} m/s</th>
              {cal.awaBins.map((_, awaIdx) => {
                const v = cal.angleCorrection[awsIdx]![awaIdx]!;
                const isSelected = selected?.awsIdx === awsIdx && selected.awaIdx === awaIdx;
                return (
                  <td
                    key={awaIdx}
                    onClick={() => onSelect?.({ awsIdx, awaIdx })}
                    className={`p-2 cursor-pointer text-right ${cellColor(v)} ${
                      isSelected ? 'ring-2 ring-amber-400' : ''
                    }`}
                    title={`AWS ${aws.toFixed(1)} m/s, |AWA| ${(
                      cal.awaBins[awaIdx]! * RAD_TO_DEG
                    ).toFixed(0)}°, cal ${(v * RAD_TO_DEG).toFixed(2)}°`}
                  >
                    {(v * RAD_TO_DEG).toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-2">
        Cell values shown in degrees. Click a cell to select it.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```
npm run typecheck --workspace=@g5000/web
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/calibration/wind/CalHeatmap.tsx
git commit -m "feat(web): CalHeatmap component visualizing AWS/AWA grid"
```

---

## Task 7: `CellEditor` component

**Files:**

- Create: `packages/web/src/app/calibration/wind/CellEditor.tsx`

When a cell is selected, show a form with the current value, an input for a new value (in degrees), and an "Apply" button that PUTs the new full cal table.

- [ ] **Step 1: Implement `CellEditor.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import type { AwsAwaCalTable } from '@g5000/db';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export interface CellEditorProps {
  cal: AwsAwaCalTable;
  cell: { awsIdx: number; awaIdx: number };
  onApply: (updatedCal: AwsAwaCalTable) => void | Promise<void>;
}

export function CellEditor({ cal, cell, onApply }: CellEditorProps) {
  const currentRad = cal.angleCorrection[cell.awsIdx]![cell.awaIdx]!;
  const [newDeg, setNewDeg] = useState((currentRad * RAD_TO_DEG).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync when a different cell is selected.
  useEffect(() => {
    setNewDeg((currentRad * RAD_TO_DEG).toFixed(2));
    setErr(null);
  }, [cell.awsIdx, cell.awaIdx, currentRad]);

  const handleApply = async (): Promise<void> => {
    const parsed = Number(newDeg);
    if (!Number.isFinite(parsed)) {
      setErr('Not a number');
      return;
    }
    const newRad = parsed * DEG_TO_RAD;
    const updated: AwsAwaCalTable = {
      ...cal,
      angleCorrection: cal.angleCorrection.map((row, i) =>
        i === cell.awsIdx ? row.map((v, j) => (j === cell.awaIdx ? newRad : v)) : row.slice(),
      ),
    };
    setBusy(true);
    setErr(null);
    try {
      await onApply(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const awsAt = cal.awsBins[cell.awsIdx]!;
  const awaAt = cal.awaBins[cell.awaIdx]! * RAD_TO_DEG;

  return (
    <div className="border border-slate-700 rounded p-4 space-y-3">
      <div className="text-sm text-slate-300">
        Editing cell at <span className="font-mono">AWS {awsAt.toFixed(1)} m/s</span> ×{' '}
        <span className="font-mono">|AWA| {awaAt.toFixed(0)}°</span>
      </div>
      <label className="block text-sm">
        <span className="text-slate-400">Angle correction (degrees):</span>
        <input
          type="number"
          step="0.1"
          value={newDeg}
          onChange={(e) => setNewDeg(e.target.value)}
          className="block w-32 mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono"
        />
      </label>
      <button
        onClick={handleApply}
        disabled={busy}
        className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Apply'}
      </button>
      {err && <div className="text-sm text-red-400">{err}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/calibration/wind/CellEditor.tsx
git commit -m "feat(web): CellEditor for manual cell value entry"
```

---

## Task 8: `TackTestWizard` component

**Files:**

- Create: `packages/web/src/app/calibration/wind/TackTestWizard.tsx`

State machine:

```
idle ──"Start"──▶ awaitingPort ──"Capture"──▶ capturingPort ──5s──▶ portCaptured
   ▲                                                                       │
   │"Discard"                                                               │"Next tack"
   │                                                                       ▼
   └── reviewing ◀──5s── capturingStarboard ◀──"Capture"── awaitingStarboard
              │
              │"Apply"
              ▼
            applied
```

The wizard listens to live `wind.true.calibrated.{angle,speed,direction}` channels via `useSse` + `useChannelHistory`. On Capture, it averages the last 5 s of TWD/TWA/AWS. After both tacks, it calls `computeTackCorrection` and shows the result. Apply PUTs the previewed cal.

- [ ] **Step 1: Implement `TackTestWizard.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import type { AwsAwaCalTable } from '@g5000/db';
import { computeTackCorrection, type TackCapture } from '@g5000/compute';
import { useSse } from '../../../hooks/use-sse.js';
import { useChannelHistory } from '../../../hooks/use-channel-history.js';

const RAD_TO_DEG = 180 / Math.PI;

type WizardState =
  | { kind: 'idle' }
  | { kind: 'awaitingPort' }
  | { kind: 'capturingPort'; startedAt: number }
  | { kind: 'portCaptured'; port: TackCapture }
  | { kind: 'awaitingStarboard'; port: TackCapture }
  | { kind: 'capturingStarboard'; port: TackCapture; startedAt: number }
  | {
      kind: 'reviewing';
      port: TackCapture;
      starboard: TackCapture;
    }
  | { kind: 'applied' };

const CAPTURE_MS = 5000;
const WINDOW_MS = 6000;

export interface TackTestWizardProps {
  cal: AwsAwaCalTable;
  onApply: (updatedCal: AwsAwaCalTable) => void | Promise<void>;
}

export function TackTestWizard({ cal, onApply }: TackTestWizardProps) {
  const { channels } = useSse();
  const twd = useChannelHistory(channels.get('wind.true.calibrated.direction'), WINDOW_MS);
  const twa = useChannelHistory(channels.get('wind.true.calibrated.angle'), WINDOW_MS);
  const tws = useChannelHistory(channels.get('wind.true.calibrated.speed'), WINDOW_MS);
  const aws = useChannelHistory(channels.get('wind.apparent.speed'), WINDOW_MS);
  const awa = useChannelHistory(channels.get('wind.apparent.angle'), WINDOW_MS);

  const [state, setState] = useState<WizardState>({ kind: 'idle' });

  const liveCapture = (): TackCapture | null => {
    const twdAvg = twd.average();
    const twsAvg = tws.average();
    const awaAvg = awa.average();
    const awsAvg = aws.average();
    if (twdAvg === null || twsAvg === null || awaAvg === null || awsAvg === null) {
      return null;
    }
    return { twd: twdAvg, tws: twsAvg, awa: awaAvg, aws: awsAvg };
  };

  const startCapture = (side: 'port' | 'starboard'): void => {
    const now = Date.now();
    if (side === 'port') {
      setState({ kind: 'capturingPort', startedAt: now });
      setTimeout(() => {
        const cap = liveCapture();
        if (cap) setState({ kind: 'portCaptured', port: cap });
        else setState({ kind: 'awaitingPort' }); // ran out of data
      }, CAPTURE_MS);
    } else {
      const port = state.kind === 'awaitingStarboard' ? state.port : null;
      if (!port) return;
      setState({ kind: 'capturingStarboard', port, startedAt: now });
      setTimeout(() => {
        const cap = liveCapture();
        if (cap) setState({ kind: 'reviewing', port, starboard: cap });
        else setState({ kind: 'awaitingStarboard', port });
      }, CAPTURE_MS);
    }
  };

  const result = useMemo(() => {
    if (state.kind !== 'reviewing') return null;
    return computeTackCorrection(cal, state.port, state.starboard);
  }, [state, cal]);

  const handleApply = async (): Promise<void> => {
    if (state.kind !== 'reviewing' || !result) return;
    await onApply(result.previewed);
    setState({ kind: 'applied' });
  };

  const reset = (): void => setState({ kind: 'idle' });

  return (
    <div className="border border-slate-700 rounded p-4 space-y-3">
      <div className="text-lg font-semibold">Tack-test wizard</div>

      {/* Live data */}
      <div className="grid grid-cols-3 gap-2 text-xs font-mono text-slate-300">
        <div>TWD: {twd.latest !== null ? `${(twd.latest * RAD_TO_DEG).toFixed(1)}°` : '—'}</div>
        <div>TWA: {twa.latest !== null ? `${(twa.latest * RAD_TO_DEG).toFixed(1)}°` : '—'}</div>
        <div>TWS: {tws.latest !== null ? `${tws.latest.toFixed(2)} m/s` : '—'}</div>
        <div>AWA: {awa.latest !== null ? `${(awa.latest * RAD_TO_DEG).toFixed(1)}°` : '—'}</div>
        <div>AWS: {aws.latest !== null ? `${aws.latest.toFixed(2)} m/s` : '—'}</div>
      </div>

      {/* State-driven UI */}
      {state.kind === 'idle' && (
        <button
          onClick={() => setState({ kind: 'awaitingPort' })}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
        >
          Start tack test
        </button>
      )}

      {state.kind === 'awaitingPort' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            Sail steady close-hauled on <strong>port tack</strong>. When settled, tap Capture.
          </p>
          <button
            onClick={() => startCapture('port')}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
          >
            Capture port tack
          </button>
        </div>
      )}

      {state.kind === 'capturingPort' && (
        <p className="text-sm text-slate-300">Capturing port tack… (5s)</p>
      )}

      {state.kind === 'portCaptured' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            Port captured: TWD {(state.port.twd * RAD_TO_DEG).toFixed(1)}°, TWS{' '}
            {state.port.tws.toFixed(2)} m/s. Now tack to starboard.
          </p>
          <button
            onClick={() => setState({ kind: 'awaitingStarboard', port: state.port })}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
          >
            Tacked — continue
          </button>
        </div>
      )}

      {state.kind === 'awaitingStarboard' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-300">
            Sail steady close-hauled on <strong>starboard tack</strong>. When settled, tap Capture.
          </p>
          <button
            onClick={() => startCapture('starboard')}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
          >
            Capture starboard tack
          </button>
        </div>
      )}

      {state.kind === 'capturingStarboard' && (
        <p className="text-sm text-slate-300">Capturing starboard tack… (5s)</p>
      )}

      {state.kind === 'reviewing' && result && (
        <div className="space-y-2 text-sm">
          <div className="text-slate-300">
            Port TWD: <span className="font-mono">{(state.port.twd * RAD_TO_DEG).toFixed(1)}°</span>
            <br />
            Starboard TWD:{' '}
            <span className="font-mono">{(state.starboard.twd * RAD_TO_DEG).toFixed(1)}°</span>
            <br />
            Difference:{' '}
            <span className="font-mono">{(result.twdDiff * RAD_TO_DEG).toFixed(2)}°</span>
          </div>
          <div className="text-slate-200">
            Suggested correction at cell (AWS{' '}
            <span className="font-mono">{cal.awsBins[result.cell.awsIdx]!.toFixed(0)}</span>, |AWA|{' '}
            <span className="font-mono">
              {(cal.awaBins[result.cell.awaIdx]! * RAD_TO_DEG).toFixed(0)}°
            </span>
            ): <span className="font-mono">{(result.delta * RAD_TO_DEG).toFixed(2)}°</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApply}
              className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
            >
              Apply
            </button>
            <button onClick={reset} className="px-3 py-1 bg-slate-700 text-slate-200 rounded">
              Discard
            </button>
          </div>
        </div>
      )}

      {state.kind === 'applied' && (
        <div className="space-y-2">
          <p className="text-sm text-green-400">Correction applied.</p>
          <button onClick={reset} className="px-3 py-1 bg-slate-700 text-slate-200 rounded">
            Run another tack test
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck --workspace=@g5000/web
```

Clean.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/calibration/wind/TackTestWizard.tsx
git commit -m "feat(web): TackTestWizard with capture/review/apply state machine"
```

---

## Task 9: `/calibration/wind` page

**Files:**

- Create: `packages/web/src/app/calibration/wind/page.tsx`

The page combines `CalHeatmap`, `CellEditor` (when a cell is selected), and `TackTestWizard`. It loads the current cal table from the API and provides a callback for both editor and wizard to PUT updates back.

- [ ] **Step 1: Implement `page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AwsAwaCalTable } from '@g5000/db';
import { CalHeatmap } from './CalHeatmap.js';
import { CellEditor } from './CellEditor.js';
import { TackTestWizard } from './TackTestWizard.js';

export default function CalibrationWindPage() {
  const [cal, setCal] = useState<AwsAwaCalTable | null>(null);
  const [selected, setSelected] = useState<{ awsIdx: number; awaIdx: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/aws-awa');
      if (!res.ok) {
        setErr(`reload failed: ${res.status}`);
        return;
      }
      const body = (await res.json()) as AwsAwaCalTable;
      setCal(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleApply = async (updated: AwsAwaCalTable): Promise<void> => {
    const res = await fetch('/api/config/aws-awa', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PUT failed: ${res.status} ${body}`);
    }
    await reload();
  };

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">AWS/AWA wind calibration</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {cal && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Calibration grid</h2>
            <CalHeatmap
              cal={cal}
              selected={selected ?? undefined}
              onSelect={(c) => setSelected(c)}
            />
            {selected && <CellEditor cal={cal} cell={selected} onApply={handleApply} />}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Tack test</h2>
            <TackTestWizard cal={cal} onApply={handleApply} />
          </section>
        </>
      )}

      {!cal && !err && <p className="text-slate-400">Loading…</p>}
    </main>
  );
}
```

- [ ] **Step 2: Smoke-test in the browser**

Boot the integrated server:

```
SKIP_BRIDGE=1 npm run dev --workspace=@g5000/autopilot-server > /tmp/cal-wizard.log 2>&1 &
SERVER_PID=$!
sleep 12
curl -s -o /dev/null -w "/calibration/wind: %{http_code}\n" -m 5 http://localhost:3000/calibration/wind
kill $SERVER_PID
```

Expected: 200. Manual visual confirmation: visit `http://localhost:3000/calibration/wind` in a browser, see the cal heatmap with all-zero cells (identity defaults), click a cell, see the editor appear, change the value, click Apply, see the cell color/value update.

- [ ] **Step 3: Typecheck**

```
npm run typecheck --workspace=@g5000/web
```

Clean.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/calibration/wind/page.tsx
git commit -m "feat(web): /calibration/wind page combining heatmap, editor, and wizard"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run full test suite**

```
npm test
```

Expected: ~80 tests pass (Plan 3's 72 + Task 1's ~3 + Task 2's ~5).

- [ ] **Step 2: Typecheck workspace**

```
npx tsc -b
```

Clean.

- [ ] **Step 3: Lint and format**

```
npm run lint
```

If anything is unformatted, run `npm run format` and commit.

- [ ] **Step 4: Manual functional verification (boat-side or sim)**

A reasonable bench-test sequence — does NOT require an NGT-1:

1. Start server with `SKIP_BRIDGE=1` so no live bus traffic.
2. Visit `/calibration/wind`.
3. Heatmap renders with all-zero cells. ✓
4. Click cell (AWS=6, |AWA|=45°). Editor appears. ✓
5. Enter `2.5` (degrees). Click Apply.
6. Heatmap cell color shifts toward blue. Tooltip on cell now reads "cal 2.50°". ✓
7. Verify via `curl http://localhost:3000/api/config/aws-awa | jq '.angleCorrection[2][3]'` → expect ~0.0436 (2.5° in radians).
8. Tack-test wizard: with SKIP_BRIDGE the live data fields show "—" because no samples are flowing. Click Start, click Capture. After 5 s, wizard returns to `awaitingPort` because no data arrived. ✓ (Real-boat or replay-mode testing for full wizard flow.)

If anything visually broken, capture and report.

- [ ] **Step 5: Final commit**

If anything was tweaked during manual testing:

```bash
git add -u
git commit -m "chore: final polish after Plan 4 manual verification"
```

(Skip if nothing changed.)

---

## Closing notes

After this plan:

- Manual cell editing: visit `/calibration/wind`, click cell, enter degrees, apply.
- Tack-test wizard: sail upwind on port, tap Capture, tack, sail steady on starboard, tap Capture, review correction, Apply. The cell is updated and the compute pipeline hot-reloads.
- Plan 3's REST PUT endpoint is now exercised by real UI.

The math has been independently TDD-tested; the UI is manually verified. The first real-boat test of the wizard will be the moment the G5000 starts beating the H5000 in calibration quality (assuming you actually save corrections).

Plan 5 candidates:

- BSP cal page + dockside swing for compass deviation + boat config form (the easy cal rounds — same pattern as this, just 1D tables).
- Polars editor with Expedition CSV import.
- Autopilot decode → shadow mode (the highest-stakes work — needs the existing tooling to capture H5000 → course computer traffic and diff against our shadow).
