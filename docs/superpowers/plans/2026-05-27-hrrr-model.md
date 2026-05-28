# HRRR 3 km Inshore Wind Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) tracking. Read the files named in each task before editing — several exact strings must be discovered in-place.

**Goal:** Add HRRR (NOAA High-Resolution Rapid Refresh, 3 km, hourly, CONUS) as a fourth chart model alongside GFS / ECMWF / CMEMS, for high-detail near-shore US wind.

**Architecture:** HRRR GRIB2 is on a **Lambert Conformal Conic** grid, not lat/lon — so unlike GFS/ECMWF it must be **regridded with `wgrib2 -new_grid latlon`** to a regular lat/lon grid over the requested bbox before the existing parse → `WindGrid` → `WindOverlay` pipeline can consume it. Everything else is plumbing: extend the `WindModel`/`ChartModel` unions and the per-model records that thread through fetch, cache, refresh, manifest, and UI.

**Tech Stack:** NOMADS `filter_hrrr_2d.pl`, `wgrib2` (already a runtime dep for GFS/ECMWF parsing), MapLibre, the existing `wind-fetch.ts` machinery.

**Key constraints / gotchas (read first):**
- **CONUS only.** HRRR covers the continental US + coastal waters. Outside that domain the fetch/regrid yields empty data — the UI must message "HRRR has no data here" rather than show a blank overlay. Gate by a rough CONUS bbox (lat 21–53, lon -135 to -60).
- **Short horizon.** HRRR is hourly f00–f18 every run, extending to f00–f48 only on the 00/06/12/18z runs. Far shorter than GFS/ECMWF's 168 h — the timeline/slider must cope with a model whose max forecast hour is ~18–48.
- **Hourly runs.** HRRR runs every hour (00–23z), posted ~50–90 min after the hour. `pickHrrrRun` should lag ~2 h to be safe.
- **Lambert regrid is the crux.** `wgrib2 IN.grib2 -new_grid_winds earth -new_grid latlon <lon0>:<nx>:<dlon> <lat0>:<ny>:<dlat> OUT.grib2`. Choose dlon/dlat ≈ 0.03° (~3 km) to preserve HRRR detail; nx/ny from the bbox span. `-new_grid_winds earth` is REQUIRED so U/V are earth-relative (HRRR stores grid-relative winds — skip this and the wind directions will be wrong).
- Reference the **existing GFS path** in `packages/web/src/lib/wind-fetch.ts` (`fetchWindGrid`, the `wgrib2` spawn/parse, `WindGrid` assembly, `bboxKey`, `expectedRunUnix`) and mirror it. ECMWF's S3 `.index` byte-range fetch in the same file is a second reference pattern.

---

## File Structure

- `packages/web/src/lib/hrrr-fetch.ts` (new) — `buildHrrrUrl`, `pickHrrrRun`, `fetchHrrrGrid(bbox, hour, …)`: NOMADS fetch → `wgrib2` regrid → parse to `WindGrid` with `model:'hrrr'`. Mirrors `fetchWindGrid`.
- `packages/web/src/lib/hrrr-fetch.test.ts` (new) — unit tests for `buildHrrrUrl`, `pickHrrrRun`, CONUS bbox guard, hour cadence.
- `packages/web/src/lib/wind-fetch.ts` (modify) — widen `WindModel` to `'gfs' | 'ecmwf' | 'hrrr'`; add `expectedRunUnix('hrrr')` (hourly); ensure `bboxKey` handles hrrr.
- `packages/web/src/app/api/wind/route.ts` (modify) — accept `model=hrrr`; route to `fetchHrrrGrid`.
- `packages/web/src/app/api/forecast/refresh/route.ts` (modify) — allow `'hrrr'` in the model filter; add `'hrrr'` to `POOL_CONCURRENCY`; teach `hoursForModel` HRRR's hourly-but-short (≤18, or ≤48 on synoptic runs) cadence; route hrrr fetches to `fetchHrrrGrid`.
- `packages/web/src/app/chart/model-layer.ts` (modify) — `ChartModel` gains `'hrrr'`; `isWindModel`/`windModel` treat hrrr as a wind model.
- `packages/web/src/app/chart/LayersControl.tsx` (modify) — add an `HRRR (3 km wind)` radio option.
- `packages/web/src/components/WindOverlay.tsx` (modify) — widen the `WindModel`/`model` prop type to include `'hrrr'` (rendering is identical — same `WindGrid`).
- `packages/web/src/app/chart/page.tsx` (modify) — extend `availableHours` / `latestRunAt` records to include `hrrr`; the manifest sync loop, `REFRESH_MODELS`, and the timeline to handle hrrr's short horizon; a CONUS-domain notice when hrrr is selected but the ROI/viewport is outside coverage.
- `packages/web/src/app/forecast/page.tsx` (modify, if it has a per-model section) — surface HRRR availability/refresh like GFS/ECMWF.

---

### Task 1: HRRR URL + run-picker + cadence helpers (pure, TDD)

**Files:** Create `packages/web/src/lib/hrrr-fetch.ts` (+ `.test.ts`).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildHrrrUrl, pickHrrrRun, hrrrHorizonHours, inHrrrDomain } from './hrrr-fetch.js';

describe('hrrr helpers', () => {
  it('buildHrrrUrl targets filter_hrrr_2d with conus dir, 10 m wind, bbox subregion', () => {
    const u = new URL(
      buildHrrrUrl({
        runDateUtc: '2026-05-27',
        runHourUtc: 12,
        forecastHour: 3,
        bbox: { latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 },
      }),
    );
    expect(u.pathname).toContain('filter_hrrr_2d.pl');
    expect(u.searchParams.get('dir')).toBe('/hrrr.20260527/conus');
    expect(u.searchParams.get('file')).toBe('hrrr.t12z.wrfsfcf03.grib2');
    expect(u.searchParams.get('var_UGRD')).toBe('on');
    expect(u.searchParams.get('var_VGRD')).toBe('on');
    expect(u.searchParams.get('lev_10_m_above_ground')).toBe('on');
    expect(u.searchParams.get('subregion')).toBe('');
    expect(u.searchParams.get('toplat')).toBe('42');
  });

  it('pickHrrrRun lags ~2 h and picks the hourly run', () => {
    // 2026-05-27T15:10Z → with ~2h lag, the 13z run.
    const r = pickHrrrRun(Date.parse('2026-05-27T15:10:00Z') / 1000);
    expect(r.runDateUtc).toBe('2026-05-27');
    expect(r.runHourUtc).toBe(13);
  });

  it('hrrrHorizonHours: 18 h on off-hours, 48 h on synoptic runs', () => {
    expect(hrrrHorizonHours(13)).toBe(18);
    expect(hrrrHorizonHours(12)).toBe(48);
    expect(hrrrHorizonHours(0)).toBe(48);
  });

  it('inHrrrDomain rejects mid-ocean / non-US', () => {
    expect(inHrrrDomain({ latMin: 40, latMax: 42, lonMin: -72, lonMax: -70 })).toBe(true); // RI
    expect(inHrrrDomain({ latMin: 30, latMax: 34, lonMin: -64, lonMax: -60 })).toBe(false); // Bermuda
  });
});
```

- [ ] **Step 2:** Run `npx vitest run packages/web/src/lib/hrrr-fetch.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the helpers**

```ts
import type { Bbox } from '@g5000/grib';

const NOMADS = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_hrrr_2d.pl';

export interface BuildHrrrUrlOpts {
  runDateUtc: string; // YYYY-MM-DD
  runHourUtc: number; // 0..23
  forecastHour: number; // 0..18 (or ..48 on synoptic runs)
  bbox: Bbox;
}

export function buildHrrrUrl(o: BuildHrrrUrlOpts): string {
  const dateNoDash = o.runDateUtc.replace(/-/g, '');
  const hh = String(o.runHourUtc).padStart(2, '0');
  const ff = String(o.forecastHour).padStart(2, '0');
  const p = new URLSearchParams();
  p.set('dir', `/hrrr.${dateNoDash}/conus`);
  p.set('file', `hrrr.t${hh}z.wrfsfcf${ff}.grib2`);
  p.set('var_UGRD', 'on');
  p.set('var_VGRD', 'on');
  p.set('lev_10_m_above_ground', 'on');
  p.set('subregion', '');
  p.set('toplat', String(o.bbox.latMax));
  p.set('leftlon', String(o.bbox.lonMin));
  p.set('rightlon', String(o.bbox.lonMax));
  p.set('bottomlat', String(o.bbox.latMin));
  return `${NOMADS}?${p.toString()}`;
}

/** HRRR runs hourly, posts ~50–90 min after the hour; lag 2 h for safety. */
export function pickHrrrRun(atUnixSec: number): { runDateUtc: string; runHourUtc: number } {
  const d = new Date(atUnixSec * 1000 - 2 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { runDateUtc: `${y}-${m}-${day}`, runHourUtc: d.getUTCHours() };
}

/** f00–f18 on most runs; f00–f48 on the synoptic 00/06/12/18z runs. */
export function hrrrHorizonHours(runHourUtc: number): number {
  return runHourUtc % 6 === 0 ? 48 : 18;
}

/** Rough CONUS+coastal envelope. Outside this, HRRR has no data. */
export function inHrrrDomain(b: Bbox): boolean {
  return b.latMin >= 21 && b.latMax <= 53 && b.lonMin >= -135 && b.lonMax <= -60;
}
```

- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit `feat(web): HRRR URL/run/cadence/domain helpers`.

---

### Task 2: `fetchHrrrGrid` — fetch + Lambert regrid + parse to WindGrid

**Files:** `packages/web/src/lib/hrrr-fetch.ts` (extend). No new unit test (it shells `wgrib2` + network); covered by manual smoke + browser later.

- [ ] **Step 1:** Read `packages/web/src/lib/wind-fetch.ts` `fetchWindGrid` end-to-end — copy its structure for: temp-dir handling, the `wgrib2` spawn helper, GRIB→grid parse, and the returned `WindGrid` object shape (`{ lats, lons, u, v, prmsl?, validAt, runAt, forecastHour, model }`).

- [ ] **Step 2:** Implement `fetchHrrrGrid(bbox, forecastHour, cancel?, signal?)` mirroring `fetchWindGrid`, but insert a regrid stage between download and parse:
  - `pickHrrrRun(now)`; if `forecastHour > hrrrHorizonHours(run.runHourUtc)` → throw a clear "beyond HRRR horizon" error.
  - If `!inHrrrDomain(bbox)` → throw "outside HRRR domain".
  - Download `buildHrrrUrl(...)` to a temp `in.grib2`.
  - Regrid: spawn `wgrib2 in.grib2 -new_grid_winds earth -new_grid latlon <lon0>:<nx>:0.03 <lat0>:<ny>:0.03 out.grib2`, where `lon0=bbox.lonMin`, `lat0=bbox.latMin`, `nx=ceil((lonMax-lonMin)/0.03)`, `ny=ceil((latMax-latMin)/0.03)`. **Include `-new_grid_winds earth`** (HRRR winds are grid-relative; omitting this rotates them wrongly).
  - Parse `out.grib2` with the same wgrib2-json path GFS uses; assemble `WindGrid` with `model: 'hrrr'`, `runAt`/`validAt` from the run + forecastHour.
  - Return it.

- [ ] **Step 3:** Typecheck (`npm run typecheck`).
- [ ] **Step 4:** Manual smoke (dev server running): `curl "http://localhost:3000/api/wind?model=hrrr&...bbox...&hour=1"` after Task 3 wires the route — confirm a non-empty grid for a US-coastal bbox and a clean error for a mid-ocean bbox.
- [ ] **Step 5:** Commit `feat(web): fetchHrrrGrid with wgrib2 Lambert→latlon regrid`.

---

### Task 3: Thread HRRR through fetch/cache/refresh/wind-route

**Files:** `wind-fetch.ts`, `app/api/wind/route.ts`, `app/api/forecast/refresh/route.ts`.

- [ ] **Step 1:** `wind-fetch.ts` — widen `export type WindModel = 'gfs' | 'ecmwf' | 'hrrr';`. Add `expectedRunUnix('hrrr')` returning the hourly-lagged run epoch (mirror `pickHrrrRun`). Ensure `bboxKey(model, bbox, hour)` already keys on model (it does) so hrrr caches separately.
- [ ] **Step 2:** `app/api/wind/route.ts` — read existing GFS/ECMWF branch; add `model === 'hrrr'` → `fetchHrrrGrid(...)`. Mirror the response/caching shape.
- [ ] **Step 3:** `app/api/forecast/refresh/route.ts` —
  - Allow `'hrrr'` in the `models` filter (line ~`(m) => m === 'gfs' || m === 'ecmwf'`).
  - Add `hrrr: 4` to `POOL_CONCURRENCY`.
  - In `hoursForModel`, add: `hrrr` → hourly but capped at its horizon (`hours.filter((h) => h <= 18)` is a safe floor; the synoptic-48 case can be a later refinement).
  - In `fetchOne`, route `model === 'hrrr'` to `fetchHrrrGrid` (GFS/ECMWF branch today).
- [ ] **Step 4:** Typecheck. Commit `feat(web): wire HRRR through wind fetch/cache/refresh`.

---

### Task 4: UI — model selector, overlay type, timeline, CONUS notice

**Files:** `model-layer.ts`, `LayersControl.tsx`, `WindOverlay.tsx`, `chart/page.tsx`.

- [ ] **Step 1:** `model-layer.ts` — `ChartModel` gains `'hrrr'`; `isWindModel = model==='gfs'||model==='ecmwf'||model==='hrrr'`; `windModel` returns the model when it's any of the three. Update `model-layer.test.ts` with an `hrrr` case (wind shown, currentHidden true). 
- [ ] **Step 2:** `LayersControl.tsx` — add `<ModelRow label="HRRR (3 km)" active={state.model==='hrrr'} onClick={()=>onSelectModel('hrrr')} />`. The `ChartModel` validation array in `chart/page.tsx` hydration (`['none','gfs','ecmwf','cmems']`) must add `'hrrr'`.
- [ ] **Step 3:** `WindOverlay.tsx` — widen `export type WindModel = 'gfs' | 'ecmwf' | 'hrrr';` (rendering unchanged — same `WindGrid`).
- [ ] **Step 4:** `chart/page.tsx` —
  - Extend `availableHours` and `latestRunAt` state records from `{gfs,ecmwf}` to include `hrrr`.
  - The manifest-sync loop that buckets cached entries per model: add the hrrr bucket.
  - `REFRESH_MODELS` in `ForecastRoi` (currently `['gfs','ecmwf']`) — decide whether HRRR auto-refreshes with the ROI or only on demand. Recommended: include it ONLY when the ROI is `inHrrrDomain`, to avoid pointless mid-ocean HRRR fetches. (Import `inHrrrDomain`.)
  - Timeline: when `model==='hrrr'`, clamp the slider/`WIND_FORECAST_HOURS` view to the HRRR horizon (≤18/48) so it doesn't render 168 h of empty band.
  - Add a small notice in the wind-info panel when hrrr is selected but the viewport/ROI is outside CONUS: "HRRR covers US waters only — no data for this area."
- [ ] **Step 5:** Typecheck; `npx prettier --write` the touched files; run `npx vitest run packages/web/src/app/chart/model-layer.test.ts`.
- [ ] **Step 6:** Commit `feat(web): HRRR model selector, overlay, timeline + CONUS notice`.

---

### Task 5: Browser verification

- [ ] Dev server up (`SKIP_BRIDGE=1 DEMO_MODE=1 npm run dev --workspace @g5000/app`).
- [ ] Select **HRRR (3 km)** in the layers popover near the US coast (e.g. Rhode Island). Trigger a forecast refresh; confirm a visibly finer wind field than GFS/ECMWF in the same spot, with correct directions (sanity-check against GFS — if HRRR arrows are rotated relative to GFS, the `-new_grid_winds earth` flag is missing).
- [ ] Pan to mid-ocean (e.g. Bermuda) with HRRR selected; confirm the "US waters only" notice and no blank/garbage overlay.
- [ ] Confirm GFS/ECMWF/CMEMS still work unchanged.

---

## Self-Review

**Coverage:** fetch+regrid (Tasks 1–2), cache/refresh/route wiring (Task 3), UI selector/overlay/timeline/domain-notice (Task 4), verification (Task 5). The Lambert→latlon regrid with `-new_grid_winds earth` is called out as the critical correctness step. CONUS-only and short-horizon constraints are handled in `inHrrrDomain`, `hrrrHorizonHours`, the refresh gating, and the UI notice.

**Type consistency:** `WindModel` widened in BOTH `wind-fetch.ts` and `WindOverlay.tsx`; `ChartModel` widened in `model-layer.ts` and the hydration validation array; per-model records (`availableHours`, `latestRunAt`, `POOL_CONCURRENCY`, `expectedRun`) all gain `hrrr`. `fetchHrrrGrid`/`buildHrrrUrl`/`pickHrrrRun`/`hrrrHorizonHours`/`inHrrrDomain` names are consistent across tasks.

**Open investigation points (resolve while implementing, by reading the named files):** exact `wgrib2` json-parse path in `wind-fetch.ts`; exact shape of the `/api/wind` route's model branch and `availableHours`/manifest loop in `chart/page.tsx`; whether `/api/forecast/manifest` needs a per-model tweak for hrrr.
```
