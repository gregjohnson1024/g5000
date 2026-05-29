# Simplification audit (2026-05-28)

Codebase-wide read-only audit for **simplification** opportunities (dead code,
duplication, over-abstraction, oversized units). Run as 7 parallel auditors,
one per area; every "dead/unused" claim was grepped across `packages/*` +
`apps/*` before listing. **Filesystem/git is ground truth** — the code-review
graph holds stale phantom nodes (`apps/autopilot-server`, `/code/autopilot`)
that no longer exist; those were ignored.

Guardrails respected (NOT to be "simplified"): `globalThis.__g5000_*__`
singletons; the `@g5000/compute/race` subpath split; `serverExternalPackages`;
the `__above-wind__` z-order sentinel + MapLibre add/`beforeId`/`styledata`
patterns; disabled-but-preserved layers (Laylines, Seamark, **DriftArrow**);
the `(id, value JSON)` db schema; UTC-everywhere; compact-DMM lat/lon.

Risk = blast radius on the live boat system. LOC delta is net (deletions −,
relocations ~0). Confidence is the auditor's, after verifying against source.

---

## Tier 1 — Dead code (true deletions, low risk, high confidence)

| # | Location | What | LOC | Notes |
|---|----------|------|-----|-------|
| 1 | `packages/grib/src/cache.ts` (+ test) | Entire on-disk GRIB cache module — unused at runtime (web's `wind-fetch.ts` has its own cache) | −110 | delete after #2 |
| 2 | `packages/grib/src/fetch-gfs.ts`, `fetch-ecmwf.ts` (+ tests) | High-level GFS/ECMWF fetchers — dead, superseded by `web/src/lib/wind-fetch.ts`; **keep only `pickEcmwfRun`** (the one live import → move to `run-selection.ts`) | −350 | barrel `index.ts` re-exports trimmed (−20) |
| 3 | `packages/grib/src/parse-grib2.ts` | RTOFS vestiges: `UOGRD`/`VOGRD` in union+whitelist; `CurrentField` polymorphism in `parseGrib2Json` (currents never flow through it); unused `level` field | −8 | RTOFS removal confirmed |
| 4 | `packages/db/src/config-store.ts` + `schema.ts` | Completed polar-migration scaffolding: `polars$` getter, `setPolars()`/`setActiveRevision()` throwing stubs, orphaned `polars` drizzle table export, stale `migrate-wardrobe-v2.ts` comment | −30 | needs test edits (`pipeline.test.ts`, `config-store.test.ts` ref `polars$`); leave the SQLite DDL/table alone |
| 5 | `packages/web/src/lib/current-fetch.ts` | `todayUtcDate()` — exported, referenced nowhere (left behind by my recent refactor) | −8 | |
| 6 | `packages/web/src/components/SatelliteLayer.tsx` | `refreshSatTiles` — exported, zero callers | −14 | |
| 7 | `packages/compute/src/race/ocs-predictor.ts` | dead `export { haversineMeters }` re-export | −3 | |
| 8 | `apps/g5000/src/sd-notify.ts` | `notifyWatchdog` exported but only used in-file → demote private | 0 | |
| 9 | `packages/web/src/lib/ecmwf-global-cache.ts` | `GLOBAL_CACHE_CAP_BYTES` exported, only used in-file → demote | −1 | |

**Tier-1 total ≈ −540 LOC.** Biggest single win: the dead grib fetch/cache layer (#1–3, ~−490).

---

## Tier 2 — Safe dedup (byte-identical / pure; low risk, high confidence)

| # | Location | What → shared helper | LOC |
|---|----------|----------------------|-----|
| 10 | `core/selector.ts` vs `core/bus.ts` | `compileChannelPattern` is a byte-identical copy of `compilePattern` (comment admits it) → export+import the one in bus.ts | −28 |
| 11 | `compute/polars/math.ts` vs `compute/true-wind/math.ts` | `bilinear`/`locate` byte-identical → `compute/grid-interp.ts` | −35 |
| 12 | `web/components/WindOverlay.tsx` vs `CurrentOverlay.tsx` | `contourField` + `buildSpeedContours` near-identical pure fns → `lib/contour-field.ts` (keep the two distinct `FILL_STOPS`) | −90 |
| 13 | web `CogExtension`, `CurrentOverlay`, `AisTargets` | flat-earth `project()` re-defined; `projectGeo` already exists in `lib/wind-barb.ts` → consolidate | −30 |
| 14 | web `WindOverlay`/`CurrentOverlay` | identical MapLibre `step` color-expr builder loop → `buildStepExpr(stops)` | −20 |
| 15 | web `TrackOverlay`/`RoutePolyline` | byte-identical SOG `interpolate-hcl` ramp (comment says "matches") → shared constant | −15 |
| 16 | **geodesic sprawl** | great-circle + bearing re-implemented ~10× (web pages: chart, passage, routes, waypoints, OffscreenVesselIndicator; lib: distance-stats, eta-stats, track-recorder, tracks; compute: anchor-watch, line-geometry). Add `web/lib/geo.ts` (`greatCircleNm`,`bearingDeg`) + a `haversineM` for the metre callers. Cross-package (web vs compute) split — do web first | −90 (web), −30 (lib) |
| 17 | web `helm`, `chart` | DMM lat/lon re-implemented despite `lib/format-coords.ts` → import shared | −25 |
| 18 | web `passage`/`tracks`/`forecast` | duration formatter ×3 → `lib/tz.ts:formatDuration` | −20 |
| 19 | web `tracks`/`forecast`/`window` | UTC ISO-slice formatter dup → `lib/tz.ts:fmtUtcMinute` | −12 |
| 20 | web `routes.ts`/`waypoints.ts` | two `slugify()` → one | −5 |
| 21 | `compute/race/*` | `wrapToPi` open-coded 5× (vmc, wind-shift, line-geometry, index) → `race/geo.ts`; `wrapTwoPi` (cpa/current/race) → `compute/angles.ts` + a race copy (subpath split) | −18 |
| 22 | `compute/race/laylines.ts`+`ocs-predictor.ts` | identical great-circle `project()` → `race/geo.ts` | −15 |
| 23 | `bridge/driver-hub.ts` | 6× identical subscription error-handler → `loggingObserver(label)` | −15 |
| 24 | `db/defaults.ts` vs `core/selector.ts` | `SourcePriorityRule`/`Config` type defined twice → import from core | −23 |
| 25 | `web/lib/wind-fetch.ts` | ~50-line eccodes grid-assembly block duplicated in `fetchWindGrid` + `decodeUVGrib` → `recordsToGrid()` | −45 |
| 26 | units sprawl | `MS_TO_KN` (=1/0.514444) ~20×, `wrap360` ~5× → `lib/units.ts` (mostly de-risking) | ~−15 |

**Tier-2 total ≈ −560 LOC**, all true dedup with single sources of truth.

---

## Tier 3 — Decomposition (relocation; med risk; ~0 net LOC, shrinks god-components)

| # | Target | Extract | Shrinks |
|---|--------|---------|---------|
| 27 | `apps/g5000/src/index.ts` `main()` (635) | 5 helpers: `createLiveFactory` (live-factory.ts, **med** — teardown-binding inversion), `startRaceSubsystem`, `wireAlarmsHistory`, `startWebServer`, `startHlink` | 635 → ~150–200 |
| 28 | `web/app/passage/page.tsx` (1015) | `EnginePanel.tsx` (engine-logging sub-feature) | −440 |
| 29 | `web/app/ais/client-view.tsx` (1007) | `RadarScope.tsx`, `TargetsTable.tsx`, `use-threat-audio.ts` | −565 |
| 30 | `web/app/chart/page.tsx` (1502) | `WindTimeline.tsx` (185, has render-time setState to convert), `useForecastManifest` hook (dedups the triple bbox-stabilizer), `useLocalStorageState` hook (collapses ~4 hydrate/write pairs — preserve SSR ordering) | −250+ |
| 31 | `web/lib/wind-fetch.ts` (790) | split → `wind-cache.ts` / `wind-fetch.ts` / `wind-runs.ts` | organizational |

---

## Tier 4 — Larger dedup (med risk; needs care / explicit go-ahead)

| # | Target | What | LOC | Caveat |
|---|--------|------|-----|--------|
| 32 | `api/{tiles,seamark,enc,sat}-tiles/route.ts` | 4 near-identical proxies → one `tileProxy(opts)` factory | −340 | documented contract (x-cache, transparent-PNG, zoom band) must be preserved exactly; live chart |
| 33 | 32× `route.ts` | `parseJsonBody(req)` helper for the repeated JSON-parse-or-400 | −90 | error-envelope shapes differ; standardize |
| 34 | `db/config-store.ts` | registry-drive the 4×-repeated 14-table list + 7 trivial pass-through setters (keep validating setters explicit) | −60..−90 | most-touched file; full test suite must stay green |
| 35 | web `EncLayer`/`SatelliteLayer`/`EncBuoyLayer` | `useRasterTileLayer` hook for the ensure/styledata/visibility scaffold | −80 | must preserve no-isStyleLoaded + styledata-retry + sentinel |
| 36 | `bridge` 5 drivers | shared health-subject factory + `txPgnViaFrames` (do NOT touch ydwg reconnect/backoff) | −40 | |
| — | wind vs current disk caches | **DEFER** — only a 2-way `JsonDiskCache<T>` base at most; do NOT force a 4-way merge (ecmwf-global + sat are structurally unlike) | — | current was just refactored; wind is on the routing hot path |

---

## Judgment calls — do NOT auto-apply (owner decides)

- `web/components/DriftArrow.tsx` (156) — unmounted but preserved (same category as Seamark/Laylines). Delete only if confirmed.
- `web/app/ais/client-view.tsx` `northUp` dead branch (−6) — author comment keeps it for a future toggle.
- WindOverlay refetches every 30s (chart manifest poll allocates a fresh `availableHours` object → refreshKey churn) — a perf fix, med confidence; arguably a bug not a simplification.

## Doc/stale notes (not code)

- **CLAUDE.md + deploy-procedure memory reference `computeSailTimeline` "exported from `@g5000/routing`" — it does not exist anywhere** (grep-confirmed by 2 auditors). Either the doc is stale or the symbol was renamed; verify and fix the doc.
- `db/schema.ts` comment references `migrate-wardrobe-v2.ts` which doesn't exist.
- A couple of drifted code comments (AisTargets z-order claim contradicts LiveBoatMarker; etc.).

---

## Suggested execution order

1. **Tier 1** dead code (pure deletions, ~−540) — start with grib (#1–3), then the small dead exports. Test + typecheck gate each package.
2. **Tier 2** safe dedup (~−560) — pure helpers first (#10–15, 21–22), then the geodesic/format consolidations (#16–20), then eccodes/driver (#23, 25).
3. **Tier 3** decomposition — `main()` first (clear seams), then the page god-components.
4. **Tier 4** — explicit go-ahead per item; tile-proxy factory and ConfigStore registry are the biggest wins but riskiest.

Total mechanical reduction available before decomposition: **≈ −1,100 LOC** with low risk.

---

## Status — applied 2026-05-29 (all tiers)

Executed as 9 verify-gated phases on `develop`; every phase: file-disjoint apply
agents → (for relocations/factories) adversarial behavior-equivalence review →
`tsc -b` + full vitest, committed only when green. `next build` run as a gate on
every web-touching phase.

| Phase | Commit | Result |
|-------|--------|--------|
| Tier 1 dead code | `dc76ae0` | done (~−540) |
| Tier 2A core/compute/bridge/db dedup + polars$ retire | `a72d7b0` | done |
| Tier 2B web formatters/geo/units | `625e2f3` | done |
| Tier 2C map overlays + wind-fetch | `998f006` | done |
| Tier 3A passage/ais/wind-fetch decomp | `8b3dbe2` | done (reviews equivalent) |
| Tier 3B main() + chart timeline | `2e8b428` | done (reviews equivalent) |
| Tier 4A config-store registry / raster hook / driver base | `d42cd3e` | done |
| Tier 4B tile-proxy factory + parseJsonBody | `ebd63ca` | done (+31 char tests) |

God-components after Tier 3: chart 1502→~1277, passage 993→576, ais 1006→427,
`main()` 635→213, wind-fetch 788→426.

**Deferred (intentionally not applied):**
- Chart `useLocalStorageState` + `useForecastManifest` hook extractions (#30 partial)
  — restructure effect/SSR-hydration ordering for modest LOC; higher risk than a
  pure relocation, low reward. Left in `chart/page.tsx`.
- `DriftArrow.tsx` (unmounted-but-preserved, like Seamark/Laylines) — not deleted.
- ais `northUp` dead branch — kept per author's future-toggle comment.
- WindOverlay 30 s refetch (manifest-poll object-identity churn) — a perf/bug fix,
  not a relocation; out of scope for a behavior-preserving pass.
- Minor: `inspect/page.tsx` keeps its local `MS_TO_KN = 1.943844` (≠ `1/0.514444`)
  to preserve its exact output.

**Doc fix still owed:** CLAUDE.md (Deployment) + the deploy-procedure memory cite
`computeSailTimeline` "exported from `@g5000/routing`" — grep-confirmed it does not
exist. Stale reference to correct.

**Pre-promote gate (must pass before promoting `develop`→`main`/Pi):** `npm run build`
(done, green) + boot in demo mode and exercise a source-mode swap to runtime-verify
the new `main()` teardown path (no automated test covers `apps/g5000/index.ts`).
