# CHS Tidal-Current Predictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-contained `/currents` planning page showing CHS tidal-current predictions (set & drift over time + slack/max-flood/max-ebb events) for a chosen Canadian current station.

**Architecture:** New pure modules in `@g5000/tide` (the CHS marine-data package): `current-prediction.ts` (types + `currentNow` with circular direction interpolation + `nextCurrentEvent`) and `chs-currents.ts` (parsers + no-key fetchers that zip `wcsp1`+`wcdp1` and map `wcp1-events` qualifiers). Two cached `/api/currents/*` routes + a `/currents` page. No ConfigStore, no bus, no multi-source.

**Tech Stack:** Node ≥22, ESM, strict TS composite refs, Next.js 16 web, Vitest. CHS IWLS is open (no key).

**Spec:** `docs/superpowers/specs/2026-06-03-chs-tidal-currents-design.md`

**Conventions:** one test file `npx vitest run <path>`; web typecheck `cd packages/web && npx tsc --noEmit`; full build `npx tsc -b`. Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Live-verified CHS shapes (probed 2026-06-03 — fixtures):** current stations have `timeSeries` with both `wcsp1` (speed) & `wcdp1` (direction); `GET /stations/{id}/data?time-series-code=wcsp1&from=&to=` → quarter-hourly `{eventDate (ISO Z), value}` (speed, knots); `wcdp1` same shape (value = °true); `wcp1-events` → `{eventDate, value, qualifier}` with `qualifier ∈ {SLACK, EXTREMA_FLOOD, EXTREMA_EBB}` (slack value 0). `wcsp1`/`wcdp1` share identical `eventDate`s. Speed treated as **knots**.

**Existing reused:** `@g5000/tide` `types.ts` (`Station`), `chs-client.ts` (`TideApiError`, the private `chsGet` helper + `CHS_BASE` — Task 2 exports `chsGet`). Distinct from the gridded `CurrentOverlay` and `compute/current` — nothing existing changes.

**File structure:**
- `packages/tide/src/current-prediction.ts` (+ test) — pure types + `currentNow` + `nextCurrentEvent`.
- `packages/tide/src/chs-currents.ts` (+ test) — parsers + fetchers.
- `packages/tide/src/chs-client.ts` — MODIFY: `export` the `chsGet` helper.
- `packages/tide/src/index.ts` — MODIFY: export the new symbols.
- `packages/web/src/app/api/currents/{stations,predictions}/route.ts` — new routes.
- `packages/web/src/app/currents/page.tsx` — the page.

---

### Task 1: `current-prediction.ts` (pure model)

**Files:**
- Create: `packages/tide/src/current-prediction.ts`
- Test: `packages/tide/src/current-prediction.test.ts`

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, it, expect } from 'vitest';
import { currentNow, nextCurrentEvent } from './current-prediction.js';
import type { CurrentPrediction, CurrentEvent } from './current-prediction.js';

const min = 60_000;
const preds: CurrentPrediction[] = [
  { timeMs: 0, speedKn: 1.0, dirDeg: 350 },
  { timeMs: 60 * min, speedKn: 3.0, dirDeg: 10 },
];

describe('currentNow', () => {
  it('interpolates speed linearly and direction circularly', () => {
    const r = currentNow(preds, 30 * min);
    expect(r).not.toBeNull();
    expect(r!.speedKn).toBeCloseTo(2.0, 6);
    expect(r!.dirDeg).toBeCloseTo(0, 4); // circular midpoint of 350 and 10 is 0, NOT 180
  });
  it('returns the endpoints', () => {
    expect(currentNow(preds, 0)!.speedKn).toBeCloseTo(1.0, 6);
    expect(currentNow(preds, 60 * min)!.speedKn).toBeCloseTo(3.0, 6);
  });
  it('returns null when not bracketed', () => {
    expect(currentNow(preds, -1)).toBeNull();
    expect(currentNow(preds, 61 * min)).toBeNull();
    expect(currentNow([], 0)).toBeNull();
  });
});

describe('nextCurrentEvent', () => {
  const events: CurrentEvent[] = [
    { timeMs: 0, speedKn: 0, kind: 'slack' },
    { timeMs: 60 * min, speedKn: 3.0, kind: 'flood' },
  ];
  it('returns the first event strictly after now', () => {
    expect(nextCurrentEvent(events, 30 * min)?.kind).toBe('flood');
  });
  it('returns null when none remain', () => {
    expect(nextCurrentEvent(events, 61 * min)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run packages/tide/src/current-prediction.test.ts`.

- [ ] **Step 3: Implement `packages/tide/src/current-prediction.ts`:**
```ts
export interface CurrentPrediction {
  timeMs: number;
  /** Drift — current speed, knots. */
  speedKn: number;
  /** Set — current direction, degrees true [0,360). */
  dirDeg: number;
}

export type CurrentEventKind = 'slack' | 'flood' | 'ebb';

export interface CurrentEvent {
  timeMs: number;
  speedKn: number;
  kind: CurrentEventKind;
}

function bracket(
  preds: ReadonlyArray<CurrentPrediction>,
  nowMs: number,
): [CurrentPrediction, CurrentPrediction] | null {
  for (let i = 0; i < preds.length - 1; i++) {
    if (preds[i]!.timeMs <= nowMs && nowMs <= preds[i + 1]!.timeMs) {
      return [preds[i]!, preds[i + 1]!];
    }
  }
  return null;
}

/** Set & drift at nowMs from the ascending prediction series. Linear speed,
 *  circular direction (wrap-safe across 0/360). Null when no bracketing pair. */
export function currentNow(
  preds: ReadonlyArray<CurrentPrediction>,
  nowMs: number,
): { speedKn: number; dirDeg: number } | null {
  const pair = bracket(preds, nowMs);
  if (!pair) return null;
  const [a, b] = pair;
  const span = b.timeMs - a.timeMs;
  const f = span === 0 ? 0 : (nowMs - a.timeMs) / span;
  const speedKn = a.speedKn + f * (b.speedKn - a.speedKn);
  const ar = (a.dirDeg * Math.PI) / 180;
  const br = (b.dirDeg * Math.PI) / 180;
  const x = (1 - f) * Math.cos(ar) + f * Math.cos(br);
  const y = (1 - f) * Math.sin(ar) + f * Math.sin(br);
  let dirDeg = (Math.atan2(y, x) * 180) / Math.PI;
  if (dirDeg < 0) dirDeg += 360;
  return { speedKn, dirDeg };
}

/** First event strictly after nowMs (events assumed ascending), or null. */
export function nextCurrentEvent(
  events: ReadonlyArray<CurrentEvent>,
  nowMs: number,
): CurrentEvent | null {
  for (const e of events) {
    if (e.timeMs > nowMs) return e;
  }
  return null;
}
```

- [ ] **Step 4: Run, verify PASS:** `npx vitest run packages/tide/src/current-prediction.test.ts`.

- [ ] **Step 5: Commit:**
```bash
git add packages/tide/src/current-prediction.ts packages/tide/src/current-prediction.test.ts
git commit -m "feat(currents): current-prediction model (currentNow circular interp, nextCurrentEvent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `chs-currents.ts` (parsers + fetchers)

**Files:**
- Create: `packages/tide/src/chs-currents.ts`
- Test: `packages/tide/src/chs-currents.test.ts`
- Modify: `packages/tide/src/chs-client.ts` (export `chsGet`), `packages/tide/src/index.ts` (exports)

- [ ] **Step 1: Export the CHS HTTP helper.** In `packages/tide/src/chs-client.ts`, change the private `async function chsGet(` to `export async function chsGet(` (no other change). This lets the currents fetchers reuse the same base URL + `TideApiError` handling.

- [ ] **Step 2: Write the failing test `packages/tide/src/chs-currents.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { parseChsCurrentStations, parseChsCurrentSeries, parseChsCurrentEvents } from './chs-currents.js';

describe('parseChsCurrentStations', () => {
  it('keeps stations with both wcsp1 and wcdp1', () => {
    const json = [
      { id: 'a', officialName: 'Big Bras dOr', latitude: 46.28, longitude: -60.42,
        timeSeries: [{ code: 'wcsp1' }, { code: 'wcdp1' }, { code: 'wcp1-events' }] },
      { id: 'b', officialName: 'SpeedOnly', latitude: 50, longitude: -60, timeSeries: [{ code: 'wcsp1' }] },
      { id: 'c', officialName: 'Tide', latitude: 50, longitude: -60, timeSeries: [{ code: 'wlp-hilo' }] },
    ];
    expect(parseChsCurrentStations(json)).toEqual([
      { id: 'a', name: 'Big Bras dOr', lat: 46.28, lon: -60.42 },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(parseChsCurrentStations(null)).toEqual([]);
  });
});

describe('parseChsCurrentSeries', () => {
  it('inner-joins speed and direction by eventDate, sorted', () => {
    const speed = [
      { eventDate: '2026-06-03T19:00:00Z', value: 3.0 },
      { eventDate: '2026-06-03T18:45:00Z', value: 2.0 },
      { eventDate: '2026-06-03T19:15:00Z', value: 1.0 }, // no matching dir → dropped
    ];
    const dir = [
      { eventDate: '2026-06-03T18:45:00Z', value: 50 },
      { eventDate: '2026-06-03T19:00:00Z', value: 60 },
    ];
    expect(parseChsCurrentSeries(speed, dir)).toEqual([
      { timeMs: Date.parse('2026-06-03T18:45:00Z'), speedKn: 2.0, dirDeg: 50 },
      { timeMs: Date.parse('2026-06-03T19:00:00Z'), speedKn: 3.0, dirDeg: 60 },
    ]);
  });
  it('returns [] when either input is non-array', () => {
    expect(parseChsCurrentSeries(null, [])).toEqual([]);
  });
});

describe('parseChsCurrentEvents', () => {
  it('maps qualifiers to kinds, sorted, skips unknown', () => {
    const json = [
      { eventDate: '2026-06-04T03:37:00Z', value: 2.3, qualifier: 'EXTREMA_FLOOD' },
      { eventDate: '2026-06-03T20:49:00Z', value: 3.5, qualifier: 'EXTREMA_EBB' },
      { eventDate: '2026-06-04T00:49:00Z', value: 0.0, qualifier: 'SLACK' },
      { eventDate: '2026-06-04T09:00:00Z', value: 1.0, qualifier: 'WHATEVER' }, // skip
    ];
    expect(parseChsCurrentEvents(json)).toEqual([
      { timeMs: Date.parse('2026-06-03T20:49:00Z'), speedKn: 3.5, kind: 'ebb' },
      { timeMs: Date.parse('2026-06-04T00:49:00Z'), speedKn: 0.0, kind: 'slack' },
      { timeMs: Date.parse('2026-06-04T03:37:00Z'), speedKn: 2.3, kind: 'flood' },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(parseChsCurrentEvents(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, verify FAIL:** `npx vitest run packages/tide/src/chs-currents.test.ts`.

- [ ] **Step 4: Implement `packages/tide/src/chs-currents.ts`:**
```ts
import type { Station } from './types.js';
import { chsGet } from './chs-client.js';
import type { CurrentPrediction, CurrentEvent, CurrentEventKind } from './current-prediction.js';

/** Stations with BOTH current-speed (wcsp1) and current-direction (wcdp1) predictions. Pure. */
export function parseChsCurrentStations(json: unknown): Station[] {
  if (!Array.isArray(json)) return [];
  const out: Station[] = [];
  for (const s of json as Array<{
    id?: unknown; officialName?: unknown; latitude?: unknown; longitude?: unknown;
    timeSeries?: Array<{ code?: unknown }>;
  }>) {
    const codes = Array.isArray(s.timeSeries) ? s.timeSeries.map((t) => t?.code) : [];
    if (
      codes.includes('wcsp1') &&
      codes.includes('wcdp1') &&
      typeof s.id === 'string' &&
      typeof s.officialName === 'string' &&
      typeof s.latitude === 'number' &&
      typeof s.longitude === 'number'
    ) {
      out.push({ id: s.id, name: s.officialName, lat: s.latitude, lon: s.longitude });
    }
  }
  return out;
}

/** Inner-join the speed (wcsp1) and direction (wcdp1) series by eventDate.
 *  Keeps only timestamps present in BOTH. Sorted ascending. Pure. */
export function parseChsCurrentSeries(speedJson: unknown, dirJson: unknown): CurrentPrediction[] {
  if (!Array.isArray(speedJson) || !Array.isArray(dirJson)) return [];
  const dirByDate = new Map<string, number>();
  for (const e of dirJson as Array<{ eventDate?: unknown; value?: unknown }>) {
    if (typeof e.eventDate === 'string' && typeof e.value === 'number') dirByDate.set(e.eventDate, e.value);
  }
  const out: CurrentPrediction[] = [];
  for (const e of speedJson as Array<{ eventDate?: unknown; value?: unknown }>) {
    if (typeof e.eventDate === 'string' && typeof e.value === 'number' && dirByDate.has(e.eventDate)) {
      const t = Date.parse(e.eventDate);
      if (!Number.isNaN(t)) out.push({ timeMs: t, speedKn: e.value, dirDeg: dirByDate.get(e.eventDate)! });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

const QUALIFIER_KIND: Record<string, CurrentEventKind> = {
  SLACK: 'slack',
  EXTREMA_FLOOD: 'flood',
  EXTREMA_EBB: 'ebb',
};

/** Parse wcp1-events turning points. Pure. Sorted ascending; skips unknown qualifiers. */
export function parseChsCurrentEvents(json: unknown): CurrentEvent[] {
  if (!Array.isArray(json)) return [];
  const out: CurrentEvent[] = [];
  for (const e of json as Array<{ eventDate?: unknown; value?: unknown; qualifier?: unknown }>) {
    const kind = typeof e.qualifier === 'string' ? QUALIFIER_KIND[e.qualifier] : undefined;
    if (kind && typeof e.eventDate === 'string' && typeof e.value === 'number') {
      const t = Date.parse(e.eventDate);
      if (!Number.isNaN(t)) out.push({ timeMs: t, speedKn: e.value, kind });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

const window = (hours: number): { from: string; to: string } => ({
  from: new Date().toISOString(),
  to: new Date(Date.now() + hours * 3_600_000).toISOString(),
});

export async function chsListCurrentStations(): Promise<Station[]> {
  return parseChsCurrentStations(await chsGet('/stations'));
}

export async function chsGetCurrentPredictions(stationId: string, hours = 48): Promise<CurrentPrediction[]> {
  const { from, to } = window(hours);
  const enc = encodeURIComponent(stationId);
  const [speed, dir] = await Promise.all([
    chsGet(`/stations/${enc}/data?time-series-code=wcsp1&from=${from}&to=${to}`),
    chsGet(`/stations/${enc}/data?time-series-code=wcdp1&from=${from}&to=${to}`),
  ]);
  return parseChsCurrentSeries(speed, dir);
}

export async function chsGetCurrentEvents(stationId: string, hours = 48): Promise<CurrentEvent[]> {
  const { from, to } = window(hours);
  const enc = encodeURIComponent(stationId);
  return parseChsCurrentEvents(await chsGet(`/stations/${enc}/data?time-series-code=wcp1-events&from=${from}&to=${to}`));
}
```

- [ ] **Step 5: Run, verify PASS:** `npx vitest run packages/tide/src/chs-currents.test.ts`.

- [ ] **Step 6: Export** — append to `packages/tide/src/index.ts`:
```ts
export type { CurrentPrediction, CurrentEvent, CurrentEventKind } from './current-prediction.js';
export { currentNow, nextCurrentEvent } from './current-prediction.js';
export { chsListCurrentStations, chsGetCurrentPredictions, chsGetCurrentEvents, parseChsCurrentStations, parseChsCurrentSeries, parseChsCurrentEvents } from './chs-currents.js';
```
Build: `npx tsc -b packages/tide` (clean). Run `npx vitest run packages/tide` (all pass).

- [ ] **Step 7: Commit:**
```bash
git add packages/tide/src/chs-currents.ts packages/tide/src/chs-currents.test.ts packages/tide/src/chs-client.ts packages/tide/src/index.ts
git commit -m "feat(currents): CHS current client (zip wcsp1+wcdp1, wcp1-events qualifiers)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `/api/currents` routes

**Files:**
- Create: `packages/web/src/app/api/currents/stations/route.ts`, `packages/web/src/app/api/currents/predictions/route.ts`

Read an existing route (`packages/web/src/app/api/tide/events/route.ts`) for the idiom.

- [ ] **Step 1: `stations/route.ts`** (module-cached weekly, since the `/stations` fetch is large):
```ts
import { NextResponse } from 'next/server';
import { chsListCurrentStations } from '@g5000/tide';

export const dynamic = 'force-dynamic';

let cache: { at: number; stations: unknown } | null = null;
const TTL_MS = 7 * 86_400_000;

export async function GET(): Promise<NextResponse> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ ok: true, stations: cache.stations });
  }
  try {
    const stations = await chsListCurrentStations();
    cache = { at: Date.now(), stations };
    return NextResponse.json({ ok: true, stations });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
```

- [ ] **Step 2: `predictions/route.ts`** (`?stationId=`, cached per station+UTC day):
```ts
import { NextResponse } from 'next/server';
import { chsGetCurrentPredictions, chsGetCurrentEvents } from '@g5000/tide';

export const dynamic = 'force-dynamic';
const cache = new Map<string, { day: number; predictions: unknown; events: unknown }>();

export async function GET(req: Request): Promise<NextResponse> {
  const stationId = new URL(req.url).searchParams.get('stationId');
  if (!stationId) return NextResponse.json({ ok: false, error: 'stationId required' }, { status: 400 });
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(stationId);
  if (hit && hit.day === day) {
    return NextResponse.json({ ok: true, predictions: hit.predictions, events: hit.events });
  }
  try {
    const [predictions, events] = await Promise.all([
      chsGetCurrentPredictions(stationId, 48),
      chsGetCurrentEvents(stationId, 48),
    ]);
    cache.set(stationId, { day, predictions, events });
    return NextResponse.json({ ok: true, predictions, events });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
```

- [ ] **Step 3: Typecheck + commit**
Run `cd packages/web && npx tsc --noEmit` (clean; if `@g5000/tide` types missing run `npx tsc -b packages/tide` from root first).
```bash
git add packages/web/src/app/api/currents
git commit -m "feat(currents): /api/currents stations + predictions routes (cached, CHS open)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `/currents` page + full build/test

**Files:**
- Create: `packages/web/src/app/currents/page.tsx`

Read `packages/web/src/app/tide/page.tsx` and `packages/web/src/components/WindShiftPlot.tsx` first to match the page idiom + SVG style.

- [ ] **Step 1: Implement `packages/web/src/app/currents/page.tsx`** — a `'use client'` component that:
  - On mount, `fetch('/api/currents/stations')` → `{ok, stations}`; if `!ok`, show "CHS currents unavailable (try again)". Default-select the first station.
  - On station select, `fetch('/api/currents/predictions?stationId=…')` → `{ok, predictions, events}` (types: `CurrentPrediction[]` / `CurrentEvent[]` from `@g5000/tide`). Wrap `.json()` in `.catch`.
  - **Station picker:** filter input + `<select>` over the stations (search by name); the selected station's id always present in the options.
  - **Drift-over-time SVG graph:** plot `predictions[].speedKn` (y, kn) vs `timeMs` (x) over the window as a polyline (reuse the WindShiftPlot/tide-curve SVG approach — fixed viewBox, padded, y inverted so faster = higher). Overlay `events` as small markers at their `(timeMs, speedKn)` with a one-letter/colour cue per `kind` (slack/flood/ebb). A vertical **now** line at `Date.now()` gated to the x-range.
  - **Now readout:** `currentNow(predictions, Date.now())` from `@g5000/tide` → "Set 054° · Drift 2.6 kn · → flood" where the phase is `\`→ ${nextCurrentEvent(events, Date.now())?.kind}\`` (heading toward the next event), or "—" when `currentNow` is null.
  - **Events table:** rows for each event — local time, `kind` (Slack / Max flood / Max ebb), speed `X.X kn` (omit speed for slack or show 0.0).
  - **Labels:** "Drift in knots", "Set in °true", "predictions · 48 h", local times, and a one-line note: "Tidal-stream predictions at a CHS current station — distinct from the chart's ocean-current overlay."
  - Use `@g5000/tide` (`currentNow`, `nextCurrentEvent`, the types) for the readout; `packages/web` already depends on `@g5000/tide`.
  - Numbers: `speedKn.toFixed(1)`, `dirDeg` rounded to a 3-digit `padStart(3,'0')` degrees. Guard all reads (no NaN; `—` when absent).

- [ ] **Step 2: Build**
Run `cd packages/web && npx tsc --noEmit` then `cd packages/web && npm run build` → `/currents` in the route manifest. (Do not run a dev server; note manual DEMO_MODE smoke recommended, not performed.)

- [ ] **Step 3: Full workspace gate**
Run `npx tsc -b` (whole workspace — exit 0) and `npx vitest run packages/tide` (all pass — current-prediction + chs-currents included).

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/app/currents/page.tsx
git commit -m "feat(web): /currents page (CHS tidal-current set/drift graph + slack/max events)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** pure model (`currentNow` circular interp, `nextCurrentEvent`) → Task 1; CHS parsers (station filter wcsp1&wcdp1, inner-join speed+dir, qualifier mapping) + no-key fetchers → Task 2; cached routes → Task 3; `/currents` page (picker, drift graph + event markers + now-marker, set/drift-now readout, events table, labels) → Task 4. CHS open (no key), no bus/ConfigStore/multi-source, distinct-from-overlay note → Tasks 3/4. ✅

**Placeholder scan:** Task 4 (page) is concrete bullets over already-defined APIs + the `@g5000/tide` pure fns (standard fetch+list+SVG glue, mirroring the existing `/tide` page) — every data source, number format, label, and SVG behaviour is specified; no TODO/TBD. Task 2 Step 1 modifies one word (`export`) in `chs-client.ts` — exact.

**Type consistency:** `CurrentPrediction`/`CurrentEvent`/`CurrentEventKind` defined in Task 1, imported by Task 2 (`chs-currents`) and Task 4 (page). `currentNow`/`nextCurrentEvent` signatures consistent across Task 1 (def), the barrel (Task 2), and the page (Task 4). `chsGet` exported (Task 2 Step 1) and imported by `chs-currents` (Task 2 Step 4). Route function names (`chsListCurrentStations`/`chsGetCurrentPredictions`/`chsGetCurrentEvents`) match Task 2's exports. `Station` reused unchanged.
