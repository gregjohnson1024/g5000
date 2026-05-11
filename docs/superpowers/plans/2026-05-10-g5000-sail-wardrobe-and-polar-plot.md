# G5000 Plan 11 — Sail Wardrobe + Live Polar Plot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Three intertwined things the user asked for:
1. **Sail wardrobe** — replace the single global polar with a collection of named sail configurations ("Full main + J1", "Reef 1 + A2", etc.), each with its own polar table.
2. **Active-config selection** — UI to choose which sails are currently set; the active config's polar drives the live performance pipeline.
3. **Live polar plot** — SVG radial diagram showing the polar curves with the current operating point overlaid. Updates live via SSE.

**Architecture:**
- Replace the `polars` SQLite singleton with a `sail_wardrobe` row holding `SailWardrobe = { configs: SailConfig[], activeConfigId: string }`. Each `SailConfig` carries its own `PolarTable` plus metadata (name, optional mainState/headsail/downwind notes).
- ConfigStore gains a `sails$` observable and a derived `activePolar$` observable. Bumps the existing `polars$` getter to be backed by `activePolar$` for API compatibility.
- The polar performance pipeline (no code change in math; just point at `activePolar$` instead of `polars$`).
- REST: GET / PUT `/api/sails` for the full wardrobe; POST `/api/sails/import` (with `?configId=` query) for CSV import into a specific config; PUT `/api/sails/active` for quick active-config swap.
- New `/sails` page — list configs, set active, add/rename/delete, edit each config's polar.
- New `PolarPlot` SVG component — reusable. Renders curves per TWS plus optional current-operating-point and target-point overlays.
- `/polars` page now displays the active config's polar with both the heatmap-editor (unchanged) AND the new live polar plot. An "Active sails: X [change]" header at the top with a quick-swap dropdown.
- `/helm` page gets a small "Active sails: X" indicator with a tap-to-change menu.

**Migration:** on first boot after this plan lands, if the SQLite has the old `polars` row (single PolarTable) but no `sail_wardrobe` row, seed the wardrobe with one config named "Default" wrapping that polar. If neither exists, use `DEFAULT_WARDROBE` (one config named "Default" with `DEFAULT_POLARS`). Old `polars` row left in place — harmless; can be removed in a future cleanup.

**Tech stack additions:** none.

---

## Files

```
autopilot/
└── packages/
    ├── db/
    │   └── src/
    │       ├── defaults.ts                MODIFY: SailConfig, SailWardrobe, DEFAULT_WARDROBE
    │       ├── schema.ts                  MODIFY: add sail_wardrobe table
    │       └── config-store.ts            MODIFY: sails$, activePolar$, setSails, migration
    ├── compute/
    │   └── src/polars/
    │       └── pipeline.ts                MODIFY: subscribe to configStore.activePolar$
    └── web/
        └── src/app/
            ├── api/sails/
            │   ├── route.ts               NEW: GET / PUT wardrobe
            │   ├── active/route.ts        NEW: PUT { configId }
            │   └── import/route.ts        NEW: POST CSV (?configId=...)
            ├── sails/
            │   ├── page.tsx               NEW
            │   ├── ConfigList.tsx         NEW
            │   └── ConfigEditor.tsx       NEW
            ├── polars/
            │   └── page.tsx               MODIFY: add active-sails selector + live polar plot
            └── helm/
                └── page.tsx               MODIFY: add "Active sails: …" tile
└── packages/web/src/components/
    └── PolarPlot.tsx                      NEW
```

---

## Task 1: Sail wardrobe data model + schema + ConfigStore (TDD)

**Files:**
- Modify: `packages/db/src/defaults.ts` — add `SailConfig`, `SailWardrobe`, `DEFAULT_WARDROBE`
- Modify: `packages/db/src/schema.ts` — add `sail_wardrobe` table
- Modify: `packages/db/src/config-store.ts` — sails$, activePolar$, setSails, migration
- Modify: `packages/db/src/config-store.test.ts` — extend with wardrobe tests

### Step 1: Append to `defaults.ts`

```ts
/**
 * One sail-configuration entry in the wardrobe. Carries its own polar table
 * plus metadata so the user knows which configuration they're picking.
 */
export interface SailConfig {
  /** Stable unique ID (e.g. 'default', 'full-j1', 'reef1-a2'). */
  id: string;
  /** Human-readable name (e.g. 'Full main + J1'). */
  name: string;
  /** Optional structured metadata for filtering / sorting. */
  mainState?: string;
  headsail?: string;
  downwindSail?: string;
  notes?: string;
  /** This config's polar table. */
  polar: PolarTable;
}

/**
 * The sail wardrobe: list of configurations + which one is currently active.
 * The compute pipeline reads the active config's polar.
 */
export interface SailWardrobe {
  configs: SailConfig[];
  /** ID of the active configuration. Must reference a configs[].id. */
  activeConfigId: string;
}

/** Default wardrobe: one config wrapping the existing DEFAULT_POLARS. */
export const DEFAULT_WARDROBE: SailWardrobe = {
  configs: [
    {
      id: 'default',
      name: 'Default',
      notes: 'Initial baseline polar. Replace with your boat-specific data.',
      polar: DEFAULT_POLARS,
    },
  ],
  activeConfigId: 'default',
};
```

### Step 2: Append to `schema.ts`

```ts
export const sailWardrobe = sqliteTable('sail_wardrobe', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded SailWardrobe
});
```

### Step 3: Extend `config-store.ts`

1. Imports — add `DEFAULT_WARDROBE`, `type SailWardrobe`, `sailWardrobe` from schema.
2. Add to subjects type: `sails: BehaviorSubject<SailWardrobe>`.
3. Add `CREATE TABLE IF NOT EXISTS sail_wardrobe ...` to `raw.exec(...)`.
4. Extend the table-union types in `loadOrInsert` and `upsert` to include `typeof sailWardrobe`.
5. **Migration logic for the seed**: in `open()`, replace the `loadOrInsert` call for the sails entry with a custom path:
   - If a `sail_wardrobe` row exists, parse and use it.
   - Else, look at the existing `polars` row (`loadOrInsert<PolarTable>(polars, DEFAULT_POLARS)` already returns it). Wrap it in a `SailWardrobe` whose single config holds that polar (name "Default"), insert that into `sail_wardrobe`, and use it.
6. Add to `initial`: `sails: <result of migration>`.
7. Initialize `subjects.sails` from `initial.sails`.
8. Add the getter `sails$`.
9. Add the setter `setSails(value: SailWardrobe)` — validate `activeConfigId` references an existing config, write through, emit.
10. Add a **derived** getter `activePolar$` that returns `this.subjects.sails.asObservable().pipe(map(w => activeConfigPolar(w)))` where `activeConfigPolar` returns the active config's polar (or `DEFAULT_POLARS` if `activeConfigId` is dangling). Import `map` from `rxjs/operators` or `rxjs`.
11. **Repoint `polars$`** — change `get polars$()` to return `this.activePolar$`. This preserves backward compatibility — the polar pipeline keeps working unchanged for one beat.
12. **Repoint `setPolars()`** — when the legacy API is called, update the active config's polar inside the wardrobe and emit on `sails$`. This way the existing `/api/config/polars` endpoint continues to function as "edit the active config's polar".
13. Add `this.subjects.sails.complete()` to `close()`.

### Step 4: Extend `config-store.test.ts`

Append:

```ts
import { DEFAULT_WARDROBE, type SailWardrobe } from './defaults.js';

it('returns the default wardrobe on a fresh database', async () => {
  const w = await firstValueFrom(store.sails$);
  expect(w.activeConfigId).toBe('default');
  expect(w.configs).toHaveLength(1);
  expect(w.configs[0]!.id).toBe('default');
});

it('emits a new wardrobe when setSails is called', async () => {
  const next: Promise<SailWardrobe> = firstValueFrom(
    store.sails$.pipe(skip(1), take(1)),
  );
  const updated: SailWardrobe = {
    ...DEFAULT_WARDROBE,
    configs: [
      ...DEFAULT_WARDROBE.configs,
      {
        id: 'reef1-a2',
        name: 'Reef 1 + A2',
        mainState: 'Reef 1',
        downwindSail: 'A2',
        polar: DEFAULT_WARDROBE.configs[0]!.polar,
      },
    ],
  };
  await store.setSails(updated);
  const v = await next;
  expect(v.configs).toHaveLength(2);
});

it('rejects setSails with an unknown activeConfigId', async () => {
  await expect(
    store.setSails({
      ...DEFAULT_WARDROBE,
      activeConfigId: 'does-not-exist',
    }),
  ).rejects.toThrow();
});

it('activePolar$ tracks the active config polar', async () => {
  const initial = await firstValueFrom(store.activePolar$);
  expect(initial.twsBins.length).toBeGreaterThan(0);

  // Add a config with a distinct polar (all zeros) and switch to it.
  const wardrobe = await firstValueFrom(store.sails$);
  const distinctPolar = {
    ...wardrobe.configs[0]!.polar,
    boatSpeed: wardrobe.configs[0]!.polar.boatSpeed.map((row) =>
      row.map(() => 0),
    ),
  };
  await store.setSails({
    configs: [
      ...wardrobe.configs,
      { id: 'zeros', name: 'Zeros', polar: distinctPolar },
    ],
    activeConfigId: 'zeros',
  });
  const after = await firstValueFrom(store.activePolar$);
  expect(after.boatSpeed.flat().every((x) => x === 0)).toBe(true);
});

it('legacy polars$ tracks active config (backward compat)', async () => {
  // After Task 1, polars$ is an alias for activePolar$.
  const a = await firstValueFrom(store.polars$);
  const b = await firstValueFrom(store.activePolar$);
  expect(a).toEqual(b);
});
```

### Step 5: Run tests

```
npx vitest run packages/db
```

All 11 tests pass (6 existing + 5 new).

### Step 6: Rebuild db dist

```
npm run build --workspace=@g5000/db
```

### Step 7: Commit

```bash
git add packages/db/src/defaults.ts packages/db/src/schema.ts packages/db/src/config-store.ts packages/db/src/config-store.test.ts
git commit -m "feat(db): SailWardrobe schema, sails\$ / activePolar\$ observables, migration from polars singleton"
```

---

## Task 2: Polar pipeline → activePolar$ (small refactor)

**File:** `packages/compute/src/polars/pipeline.ts`

The pipeline currently subscribes to `configStore.polars$`. After Task 1 that's already an alias for `activePolar$`, so technically nothing needs to change. But to make intent explicit, switch the subscription to `configStore.activePolar$`.

### Step 1: Edit pipeline.ts

Change:
```ts
let polar: PolarTable = await firstValueFrom(configStore.polars$);
// ...
rxSubs.push(
  configStore.polars$.subscribe((next) => { ... }),
);
```

To:
```ts
let polar: PolarTable = await firstValueFrom(configStore.activePolar$);
// ...
rxSubs.push(
  configStore.activePolar$.subscribe((next) => { ... }),
);
```

### Step 2: Pipeline test should still pass

```
npx vitest run packages/compute/src/polars/pipeline.test.ts
```

The test uses `store.setPolars(...)` (the legacy setter), which now mutates the active config. The pipeline subscribes to `activePolar$`, which emits when sails$ changes. The cascade works.

Run full compute suite:
```
npx vitest run packages/compute
```

### Step 3: Rebuild compute dist

```
npm run build --workspace=@g5000/compute
```

### Step 4: Commit

```bash
git add packages/compute/src/polars/pipeline.ts
git commit -m "feat(compute): polar pipeline reads activePolar\$ directly"
```

---

## Task 3: REST endpoints for the wardrobe

**Files:**
- Create: `packages/web/src/app/api/sails/route.ts` — GET / PUT full wardrobe
- Create: `packages/web/src/app/api/sails/active/route.ts` — PUT { configId }
- Create: `packages/web/src/app/api/sails/import/route.ts` — POST CSV body; `?configId=` query

### Step 1: `route.ts`

```ts
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type SailWardrobe } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const w = await firstValueFrom(store.sails$);
  return Response.json(w);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: SailWardrobe;
  try {
    body = (await req.json()) as SailWardrobe;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validate(body)) {
    return Response.json({ error: 'invalid wardrobe shape' }, { status: 422 });
  }
  try {
    await store.setSails(body);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }
  return Response.json({ ok: true });
}

function validate(v: unknown): v is SailWardrobe {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.activeConfigId !== 'string') return false;
  if (!Array.isArray(o.configs) || o.configs.length === 0) return false;
  for (const c of o.configs as unknown[]) {
    if (!c || typeof c !== 'object') return false;
    const cc = c as Record<string, unknown>;
    if (typeof cc.id !== 'string' || typeof cc.name !== 'string') return false;
    if (!cc.polar || typeof cc.polar !== 'object') return false;
    const p = cc.polar as Record<string, unknown>;
    if (
      !Array.isArray(p.twsBins) ||
      !Array.isArray(p.twaBins) ||
      !Array.isArray(p.boatSpeed)
    )
      return false;
  }
  return true;
}
```

### Step 2: `active/route.ts`

```ts
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: { configId?: string };
  try {
    body = (await req.json()) as { configId?: string };
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof body.configId !== 'string') {
    return Response.json({ error: 'configId required (string)' }, { status: 422 });
  }
  const wardrobe = await firstValueFrom(store.sails$);
  if (!wardrobe.configs.find((c) => c.id === body.configId)) {
    return Response.json({ error: 'unknown configId' }, { status: 422 });
  }
  await store.setSails({ ...wardrobe, activeConfigId: body.configId });
  return Response.json({ ok: true, activeConfigId: body.configId });
}
```

### Step 3: `import/route.ts`

```ts
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';
import { parseExpeditionPolar } from '@g5000/compute';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  const url = new URL(req.url);
  const configId = url.searchParams.get('configId');
  if (!configId) {
    return Response.json(
      { error: 'configId query param required' },
      { status: 400 },
    );
  }
  const csv = await req.text();
  if (!csv || csv.length === 0) {
    return Response.json({ error: 'empty body' }, { status: 400 });
  }
  let polar;
  try {
    polar = parseExpeditionPolar(csv);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }
  const wardrobe = await firstValueFrom(store.sails$);
  const idx = wardrobe.configs.findIndex((c) => c.id === configId);
  if (idx < 0) {
    return Response.json({ error: 'unknown configId' }, { status: 422 });
  }
  const newConfigs = wardrobe.configs.slice();
  newConfigs[idx] = { ...newConfigs[idx]!, polar };
  await store.setSails({ ...wardrobe, configs: newConfigs });
  return Response.json({
    ok: true,
    twsBinCount: polar.twsBins.length,
    twaBinCount: polar.twaBins.length,
  });
}
```

### Step 4: Typecheck + commit

```
npm run typecheck --workspace=@g5000/web
```

```bash
git add packages/web/src/app/api/sails/route.ts packages/web/src/app/api/sails/active/route.ts packages/web/src/app/api/sails/import/route.ts
git commit -m "feat(web): REST endpoints for sail wardrobe"
```

---

## Task 4: PolarPlot SVG component

**File:** `packages/web/src/components/PolarPlot.tsx`

Reusable. Takes a PolarTable + optional currentTws/currentTwa/currentBsp + optional targetTwa/targetBsp. Renders:
- Concentric speed rings (in knots) with labels
- Compass-style TWA labels at 30°/60°/90°/120°/150°
- One curve per TWS bin, mirrored across the boat centerline (so the chart shows port and starboard symmetric)
- The TWS curves are color-coded from cool (light air) to warm (heavy air)
- Current operating point: a bright circle at the (TWA, BSP) location
- Target point: a smaller marker at the optimal-VMG TWA + target BSP

```tsx
'use client';

import type { PolarTable } from '@g5000/db';

const MS_TO_KNOTS = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export interface PolarPlotProps {
  polar: PolarTable;
  /** Current operating point — both must be defined for the dot to render. */
  currentTwa?: number;
  currentTws?: number;
  currentBsp?: number;
  /** Target point overlay. */
  targetTwa?: number;
  targetBsp?: number;
  /** Pixel size of the square canvas. Default 480. */
  size?: number;
}

/**
 * SVG polar plot. Center = boat; up = 0° TWA (into wind); down = 180° TWA.
 * TWS curves are drawn for each row in the polar table, mirrored across the
 * centerline so the chart shows both port (left) and starboard (right).
 */
export function PolarPlot({
  polar,
  currentTwa,
  currentTws,
  currentBsp,
  targetTwa,
  targetBsp,
  size = 480,
}: PolarPlotProps) {
  const cx = size / 2;
  const cy = size / 2;
  const margin = 40;
  const maxBsp = Math.max(1, ...polar.boatSpeed.flat()); // m/s
  const scale = (size / 2 - margin) / maxBsp;

  // Convert (TWA radians, BSP m/s, side) → (x, y) in SVG coords.
  // TWA = 0 is straight up, sweeps clockwise. side = -1 for port, +1 for starboard.
  const polarToCartesian = (
    twa: number,
    bsp: number,
    side: 1 | -1,
  ): { x: number; y: number } => ({
    x: cx + side * bsp * Math.sin(twa) * scale,
    y: cy - bsp * Math.cos(twa) * scale,
  });

  // Speed rings — every 2 m/s (≈ 4 kn).
  const ringStepMs = 2;
  const ringMaxMs = Math.ceil(maxBsp);
  const rings: number[] = [];
  for (let v = ringStepMs; v <= ringMaxMs; v += ringStepMs) rings.push(v);

  // TWS curves (one per TWS bin).
  const tsColor = (twsIdx: number): string => {
    const t = polar.twsBins.length > 1 ? twsIdx / (polar.twsBins.length - 1) : 0;
    // Cool blue at light air → warm orange at heavy air.
    const r = Math.floor(80 + 160 * t);
    const g = Math.floor(180 - 80 * t);
    const b = Math.floor(220 - 120 * t);
    return `rgb(${r},${g},${b})`;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="bg-slate-900 rounded"
    >
      {/* Speed rings */}
      {rings.map((v, i) => (
        <g key={`ring-${i}`}>
          <circle
            cx={cx}
            cy={cy}
            r={v * scale}
            fill="none"
            stroke="rgb(50,55,70)"
            strokeWidth="1"
          />
          <text
            x={cx + 4}
            y={cy - v * scale + 4}
            fill="rgb(100,110,130)"
            fontSize="10"
            fontFamily="monospace"
          >
            {(v * MS_TO_KNOTS).toFixed(0)}kn
          </text>
        </g>
      ))}

      {/* Radial lines at common TWAs */}
      {[30, 60, 90, 120, 150].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const r = size / 2 - margin;
        return (
          <g key={`radial-${deg}`}>
            <line
              x1={cx + r * Math.sin(rad)}
              y1={cy - r * Math.cos(rad)}
              x2={cx - r * Math.sin(rad)}
              y2={cy - r * Math.cos(rad)}
              stroke="rgb(40,45,55)"
              strokeWidth="1"
            />
            <text
              x={cx + (r + 12) * Math.sin(rad)}
              y={cy - (r + 12) * Math.cos(rad)}
              fill="rgb(100,110,130)"
              fontSize="10"
              fontFamily="monospace"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {deg}°
            </text>
          </g>
        );
      })}

      {/* Vertical and horizontal axes */}
      <line
        x1={cx}
        y1={margin}
        x2={cx}
        y2={size - margin}
        stroke="rgb(60,70,90)"
        strokeWidth="1"
      />
      <line
        x1={margin}
        y1={cy}
        x2={size - margin}
        y2={cy}
        stroke="rgb(60,70,90)"
        strokeWidth="1"
      />

      {/* TWS curves */}
      {polar.boatSpeed.map((row, twsIdx) => {
        const points: string[] = [];
        for (let twaIdx = 0; twaIdx < polar.twaBins.length; twaIdx++) {
          const twa = polar.twaBins[twaIdx]!;
          const bsp = row[twaIdx]!;
          const { x, y } = polarToCartesian(twa, bsp, 1);
          points.push(`${x},${y}`);
        }
        // Mirror to port side.
        const portPoints: string[] = [];
        for (let twaIdx = polar.twaBins.length - 1; twaIdx >= 0; twaIdx--) {
          const twa = polar.twaBins[twaIdx]!;
          const bsp = row[twaIdx]!;
          const { x, y } = polarToCartesian(twa, bsp, -1);
          portPoints.push(`${x},${y}`);
        }
        const allPoints = [...points, ...portPoints].join(' ');
        return (
          <polygon
            key={`curve-${twsIdx}`}
            points={allPoints}
            fill="none"
            stroke={tsColor(twsIdx)}
            strokeWidth="1.5"
            opacity="0.85"
          />
        );
      })}

      {/* Target point (lower z than current) */}
      {targetTwa !== undefined && targetBsp !== undefined && (
        <circle
          cx={polarToCartesian(Math.abs(targetTwa), targetBsp, targetTwa >= 0 ? 1 : -1).x}
          cy={polarToCartesian(Math.abs(targetTwa), targetBsp, targetTwa >= 0 ? 1 : -1).y}
          r={5}
          fill="rgb(255,180,80)"
          stroke="rgb(40,30,10)"
          strokeWidth="1"
        />
      )}

      {/* Current operating point */}
      {currentTwa !== undefined && currentBsp !== undefined && (
        <circle
          cx={polarToCartesian(Math.abs(currentTwa), currentBsp, currentTwa >= 0 ? 1 : -1).x}
          cy={polarToCartesian(Math.abs(currentTwa), currentBsp, currentTwa >= 0 ? 1 : -1).y}
          r={8}
          fill="rgb(120,255,180)"
          stroke="rgb(20,40,30)"
          strokeWidth="2"
        />
      )}

      {/* Legend / current numbers */}
      <g transform={`translate(${margin / 2},${size - margin / 2})`}>
        <text fill="rgb(200,210,230)" fontSize="11" fontFamily="monospace">
          {currentTws !== undefined ? `TWS ${(currentTws * MS_TO_KNOTS).toFixed(1)}kn` : 'TWS —'}
        </text>
        <text
          fill="rgb(200,210,230)"
          fontSize="11"
          fontFamily="monospace"
          dy="14"
        >
          {currentTwa !== undefined
            ? `TWA ${(currentTwa * RAD_TO_DEG).toFixed(0)}°`
            : 'TWA —'}
          {currentBsp !== undefined
            ? `  BSP ${(currentBsp * MS_TO_KNOTS).toFixed(2)}kn`
            : ''}
        </text>
      </g>
    </svg>
  );
}
```

### Step 1: Create the file

### Step 2: Typecheck

```
npm run typecheck --workspace=@g5000/web
```

### Step 3: Commit

```bash
git add packages/web/src/components/PolarPlot.tsx
git commit -m "feat(web): PolarPlot SVG component (radial plot with overlays)"
```

---

## Task 5: `/sails` page — wardrobe management

**Files:**
- Create: `packages/web/src/app/sails/page.tsx`

A page where you:
- See all sail configs as a list
- Click one to make it active (visual highlight)
- Click to expand a config — edit name + metadata + polar (via existing heatmap pattern from /polars)
- Add a new config (clones the active one's polar by default)
- Delete a config (with confirmation; can't delete the active one)
- Import CSV into the selected config

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SailConfig, SailWardrobe, PolarTable } from '@g5000/db';
import { PolarHeatmap } from '../polars/PolarHeatmap';
import { PolarCellEditor } from '../polars/PolarCellEditor';

export default function SailsPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ twsIdx: number; twaIdx: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/sails', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/sails: ${res.status}`);
      const body = (await res.json()) as SailWardrobe;
      setWardrobe(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const writeWardrobe = async (w: SailWardrobe) => {
    const res = await fetch('/api/sails', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(w),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`PUT failed: ${res.status} ${t}`);
    }
    await reload();
  };

  const setActive = async (id: string) => {
    const res = await fetch('/api/sails/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configId: id }),
    });
    if (!res.ok) {
      const t = await res.text();
      setErr(`activate failed: ${res.status} ${t}`);
      return;
    }
    await reload();
  };

  const addConfig = async () => {
    if (!wardrobe) return;
    const baseId = `config-${Date.now()}`;
    const base = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId)!;
    const newCfg: SailConfig = {
      id: baseId,
      name: `New config (${wardrobe.configs.length + 1})`,
      polar: base.polar, // start from current active
    };
    try {
      await writeWardrobe({
        ...wardrobe,
        configs: [...wardrobe.configs, newCfg],
      });
      setEditingId(baseId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteConfig = async (id: string) => {
    if (!wardrobe) return;
    if (wardrobe.configs.length === 1) {
      setErr('Cannot delete the last config');
      return;
    }
    if (id === wardrobe.activeConfigId) {
      setErr('Cannot delete the active config (switch first)');
      return;
    }
    if (!confirm(`Delete config "${id}"?`)) return;
    try {
      await writeWardrobe({
        ...wardrobe,
        configs: wardrobe.configs.filter((c) => c.id !== id),
      });
      if (editingId === id) setEditingId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const updateConfig = async (id: string, patch: Partial<SailConfig>) => {
    if (!wardrobe) return;
    try {
      await writeWardrobe({
        ...wardrobe,
        configs: wardrobe.configs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const applyPolarChange = async (id: string, polar: PolarTable) => {
    await updateConfig(id, { polar });
  };

  const handleImport = async (file: File, configId: string) => {
    setImportBusy(true);
    try {
      const text = await file.text();
      const res = await fetch(`/api/sails/import?configId=${encodeURIComponent(configId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Import failed: ${res.status} ${t}`);
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sail wardrobe</h1>
        <button
          onClick={addConfig}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium"
        >
          Add config
        </button>
      </div>
      {err && <div className="text-red-400 text-sm">{err}</div>}

      {!wardrobe && !err && <p className="text-slate-400">Loading…</p>}

      {wardrobe && (
        <div className="space-y-2">
          {wardrobe.configs.map((c) => {
            const isActive = c.id === wardrobe.activeConfigId;
            const isEditing = c.id === editingId;
            return (
              <div
                key={c.id}
                className={`border rounded p-3 ${
                  isActive ? 'border-amber-500' : 'border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setActive(c.id)}
                      className={`px-2 py-1 rounded text-xs font-mono ${
                        isActive
                          ? 'bg-amber-600 text-slate-900'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {isActive ? 'ACTIVE' : 'Make active'}
                    </button>
                    <div>
                      <div className="text-base font-semibold">{c.name}</div>
                      <div className="text-xs text-slate-500 font-mono">{c.id}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingId(isEditing ? null : c.id)}
                      className="px-2 py-1 bg-slate-700 text-slate-200 rounded text-xs"
                    >
                      {isEditing ? 'Close' : 'Edit'}
                    </button>
                    <button
                      onClick={() => deleteConfig(c.id)}
                      disabled={isActive || wardrobe.configs.length === 1}
                      className="px-2 py-1 bg-red-900 text-red-200 rounded text-xs disabled:opacity-30"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 space-y-3 border-t border-slate-800 pt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-sm">
                        <span className="text-slate-400">Name:</span>
                        <input
                          type="text"
                          value={c.name}
                          onChange={(e) => updateConfig(c.id, { name: e.target.value })}
                          className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Main:</span>
                        <input
                          type="text"
                          placeholder="Full / Reef 1 / Reef 2 / None"
                          value={c.mainState ?? ''}
                          onChange={(e) => updateConfig(c.id, { mainState: e.target.value || undefined })}
                          className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Headsail:</span>
                        <input
                          type="text"
                          placeholder="J1 / J2 / Storm / None"
                          value={c.headsail ?? ''}
                          onChange={(e) => updateConfig(c.id, { headsail: e.target.value || undefined })}
                          className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Downwind sail:</span>
                        <input
                          type="text"
                          placeholder="A2 / A3 / Code 0 / None"
                          value={c.downwindSail ?? ''}
                          onChange={(e) => updateConfig(c.id, { downwindSail: e.target.value || undefined })}
                          className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.txt,.pol"
                        id={`import-${c.id}`}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void handleImport(f, c.id);
                        }}
                        className="hidden"
                      />
                      <label
                        htmlFor={`import-${c.id}`}
                        className={`px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium cursor-pointer text-sm ${importBusy ? 'opacity-50' : ''}`}
                      >
                        {importBusy ? 'Importing…' : 'Import CSV for this config'}
                      </label>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-sm uppercase tracking-wider text-slate-400">
                        Polar grid
                      </h3>
                      <PolarHeatmap
                        polar={c.polar}
                        selected={selectedCell ?? undefined}
                        onSelect={(cell) => setSelectedCell(cell)}
                      />
                      {selectedCell && (
                        <PolarCellEditor
                          polar={c.polar}
                          cell={selectedCell}
                          onApply={(updated) => applyPolarChange(c.id, updated)}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
```

### Step 1: Create the file
### Step 2: Typecheck
### Step 3: Commit

```bash
git add packages/web/src/app/sails/page.tsx
git commit -m "feat(web): /sails page for managing the wardrobe (add, rename, delete, set active, edit polar per config)"
```

---

## Task 6: `/polars` page — live polar plot + active sails header

**File:** `packages/web/src/app/polars/page.tsx` (modify)

Adds at the top: "Active sails: X [change]" with a dropdown that PUTs `/api/sails/active`. Adds the live PolarPlot side-by-side with the existing heatmap+editor. The plot shows the active polar with live operating-point overlay from SSE channels.

Modify the existing `/polars/page.tsx` to:
1. Fetch the wardrobe (`/api/sails`), display the active config name and a dropdown to switch
2. Subscribe to SSE for `wind.true.calibrated.{speed,angle}` and `boat.speed.water`
3. Render `<PolarPlot>` next to the heatmap, passing current TWS/TWA/BSP

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PolarTable, SailWardrobe } from '@g5000/db';
import { PolarHeatmap } from './PolarHeatmap';
import { PolarCellEditor } from './PolarCellEditor';
import { PolarPlot } from '../../components/PolarPlot';
import { useSse } from '../../hooks/use-sse';

export default function PolarsPage() {
  const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);
  const [polar, setPolar] = useState<PolarTable | null>(null);
  const [selected, setSelected] = useState<{ twsIdx: number; twaIdx: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { channels } = useSse();

  const reload = useCallback(async () => {
    try {
      const [pol, war] = await Promise.all([
        fetch('/api/config/polars', { cache: 'no-store' }).then((r) => r.json() as Promise<PolarTable>),
        fetch('/api/sails', { cache: 'no-store' }).then((r) => r.json() as Promise<SailWardrobe>),
      ]);
      setPolar(pol);
      setWardrobe(war);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleApply = async (updated: PolarTable) => {
    const res = await fetch('/api/config/polars', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`PUT failed: ${res.status} ${t}`);
    }
    await reload();
  };

  const switchActive = async (configId: string) => {
    const res = await fetch('/api/sails/active', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configId }),
    });
    if (!res.ok) {
      const t = await res.text();
      setErr(`switch failed: ${res.status} ${t}`);
      return;
    }
    await reload();
  };

  const handleImport = async (file: File) => {
    if (!wardrobe) return;
    setImportBusy(true);
    try {
      const text = await file.text();
      const res = await fetch(
        `/api/sails/import?configId=${encodeURIComponent(wardrobe.activeConfigId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: text,
        },
      );
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Import failed: ${res.status} ${t}`);
      }
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Live operating-point values from SSE.
  const twsSample = channels.get('wind.true.calibrated.speed');
  const twaSample = channels.get('wind.true.calibrated.angle');
  const bspSample = channels.get('boat.speed.water');
  const targetSpeedSample = channels.get('performance.target.boatSpeed');
  const targetTwaSample = channels.get('performance.target.twaUpwind'); // simplistic — could pick up/down based on twa sign

  const num = (s: typeof twsSample): number | undefined =>
    s && s.value.kind === 'scalar' ? s.value.value : undefined;

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Polars</h1>
        {wardrobe && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Active sails:</span>
            <select
              value={wardrobe.activeConfigId}
              onChange={(e) => switchActive(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded text-slate-200 px-2 py-1 text-sm"
            >
              {wardrobe.configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <a
              href="/sails"
              className="text-xs text-slate-500 hover:text-slate-300 underline"
            >
              manage wardrobe →
            </a>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.pol"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f);
              }}
              className="hidden"
              id="polar-import-active"
            />
            <label
              htmlFor="polar-import-active"
              className={`px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium cursor-pointer text-sm ${importBusy ? 'opacity-50' : ''}`}
            >
              {importBusy ? 'Importing…' : 'Import CSV (active)'}
            </label>
          </div>
        )}
      </div>

      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      {polar && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Polar plot (live)</h2>
            <PolarPlot
              polar={polar}
              currentTws={num(twsSample)}
              currentTwa={num(twaSample)}
              currentBsp={num(bspSample)}
              targetBsp={num(targetSpeedSample)}
              targetTwa={num(targetTwaSample)}
              size={480}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Polar grid (active config)</h2>
            <PolarHeatmap
              polar={polar}
              selected={selected ?? undefined}
              onSelect={(c) => setSelected(c)}
            />
            {selected && (
              <PolarCellEditor polar={polar} cell={selected} onApply={handleApply} />
            )}
          </section>
        </div>
      )}

      {!polar && !err && <p className="text-slate-400">Loading…</p>}
    </main>
  );
}
```

### Step 1: Update the file
### Step 2: Typecheck
### Step 3: Commit

```bash
git add packages/web/src/app/polars/page.tsx
git commit -m "feat(web): /polars page adds live polar plot + active sails selector"
```

---

## Task 7: `/helm` page — active sails indicator

**File:** `packages/web/src/app/helm/page.tsx` (modify)

Add a small tile or line showing "Active sails: X" with a button/link to `/sails` for full management. Quick-switch via a dropdown.

Add a `useEffect` that fetches `/api/sails` on mount and re-fetches periodically (or just on focus — simpler). Display the active config name in a thin bar above the tile grid.

Minimal change: add a header bar that shows active sails + dropdown to swap. Place the dropdown above the existing grid.

```tsx
// At top of the existing HelmPage component, add wardrobe state + fetcher
const [wardrobe, setWardrobe] = useState<SailWardrobe | null>(null);

const reloadWardrobe = useCallback(async () => {
  try {
    const r = await fetch('/api/sails', { cache: 'no-store' });
    if (!r.ok) return;
    setWardrobe(await r.json() as SailWardrobe);
  } catch { /* ignore */ }
}, []);

useEffect(() => {
  void reloadWardrobe();
}, [reloadWardrobe]);

const swapActive = async (configId: string) => {
  await fetch('/api/sails/active', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configId }),
  });
  await reloadWardrobe();
};

// In the JSX, ABOVE the grid:
{wardrobe && (
  <div className="flex items-center gap-2 mb-3 text-sm bg-slate-900 border border-slate-800 rounded px-3 py-2">
    <span className="text-slate-400">Sails:</span>
    <select
      value={wardrobe.activeConfigId}
      onChange={(e) => swapActive(e.target.value)}
      className="bg-slate-900 border border-slate-700 rounded text-slate-200 px-2 py-1 text-sm"
    >
      {wardrobe.configs.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
    <a href="/sails" className="text-xs text-slate-500 hover:text-slate-300 underline">manage</a>
  </div>
)}
```

Adjust the imports at the top: add `useCallback`, `useEffect`, `useState` from 'react'; import `type SailWardrobe` from `@g5000/db`.

### Step 1: Update
### Step 2: Typecheck
### Step 3: Commit

```bash
git add packages/web/src/app/helm/page.tsx
git commit -m "feat(web): /helm page shows active sails + quick-swap selector"
```

---

## Task 8: Final verification + merge

- `npm test` — expect ~126 tests (5 new sails-related db tests)
- `npx tsc -b` — clean
- `npm run lint` → `npm run format` if needed → commit
- Smoke-test all four touched pages: `/sails`, `/polars`, `/helm`, plus the existing `/inspect`. All return 200.
- Smoke-test `/api/sails` returns wardrobe with default config; `/api/sails/active` PUT swaps active.
- Merge `--no-ff` to main.

---

## Closing notes

After this plan:
- You can model your real sail wardrobe: full main + J1, reefed main + A2, jib + A0, etc.
- Each config has its own polar — when you change sails, switch the active config and the compute pipeline instantly uses the right polar.
- The `/polars` page shows the live polar plot side-by-side with the heatmap editor; the current operating point dot moves around the plot as conditions change.
- `/helm` shows a small "Sails: X [change]" bar so you can swap configs without leaving the dashboard.

This delivers what you asked for: live polar visualisation + sail-selection UI + polars tied to the wardrobe.
