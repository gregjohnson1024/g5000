# Multi-source tides — add CHS (Canada), auto-by-region

**Date:** 2026-06-03
**Status:** design (approved in brainstorming)
**Builds on:** `docs/superpowers/specs/2026-06-02-tide-heights-design.md` (the ADMIRALTY UK tide feature). This adds a second source and a source abstraction; it does not change the pure tidal math.

## Summary

Generalize the tide feature to **multiple sources**, auto-selected by the boat's region, and add the **Canadian Hydrographic Service (CHS) Integrated Water Level System (IWLS)** as the Canadian source alongside the existing UK ADMIRALTY source.

- A `TideSource` interface (in `@g5000/tide`) abstracts the three ADMIRALTY-specific touchpoints. Two implementations: `admiralty` (UK, key-gated) and `chs` (Canada, **no key**).
- The active source is chosen **auto-by-region** (the source whose coverage bbox contains `nav.gps.position` and that is available), with a config override (`tideSource: 'auto'|'admiralty'|'chs'`, default `auto`) and graceful suppression when no source covers the position.
- The pure pipeline (`curve`/`nearest`/`next-event`/`snapshot` → `TidalEvent[]` → `tide.*` channels → `/tide` page) is **unchanged** and shared across both sources.

**Phase-0 already done (live):** CHS is open/no-key, so the IWLS shapes below were confirmed against the live API on 2026-06-03 (not reconstructed) — real fixtures are captured.

## Goals

- `TideSource` abstraction; ADMIRALTY refactored to implement it; CHS added.
- Auto-by-region source selection + explicit override + graceful "no source for this region."
- CHS IWLS client: `listStations` (filtered to prediction-capable stations) + `getTidalEvents` (HW/LW derived from `wlp-hilo` extrema).
- A `tide.source` bus channel so displays show which source is active.
- Keep `@g5000/tide` pure (no `process.env`) — the ADMIRALTY key is injected.

## Non-goals

- **No continuous-series curve** — CHS `wlp` (continuous water levels) would give an exact curve, but v1 uses `wlp-hilo` extrema → uniform `TidalEvent[]` + the existing cosine curve. Continuous is a future accuracy upgrade.
- **No US/NOAA source** — the abstraction makes it a clean later addition; not in scope.
- **No paid ADMIRALTY tiers**, no observed/forecast water levels, no tidal currents (the CHS API also exposes currents/temp/salinity — a separate future spec).
- No change to the curve/nearest/snapshot math or the `/tide` page layout beyond source-awareness.

## Verified CHS IWLS API shape (live probe, 2026-06-03)

- **Base:** `https://api-sine.dfo-mpo.gc.ca/api/v1`. **No auth/key.** Rate limits: 3 req/s, 30 req/min; per-request data windows (HW/LW over ~7 days is far under).
- `GET /stations` → JSON array (**1570** stations). Each: `{ id (ObjectId string, used in the path), code (e.g. "00490"), officialName (e.g. "Halifax"), alternativeName, latitude, longitude, operating, type, timeSeries: [{ code, … }] }`. The `timeSeries` array lists available series codes per station (e.g. `wlp`, `wlp-hilo`, `wlo`, `dvc1`).
- `GET /stations/{id}/data?time-series-code=wlp-hilo&from={ISO}&to={ISO}` → JSON array of extrema: `{ eventDate (ISO 8601 UTC, e.g. "2026-06-03T19:59:00Z"), value (metres), qcFlagCode, reviewed, timeSeriesId }`. **Sample (Halifax):** `0.74, 1.706, 0.425, …` — alternating low/high/low.
- ⚠️ **There is NO high/low label field.** `wlp-hilo` returns the extrema points only; HW vs LW must be **derived** from the value sequence (it strictly alternates).

## Architecture

### `TideSource` interface (`@g5000/tide`)
```ts
interface TideSource {
  id: 'admiralty' | 'chs';
  coversPosition(lat: number, lon: number): boolean;
  available(): boolean;
  listStations(): Promise<Station[]>;
  getTidalEvents(stationId: string, days: number): Promise<TidalEvent[]>;
}
```
- **Shared factory (keeps the package pure):** `createTideSources(opts: { getAdmiraltyKey: () => string | undefined }): TideSource[]` returns `[admiralty, chs]`. The ADMIRALTY key is **injected** via `getAdmiraltyKey` — `@g5000/tide` never reads `process.env`. Both the `TideService` and the `/api/tide` routes build sources through this one factory (no divergence). `getTideSource(sources, id)` helper for the routes' `source` param.
- **`admiralty` source:** wraps the existing `admiralty-client`; `coversPosition` = UK EEZ bbox (lon −14…+3, lat 48…62); `available()` = `getAdmiraltyKey() != null`; `listStations`/`getTidalEvents` call the existing client with the injected key.
- **`chs` source:** wraps the new `chs-client`; `coversPosition` = Canadian-waters bbox (lon −141…−52, lat 41…84 — both coasts, Arctic, Great Lakes); `available()` = always true; no key. The bboxes are coarse rectangles (documented as heuristic/tunable); UK and CA don't overlap.

### `chs-client.ts` (`@g5000/tide`, no key)
- `parseChsStations(json)`: array → `{ id, name: officialName, lat: latitude, lon: longitude }` for each station **whose `timeSeries` includes `wlp-hilo`** (so the picker only shows prediction-capable stations). Skips entries missing id/name/numeric coords. Pure.
- `parseChsEvents(json)`: array of `{eventDate, value}` (sorted ascending by time) → `TidalEvent[]`, **deriving HW/LW by alternation**: event *i* is `HW` iff its `value` is greater than the adjacent extremum — for `i ≥ 1`, `value[i] > value[i-1]` → HW else LW; for `i = 0`, `value[0] > value[1]` → HW else LW (single-element input → classify against itself is undefined, return that one event typed by comparison to none → treat a lone event as HW if no neighbor; documented edge). Pure.
- `listStations()` → `GET /stations` → `parseChsStations`. `getTidalEvents(stationId, days)` → `GET /stations/{id}/data?time-series-code=wlp-hilo&from={now}&to={now+days}` → `parseChsEvents`. Errors (429/5xx) throw a typed `TideApiError` like the ADMIRALTY client.

### Selection (`TideService`)
Config `tideSource`:
- **`auto`** (default): first *available* source whose `coversPosition(lat,lon)` is true for the live `nav.gps.position`.
- **`'admiralty'` / `'chs'`**: force that source if available.
- **No active source** (no GPS + no override, position outside all bboxes, or matched source unavailable) → suppress all `tide.*` channels; `/tide` page shows the no-source state.

On active-source change: fetch that source's station list (per-source cache), re-resolve the active station (matching-source pin, else nearest within that source's list), fetch its events. The ~30 s interpolation tick and `publishTideSnapshot` are unchanged, plus a new `tide.source` enum publish.

## Bus channels
Add `Tide.Source: 'tide.source'` (enum `'admiralty'|'chs'`) to the `Channels` catalog (auto mast-selectable; enum passthrough already handled by the mast formatter). All existing `tide.*` channels unchanged.

## ConfigStore — `TideConfig` evolves
(merge-over-defaults migration is trivial — new keys default in; the dropped single cache rebuilds on next fetch)
```ts
interface TideConfig {
  tideSource: 'auto' | 'admiralty' | 'chs';                 // default 'auto'
  pinnedStation: { sourceId: 'admiralty' | 'chs'; stationId: string } | null;  // pin carries its source; honored only when it matches the active source; doubles as the no-GPS anchor
  stationsCacheBySource: Partial<Record<'admiralty' | 'chs', { fetchedAtMs: number; stations: Station[] }>>;  // per-source weekly cache
}
export const DEFAULT_TIDE_CONFIG: TideConfig = { tideSource: 'auto', pinnedStation: null, stationsCacheBySource: {} };
```
(Replaces the old `pinnedStationId`/`defaultStationId`/`stationsCache`. `defaultStationId` is dropped — the pin doubles as the no-GPS anchor.)

## Touchpoint refactors
- `apps/g5000/src/tide-subsystem.ts`: build sources via `createTideSources({ getAdmiraltyKey: () => process.env.ADMIRALTY_TIDAL_API_KEY })`; replace the single-source key-gate + `listStations`/`getTidalEvents` calls with source resolution + per-source cache + the new pin model; publish `tide.source`. Graceful-off becomes "no active source → suppress."
- `packages/web/src/app/api/tide/`: `stations` returns the active source's list + `sourceId`; `events?stationId=&source=` resolves the named source via the factory and calls its `getTidalEvents` (drops the direct `ADMIRALTY_TIDAL_API_KEY` read); `active` → `{sourceId, pinned, stationId, name}`; `pin` accepts `{stationId, sourceId} | {stationId:null}`.
- `packages/web/src/app/tide/page.tsx`: show the active source label; the picker lists the active source's stations; replace the hardcoded "set ADMIRALTY_TIDAL_API_KEY" message with a source-aware state ("No tide source for this region" / "UK waters but ADMIRALTY key not set").
- `packages/web/src/app/helm/groups/NavigatingGroup.tsx`: the tide tile's `sub` shows `tide.source`.

## Testing (repo's pure-logic vitest convention)
- `@g5000/tide`:
  - `sources.test.ts` — `coversPosition` (UK pos → admiralty true / chs false; Canadian pos → chs true / admiralty false; mid-Atlantic → neither); `available()` (admiralty with/without injected key; chs always true); `createTideSources` selection helper (auto picks covering+available; explicit override; unavailable → null).
  - `chs-client.test.ts` — `parseChsStations` (maps fields; filters to `wlp-hilo`-capable; skips bad), `parseChsEvents` (**HW/LW derived by alternation** — e.g. `[0.74,1.706,0.425]` → `[LW,HW,LW]`; single event edge; non-array → []).
  - curve/nearest/next-event/snapshot tests unchanged (source-agnostic).
- `TideService` (`tide-subsystem.test.ts`) — active-source switch on position; per-source cache; pin honored only for the matching source; suppress when no source; `publishTideSnapshot` unchanged (existing test stays). Inject a fake clock + sources for determinism.
- Routes — `source` param resolution; existing tests updated to the injected-key interface.
- Mast `format.test.ts` — `tide.source` enum passthrough.
- ADMIRALTY parser tests unchanged.

## Edge cases
- No GPS + `auto` + no pin → no active source → suppress (page: "no position / pick a source").
- Position in UK bbox but `ADMIRALTY_TIDAL_API_KEY` unset → admiralty unavailable → no source → suppress with a "set key" hint.
- Source switch (UK↔Canada crossing): new source's list fetched, nearest re-resolved, pin ignored if it belonged to the other source.
- CHS `wlp-hilo` single-element / empty window → handled (lone event typed by fallback; empty → no events → `heightNow` null).
- CHS 429 → keep cached, retry next cadence.
- All times UTC; display local. Heights above Chart Datum (CD/CLLW) for both sources.

## Files (anticipated; the plan refines)
Create: `packages/tide/src/{sources.ts, chs-client.ts}` (+ tests). Modify: `packages/tide/src/index.ts` (export sources + chs client + the `TideSource` type), `packages/core/src/channels.ts` (`Tide.Source`), `packages/db/src/{defaults,schema?,config-store}.ts` (TideConfig shape — schema table unchanged, just the JSON value shape + accessors), `apps/g5000/src/tide-subsystem.ts`, `packages/web/src/app/api/tide/{stations,events,active,pin}/route.ts`, `packages/web/src/app/tide/page.tsx`, `packages/web/src/app/helm/groups/NavigatingGroup.tsx`. The ADMIRALTY client + the pure curve/nearest/snapshot modules are unchanged (ADMIRALTY client gets wrapped by a source, not rewritten).
