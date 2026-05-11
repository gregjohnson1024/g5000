# G5000 Plan 10 — Helm Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** A `/helm` page suitable for a tablet or phone at the wheel. Big-number layout of the key sailing numbers, color-coded `%polar` indicator, live SSE updates. No backend changes — pure UI on top of channels we already publish.

**Architecture:** One reusable `<HelmTile>` component (label + big value + unit + optional color band) plus the `/helm` page that lays out tiles in a responsive grid and feeds them from `useSse`. Existing hook, existing channels, existing data path — only thing new is the page.

**Tech stack additions:** none.

---

## Files

```
autopilot/
└── packages/
    └── web/
        └── src/app/
            └── helm/
                ├── page.tsx                          NEW
                └── HelmTile.tsx                      NEW
```

---

## Task 1: `HelmTile` component

**File:** `packages/web/src/app/helm/HelmTile.tsx`

A label-over-big-number tile with optional color band derived from a numeric value (used for %polar). Tailwind-styled for sunlight contrast (high-contrast white-on-black + accent colors).

```tsx
'use client';

import type { ReactNode } from 'react';

export interface HelmTileProps {
  label: string;
  value: string;
  unit?: string;
  /**
   * Optional severity for color-coding (used for %polar):
   *   - 'good' green
   *   - 'ok' amber
   *   - 'bad' red
   *   - 'neutral' (default) white
   */
  severity?: 'good' | 'ok' | 'bad' | 'neutral';
  /** Optional sub-label (e.g. "target" suffix). */
  sub?: string;
  /** When true, render in a smaller size — for less-critical numbers. */
  small?: boolean;
  /** Extra content rendered below the value, typically tiny labels or age. */
  children?: ReactNode;
}

export function HelmTile({
  label,
  value,
  unit,
  severity = 'neutral',
  sub,
  small,
  children,
}: HelmTileProps) {
  const colorByMode: Record<NonNullable<HelmTileProps['severity']>, string> = {
    good: 'text-green-300',
    ok: 'text-amber-300',
    bad: 'text-red-300',
    neutral: 'text-slate-100',
  };
  const valueSize = small ? 'text-4xl' : 'text-6xl';
  const labelSize = small ? 'text-xs' : 'text-sm';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-4 flex flex-col gap-1">
      <div
        className={`${labelSize} uppercase tracking-wider text-slate-400 flex items-baseline gap-2`}
      >
        <span>{label}</span>
        {sub && <span className="text-slate-600 text-xs normal-case">({sub})</span>}
      </div>
      <div className={`${valueSize} font-mono ${colorByMode[severity]}`}>
        {value}
        {unit && <span className="text-2xl text-slate-500 ml-2">{unit}</span>}
      </div>
      {children}
    </div>
  );
}
```

### Step 1: Create the file

### Step 2: Typecheck

### Step 3: Commit

```bash
git add packages/web/src/app/helm/HelmTile.tsx
git commit -m "feat(web): HelmTile component for big-number sailing display"
```

---

## Task 2: `/helm` page

**File:** `packages/web/src/app/helm/page.tsx`

Subscribes to `useSse` and renders a responsive grid of tiles. Layout:

- Row 1: wind (TWS large, TWA large, AWA small)
- Row 2: boat (BSP large, target speed large, %polar large with color)
- Row 3: VMG (current VMG, target VMG, heading)
- Row 4 (small): heel, pitch, rate of turn

```tsx
'use client';

import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';
import { HelmTile } from './HelmTile';

const MS_TO_KNOTS = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

function fmtSpeed(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : `${(v * MS_TO_KNOTS).toFixed(1)}`;
}

function fmtAngleSigned(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  if (v === null) return '—';
  const deg = v * RAD_TO_DEG;
  const sign = deg >= 0 ? '+' : '';
  return `${sign}${deg.toFixed(0)}`;
}

function fmtHeading(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  if (v === null) return '—';
  let deg = v * RAD_TO_DEG;
  while (deg < 0) deg += 360;
  while (deg >= 360) deg -= 360;
  return `${deg.toFixed(0)}`;
}

function fmtPercent(s: JsonSafeSample | undefined): string {
  const v = scalar(s);
  return v === null ? '—' : `${v.toFixed(0)}`;
}

function percentSeverity(s: JsonSafeSample | undefined): 'good' | 'ok' | 'bad' | 'neutral' {
  const v = scalar(s);
  if (v === null) return 'neutral';
  if (v >= 95) return 'good';
  if (v >= 80) return 'ok';
  return 'bad';
}

export default function HelmPage() {
  const { channels, connected } = useSse();

  const tws = channels.get('wind.true.calibrated.speed');
  const twa = channels.get('wind.true.calibrated.angle');
  const awa = channels.get('wind.apparent.angle');
  const bsp = channels.get('boat.speed.water');
  const targetSpeed = channels.get('performance.target.boatSpeed');
  const percentPolar = channels.get('performance.percentPolar');
  const vmg = channels.get('performance.vmg');
  const targetVmg = channels.get('performance.target.vmg');
  const hdg = channels.get('boat.heading.magnetic');
  const heel = channels.get('motion.heel');
  const pitch = channels.get('motion.pitch');
  const rot = channels.get('motion.rateOfTurn');

  return (
    <main className="p-4 min-h-screen bg-black">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-300">Helm</h1>
        <div className="text-xs text-slate-500">{connected ? 'Live' : 'Reconnecting…'}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <HelmTile label="TWS" value={fmtSpeed(tws)} unit="kn" />
        <HelmTile label="TWA" value={fmtAngleSigned(twa)} unit="°" />
        <HelmTile label="AWA" value={fmtAngleSigned(awa)} unit="°" small />

        <HelmTile label="BSP" value={fmtSpeed(bsp)} unit="kn" />
        <HelmTile label="Target speed" value={fmtSpeed(targetSpeed)} unit="kn" sub="polar" />
        <HelmTile
          label="% polar"
          value={fmtPercent(percentPolar)}
          unit="%"
          severity={percentSeverity(percentPolar)}
        />

        <HelmTile label="VMG" value={fmtSpeed(vmg)} unit="kn" />
        <HelmTile label="Target VMG" value={fmtSpeed(targetVmg)} unit="kn" sub="polar" />
        <HelmTile label="Heading" value={fmtHeading(hdg)} unit="°" />

        <HelmTile label="Heel" value={fmtAngleSigned(heel)} unit="°" small />
        <HelmTile label="Pitch" value={fmtAngleSigned(pitch)} unit="°" small />
        <HelmTile label="Rate of turn" value={fmtAngleSigned(rot)} unit="°/s" small />
      </div>
    </main>
  );
}
```

### Step 1: Create the file

### Step 2: Typecheck (`npm run typecheck --workspace=@g5000/web`)

### Step 3: Commit

```bash
git add packages/web/src/app/helm/page.tsx
git commit -m "feat(web): /helm dashboard page with big-number sailing tiles"
```

---

## Task 3: Final verification + merge

- [ ] **`npm test`** (expect 121 — no new tests added)
- [ ] **`npx tsc -b`** (clean)
- [ ] **`npm run lint`** → `npm run format` if needed → commit
- [ ] **Smoke test**: `SKIP_BRIDGE=1` server, `curl /helm` → 200, manual visual check at `http://localhost:3000/helm` shows the grid layout (all values "—" since no traffic)
- [ ] **Merge** to main

---

## Closing notes

After this plan, `http://localhost:3000/helm` is the daily-use page at the wheel. With real boat data, you'll see live wind, boat speed, target speed, %polar (red/amber/green), VMG, heading, heel/pitch/rate-of-turn. Designed responsive — usable on phone, tablet, or pulled-up laptop.

This is the natural Phase 0a stopping point for the field test. Future plans (after the field test validates the stack):

- Plan 11: B&G proprietary autopilot PGNs decoded (now that we'd have captured frames to verify against)
- Plan 12: Shadow-mode diff tool
- Plan 13: Polar plot visualization (radial diagram)
- Plan 14: Capture wizards for BSP / compass deviation
- Plan 15: Engagement UI for going-live with our own autopilot output
