# G5000 Plan 8 — Remaining Cal Pages: BSP, Compass Deviation, Boat Config

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Round out the calibration UX. Three pages, three API endpoint pairs, following the established `/calibration/wind` + `/polars` pattern. After this plan, every field stored in `config.db` is editable from the browser without writing SQL.

**Architecture:** No new packages, no new compute, no new pipeline. Each task adds a GET/PUT REST endpoint and a page with either a 1D table editor (BSP, compass deviation) or a form (boat config). All three use `getSharedConfigStore()` exactly like `/api/config/aws-awa` does — copy-paste-modify is fine here.

**Tech stack additions:** none.

**Reference spec:** `docs/superpowers/specs/2026-05-08-h6000-design.md`. Implements build-sequence step 11 (boat config) and step 17 (BSP cal + compass deviation), minus the GPS-correlation / dockside-swing capture wizards which are deferred to a follow-up plan.

---

## What's in scope

- `/api/config/boat` GET / PUT — single struct with 4 numbers.
- `/boat` page — form with one input per field, Apply button.
- `/api/config/bsp` GET / PUT — 1D table (bins + multipliers).
- `/calibration/bsp` page — display the table as a row of cells, click to select, edit multiplier per cell. Live BSP/SOG display via SSE (so the user can manually note the values to enter).
- `/api/config/compass-deviation` GET / PUT — 1D table (36 bins × 10°, deviation per bin).
- `/calibration/compass` page — 36-cell row, click to edit. Live heading/COG display.

## What's NOT in scope

- BSP capture wizard (auto-fill the cell by comparing BSP to GPS SOG over a 30s window). Deferred — manual entry suffices for now.
- Compass swing wizard (auto-fill bins by correlating HDG against GPS COG during a slow turn). Deferred.
- Changing the bin schemas (counts/positions). Bin layouts come from `DEFAULT_*` constants in `@g5000/db`.
- Multiple boat profiles. Single struct, single boat.

---

## File structure

```
autopilot/
└── packages/
    └── web/
        └── src/app/
            ├── api/config/
            │   ├── boat/route.ts                           NEW
            │   ├── bsp/route.ts                            NEW
            │   └── compass-deviation/route.ts              NEW
            ├── boat/
            │   └── page.tsx                                NEW
            └── calibration/
                ├── bsp/
                │   └── page.tsx                            NEW
                └── compass/
                    └── page.tsx                            NEW
```

Six new files, no modifications to anything else.

---

## Task 1: Boat config — API + `/boat` page

**Files:**

- Create: `packages/web/src/app/api/config/boat/route.ts`
- Create: `packages/web/src/app/boat/page.tsx`

### Step 1: `route.ts`

```ts
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type BoatConfig } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cfg = await firstValueFrom(store.boatConfig$);
  return Response.json(cfg);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: BoatConfig;
  try {
    body = (await req.json()) as BoatConfig;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!validate(body)) {
    return Response.json({ error: 'invalid boat config shape' }, { status: 422 });
  }
  await store.setBoatConfig(body);
  return Response.json({ ok: true });
}

function validate(v: unknown): v is BoatConfig {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.mastHeight === 'number' &&
    typeof o.mastheadOffsetX === 'number' &&
    typeof o.mastheadOffsetY === 'number' &&
    typeof o.magVarDeg === 'number'
  );
}
```

### Step 2: `page.tsx`

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BoatConfig } from '@g5000/db';

const FIELDS: Array<{
  key: keyof BoatConfig;
  label: string;
  unit: string;
  step: number;
}> = [
  { key: 'mastHeight', label: 'Mast height (above masthead unit ref)', unit: 'm', step: 0.1 },
  { key: 'mastheadOffsetX', label: 'Masthead X offset (bow direction)', unit: 'm', step: 0.1 },
  { key: 'mastheadOffsetY', label: 'Masthead Y offset (lateral)', unit: 'm', step: 0.1 },
  { key: 'magVarDeg', label: 'Magnetic variation (positive = east)', unit: '°', step: 0.1 },
];

export default function BoatConfigPage() {
  const [cfg, setCfg] = useState<BoatConfig | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/boat', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/config/boat: ${res.status}`);
      const body = (await res.json()) as BoatConfig;
      setCfg(body);
      const e: Record<string, string> = {};
      for (const f of FIELDS) e[f.key] = String(body[f.key]);
      setEdits(e);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleApply = async (): Promise<void> => {
    if (!cfg) return;
    const next: BoatConfig = { ...cfg };
    for (const f of FIELDS) {
      const n = Number(edits[f.key]);
      if (!Number.isFinite(n)) {
        setErr(`${f.label} is not a valid number`);
        return;
      }
      (next as Record<string, number>)[f.key] = n;
    }
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const res = await fetch('/api/config/boat', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`PUT failed: ${res.status} ${t}`);
      }
      setCfg(next);
      setOk(true);
      setTimeout(() => setOk(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-4 max-w-xl">
      <h1 className="text-2xl font-semibold">Boat configuration</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}
      {ok && <div className="text-green-400 text-sm">Saved.</div>}
      {cfg === null && !err && <p className="text-slate-400">Loading…</p>}
      {cfg && (
        <div className="space-y-3">
          {FIELDS.map((f) => (
            <label key={f.key} className="block text-sm">
              <span className="text-slate-400">
                {f.label} ({f.unit})
              </span>
              <input
                type="number"
                step={f.step}
                value={edits[f.key] ?? ''}
                onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className="block w-40 mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 font-mono"
              />
            </label>
          ))}
          <button
            onClick={handleApply}
            disabled={busy}
            className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Apply'}
          </button>
        </div>
      )}
      <p className="text-xs text-slate-500 pt-4 border-t border-slate-800">
        Mast height is used by the true-wind pipeline to correct for masthead motion. If it&apos;s
        wrong, true wind will appear noisy in turning maneuvers.
      </p>
    </main>
  );
}
```

### Step 3: Typecheck

```
npm run typecheck --workspace=@g5000/web
```

### Step 4: Commit

```bash
git add packages/web/src/app/api/config/boat/route.ts packages/web/src/app/boat/page.tsx
git commit -m "feat(web): /boat config form + /api/config/boat GET/PUT"
```

---

## Task 2: BSP cal — API + `/calibration/bsp` page

**Files:**

- Create: `packages/web/src/app/api/config/bsp/route.ts`
- Create: `packages/web/src/app/calibration/bsp/page.tsx`

### Step 1: `route.ts`

```ts
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type BspCal } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cal = await firstValueFrom(store.bspCal$);
  return Response.json(cal);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: BspCal;
  try {
    body = (await req.json()) as BspCal;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (
    !body ||
    !Array.isArray(body.bins) ||
    !Array.isArray(body.multiplier) ||
    body.bins.length !== body.multiplier.length
  ) {
    return Response.json({ error: 'invalid BSP cal shape' }, { status: 422 });
  }
  await store.setBspCal(body);
  return Response.json({ ok: true });
}
```

### Step 2: `page.tsx`

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BspCal } from '@g5000/db';
import { useSse } from '../../../hooks/use-sse';

const MS_TO_KNOTS = 1 / 0.514444;

export default function BspCalPage() {
  const [cal, setCal] = useState<BspCal | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [edit, setEdit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { channels } = useSse();
  const bsp = channels.get('boat.speed.water');
  const sog = channels.get('nav.gps.sog');

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/bsp', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/config/bsp: ${res.status}`);
      const body = (await res.json()) as BspCal;
      setCal(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (selected !== null && cal) {
      setEdit(cal.multiplier[selected]!.toFixed(3));
    }
  }, [selected, cal]);

  const handleApply = async (): Promise<void> => {
    if (!cal || selected === null) return;
    const m = Number(edit);
    if (!Number.isFinite(m) || m <= 0) {
      setErr('Multiplier must be a positive number');
      return;
    }
    const next: BspCal = {
      ...cal,
      multiplier: cal.multiplier.map((v, i) => (i === selected ? m : v)),
    };
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/config/bsp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`PUT failed: ${res.status} ${t}`);
      }
      setCal(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fmt = (s: { value: { kind: string; value?: number } } | undefined): string => {
    if (!s || s.value.kind !== 'scalar') return '—';
    return `${(s.value.value! * MS_TO_KNOTS).toFixed(2)} kn`;
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">BSP calibration</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      <div className="grid grid-cols-2 gap-2 text-sm font-mono text-slate-300 max-w-xl">
        <div>BSP (boat speed): {fmt(bsp as never)}</div>
        <div>SOG (GPS speed): {fmt(sog as never)}</div>
      </div>
      <p className="text-xs text-slate-500 max-w-xl">
        In still water with no current, ideal multiplier ≈ SOG / BSP. Note the ratio at each speed
        bin and edit cells accordingly.
      </p>

      {cal && (
        <div className="space-y-3">
          <table className="border-collapse text-xs font-mono">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-1">Bin (kn)</th>
                {cal.bins.map((b, i) => (
                  <th key={i} className="p-1 text-right">
                    {(b * MS_TO_KNOTS).toFixed(0)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="p-1 text-slate-400 text-right pr-2">Multiplier</th>
                {cal.multiplier.map((m, i) => {
                  const isSel = selected === i;
                  return (
                    <td
                      key={i}
                      onClick={() => setSelected(i)}
                      className={`p-2 cursor-pointer text-right bg-slate-800 ${isSel ? 'ring-2 ring-amber-400' : ''}`}
                    >
                      {m.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

          {selected !== null && (
            <div className="border border-slate-700 rounded p-4 space-y-3 max-w-xl">
              <div className="text-sm text-slate-300">
                Editing bin at{' '}
                <span className="font-mono">
                  {(cal.bins[selected]! * MS_TO_KNOTS).toFixed(1)} kn
                </span>
              </div>
              <label className="block text-sm">
                <span className="text-slate-400">Multiplier (1.0 = no correction):</span>
                <input
                  type="number"
                  step="0.01"
                  value={edit}
                  onChange={(e) => setEdit(e.target.value)}
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
            </div>
          )}
        </div>
      )}
    </main>
  );
}
```

### Step 3: Typecheck

```
npm run typecheck --workspace=@g5000/web
```

### Step 4: Commit

```bash
git add packages/web/src/app/api/config/bsp/route.ts packages/web/src/app/calibration/bsp/page.tsx
git commit -m "feat(web): /calibration/bsp page + /api/config/bsp GET/PUT"
```

---

## Task 3: Compass deviation — API + `/calibration/compass` page

**Files:**

- Create: `packages/web/src/app/api/config/compass-deviation/route.ts`
- Create: `packages/web/src/app/calibration/compass/page.tsx`

### Step 1: `route.ts`

```ts
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore, type CompassDeviation } from '@g5000/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const store = getSharedConfigStore();
  const cal = await firstValueFrom(store.compassDeviation$);
  return Response.json(cal);
}

export async function PUT(req: Request): Promise<Response> {
  const store = getSharedConfigStore();
  let body: CompassDeviation;
  try {
    body = (await req.json()) as CompassDeviation;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (
    !body ||
    !Array.isArray(body.deviation) ||
    body.deviation.length !== 36 ||
    !body.deviation.every((n) => Number.isFinite(n))
  ) {
    return Response.json(
      { error: 'invalid compass deviation (need 36 finite numbers)' },
      { status: 422 },
    );
  }
  await store.setCompassDeviation(body);
  return Response.json({ ok: true });
}
```

### Step 2: `page.tsx`

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CompassDeviation } from '@g5000/db';
import { useSse } from '../../../hooks/use-sse';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export default function CompassDeviationPage() {
  const [cal, setCal] = useState<CompassDeviation | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [edit, setEdit] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { channels } = useSse();
  const hdg = channels.get('boat.heading.magnetic');
  const cog = channels.get('nav.gps.cog');

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/compass-deviation', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/config/compass-deviation: ${res.status}`);
      const body = (await res.json()) as CompassDeviation;
      setCal(body);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (selected !== null && cal) {
      setEdit((cal.deviation[selected]! * RAD_TO_DEG).toFixed(2));
    }
  }, [selected, cal]);

  const handleApply = async (): Promise<void> => {
    if (!cal || selected === null) return;
    const d = Number(edit);
    if (!Number.isFinite(d)) {
      setErr('Deviation must be a finite number (degrees)');
      return;
    }
    const next: CompassDeviation = {
      deviation: cal.deviation.map((v, i) => (i === selected ? d * DEG_TO_RAD : v)),
    };
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/config/compass-deviation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`PUT failed: ${res.status} ${t}`);
      }
      setCal(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fmtAngle = (s: { value: { kind: string; value?: number } } | undefined): string => {
    if (!s || s.value.kind !== 'scalar') return '—';
    return `${(s.value.value! * RAD_TO_DEG).toFixed(1)}°`;
  };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Compass deviation</h1>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}

      <div className="grid grid-cols-2 gap-2 text-sm font-mono text-slate-300 max-w-xl">
        <div>Heading (mag): {fmtAngle(hdg as never)}</div>
        <div>GPS COG: {fmtAngle(cog as never)}</div>
      </div>
      <p className="text-xs text-slate-500 max-w-xl">
        Deviation = HDG_observed − HDG_true. With no current and a known variation, you can derive
        deviation per heading bin by comparing the compass against GPS COG on long straight runs.
      </p>

      {cal && (
        <div className="space-y-3">
          <table className="border-collapse text-xs font-mono">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-800">
                <th className="p-1">Bin start (°)</th>
                {cal.deviation.map((_, i) => (
                  <th key={i} className="p-1 text-right" style={{ minWidth: 32 }}>
                    {i * 10}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="p-1 text-slate-400 text-right pr-2">Dev (°)</th>
                {cal.deviation.map((d, i) => {
                  const isSel = selected === i;
                  return (
                    <td
                      key={i}
                      onClick={() => setSelected(i)}
                      className={`p-1 cursor-pointer text-right bg-slate-800 ${isSel ? 'ring-2 ring-amber-400' : ''}`}
                    >
                      {(d * RAD_TO_DEG).toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

          {selected !== null && (
            <div className="border border-slate-700 rounded p-4 space-y-3 max-w-xl">
              <div className="text-sm text-slate-300">
                Editing bin at{' '}
                <span className="font-mono">
                  {selected * 10}°–{selected * 10 + 10}°
                </span>{' '}
                heading
              </div>
              <label className="block text-sm">
                <span className="text-slate-400">Deviation (degrees, signed):</span>
                <input
                  type="number"
                  step="0.1"
                  value={edit}
                  onChange={(e) => setEdit(e.target.value)}
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
            </div>
          )}
        </div>
      )}
    </main>
  );
}
```

### Step 3: Typecheck

```
npm run typecheck --workspace=@g5000/web
```

### Step 4: Commit

```bash
git add packages/web/src/app/api/config/compass-deviation/route.ts packages/web/src/app/calibration/compass/page.tsx
git commit -m "feat(web): /calibration/compass page + /api/config/compass-deviation GET/PUT"
```

---

## Task 4: Final verification

- [ ] **Run tests + typecheck**
- [ ] **Smoke-test each page**: confirm each returns 200 and the API returns valid JSON
- [ ] **Lint and format**
- [ ] **Merge**

---

## Closing notes

After this plan, every cal-table and boat-config field is editable from the browser. The next-up plan is autopilot decode (listen-only) — parse the B&G proprietary autopilot PGNs into bus channels and build a `/autopilot` status page.
