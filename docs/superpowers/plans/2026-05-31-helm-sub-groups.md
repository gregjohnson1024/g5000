# Helm Sub-Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the flat `/helm` tile grid into three task-focused tabs (Starting / Navigating / Performance) with a pinned core strip, persisted selection, and a single SSE connection, by decomposing the 440-line `page.tsx` into focused components.

**Architecture:** A thin `page.tsx` shell calls `useSse()` once and `useHelmGroup()`, then renders a pinned `CoreStrip`, a `HelmTabs` segmented control, and exactly one active group component (`StartingGroup` / `NavigatingGroup` / `PerformanceGroup`), passing the `channels` map down as a prop. Pure helpers and group-state logic are extracted into testable modules. UI only — no channels, compute, or APIs change.

**Tech Stack:** Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + TypeScript (strict). Vitest (node env) for the pure-logic tests. SSE via the existing `useSse` hook.

**Spec:** `docs/superpowers/specs/2026-05-31-helm-sub-groups-design.md`

**Conventions:**
- Run one test file: `npx vitest run <path>` from the repo root.
- Typecheck web: `cd packages/web && npx tsc --noEmit`. Prod build: `cd packages/web && npm run build`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- The existing `HelmTile` component (`packages/web/src/app/helm/HelmTile.tsx`) is reused unchanged. `MS_TO_KN`/`RAD_TO_DEG` live in `packages/web/src/lib/units`. `fmtLatDmm`/`fmtLonDmm` live in `packages/web/src/lib/format-coords`.
- `channels` type throughout is `ReadonlyMap<string, JsonSafeSample>` (from `@g5000/core`), as returned by `useSse().channels`.

**File structure:**
- Create `helm/tile-helpers.ts` (+ test) — shared value extractors + formatters.
- Create `helm/helm-group.ts` (+ test) — pure group type + `normalizeGroup`.
- Create `helm/use-helm-group.ts` — localStorage-backed group state hook.
- Create `helm/use-rolling-stats.ts` — `/api/stats/*` polling hook (extracted from page).
- Create `helm/CoreStrip.tsx` — 6 pinned tiles.
- Create `helm/HelmTabs.tsx` — segmented control.
- Create `helm/PositionTile.tsx`, `helm/AlertsPanel.tsx` — extracted from `page.tsx`.
- Create `helm/groups/StartingGroup.tsx`, `NavigatingGroup.tsx`, `PerformanceGroup.tsx`.
- Modify `helm/page.tsx` — slim to a shell.
- Delete `components/RaceTiles.tsx` (helm-only; folded into StartingGroup).

---

### Task 1: Shared tile helpers

**Files:**
- Create: `packages/web/src/app/helm/tile-helpers.ts`
- Test: `packages/web/src/app/helm/tile-helpers.test.ts`

These are extracted verbatim from the current `page.tsx` (and replace the duplicated copies in `RaceTiles.tsx`).

- [ ] **Step 1: Write the failing test** `packages/web/src/app/helm/tile-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { JsonSafeSample } from '@g5000/core';
import { scalar, enumVal, geo, fmtSpeed, fmtAngleSigned, fmtHeadingRad } from './tile-helpers';

const s = (v: JsonSafeSample['value']): JsonSafeSample =>
  ({ channel: 'x', t_ns: '0', value: v, source: 'test' } as unknown as JsonSafeSample);

describe('value extractors', () => {
  it('scalar returns the number only for scalar samples', () => {
    expect(scalar(s({ kind: 'scalar', value: 3.4 }))).toBe(3.4);
    expect(scalar(s({ kind: 'enum', value: 'x' }))).toBeNull();
    expect(scalar(undefined)).toBeNull();
  });
  it('enumVal returns the string only for enum samples', () => {
    expect(enumVal(s({ kind: 'enum', value: 'upwind' }))).toBe('upwind');
    expect(enumVal(s({ kind: 'scalar', value: 1 }))).toBeNull();
  });
  it('geo returns lat/lon only for geo samples', () => {
    expect(geo(s({ kind: 'geo', value: { lat: 1, lon: 2 } }))).toEqual({ lat: 1, lon: 2 });
    expect(geo(s({ kind: 'scalar', value: 1 }))).toBeNull();
  });
});

describe('formatters', () => {
  it('fmtSpeed converts m/s to knots, 1 dp, — when absent', () => {
    expect(fmtSpeed(s({ kind: 'scalar', value: 0.514444 }))).toBe('1.0');
    expect(fmtSpeed(undefined)).toBe('—');
  });
  it('fmtAngleSigned shows signed degrees, — when absent', () => {
    expect(fmtAngleSigned(s({ kind: 'scalar', value: Math.PI / 4 }))).toBe('+45');
    expect(fmtAngleSigned(s({ kind: 'scalar', value: -Math.PI / 4 }))).toBe('-45');
    expect(fmtAngleSigned(undefined)).toBe('—');
  });
  it('fmtHeadingRad normalizes into [0,360) and — for null', () => {
    expect(fmtHeadingRad(0)).toBe('0');
    expect(fmtHeadingRad(-Math.PI / 2)).toBe('270');
    expect(fmtHeadingRad(2 * Math.PI)).toBe('0');
    expect(fmtHeadingRad(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run packages/web/src/app/helm/tile-helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `packages/web/src/app/helm/tile-helpers.ts`:

```ts
import type { JsonSafeSample } from '@g5000/core';
import { MS_TO_KN, RAD_TO_DEG } from '../../lib/units';
import { fmtLatDmm, fmtLonDmm } from '../../lib/format-coords';

export function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

export function enumVal(s: JsonSafeSample | undefined): string | null {
  if (!s || s.value.kind !== 'enum') return null;
  return s.value.value;
}

export function geo(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

export function fmtSpeed(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : `${(v * MS_TO_KN).toFixed(1)}`;
}

export function fmtAngleSigned(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  if (v === null) return '—';
  const deg = v * RAD_TO_DEG;
  const sign = deg >= 0 ? '+' : '';
  return `${sign}${deg.toFixed(0)}`;
}

export function fmtHeading(s: JsonSafeSample | undefined): string {
  return fmtHeadingRad(scalar(s));
}

export function fmtHeadingRad(v: number | null): string {
  if (v === null) return '—';
  let deg = v * RAD_TO_DEG;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return `${deg.toFixed(0)}`;
}

// Marine DMM: `33 42.232n` — integer degrees, decimal minutes, lowercase hemi.
export function fmtLat(lat: number): string {
  const { deg, min, hemi } = fmtLatDmm(lat);
  return `${deg} ${min}${hemi.toLowerCase()}`;
}

export function fmtLon(lon: number): string {
  const { deg, min, hemi } = fmtLonDmm(lon);
  return `${deg} ${min}${hemi.toLowerCase()}`;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run packages/web/src/app/helm/tile-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/helm/tile-helpers.ts packages/web/src/app/helm/tile-helpers.test.ts
git commit -m "feat(helm): shared tile value-extractors and formatters

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Group type + normalize (pure)

**Files:**
- Create: `packages/web/src/app/helm/helm-group.ts`
- Test: `packages/web/src/app/helm/helm-group.test.ts`

- [ ] **Step 1: Write the failing test** `packages/web/src/app/helm/helm-group.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeGroup, DEFAULT_GROUP, HELM_GROUPS, STORAGE_KEY } from './helm-group';

describe('helm-group', () => {
  it('default is navigating and key is stable', () => {
    expect(DEFAULT_GROUP).toBe('navigating');
    expect(STORAGE_KEY).toBe('g5000.helm.group');
    expect(HELM_GROUPS).toEqual(['starting', 'navigating', 'performance']);
  });
  it('passes through each valid group', () => {
    for (const g of HELM_GROUPS) expect(normalizeGroup(g)).toBe(g);
  });
  it('falls back to default for unknown / null / empty', () => {
    expect(normalizeGroup(null)).toBe(DEFAULT_GROUP);
    expect(normalizeGroup(undefined)).toBe(DEFAULT_GROUP);
    expect(normalizeGroup('')).toBe(DEFAULT_GROUP);
    expect(normalizeGroup('nope')).toBe(DEFAULT_GROUP);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run packages/web/src/app/helm/helm-group.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `packages/web/src/app/helm/helm-group.ts`:

```ts
export type HelmGroup = 'starting' | 'navigating' | 'performance';

export const HELM_GROUPS: readonly HelmGroup[] = ['starting', 'navigating', 'performance'];
export const DEFAULT_GROUP: HelmGroup = 'navigating';
export const STORAGE_KEY = 'g5000.helm.group';

export function normalizeGroup(raw: string | null | undefined): HelmGroup {
  return (HELM_GROUPS as readonly string[]).includes(raw ?? '')
    ? (raw as HelmGroup)
    : DEFAULT_GROUP;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx vitest run packages/web/src/app/helm/helm-group.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/helm/helm-group.ts packages/web/src/app/helm/helm-group.test.ts
git commit -m "feat(helm): HelmGroup type + normalizeGroup with default fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Group-state hook + rolling-stats hook

**Files:**
- Create: `packages/web/src/app/helm/use-helm-group.ts`
- Create: `packages/web/src/app/helm/use-rolling-stats.ts`

`use-rolling-stats.ts` is the `/api/stats/*` polling block moved verbatim out of the current `page.tsx` (the `avgSog`/`avgCog`/`avgHdg`/`motion` state + the 2 s `useEffect` poller), exposed as a hook.

- [ ] **Step 1: Implement `use-helm-group.ts`**

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { normalizeGroup, DEFAULT_GROUP, STORAGE_KEY, type HelmGroup } from './helm-group';

/**
 * Persisted active helm group. SSR renders DEFAULT_GROUP, then hydrates to the
 * stored value in an effect (guarded for `window`), so `next build`/SSR never
 * touches localStorage during render.
 */
export function useHelmGroup(): [HelmGroup, (g: HelmGroup) => void] {
  const [group, setGroupState] = useState<HelmGroup>(DEFAULT_GROUP);

  useEffect(() => {
    try {
      setGroupState(normalizeGroup(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, []);

  const setGroup = useCallback((g: HelmGroup) => {
    setGroupState(g);
    try {
      window.localStorage.setItem(STORAGE_KEY, g);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  return [group, setGroup];
}
```

Note: import is `useCallback`, not `useCallBack` — verify the casing.

- [ ] **Step 2: Implement `use-rolling-stats.ts`** (move the stats state + poller out of `page.tsx`):

```ts
'use client';

import { useEffect, useState } from 'react';

export interface RollingAvg {
  ms: number;
  coveredMs: number;
  windowMs: number;
}
export interface RollingAngle {
  rad: number;
  concentration: number;
  coveredMs: number;
  windowMs: number;
}
export interface RollingMotion {
  heelRmsRad: number | null;
  pitchRmsRad: number | null;
  combinedRmsRad: number | null;
  coveredMs: number;
  windowMs: number;
}
export interface RollingStats {
  avgSog: RollingAvg | null;
  avgCog: RollingAngle | null;
  avgHdg: RollingAngle | null;
  motion: RollingMotion | null;
}

/** Polls /api/stats/{sog,cog,hdg,motion} every 2 s. Server owns the buffers,
 *  so unmount/remount (tab switch) doesn't reset the averages. */
export function useRollingStats(): RollingStats {
  const [avgSog, setAvgSog] = useState<RollingAvg | null>(null);
  const [avgCog, setAvgCog] = useState<RollingAngle | null>(null);
  const [avgHdg, setAvgHdg] = useState<RollingAngle | null>(null);
  const [motion, setMotion] = useState<RollingMotion | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const [sogR, cogR, hdgR, motionR] = await Promise.all([
          fetch('/api/stats/sog', { cache: 'no-store' }),
          fetch('/api/stats/cog', { cache: 'no-store' }),
          fetch('/api/stats/hdg', { cache: 'no-store' }),
          fetch('/api/stats/motion', { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        if (sogR.ok) {
          const j = (await sogR.json()) as {
            ok: boolean;
            stats?: { avgMs: number | null; coveredMs: number; windowMs: number };
          };
          if (j.ok && j.stats && j.stats.avgMs !== null) {
            setAvgSog({ ms: j.stats.avgMs, coveredMs: j.stats.coveredMs, windowMs: j.stats.windowMs });
          }
        }
        if (cogR.ok) {
          const j = (await cogR.json()) as {
            ok: boolean;
            stats?: { avgRad: number | null; concentration: number; coveredMs: number; windowMs: number };
          };
          if (j.ok && j.stats && j.stats.avgRad !== null) {
            setAvgCog({ rad: j.stats.avgRad, concentration: j.stats.concentration, coveredMs: j.stats.coveredMs, windowMs: j.stats.windowMs });
          }
        }
        if (hdgR.ok) {
          const j = (await hdgR.json()) as {
            ok: boolean;
            stats?: { avgRad: number | null; concentration: number; coveredMs: number; windowMs: number };
          };
          if (j.ok && j.stats && j.stats.avgRad !== null) {
            setAvgHdg({ rad: j.stats.avgRad, concentration: j.stats.concentration, coveredMs: j.stats.coveredMs, windowMs: j.stats.windowMs });
          }
        }
        if (motionR.ok) {
          const j = (await motionR.json()) as {
            ok: boolean;
            stats?: { heelRmsRad: number | null; pitchRmsRad: number | null; combinedRmsRad: number | null; coveredMs: number; windowMs: number };
          };
          if (j.ok && j.stats) {
            setMotion({
              heelRmsRad: j.stats.heelRmsRad,
              pitchRmsRad: j.stats.pitchRmsRad,
              combinedRmsRad: j.stats.combinedRmsRad,
              coveredMs: j.stats.coveredMs,
              windowMs: j.stats.windowMs,
            });
          }
        }
      } catch {
        /* next tick retries */
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { avgSog, avgCog, avgHdg, motion };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: passes (these are standalone; nothing imports them yet, so this just confirms they compile).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/helm/use-helm-group.ts packages/web/src/app/helm/use-rolling-stats.ts
git commit -m "feat(helm): useHelmGroup (persisted) + useRollingStats hooks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CoreStrip + HelmTabs

**Files:**
- Create: `packages/web/src/app/helm/CoreStrip.tsx`
- Create: `packages/web/src/app/helm/HelmTabs.tsx`

- [ ] **Step 1: Implement `CoreStrip.tsx`** (HDG/COG logic mirrors today's `page.tsx`):

```tsx
'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from './HelmTile';
import { scalar, fmtSpeed, fmtHeading, fmtHeadingRad } from './tile-helpers';

/** The six pinned tiles shown on every helm group. */
export function CoreStrip({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const sog = channels.get('nav.gps.sog');
  const depth = channels.get('nav.depth');
  const tws = channels.get('wind.true.speed');
  const twd = channels.get('wind.true.direction');

  const cogTrue = channels.get('nav.gps.cog');
  const cogMag = channels.get('nav.gps.cog.magnetic');
  const cog = cogTrue ?? cogMag;
  const cogRef = cogTrue ? 'T' : cogMag ? 'M' : null;

  const hdgTrueRad = scalar(channels.get('boat.heading.true'));
  const hdgMagRad = scalar(channels.get('boat.heading.magnetic'));
  const magVarRad = scalar(channels.get('nav.magvar'));
  let hdgValueRad: number | null = null;
  let hdgRef: 'T' | 'M' | null = null;
  if (hdgTrueRad !== null) {
    hdgValueRad = hdgTrueRad;
    hdgRef = 'T';
  } else if (hdgMagRad !== null && magVarRad !== null) {
    hdgValueRad = hdgMagRad + magVarRad;
    hdgRef = 'T';
  } else if (hdgMagRad !== null) {
    hdgValueRad = hdgMagRad;
    hdgRef = 'M';
  }

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-3">
      <HelmTile label="SOG" value={fmtSpeed(sog)} unit="kn" small />
      <HelmTile label="HDG" value={fmtHeadingRad(hdgValueRad)} unit="°" sub={hdgRef ?? undefined} small />
      <HelmTile label="COG" value={fmtHeading(cog)} unit="°" sub={cogRef ?? undefined} small />
      <HelmTile label="Depth" value={fmtSpeedlessDepth(depth)} unit="m" small />
      <HelmTile label="TWS" value={fmtSpeed(tws)} unit="kn" small />
      <HelmTile label="TWD" value={fmtHeading(twd)} unit="°" small />
    </div>
  );
}

// Depth is published in metres as a plain scalar — show 1 dp, — when absent.
function fmtSpeedlessDepth(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : v.toFixed(1);
}
```

- [ ] **Step 2: Implement `HelmTabs.tsx`**:

```tsx
'use client';

import { HELM_GROUPS, type HelmGroup } from './helm-group';

const LABEL: Record<HelmGroup, string> = {
  starting: 'Starting',
  navigating: 'Navigating',
  performance: 'Performance',
};

/** Full-width segmented control; large touch targets for helm use. */
export function HelmTabs({
  group,
  onChange,
}: {
  group: HelmGroup;
  onChange: (g: HelmGroup) => void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-3 gap-1 mb-3 bg-slate-900 border border-slate-800 rounded p-1">
      {HELM_GROUPS.map((g) => {
        const active = g === group;
        return (
          <button
            key={g}
            type="button"
            onClick={() => onChange(g)}
            aria-pressed={active}
            className={`py-3 rounded text-sm font-semibold uppercase tracking-wide transition-colors ${
              active ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
            }`}
          >
            {LABEL[g]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/helm/CoreStrip.tsx packages/web/src/app/helm/HelmTabs.tsx
git commit -m "feat(helm): pinned CoreStrip + segmented HelmTabs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Extract PositionTile + AlertsPanel

**Files:**
- Create: `packages/web/src/app/helm/PositionTile.tsx`
- Create: `packages/web/src/app/helm/AlertsPanel.tsx`

Move these two components out of `page.tsx` **verbatim** (same logic), into their own files with exports. They are currently defined at the bottom of `page.tsx`.

- [ ] **Step 1: Create `PositionTile.tsx`** — cut the `PositionTile` function from `page.tsx` (the one taking `{ positionLat, positionLon }`), add `'use client';` and the needed imports (`useCallback, useEffect, useRef, useState` from react). Export it: `export function PositionTile({ positionLat, positionLon }: { positionLat: string | null; positionLon: string | null }): React.ReactElement`. Keep its body (the copy-button logic) exactly as-is.

- [ ] **Step 2: Create `AlertsPanel.tsx`** — cut the `AlertsPanel` function and its module-private helpers `AlertSnapshot` (interface) and `ALERT_TYPE_STYLE` (const) from `page.tsx` into this file. Add `'use client';` and imports (`useEffect, useState, type ReactElement`). Export: `export function AlertsPanel(): ReactElement | null`. Keep the `/api/alerts` polling and acknowledge logic exactly as-is.

- [ ] **Step 3: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: `page.tsx` will now have unused/duplicate definitions until Task 9 — that's expected. This step only needs the TWO NEW files to compile. If `tsc --noEmit` errors solely due to `page.tsx` still containing its own copies (duplicate identifiers), that is acceptable at this stage; do NOT edit `page.tsx` yet (Task 9 rewrites it). If you prefer a clean intermediate, you may delete the now-extracted `PositionTile`/`AlertsPanel`/`AlertSnapshot`/`ALERT_TYPE_STYLE` definitions from `page.tsx` and add imports — but Task 9 replaces `page.tsx` wholesale, so leaving it is fine. Note which you did.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/app/helm/PositionTile.tsx packages/web/src/app/helm/AlertsPanel.tsx
git commit -m "refactor(helm): extract PositionTile and AlertsPanel into own files

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: StartingGroup (absorbs RaceTiles)

**Files:**
- Create: `packages/web/src/app/helm/groups/StartingGroup.tsx`

Contains the start-line live readouts. Replaces `components/RaceTiles.tsx` (deleted in Task 9). `bias`/`windShift.bias` are radians; `DTL`/`TTL` are metres/seconds.

- [ ] **Step 1: Implement** `packages/web/src/app/helm/groups/StartingGroup.tsx`:

```tsx
'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from '../HelmTile';
import { RaceMiniTimer } from '../RaceMiniTimer';
import { scalar, enumVal } from '../tile-helpers';
import { RAD_TO_DEG } from '../../../lib/units';

/** Starting tab: pre-start line work + timer. */
export function StartingGroup({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const dtl = scalar(channels.get('race.line.distanceToLine'));
  const ttl = scalar(channels.get('race.line.timeToLine'));
  const bias = scalar(channels.get('race.line.bias'));
  const ocs = enumVal(channels.get('race.line.ocsPredicted'));
  const shift = scalar(channels.get('race.windShift.bias'));

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div className="col-span-2 md:col-span-3">
        <RaceMiniTimer />
      </div>
      <HelmTile
        label="DTL"
        value={dtl === null ? '—' : Math.abs(dtl).toFixed(0)}
        unit="m"
        sub={dtl === null ? undefined : dtl >= 0 ? 'pre-start' : 'past line'}
      />
      <HelmTile label="TTL" value={ttl === null ? '—' : Math.round(ttl).toString()} unit="s" />
      <HelmTile
        label="Bias"
        value={bias === null ? '—' : `${bias >= 0 ? '+' : ''}${(bias * RAD_TO_DEG).toFixed(0)}`}
        unit="°"
        sub={bias === null ? undefined : bias > 0 ? 'port favored' : bias < 0 ? 'stbd favored' : 'square'}
      />
      <HelmTile
        label="OCS"
        value={ocs ?? '—'}
        sub={ocs === 'OCS' ? 'over early!' : ocs === 'OK' ? 'clear' : undefined}
      />
      <HelmTile
        label="Wind shift"
        value={shift === null ? '—' : `${shift >= 0 ? '+' : ''}${(shift * RAD_TO_DEG).toFixed(0)}`}
        unit="°"
        sub={shift === null ? undefined : shift > 0 ? 'veer (right)' : shift < 0 ? 'back (left)' : 'steady'}
      />
    </div>
  );
}
```

Note: verify `RaceMiniTimer` is exported from `packages/web/src/app/helm/RaceMiniTimer.tsx` as a named export `RaceMiniTimer` (it is imported that way in the current `page.tsx`). If it's a default export, adjust the import accordingly.

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: the new file compiles (ignore pre-existing `page.tsx` duplicate-identifier noise from Task 5 if you left it).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/helm/groups/StartingGroup.tsx
git commit -m "feat(helm): StartingGroup (DTL/TTL/Bias/OCS/wind-shift + timer)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: NavigatingGroup

**Files:**
- Create: `packages/web/src/app/helm/groups/NavigatingGroup.tsx`

Position, VMC to mark, the three 15-min averages, Drift (COG−HDG), and Motion. Uses `useRollingStats()` and `PositionTile`. The avg/drift/motion tile JSX is moved from today's `page.tsx`.

- [ ] **Step 1: Implement** `packages/web/src/app/helm/groups/NavigatingGroup.tsx`:

```tsx
'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from '../HelmTile';
import { PositionTile } from '../PositionTile';
import { useRollingStats } from '../use-rolling-stats';
import { scalar, geo, fmtHeadingRad, fmtLat, fmtLon } from '../tile-helpers';
import { MS_TO_KN } from '../../../lib/units';

/** Navigating tab: position, made-good, course averages, drift, sea-state. */
export function NavigatingGroup({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const { avgSog, avgCog, avgHdg, motion } = useRollingStats();
  const vmcMs = scalar(channels.get('race.vmc'));
  const position = geo(channels.get('nav.gps.position'));
  const positionLat = position ? fmtLat(position.lat) : null;
  const positionLon = position ? fmtLon(position.lon) : null;

  let driftDeg: number | null = null;
  if (avgCog && avgHdg) {
    let d = avgCog.rad - avgHdg.rad;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    driftDeg = (d * 180) / Math.PI;
  }

  const sub = (a: { coveredMs: number; windowMs: number } | null): string =>
    a
      ? a.coveredMs >= a.windowMs - 1000
        ? `${Math.round(a.windowMs / 60000)} min`
        : `${Math.max(1, Math.round(a.coveredMs / 60000))} min so far`
      : '15 min';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <PositionTile positionLat={positionLat} positionLon={positionLon} />
      <HelmTile
        label="VMC"
        value={vmcMs === null ? '—' : (vmcMs * MS_TO_KN).toFixed(1)}
        unit="kn"
        sub={vmcMs === null ? 'no mark' : vmcMs >= 0 ? 'closing' : 'opening'}
      />
      <HelmTile label="Avg SOG" value={avgSog ? (avgSog.ms * MS_TO_KN).toFixed(1) : '—'} unit="kn" sub={sub(avgSog)} small />
      <HelmTile label="Avg COG" value={avgCog ? fmtHeadingRad(avgCog.rad) : '—'} unit="°" sub={sub(avgCog)} small />
      <HelmTile label="Avg HDG" value={avgHdg ? fmtHeadingRad(avgHdg.rad) : '—'} unit="°" sub={sub(avgHdg)} small />
      <HelmTile
        label="Drift (COG−HDG)"
        value={driftDeg === null ? '—' : `${driftDeg >= 0 ? '+' : ''}${driftDeg.toFixed(1)}`}
        unit="°"
        sub={driftDeg === null ? '15 min' : driftDeg >= 0 ? 'set stbd' : 'set port'}
        small
      />
      <HelmTile
        label="Motion"
        value={
          motion?.combinedRmsRad !== null && motion?.combinedRmsRad !== undefined
            ? ((motion.combinedRmsRad * 180) / Math.PI).toFixed(1)
            : '—'
        }
        unit="°"
        sub={
          motion?.heelRmsRad !== null &&
          motion?.heelRmsRad !== undefined &&
          motion?.pitchRmsRad !== null &&
          motion?.pitchRmsRad !== undefined
            ? `h ${((motion.heelRmsRad * 180) / Math.PI).toFixed(1)}° p ${((motion.pitchRmsRad * 180) / Math.PI).toFixed(1)}°`
            : '15 min'
        }
        small
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: new file compiles.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/helm/groups/NavigatingGroup.tsx
git commit -m "feat(helm): NavigatingGroup (position, VMC, 15-min avgs, drift, motion)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: PerformanceGroup

**Files:**
- Create: `packages/web/src/app/helm/groups/PerformanceGroup.tsx`

Wind (TWA/AWS/AWA — **not** TWS, which is in the core strip), polar targets, the groove cluster, heel/pitch, sail recommendation. JSX moved from today's `page.tsx`.

- [ ] **Step 1: Implement** `packages/web/src/app/helm/groups/PerformanceGroup.tsx`:

```tsx
'use client';

import type { JsonSafeSample } from '@g5000/core';
import { HelmTile } from '../HelmTile';
import { SailRecommendationTile } from '../SailRecommendationTile';
import { scalar, enumVal, fmtSpeed, fmtAngleSigned } from '../tile-helpers';
import { RAD_TO_DEG } from '../../../lib/units';

/** Performance tab: wind, polar targets, groove, trim, sail recommendation. */
export function PerformanceGroup({
  channels,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
}): React.ReactElement {
  const twa = channels.get('wind.true.angle');
  const awa = channels.get('wind.apparent.angle');
  const aws = channels.get('wind.apparent.speed');
  const tbsSample = channels.get('race.targetSpeed');
  const tTwaSample = channels.get('race.targetTwa');
  const pctPolar = scalar(channels.get('race.percentPolar'));
  const heel = channels.get('motion.heel');
  const pitch = channels.get('motion.pitch');

  const timeInGroove = scalar(channels.get('groove.timeInGroove'));
  const vmgEff = scalar(channels.get('groove.vmgEfficiency'));
  const twaSteadiness = scalar(channels.get('groove.twaSteadiness'));
  const steeringEffort = scalar(channels.get('groove.steeringEffort'));
  const helmSource = enumVal(channels.get('groove.helmSource'));
  const pointOfSail = enumVal(channels.get('groove.pointOfSail'));

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {twa && <HelmTile label="TWA" value={fmtAngleSigned(twa)} unit="°" />}
      {aws && <HelmTile label="AWS" value={fmtSpeed(aws)} unit="kn" small />}
      {awa && <HelmTile label="AWA" value={fmtAngleSigned(awa)} unit="°" small />}
      {tbsSample && <HelmTile label="TBS" value={fmtSpeed(tbsSample)} unit="kn" small />}
      {tTwaSample && <HelmTile label="Target TWA" value={fmtAngleSigned(tTwaSample)} unit="°" small />}
      {pctPolar !== null && <HelmTile label="% polar" value={pctPolar.toFixed(0)} unit="%" small />}

      <HelmTile
        label="In groove"
        value={timeInGroove === null ? '—' : timeInGroove.toFixed(0)}
        unit={timeInGroove === null ? undefined : '%'}
        severity={timeInGroove === null ? 'neutral' : timeInGroove >= 80 ? 'good' : timeInGroove >= 50 ? 'ok' : 'bad'}
        sub={pointOfSail ?? undefined}
      />
      <HelmTile
        label="VMG eff"
        value={vmgEff === null ? '—' : vmgEff.toFixed(0)}
        unit={vmgEff === null ? undefined : '%'}
        severity={vmgEff === null ? 'neutral' : vmgEff >= 98 ? 'good' : vmgEff >= 90 ? 'ok' : 'bad'}
      />
      <HelmTile
        label={helmSource === 'autopilot' ? 'Pilot activity' : 'Helm steadiness'}
        value={twaSteadiness === null ? '—' : (twaSteadiness * RAD_TO_DEG).toFixed(1)}
        unit={twaSteadiness === null ? undefined : '°'}
        severity="neutral"
        small
      >
        {steeringEffort !== null && (
          <div className="text-xs text-slate-500">{steeringEffort.toFixed(1)} corr·min⁻¹</div>
        )}
      </HelmTile>

      <HelmTile label="Heel" value={fmtAngleSigned(heel)} unit="°" small />
      <HelmTile label="Pitch" value={fmtAngleSigned(pitch)} unit="°" small />
      <SailRecommendationTile />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd packages/web && npx tsc --noEmit`
Expected: new file compiles.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/helm/groups/PerformanceGroup.tsx
git commit -m "feat(helm): PerformanceGroup (wind, polar, groove, trim, sail rec)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Slim page.tsx to a shell + delete RaceTiles

**Files:**
- Modify (replace whole file): `packages/web/src/app/helm/page.tsx`
- Delete: `packages/web/src/components/RaceTiles.tsx`

- [ ] **Step 1: Replace `page.tsx` entirely** with the shell:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SailWardrobe } from '@g5000/db';
import { useSse } from '../../hooks/use-sse';
import { MobButton } from './MobButton';
import { AudibleAlarm } from '../../components/AudibleAlarm';
import { AnnotationDropper } from '../../components/AnnotationDropper';
import { RaceMiniTimer } from './RaceMiniTimer';
import { AlertsPanel } from './AlertsPanel';
import { CoreStrip } from './CoreStrip';
import { HelmTabs } from './HelmTabs';
import { useHelmGroup } from './use-helm-group';
import { StartingGroup } from './groups/StartingGroup';
import { NavigatingGroup } from './groups/NavigatingGroup';
import { PerformanceGroup } from './groups/PerformanceGroup';

export default function HelmPage(): React.ReactElement {
  const { channels, connected } = useSse();
  const [group, setGroup] = useHelmGroup();
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);

  const reloadWardrobe = useCallback(async () => {
    try {
      const r = await fetch('/api/sails', { cache: 'no-store' });
      if (!r.ok) return;
      setWardrobe((await r.json()) as SailWardrobe);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    void reloadWardrobe();
  }, [reloadWardrobe]);

  return (
    <main className="p-4 flex-1 overflow-y-auto bg-black relative">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-300">Helm</h1>
        <div className="flex items-center gap-3">
          <RaceMiniTimer />
          <div className="text-xs text-slate-500">{connected ? 'Live' : 'Reconnecting…'}</div>
        </div>
      </div>

      <AlertsPanel />

      {wardrobe && (
        <div className="flex items-center gap-3 mb-3 text-sm bg-slate-900 border border-slate-800 rounded px-3 py-2">
          <span className="text-slate-400">Sails:</span>
          {(['headsail', 'main', 'downwind'] as const).map((cat) => {
            const activeId = wardrobe.active[cat];
            const sail = activeId ? wardrobe.sails.find((s) => s.id === activeId) : undefined;
            return (
              <span key={cat} className="text-xs text-slate-300">
                <span className="text-slate-500">{cat}:</span>{' '}
                <span className="text-slate-200">{sail?.name ?? '—'}</span>
              </span>
            );
          })}
          <a href="/sails" className="text-xs text-slate-500 hover:text-slate-300 underline">
            manage
          </a>
        </div>
      )}

      <CoreStrip channels={channels} />
      <HelmTabs group={group} onChange={setGroup} />

      {group === 'starting' && <StartingGroup channels={channels} />}
      {group === 'navigating' && <NavigatingGroup channels={channels} />}
      {group === 'performance' && <PerformanceGroup channels={channels} />}

      <MobButton />
      <AudibleAlarm />
      <div className="absolute top-2 right-2 z-20">
        <AnnotationDropper variant="icon" />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Delete RaceTiles**

Run: `git rm packages/web/src/components/RaceTiles.tsx`
Then verify nothing else imports it: `grep -rn "RaceTiles" packages/web/src` — expected: no matches (it was helm-only). If anything still imports it, STOP and report.

- [ ] **Step 3: Typecheck (must be fully clean now)**

Run: `cd packages/web && npx tsc --noEmit`
Expected: PASS with zero errors (all extracted definitions now live in their own files; `page.tsx` no longer duplicates them).

- [ ] **Step 4: Production build**

Run: `cd packages/web && npm run build`
Expected: `next build` completes and the route manifest includes `/helm`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/helm/page.tsx
git rm --cached packages/web/src/components/RaceTiles.tsx 2>/dev/null || true
git commit -m "refactor(helm): slim page.tsx to a shell; tabs + core strip; drop RaceTiles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Segmented tabs (Starting/Navigating/Performance) → Task 4 (HelmTabs) + Task 9 (page shell renders one group). ✅
- Pinned core strip SOG/HDG/COG/Depth/TWS/TWD → Task 4 (CoreStrip). ✅
- Persisted group, default navigating, SSR-safe → Task 2 (normalizeGroup) + Task 3 (useHelmGroup). ✅
- One SSE connection → Task 9 (single `useSse()` in shell; `channels` passed as prop; RaceTiles deleted). ✅
- Tab assignment: Starting → Task 6; Navigating → Task 7; Performance → Task 8. TWS not duplicated in Performance (Task 8 omits it). VMC in Navigating (Task 7). Wind-shift in Starting (Task 6). Motion in Navigating (Task 7); Heel/Pitch in Performance (Task 8). ✅
- Always-on alerts/MOB/annotation/header timer + sails strip → Task 9 shell. ✅
- Decomposition / extracted AlertsPanel + PositionTile + helpers → Tasks 1, 5. ✅
- Testing: pure helpers + normalizeGroup unit-tested → Tasks 1, 2; JSX via tsc + next build → Tasks 4–9. ✅
- Timer = reuse RaceMiniTimer (resolved open question) → Task 6 + header. ✅

**Placeholder scan:** Task 5 uses prose ("cut … verbatim") rather than re-pasting the two components — deliberate, because they move unchanged and re-pasting ~120 lines invites transcription drift; the source location and exact export signatures are specified. All genuinely new code is shown in full.

**Type consistency:** `HelmGroup` (Task 2) used by Tasks 3/4/9. `normalizeGroup`/`STORAGE_KEY`/`DEFAULT_GROUP` consistent (Tasks 2/3). `scalar/enumVal/geo/fmtSpeed/fmtAngleSigned/fmtHeading/fmtHeadingRad/fmtLat/fmtLon` defined once (Task 1), imported by Tasks 4/6/7/8. `useRollingStats` return shape (Task 3) consumed by Task 7. Every group component signature is `({ channels }: { channels: ReadonlyMap<string, JsonSafeSample> })`, matching the shell's `channels={channels}` (Task 9).
