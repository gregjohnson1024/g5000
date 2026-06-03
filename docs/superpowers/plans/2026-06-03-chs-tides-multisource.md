# Multi-Source Tides (add CHS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the tide feature to multiple sources auto-selected by region, and add the Canadian Hydrographic Service (CHS) IWLS source alongside the UK ADMIRALTY one — reusing the pure `@g5000/tide` pipeline unchanged.

**Architecture:** A `TideSource` interface in `@g5000/tide` (built by a `createTideSources({getAdmiraltyKey})` factory that keeps the package free of `process.env`), with `admiralty` (key-gated, UK bbox) and `chs` (no-key, Canada bbox) implementations. `TideService` and the `/api/tide` routes select the active source via `selectSource(sources, cfg, pos)` — auto-by-region with a config override — and feed its `TidalEvent[]` through the existing curve/snapshot pipeline. New `tide.source` channel.

**Tech Stack:** Node ≥22, ESM, strict TS composite refs, RxJS bus, SQLite/Drizzle ConfigStore, Next.js 16 web, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-chs-tides-multisource-design.md`

**Conventions:** one test file `npx vitest run <path>`; web typecheck `cd packages/web && npx tsc --noEmit`; full build `npx tsc -b`. Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Live-verified CHS shapes (probed 2026-06-03 — use as fixtures):**
- `GET https://api-sine.dfo-mpo.gc.ca/api/v1/stations` → array; element `{ id:"5cebf1df…", code:"00490", officialName:"Halifax", alternativeName, latitude:44.65914, longitude:-63.583386, operating, type, timeSeries:[{code:"wlp"},{code:"wlp-hilo"},…] }`.
- `GET /api/v1/stations/{id}/data?time-series-code=wlp-hilo&from={ISO}&to={ISO}` → array; element `{ eventDate:"2026-06-03T19:59:00Z", value:0.74, qcFlagCode, reviewed, timeSeriesId }`. **No HW/LW label — derive by alternation.** Halifax sample sequence: `0.74, 1.706, 0.425` → `LW, HW, LW`.

**Existing (reused unchanged):** `@g5000/tide` `types`/`curve`/`nearest`/`next-event`/`snapshot`, `admiralty-client` (`listStations(key)`, `getTidalEvents(key,id,days)`, `TideApiError`), `publishTideSnapshot`. `Channels.Tide.*`, `/tide` page, `/api/tide/*`, `NavigatingGroup` tide tile.

---

### Task 1: CHS IWLS client

**Files:**
- Create: `packages/tide/src/chs-client.ts`
- Test: `packages/tide/src/chs-client.test.ts`
- Modify: `packages/tide/src/index.ts` (export)

- [ ] **Step 1: Write the failing test `packages/tide/src/chs-client.test.ts`** (fixtures = real probed shapes):
```ts
import { describe, it, expect } from 'vitest';
import { parseChsStations, parseChsEvents } from './chs-client.js';

describe('parseChsStations', () => {
  it('maps prediction-capable stations and skips others', () => {
    const json = [
      { id: '5cebf1df3d0f4a073c4bbcbb', code: '00490', officialName: 'Halifax', latitude: 44.65914, longitude: -63.583386,
        timeSeries: [{ code: 'wlp' }, { code: 'wlp-hilo' }] },
      { id: 'x', code: '0', officialName: 'NoPredict', latitude: 50, longitude: -60, timeSeries: [{ code: 'wlo' }] }, // no wlp-hilo → skip
      { id: 'y', officialName: 'BadCoords', timeSeries: [{ code: 'wlp-hilo' }] }, // missing coords → skip
    ];
    expect(parseChsStations(json)).toEqual([
      { id: '5cebf1df3d0f4a073c4bbcbb', name: 'Halifax', lat: 44.65914, lon: -63.583386 },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(parseChsStations(null)).toEqual([]);
  });
});

describe('parseChsEvents', () => {
  it('derives HW/LW from the value alternation, sorted ascending', () => {
    const json = [
      { eventDate: '2026-06-04T01:55:00Z', value: 1.706 },
      { eventDate: '2026-06-03T19:59:00Z', value: 0.74 },
      { eventDate: '2026-06-04T08:31:00Z', value: 0.425 },
    ];
    expect(parseChsEvents(json)).toEqual([
      { type: 'LW', timeMs: Date.parse('2026-06-03T19:59:00Z'), heightM: 0.74 },
      { type: 'HW', timeMs: Date.parse('2026-06-04T01:55:00Z'), heightM: 1.706 },
      { type: 'LW', timeMs: Date.parse('2026-06-04T08:31:00Z'), heightM: 0.425 },
    ]);
  });
  it('types a lone extremum as HW (arbitrary; cannot bracket a curve)', () => {
    expect(parseChsEvents([{ eventDate: '2026-06-03T19:59:00Z', value: 1.0 }])).toEqual([
      { type: 'HW', timeMs: Date.parse('2026-06-03T19:59:00Z'), heightM: 1.0 },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(parseChsEvents(undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run packages/tide/src/chs-client.test.ts`.

- [ ] **Step 3: Implement `packages/tide/src/chs-client.ts`:**
```ts
import type { Station, TidalEvent } from './types.js';
import { TideApiError } from './admiralty-client.js';

const CHS_BASE = 'https://api-sine.dfo-mpo.gc.ca/api/v1';

/** Parse /stations into prediction-capable Station[]. Pure.
 *  Keeps only stations whose timeSeries includes 'wlp-hilo'. */
export function parseChsStations(json: unknown): Station[] {
  if (!Array.isArray(json)) return [];
  const out: Station[] = [];
  for (const s of json as Array<{
    id?: unknown; officialName?: unknown; latitude?: unknown; longitude?: unknown;
    timeSeries?: Array<{ code?: unknown }>;
  }>) {
    const series = Array.isArray(s.timeSeries) ? s.timeSeries : [];
    const hasHilo = series.some((t) => t?.code === 'wlp-hilo');
    if (
      hasHilo &&
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

/** Parse wlp-hilo extrema into TidalEvent[] sorted ascending, deriving HW/LW by
 *  alternation (no label in the API): event i is HW iff its value exceeds the
 *  adjacent extremum. Pure. */
export function parseChsEvents(json: unknown): TidalEvent[] {
  if (!Array.isArray(json)) return [];
  const pts: Array<{ timeMs: number; heightM: number }> = [];
  for (const e of json as Array<{ eventDate?: unknown; value?: unknown }>) {
    if (typeof e.eventDate === 'string' && typeof e.value === 'number') {
      const t = Date.parse(e.eventDate);
      if (!Number.isNaN(t)) pts.push({ timeMs: t, heightM: e.value });
    }
  }
  pts.sort((a, b) => a.timeMs - b.timeMs);
  return pts.map((p, i, arr) => {
    let type: 'HW' | 'LW';
    if (arr.length === 1) type = 'HW';
    else if (i === 0) type = p.heightM > arr[1]!.heightM ? 'HW' : 'LW';
    else type = p.heightM > arr[i - 1]!.heightM ? 'HW' : 'LW';
    return { type, timeMs: p.timeMs, heightM: p.heightM };
  });
}

async function chsGet(path: string): Promise<unknown> {
  const res = await fetch(`${CHS_BASE}${path}`);
  if (!res.ok) throw new TideApiError(`CHS ${path} → ${res.status}`, res.status);
  return res.json();
}

export async function chsListStations(): Promise<Station[]> {
  return parseChsStations(await chsGet('/stations'));
}

export async function chsGetTidalEvents(stationId: string, days: number): Promise<TidalEvent[]> {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + days * 86_400_000).toISOString();
  const path = `/stations/${encodeURIComponent(stationId)}/data?time-series-code=wlp-hilo&from=${from}&to=${to}`;
  return parseChsEvents(await chsGet(path));
}
```

- [ ] **Step 4: Run, verify PASS:** `npx vitest run packages/tide/src/chs-client.test.ts`.

- [ ] **Step 5: Export** — append to `packages/tide/src/index.ts`:
```ts
export { chsListStations, chsGetTidalEvents, parseChsStations, parseChsEvents } from './chs-client.js';
```
Build: `npx tsc -b packages/tide` (clean).

- [ ] **Step 6: Commit**
```bash
git add packages/tide/src/chs-client.ts packages/tide/src/chs-client.test.ts packages/tide/src/index.ts
git commit -m "feat(tide): CHS IWLS client + fixture-tested parsers (HW/LW by alternation)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: TideSource abstraction + selection

**Files:**
- Create: `packages/tide/src/sources.ts`
- Test: `packages/tide/src/sources.test.ts`
- Modify: `packages/tide/src/index.ts` (export)

- [ ] **Step 1: Write the failing test `packages/tide/src/sources.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { createTideSources, getTideSource, selectSource } from './sources.js';

const withKey = createTideSources({ getAdmiraltyKey: () => 'KEY' });
const noKey = createTideSources({ getAdmiraltyKey: () => undefined });

const ukPos = { lat: 55, lon: -2 };       // North Sea
const caPos = { lat: 44.659, lon: -63.58 }; // Halifax
const midAtlantic = { lat: 40, lon: -30 };

describe('coversPosition', () => {
  it('admiralty covers UK, not Canada', () => {
    const a = getTideSource(withKey, 'admiralty')!;
    expect(a.coversPosition(ukPos.lat, ukPos.lon)).toBe(true);
    expect(a.coversPosition(caPos.lat, caPos.lon)).toBe(false);
  });
  it('chs covers Canada, not UK', () => {
    const c = getTideSource(withKey, 'chs')!;
    expect(c.coversPosition(caPos.lat, caPos.lon)).toBe(true);
    expect(c.coversPosition(ukPos.lat, ukPos.lon)).toBe(false);
  });
});

describe('available', () => {
  it('admiralty needs a key; chs always available', () => {
    expect(getTideSource(withKey, 'admiralty')!.available()).toBe(true);
    expect(getTideSource(noKey, 'admiralty')!.available()).toBe(false);
    expect(getTideSource(noKey, 'chs')!.available()).toBe(true);
  });
});

describe('selectSource', () => {
  it('auto picks the covering available source', () => {
    expect(selectSource(withKey, { tideSource: 'auto' }, ukPos)?.id).toBe('admiralty');
    expect(selectSource(withKey, { tideSource: 'auto' }, caPos)?.id).toBe('chs');
  });
  it('auto → null when no source covers, no GPS, or covering source unavailable', () => {
    expect(selectSource(withKey, { tideSource: 'auto' }, midAtlantic)).toBeNull();
    expect(selectSource(withKey, { tideSource: 'auto' }, null)).toBeNull();
    expect(selectSource(noKey, { tideSource: 'auto' }, ukPos)).toBeNull(); // UK but no key
  });
  it('explicit override forces the source if available', () => {
    expect(selectSource(withKey, { tideSource: 'chs' }, ukPos)?.id).toBe('chs');
    expect(selectSource(noKey, { tideSource: 'admiralty' }, caPos)).toBeNull(); // forced but unavailable
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `npx vitest run packages/tide/src/sources.test.ts`.

- [ ] **Step 3: Implement `packages/tide/src/sources.ts`:**
```ts
import type { Station, TidalEvent } from './types.js';
import { listStations as admiraltyListStations, getTidalEvents as admiraltyGetTidalEvents } from './admiralty-client.js';
import { chsListStations, chsGetTidalEvents } from './chs-client.js';

export type TideSourceId = 'admiralty' | 'chs';

export interface TideSource {
  id: TideSourceId;
  coversPosition(lat: number, lon: number): boolean;
  available(): boolean;
  listStations(): Promise<Station[]>;
  getTidalEvents(stationId: string, days: number): Promise<TidalEvent[]>;
}

const inBbox = (
  lat: number, lon: number, latMin: number, latMax: number, lonMin: number, lonMax: number,
): boolean => lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;

/** Build the tide sources. The ADMIRALTY key is injected (getter) so this
 *  package never reads process.env. Both the service and the API routes
 *  build sources through this one factory. Coverage bboxes are coarse
 *  rectangles (heuristic; UK and Canada do not overlap). */
export function createTideSources(opts: { getAdmiraltyKey: () => string | undefined }): TideSource[] {
  return [
    {
      id: 'admiralty',
      coversPosition: (lat, lon) => inBbox(lat, lon, 48, 62, -14, 3), // UK EEZ
      available: () => opts.getAdmiraltyKey() != null,
      listStations: () => admiraltyListStations(opts.getAdmiraltyKey()!),
      getTidalEvents: (id, days) => admiraltyGetTidalEvents(opts.getAdmiraltyKey()!, id, days),
    },
    {
      id: 'chs',
      coversPosition: (lat, lon) => inBbox(lat, lon, 41, 84, -141, -52), // Canadian waters
      available: () => true,
      listStations: () => chsListStations(),
      getTidalEvents: (id, days) => chsGetTidalEvents(id, days),
    },
  ];
}

export function getTideSource(sources: ReadonlyArray<TideSource>, id: string): TideSource | undefined {
  return sources.find((s) => s.id === id);
}

/** Resolve the active source: explicit override (if available), else the first
 *  available source whose bbox contains `pos`. Null when none. */
export function selectSource(
  sources: ReadonlyArray<TideSource>,
  cfg: { tideSource: 'auto' | TideSourceId },
  pos: { lat: number; lon: number } | null,
): TideSource | null {
  if (cfg.tideSource !== 'auto') {
    const s = getTideSource(sources, cfg.tideSource);
    return s && s.available() ? s : null;
  }
  if (!pos) return null;
  for (const s of sources) {
    if (s.coversPosition(pos.lat, pos.lon) && s.available()) return s;
  }
  return null;
}
```

- [ ] **Step 4: Run, verify PASS:** `npx vitest run packages/tide/src/sources.test.ts`.

- [ ] **Step 5: Export** — append to `packages/tide/src/index.ts`:
```ts
export { createTideSources, getTideSource, selectSource, type TideSource, type TideSourceId } from './sources.js';
```
Build: `npx tsc -b packages/tide` (clean). Run `npx vitest run packages/tide` (all pass).

- [ ] **Step 6: Commit**
```bash
git add packages/tide/src/sources.ts packages/tide/src/sources.test.ts packages/tide/src/index.ts
git commit -m "feat(tide): TideSource abstraction + auto-by-region selection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `tide.source` channel

**Files:** Modify `packages/core/src/channels.ts`.

- [ ] **Step 1:** In the `Tide` group, add (after `Station`):
```ts
    /** Active tide source: 'admiralty' | 'chs'. */
    Source: 'tide.source',
```
- [ ] **Step 2:** `npx tsc -b packages/core` (clean).
- [ ] **Step 3: Commit**
```bash
git add packages/core/src/channels.ts
git commit -m "feat(tide): tide.source channel constant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Evolve `TideConfig`

**Files:** Modify `packages/db/src/defaults.ts` and `packages/db/src/config-store.test.ts`. (The `tide_config` Drizzle table and the `getTideConfig`/`setTideConfig` accessors are generic over the JSON value — unchanged.)

- [ ] **Step 1: Replace the `TideConfig` interface + default** in `defaults.ts` with:
```ts
import type { Station } from '@g5000/tide';

export interface TideConfig {
  /** Which source: 'auto' = pick by region; or force one. */
  tideSource: 'auto' | 'admiralty' | 'chs';
  /** Pinned station (carries its source); honored only when it matches the active source. */
  pinnedStation: { sourceId: 'admiralty' | 'chs'; stationId: string } | null;
  /** Per-source static station-list cache (refreshed ~weekly). */
  stationsCacheBySource: Partial<Record<'admiralty' | 'chs', { fetchedAtMs: number; stations: Station[] }>>;
}

export const DEFAULT_TIDE_CONFIG: TideConfig = {
  tideSource: 'auto',
  pinnedStation: null,
  stationsCacheBySource: {},
};
```
(Remove the old `pinnedStationId`/`defaultStationId`/`stationsCache` fields.)

- [ ] **Step 2: Update the existing tide-config test** in `config-store.test.ts` to the new shape — find the `'tide config'` test and change the mutation to the new fields:
```ts
  it('seeds tide config with defaults and persists a set across reopen', async () => {
    expect(store.getTideConfig()).toEqual(DEFAULT_TIDE_CONFIG);
    const next = { ...DEFAULT_TIDE_CONFIG, tideSource: 'chs' as const };
    await store.setTideConfig(next);
    await store.close();
    store = await ConfigStore.open(dbPath);
    expect(store.getTideConfig()).toEqual(next);
  });
```

- [ ] **Step 3: Build + test**
Run `npx tsc -b packages/db` (clean) — if `config-store.ts` references any removed field it'll fail; it shouldn't (accessors are generic), but if it does, the only valid fix is updating that reference to the new shape (report it). Run `npx vitest run packages/db/src/config-store.test.ts` (all pass).

- [ ] **Step 4: Commit**
```bash
git add packages/db/src/defaults.ts packages/db/src/config-store.test.ts
git commit -m "feat(db): evolve TideConfig for multi-source (tideSource, pinnedStation, per-source cache)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Refactor `TideService` to multi-source

**Files:** Modify `apps/g5000/src/tide-subsystem.ts`. (`publishTideSnapshot` and its test are UNCHANGED.)

- [ ] **Step 1: Replace everything from `export interface TideSubsystemDeps` to the end of the file** with the multi-source service (keep the imports line updated and `publishTideSnapshot` above it intact):

Update the import line at the top to:
```ts
import { tideSnapshot, nearestStation, createTideSources, selectSource, type TideSource, type Station, type TidalEvent } from '@g5000/tide';
```
(`tideSnapshot` stays — it's used by `publishTideSnapshot`. Remove `listStations`/`getTidalEvents` from the import.)

Then the service:
```ts
export interface TideSubsystemDeps {
  bus: Bus;
  store: ConfigStore;
}

/**
 * Multi-source tide bus publisher. Builds ADMIRALTY (key-gated) + CHS (no-key)
 * sources; each tick selects the active source by region/override, fetches its
 * station list (per-source weekly cache) and the active station's events
 * (rolling cache keeps a past event), and publishes tide.* + tide.source.
 * When no source is active (no GPS / outside coverage / unavailable) it
 * publishes nothing.
 */
export async function startTideSubsystem(deps: TideSubsystemDeps): Promise<() => Promise<void>> {
  const { bus, store } = deps;
  const sources = createTideSources({ getAdmiraltyKey: () => process.env.ADMIRALTY_TIDAL_API_KEY });

  let activeSource: TideSource | null = null;
  let stations: Station[] = [];
  let active: Station | null = null;
  let activeEvents: TidalEvent[] = [];
  let lastFetchDay = -1;
  let lastPos: { lat: number; lon: number } | null = null;
  const unsubs: Array<() => void> = [];

  async function ensureStations(source: TideSource): Promise<void> {
    const cache = store.getTideConfig().stationsCacheBySource[source.id];
    if (cache && Date.now() - cache.fetchedAtMs < WEEK_MS && cache.stations.length > 0) {
      stations = cache.stations;
      return;
    }
    try {
      stations = await source.listStations();
      const cfg = store.getTideConfig();
      await store.setTideConfig({
        ...cfg,
        stationsCacheBySource: { ...cfg.stationsCacheBySource, [source.id]: { fetchedAtMs: Date.now(), stations } },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[tide] station list fetch failed; using cache', e);
    }
  }

  function resolveStation(source: TideSource): Station | null {
    const pin = store.getTideConfig().pinnedStation;
    if (pin && pin.sourceId === source.id) return stations.find((s) => s.id === pin.stationId) ?? active;
    if (lastPos) return nearestStation(stations, lastPos, active);
    return active;
  }

  async function refresh(): Promise<void> {
    const cfg = store.getTideConfig();
    const nextSource = selectSource(sources, cfg, lastPos);
    if (!nextSource) {
      activeSource = null;
      active = null;
      activeEvents = [];
      return;
    }
    if (nextSource.id !== activeSource?.id) {
      activeSource = nextSource;
      active = null;
      activeEvents = [];
      lastFetchDay = -1;
      await ensureStations(nextSource);
    }
    const nextStation = resolveStation(nextSource);
    const today = Math.floor(Date.now() / DAY_MS);
    const stationChanged = nextStation?.id !== active?.id;
    if (nextStation && (stationChanged || today !== lastFetchDay)) {
      try {
        const fresh = await nextSource.getTidalEvents(nextStation.id, 7);
        const now = Date.now();
        const pastKept = activeEvents.filter((e) => e.timeMs <= now).slice(-1);
        const merged = stationChanged ? fresh : [...pastKept, ...fresh].sort((a, b) => a.timeMs - b.timeMs);
        activeEvents = merged.filter((e, i, arr) => i === 0 || e.timeMs !== arr[i - 1]!.timeMs);
        active = nextStation;
        lastFetchDay = today;
      } catch (e) {
        // Do NOT advance `active` on failure: keep name+events consistent and
        // retry next tick (stationChanged stays true). If this was the first
        // fetch after a source change, `active` stays null → publishes are
        // suppressed until a fetch succeeds.
        // eslint-disable-next-line no-console
        console.warn('[tide] events fetch failed; keeping cached', e);
      }
    } else if (nextStation) {
      active = nextStation;
    }
  }

  unsubs.push(
    bus.subscribe(Channels.Nav.Position, (s) => {
      if (s.value.kind === 'geo') lastPos = { lat: s.value.value.lat, lon: s.value.value.lon };
    }),
  );

  const tick = async (): Promise<void> => {
    await refresh();
    if (activeSource && active && activeEvents.length > 0) {
      const now = Date.now();
      bus.publish({
        channel: Channels.Tide.Source,
        t_ns: BigInt(Math.round(now * 1e6)),
        value: { kind: 'enum', value: activeSource.id },
        source: 'tide',
      });
      publishTideSnapshot(bus, active.name, activeEvents, now);
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), TICK_MS);

  // eslint-disable-next-line no-console
  console.log('[tide] tide service online (multi-source)');
  return async () => {
    clearInterval(timer);
    for (const u of unsubs) u();
  };
}
```

- [ ] **Step 2: Run the unchanged publishTideSnapshot test:** `npx vitest run apps/g5000/src/tide-subsystem.test.ts` (the existing 2 tests still pass — `publishTideSnapshot` is unchanged).

- [ ] **Step 3: Build:** `npx tsc -b apps/g5000` (clean).

- [ ] **Step 4: Commit**
```bash
git add apps/g5000/src/tide-subsystem.ts
git commit -m "feat(tide): multi-source TideService (auto-by-region, per-source cache, tide.source)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Refactor `/api/tide` routes to source-aware

**Files:** Modify `packages/web/src/app/api/tide/{stations,events,active,pin}/route.ts`.

All build sources via the shared factory: `const sources = createTideSources({ getAdmiraltyKey: () => process.env.ADMIRALTY_TIDAL_API_KEY })`. Read the current four routes first.

- [ ] **Step 1: `stations/route.ts`** — return the active source's cached list. The service caches per source in `stationsCacheBySource`; the route reports the *config-active* source's cache (resolve via `selectSource` needs position, which the route doesn't have — so report the cache for the explicitly-set source if `tideSource !== 'auto'`, else return all cached lists keyed by source so the page can show whichever is active). Simplest contract: return `{ ok, sources: { admiralty?: Station[], chs?: Station[] } }` from `stationsCacheBySource`, plus `{ activeSourceId: cfg.tideSource }` (the page already learns the *resolved* active source from the `tide.source` channel / `/active`). Implement:
```ts
import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const store = getSharedConfigStore();
  const cache = store.getTideConfig().stationsCacheBySource;
  const sources: Record<string, unknown> = {};
  for (const [id, c] of Object.entries(cache)) sources[id] = c?.stations ?? [];
  return NextResponse.json({ ok: true, sources });
}
```

- [ ] **Step 2: `events/route.ts`** — `?stationId=&source=`; resolve the named source via the factory:
```ts
import { NextResponse } from 'next/server';
import { createTideSources, getTideSource } from '@g5000/tide';

export const dynamic = 'force-dynamic';
const cache = new Map<string, { day: number; events: unknown }>();

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const stationId = url.searchParams.get('stationId');
  const sourceId = url.searchParams.get('source');
  if (!stationId || !sourceId) {
    return NextResponse.json({ ok: false, error: 'stationId and source required' }, { status: 400 });
  }
  const sources = createTideSources({ getAdmiraltyKey: () => process.env.ADMIRALTY_TIDAL_API_KEY });
  const source = getTideSource(sources, sourceId);
  if (!source || !source.available()) {
    return NextResponse.json({ ok: false, error: 'source unavailable' }, { status: 503 });
  }
  const key = `${sourceId}:${stationId}`;
  const day = Math.floor(Date.now() / 86_400_000);
  const hit = cache.get(key);
  if (hit && hit.day === day) return NextResponse.json({ ok: true, events: hit.events });
  try {
    const events = await source.getTidalEvents(stationId, 7);
    cache.set(key, { day, events });
    return NextResponse.json({ ok: true, events });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
```

- [ ] **Step 3: `active/route.ts`** — report config + pin:
```ts
import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const cfg = getSharedConfigStore().getTideConfig();
  const pin = cfg.pinnedStation;
  let name: string | null = null;
  if (pin) {
    name = cfg.stationsCacheBySource[pin.sourceId]?.stations.find((s) => s.id === pin.stationId)?.name ?? null;
  }
  return NextResponse.json({
    ok: true,
    tideSource: cfg.tideSource,
    pinned: pin !== null,
    pinnedStationId: pin?.stationId ?? null,
    pinnedSourceId: pin?.sourceId ?? null,
    pinnedName: name,
  });
}
```

- [ ] **Step 4: `pin/route.ts`** — `POST { stationId, sourceId } | { stationId: null }`:
```ts
import { NextResponse } from 'next/server';
import { getSharedConfigStore } from '@g5000/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }
  const b = body as { stationId?: unknown; sourceId?: unknown };
  const store = getSharedConfigStore();
  const cfg = store.getTideConfig();
  if (b.stationId === null) {
    await store.setTideConfig({ ...cfg, pinnedStation: null });
    return NextResponse.json({ ok: true });
  }
  if (typeof b.stationId !== 'string' || (b.sourceId !== 'admiralty' && b.sourceId !== 'chs')) {
    return NextResponse.json({ ok: false, error: 'stationId (string) + sourceId (admiralty|chs), or stationId:null' }, { status: 400 });
  }
  await store.setTideConfig({ ...cfg, pinnedStation: { sourceId: b.sourceId, stationId: b.stationId } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Typecheck + commit**
Run `cd packages/web && npx tsc --noEmit` (clean).
```bash
git add packages/web/src/app/api/tide
git commit -m "feat(tide): source-aware /api/tide routes (source param, per-source cache, pin w/ source)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Refactor `/tide` page to source-aware

**Files:** Modify `packages/web/src/app/tide/page.tsx`. Read the current page first.

- [ ] **Step 1:** Update the page so:
  - `/api/tide/stations` now returns `{ ok, sources: { admiralty?: Station[], chs?: Station[] } }`. Build the picker list from whichever source(s) have cached stations; if both, group/label by source. If the response is empty (no cached lists yet — e.g. no key and not yet in Canadian waters), show **"No tide source available yet — waiting for position / set ADMIRALTY_TIDAL_API_KEY"** instead of the old hardcoded key-only message.
  - When fetching events, pass BOTH `stationId` and `source` (the source the selected station belongs to) to `/api/tide/events?stationId=…&source=…`.
  - Show the selected station's **source label** (e.g. "Source: CHS" / "Source: ADMIRALTY") near the title.
  - Pin: `POST /api/tide/pin` with `{ stationId, sourceId }`; un-pin with `{ stationId: null }`. Read `/api/tide/active` for `tideSource`/pin state.
  - Keep the curve/table/now-marker/labels exactly as-is (the `TidalEvent[]` shape is unchanged; `@g5000/tide` `interpolateHeight`/`tideSnapshot` unchanged). Keep the Chart-Datum / approximate-curve / 7-day labels.
  - Each station option must carry its `sourceId` so the events fetch + pin know the source. Model the picker list as `{ sourceId, station }[]`.

- [ ] **Step 2: Build**
Run `cd packages/web && npx tsc --noEmit` then `cd packages/web && npm run build` → `/tide` in manifest. (Do not run a dev server; note manual DEMO_MODE smoke recommended, not performed.)

- [ ] **Step 3: Commit**
```bash
git add packages/web/src/app/tide/page.tsx
git commit -m "feat(web): source-aware /tide page (multi-source picker, source label, pin w/ source)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Helm tile source sub + mast test + full build/test

**Files:** Modify `packages/web/src/app/helm/groups/NavigatingGroup.tsx`, `packages/web/src/app/mast/format.test.ts`.

- [ ] **Step 1:** In `NavigatingGroup.tsx`, the existing "Tide" tile reads `tide.station` for its `sub`. Also read `tide.source` (`enumVal(channels.get('tide.source'))`) and include it in the sub (e.g. `` `${station} · ${source}` `` when both present). Keep graceful `—`/omit when absent.

- [ ] **Step 2:** In `mast/format.test.ts`, add a case asserting a `tide.source` enum sample renders its value verbatim (`{kind:'enum',value:'chs'}` → `'chs'`) via the existing enum passthrough.

- [ ] **Step 3: Full build + tests**
Run:
- `npx tsc -b` (whole workspace — exit 0).
- `npx vitest run packages/tide packages/db/src/config-store.test.ts apps/g5000/src/tide-subsystem.test.ts packages/web/src/app/mast/format.test.ts` (all pass).
- `cd packages/web && npm run build` (succeeds; `/tide` in manifest).

- [ ] **Step 4: Commit**
```bash
git add packages/web/src/app/helm/groups/NavigatingGroup.tsx packages/web/src/app/mast/format.test.ts
git commit -m "feat(web): show tide.source on helm tide tile + mast formatter test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** TideSource + factory + selection → Task 2; CHS client (HW/LW by alternation, wlp-hilo filter) → Task 1; `tide.source` channel → Task 3 (+ publish in Task 5, display Task 8); evolved TideConfig → Task 4; multi-source service (auto-by-region, per-source cache, matching-source pin, suppress-when-none, the no-desync catch retained) → Task 5; source-aware routes → Task 6; source-aware page → Task 7; helm sub + mast test → Task 8. Pure curve/nearest/snapshot reused unchanged. `@g5000/tide` stays pure (injected key). ✅

**Placeholder scan:** Task 7 (page) is concrete bullets over already-defined APIs + the unchanged `@g5000/tide` curve (the page is standard fetch+list+SVG glue, edited not rewritten) — no literal full-JSON dump, but every data source, prop, and message is specified. No TODO/TBD.

**Type consistency:** `TideSource`/`TideSourceId`, `createTideSources({getAdmiraltyKey})`, `selectSource(sources, {tideSource}, pos)`, `getTideSource` — consistent across package, service (Task 5), and routes (Task 6). `TideConfig` new shape (Task 4: `tideSource`/`pinnedStation`/`stationsCacheBySource`) matches the service's reads/writes (Task 5) and the routes (Task 6). `parseChsEvents`→`TidalEvent[]` matches the unchanged curve/snapshot. `Channels.Tide.Source` (Task 3) matches the publish (Task 5) + display (Task 8). Admiralty client signatures (`listStations(key)`, `getTidalEvents(key,id,days)`) wrapped unchanged by the admiralty source (Task 2).
