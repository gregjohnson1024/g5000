# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

G5000 is a sailing instrumentation platform for a real boat (`Sula`). It ingests NMEA 2000 / NMEA 0183 from B&G/Navico/YDWG hardware, runs compute pipelines (true wind, polars, currents, routing), serves a Next.js web UI with helm/chart/forecast/autopilot views, and exposes its data back out via an H-LINK TCP server so Expedition can read it. Production target is a Raspberry Pi (`sula-bassana`) running a single Node systemd service.

Git remote is GitHub (`github.com/gregjohnson1024/g5000`). Public repo; deploy on the Pi pulls from this remote via HTTPS (no auth needed for `git pull` on a public repo). Switched from a private Forgejo at `git.rbr-global.com` on 2026-05-18 — if a stale clone is still pointing there, it'll fail to pull and needs `git remote set-url origin https://github.com/gregjohnson1024/g5000.git`.

## Commands

```bash
npm test                       # vitest run, includes packages/* and apps/* (61 test files)
npm run test:watch
npx vitest run path/to/file.test.ts          # single file
npx vitest run -t "pattern"                  # single test by name
npm run typecheck              # tsc -b across all project references
npm run build                  # build every workspace; web uses `next build --webpack`
npm run lint                   # prettier --check .
npm run format                 # prettier --write .
npm run dev --workspace @g5000/app   # local dev: tsx watch, web mounted at :3000
npm run fetch --workspace @g5000/coastline        # one-shot: pull coastline data (gitignored)
npm run bench --workspace @g5000/routing          # routing benchmarks
```

Node ≥22, ESM-only, strict TypeScript (`noUncheckedIndexedAccess`, composite project refs).

The `g5000 app`'s `predev` and `prebuild` scripts run `tsc -b` on `core`, `db`, `compute`, and `bridge` before `tsx watch` / `tsc -b` start, so the composite-ref rebuild order documented under _Deployment_ is enforced automatically in dev — you don't need to remember it locally, only on the Pi.

### Env-var gates

Common runtime knobs (set on the g5000 app process):

- `DEMO_MODE=1` — boot in demo mode (synthetic injector instead of NGT-1 / YDWG).
- `REPLAY=path/to/session.jsonl.gz` + `REPLAY_MODE=asap|realtime` — boot in replay mode against a stored session.
- `SKIP_BRIDGE=1` — start without the N2K bridge (web-only smoke testing).
- `G5000_ENABLE_AP_TX=1` — opt-in three-layer gate that allows the autopilot N2K TX path (fast-packet split via NGT-1 only). Off by default for safety; H5000 currently rejects spoofed `src=254` so this is research-only.
- `G5000_HIDE_AIS=1` — suppress AIS targets on the chart (used on Pi when running near AIS-equipped boats in port).
- `G5000_NTFY_TOPIC=<topic>` — **legacy fallback** for ntfy alarm push. The Notifications setting on `/alerts` (`AlarmsConfig.push.ntfyTopic`) is authoritative; the env var is consulted only when the config value is null/blank. Neither set = push disabled.
- `G5000_NTFY_URL=https://ntfy.sh` (default) — **legacy fallback** ntfy server base URL for alarm push; the `/alerts` setting (`AlarmsConfig.push.ntfyUrl`) wins when set.
- `YDWG_HOST=192.168.1.100` (default) — set to `none` to disable the YDWG-02 TCP driver; override for a different boat.
- `HLINK_ENABLED=0` / `HLINK_PORT=5050` — toggle / move the H-LINK TCP server.
- `NGT1_PATH=/dev/ttyUSB0` / `NGT1_BAUD=115200` — NGT-1 serial.
- `NMEA0183_PATHS=/dev/ttyUSB1,/dev/ttyUSB2` / `NMEA0183_BAUD=4800` — optional 0183 inputs.
- `CONFIG_DB=./data/config.db` and `SESSION_LOG_DIR=./data/sessions` — persistence paths.
- `G5000_BOAT_ID=sula` (default) — single active boat id for this process. Polar revisions and the wardrobe filter on this id. Multi-tenant migration of other config tables is a separate spec.
- `G5000_ROUTER_ROOT=~/.g5000-router` — OSM tile + GRIB cache root.
- `VICTRON_MQTT_HOST=<host>` — Cerbo GX MQTT broker host (e.g. `192.168.1.129`); unset or `none` = Victron driver off.
- `VICTRON_MQTT_PORT=1883` (default) — Cerbo MQTT port; override if non-standard.
- `VICTRON_SIM=1` — run the deterministic Victron simulator instead of the live MQTT driver (also implied by `DEMO_MODE=1`).
- `VICTRON_PORTAL_ID=<id>` — optional; normally auto-discovered from the broker's `N/<id>/#` topic prefix.
- `EMPORIA_EMAIL` / `EMPORIA_PASSWORD` — Emporia Energy account credentials; required for the live Vue 3 AC-loads cloud poller. Unset = Emporia off. A Google-OAuth-only Emporia account has no password → set one in the Emporia app first.
- `EMPORIA_SIM=1` — run the deterministic Emporia simulator instead of the live cloud poller; also implied by `DEMO_MODE=1`.
- `EMPORIA_POLL_S=15` — live poll cadence in seconds (default 15).

## Architecture

### One process, many roles

`apps/g5000` is the **only runtime artifact in production**. It boots in this order (see `src/index.ts`):

1. Opens the shared `ConfigStore` (SQLite via Drizzle), publishes the singleton on `globalThis`.
2. Builds a `Bus` (RxJS-backed pub/sub) and a `SourceModeController` that swaps between **live**, **demo**, and **replay** base sources.
3. Live mode opens NGT-1 (USB serial), YDWG-02 (TCP `192.168.1.100:1457`), and optional NMEA 0183 serial ports, runs the bridge, starts a session logger, and starts `startTrueWindPipeline`, `startPolarPipeline`, plus the rolling SOG/COG/HDG/motion stats workers.
4. Starts the H-LINK TCP server (default :5050) so external tactical software can read bus data.
5. Calls `next({ dev, dir: …/packages/web })` and serves the UI on the same HTTP listener (port 3000). **`packages/web` is not deployed independently** — `next start` is not used in prod; the g5000 app custom-server pattern is.
6. Notifies systemd ready, then heartbeats a `WATCHDOG=1` ping inside the configured `WatchdogSec`. If the event loop blocks, systemd SIGKILLs and restarts.

### Process-wide singletons live on `globalThis`

The `Bus`, `ConfigStore`, `DeviceRegistry`, and `AlertsRegistry` are all stored under `globalThis.__g5000_*__` keys. This survives Next.js / Turbopack re-evaluating a module (which used to silently create a second instance and break route handlers). It's also why `packages/web/next.config.ts` lists `@g5000/core`, `@g5000/db`, `@g5000/compute`, `@g5000/bridge`, and `@canboat/canboatjs` in `serverExternalPackages` — bundling them would defeat the singleton and (for `better-sqlite3`) trip the native addon. **Do not remove that list when touching `next.config.ts`.**

### Package graph

- `@g5000/core` — `Bus`, channel pattern matching (`foo.*.bar`, `wind.**`), `Channels` constants, alerts/AIS/autopilot type plumbing, JSON-safe helpers, rolling-window stat libs. No I/O.
- `@g5000/db` — Drizzle schema + `ConfigStore`. Every config table is `(id, value JSON)`; nested cal grids / polar tables don't get column-level typing.
- `@g5000/bridge` — wire drivers (`Ngt1Driver`, `YdwgRawTcpDriver`, `SerialPort0183Driver`, `ReplayDriver`), N2K decoder, channel-mapper, true-wind TX (fast-packet split, NGT-1 only), session logger.
- `@g5000/compute` — true-wind, polars, CPA/TCPA, current math, cal-tools. Pure functions + RxJS pipelines that read/write the `Bus`. **Race-day predicates (line geometry, laylines, VMC, OCS, wind-shift, polar targets, `sideOfLine`, `startRaceComputePipeline`) are exported from the `@g5000/compute/race` subpath, NOT the package root.** This is deliberate — `race/laylines.js` statically imports `@g5000/grib`, which uses `node:path`, and bundling that chain into client components breaks `next build --webpack`. Server consumers (`apps/g5000`, `/api/race/*` routes) must `import { ... } from '@g5000/compute/race'`. The root export deliberately omits race.
- `@g5000/grib` — GFS/ECMWF/RTOFS fetchers, GRIB2 parser, on-disk cache, interpolation.
- `@g5000/coastline` — OSM coastline loader + spatial-index queries (rbush) for routing land-avoidance.
- `@g5000/routing` — isochronic-fan router (`fan`, `prune`, `plan`), wind decomposition, geodesic geometry. Property-tested with fast-check.
- `@g5000/web` — Next.js 16 App Router + React 19 + Tailwind 4. UI pages under `src/app/*`, server routes under `src/app/api/*/route.ts`, MapLibre/d3-contour for chart overlays.

### Data flow

```
Drivers ─► Bridge (decode + channel-map) ─► Bus (RxJS Subject)
                                              │
                              ┌───────────────┼─────────────────┐
                              ▼               ▼                 ▼
                       Compute pipelines  Stats workers   Session logger
                              │               │
                              ▼               ▼
                              Bus (derived channels)
                              │
                              ▼
                      Web (SSE /api/stream, route.ts handlers)
                              │
                              ▼
                   React pages + H-LINK TCP server
```

Channels are dotted strings (e.g. `wind.true.angle`, `nav.gps.position`). Subscribers can use exact, `*` (one segment), or trailing `**` patterns. Canonical names live in `packages/core/src/channels.ts`; add new ones there so the channel-mapper refactors cleanly.

### Source mode

`SourceModeController` (`apps/g5000/src/source-mode-controller.ts`) is the single switch between **live** (real hardware), **demo** (synthetic injector — note: demo publishes calibrated wind directly, so the true-wind pipeline is _not_ started in demo mode), and **replay** (a session `.jsonl.gz` from `data/sessions/`). The web UI flips it via `/api/source-mode`. Code that needs to gate behaviour on mode should consult the controller, not poll the bus.

### Persistence

- `data/config.db` — SQLite via `ConfigStore`. Created at boot under `--cwd`.
- `data/sessions/<iso>.jsonl.gz` — raw wire frames + decoded samples; replayable end-to-end.
- `~/.g5000-router/*` — OSM tile cache + GRIB cache. Disk-persistent because offshore has no internet; pre-warm on shore wifi.

## Test layout

Tests sit next to source as `*.test.ts(x)` in `packages/*/src/**`, `packages/*/test/**`, `apps/*/src/**`. Vitest uses `pool: 'forks'` (because of `better-sqlite3`). Integration tests for GRIB live in `packages/grib/src/parse-grib2.integration.test.ts`. Property tests use fast-check in `packages/routing`.

**Known environmental failures** (treat as the baseline, not regressions):

- `packages/routing/test/integration/bermuda-newport.test.ts` — needs the coastline data file under `packages/coastline/data/`, which is gitignored. Fetch with `npm run fetch --workspace @g5000/coastline` to make this pass locally.
- `packages/web/src/app/api/position/route.test.ts` and other route tests that hit `getSharedConfigStore()` — fail because `ConfigStore` is only initialised by `g5000 app`'s boot, not by `vitest`. These tests need a setup harness; right now they're red in isolation.
- `packages/grib/...` parse-grib2 integration — requires `wgrib2` on `$PATH`.

If `npm test` shows ~4 failed / ~690+ passed, that's the expected baseline; do not block a merge on these. Any other failure is a regression and IS blocking.

## Conventions

- Prettier: 100 cols, single quotes, trailing commas all, 2-space.
- All times on the UI are UTC. Never mix UTC and local on the same panel.
- Lat/lon display format is compact DMM: `33 42.232n 66 25.240w` (lowercase hemisphere glued to the minute, no symbols).
- Discovery/audit docs use Verified / Reported / Unidentified tiers — don't overstate properties (see `docs/ops/network-map.md` for the rule and tone).

## Chart page (`/chart`)

`packages/web/src/app/chart/page.tsx` is the chartplotter view. It mounts a stack of layer components on top of a shared `<Map>` from `packages/web/src/components/Map.tsx`. The Map ships with an empty `__above-wind__` background layer as a **z-order sentinel**: wind / current overlays add with `beforeId: '__above-wind__'` (so they sit between OSM and the sentinel); annotation layers (AIS, route, range rings, laylines, waypoints, boat marker) append normally and end up above the sentinel. One rule, no `moveLayer` fights.

Currently mounted, top of OSM basemap upwards:

- **OSM basemap** (raster), served via the same-origin proxy at `/api/tiles/[z]/[x]/[y]` which caches PNGs under `~/.g5000-router/tile-cache/`.
- **`<EncLayer/>`** — NOAA NCDS paper-chart raster, served via `/api/enc-tiles/[z]/[x]/[y]` with disk cache under `~/.g5000-router/enc-cache/`. Off by default; toggle via the top-right `NOAA` button. Translates standard XYZ → NOAA grid: `noaa_z = std_z - 2` and ArcGIS row/col order `/tile/{z}/{y}/{x}`. Outside z=2..18 (NOAA's coverage), the proxy serves a transparent 1×1 PNG with `x-cache: EMPTY` to keep MapLibre quiet. US waters only.
- **`<SatelliteLayer/>`** — Esri World Imagery satellite raster, served via `/api/sat-tiles/[z]/[x]/[y]` with disk cache under `~/.g5000-router/sat-cache/`. Off by default; `Satellite` toggle in the layers popover. Global, JPEG, standard XYZ zoom (NO `-2` offset, unlike NOAA) but ArcGIS row/col order `/tile/{z}/{y}/{x}`. **Mounted immediately after `<EncLayer/>`** so it stacks above NOAA but below annotations — do not reorder. Esri, not Google: Google's tiles can't be legally proxied/cached offline; the proxy is source-agnostic (one-line URL swap to Sentinel-2/EOX, which IS open-licensed). 365-day TTL (imagery is static); bumps tile mtime on disk HIT so "unused" = least-recently-viewed for the prune guard. Pre-warm with `scripts/sat-seed.ts` (`regions` from `~/.g5000-router/sat-seed-regions.json` + `global` z0–7 base); inspect/prune via `scripts/sat-cache.ts` or the **Satellite tile cache** panel on `/settings` (backed by `/api/sat-cache` + `lib/sat-cache.ts`). 8 GB cap, never auto-deletes; tiles at z≤8 are protected from pruning.
- **`__above-wind__` sentinel** (invisible, always present).
- **`<WindOverlay/>`** / **`<CurrentOverlay/>`** (mutually exclusive via the model toggle), **`<GulfStreamLayer/>`**.
- **`<AisTargets/>`**, **`<RoutePolyline/>`**, **`<CogExtension/>`**, **`<WaypointsLayer/>`**, **`<StartLineLayer/>`**, **`<LiveBoatMarker/>`**, **`<ForecastRoi/>`**.

Disabled / preserved-but-unmounted (one-line revert):

- **`<LaylinesLayer/>`** — commented out around line ~551 with `disabled — not currently useful`. Code intact at `packages/web/src/components/LaylinesLayer.tsx`.
- **`<SeamarkLayer/>`** + the **`/api/seamark-tiles/[z]/[x]/[y]`** proxy — both files still in the tree but unmounted. The OpenSeaMap overlay didn't pull its weight; flipping back on is a one-line JSX restore.

**Chart UI controls and localStorage keys:**

- **Top-left:** `<ChartFollowControl/>` — two-button stack from `useChartCamera` hook. Follow toggle (sticky state, NOT a one-shot recenter) and Orientation cycle (`N` → `↑COG` → `↑HDG`). Course/heading orientations also push a 30% top padding so the boat sits at lower-third → implicit lookahead. While following, wheel/pinch zooms are re-anchored `around: 'center'` so they pivot on the boat (default around-cursor zoom would drag the center off the boat and the follow ease would visibly snap it back).
- **Top-right:** `<ChartToolbar/>` wraps `<LayersControl/>` — a layers popover with OSM / NOAA / **Satellite** / Buoys toggles, a mutually-exclusive Model-overlay radio (None / GFS / ECMWF / CMEMS), and a Misc section (AIS targets + COG extensions). `onToggle` takes a key union — add new toggle keys there and to `LayersState`.
- **Bottom corners on demand:** `<OffscreenVesselIndicator/>` — amber pill anchored to the viewport edge closest to the (off-screen) boat. Tap = re-enter follow mode. Renders only when `follow=false` AND `livePos` is outside the viewport bounds.

| localStorage key    | Shape                                                | Default                | Owner            |
| ------------------- | ---------------------------------------------------- | ---------------------- | ---------------- |
| `chart:camera`      | `{ lat, lon, zoom }`                                 | first-fix-driven       | page.tsx         |
| `chart:settings`    | UI prefs                                             | UI prefs               | page.tsx         |
| `chart:planState`   | in-progress route                                    | empty                  | page.tsx         |
| `chart:layers`      | `{ osm, enc, satellite, buoys, ais, aisCog, model }` | osm on; model `'none'` | page.tsx         |
| `chart:follow`      | `boolean`                                            | `true`                 | `useChartCamera` |
| `chart:orientation` | `'north' \| 'course' \| 'heading'`                   | `'north'`              | `useChartCamera` |

### MapLibre traps (read before adding a layer)

- **Guard every teardown-reachable map call with `mapAlive(map)` (exported from `Map.tsx`).** `Map.tsx`'s unmount cleanup calls `map.remove()`, which clears `map.style`; layer components are siblings, so their effect cleanups, timers, RAF callbacks, promise continuations, and window/BroadcastChannel listeners can run AFTER it — any style-touching call (`getLayer`, `getSource`, `removeLayer`, `setData`, …) then throws `undefined is not an object (evaluating 'this.style.getLayer')` into the route error boundary. Put `if (!mapAlive(map)) return;` at the top of cleanups and async callbacks (or keep the existing try/catch idiom). `map.off(...)` is safe post-remove; `map.on(...)` handlers can't fire post-remove but any async work they schedule can.
- **Do NOT gate `addSource`/`addLayer` on `map.isStyleLoaded()`.** That helper can stay `false` indefinitely while other sources are still loading. The chart page hands child layer components the map from inside `Map.tsx`'s `onLoad` callback — by that point the style is initialised and add\* calls are safe. Wrap in `try/catch` and use `map.on('styledata', ensure)` as a retry signal. See `SeamarkLayer.tsx` / `EncLayer.tsx` for the canonical pattern.
- **Distinguishing user pans from programmatic moves:** MapLibre's `dragend`, `movestart`, etc. fire for BOTH user gestures and our own `easeTo`/`flyTo` calls. The discriminator is `e.originalEvent` — `undefined` means programmatic, a real `MouseEvent` / `TouchEvent` means user gesture. The follow-mode exit handler in `useChartCamera` uses this to avoid exiting follow on its own recenters.
- **Bearing changes need a dead-band.** COG and HDG arrive at ~1 Hz with sensor noise. Re-easing the bearing on every tiny wiggle looks bad. `useChartCamera` uses a 3° dead-band via `wrapBearingDelta` (which correctly handles the 0/360 seam).
- **`LivePos` carries radians for `cog` and `hdg`.** MapLibre's `setBearing` and `easeTo({ bearing })` take degrees. Convert before applying.
- **Same-origin tile proxies are the pattern.** All four tile types (`/api/tiles`, `/api/seamark-tiles`, `/api/enc-tiles`, `/api/sat-tiles`) follow the same shape: regex-validate `z`/`x`/`y`, serve from disk if fresh, otherwise fetch upstream, write to disk best-effort, stream the response. `x-cache: HIT | MISS | EMPTY`, transparent 1×1 PNG for off-coverage zooms. If you add another raster overlay, copy one of these as a starting point (`/api/sat-tiles` is the most recent and passes the upstream content-type through for JPEG).
- **Cap each raster source's `maxzoom` at its upstream's ceiling so MapLibre overzooms.** OSM and Esri publish to z19, NOAA to z18. Without `maxzoom` on the source, MapLibre requests tiles past coverage and the proxy returns 404/502 on the upstream miss (this bit the OSM basemap at z20). With it set, MapLibre scales the deepest available tiles for closer harbour-detail views.
- **For a live, frequently-updated raster from an offscreen `<canvas>`, use an `ImageSource` + `updateImage`, NOT a `CanvasSource`.** MapLibre only re-uploads a `CanvasSource`'s GL texture during a source-update pass (`_sourcesDirty`), not on a plain repaint — so unless something else is _continuously_ animating, a `CanvasSource` uploads its (often blank) texture once and never refreshes. `animate: true` and `map.triggerRepaint()` (even at 60 fps) do **not** fix it; only a source mutation does. This silently bit the radar overlay: spokes were painted to the canvas (verified pixels via `getImageData`) but never appeared on the map. The fix is to drive an `image` source and push the canvas in on a cadence with `source.updateImage({ url: canvas.toDataURL('image/png'), coordinates })` — `updateImage` re-uploads the texture explicitly. `toDataURL` reads the canvas's CPU backing store, so the canvas can stay detached from the DOM (attaching it, hidden or not, does **not** help — that was a red herring). Diagnosed on real Apple-M4 hardware GL, so it is browser-agnostic (not a Safari/headless quirk): in the same map, vector layers, raster-tile sources, and `ImageSource` all render; only `CanvasSource` does not. See `packages/web/src/components/RadarOverlay.tsx`.

## At-anchor page (`/anchor`)

`packages/web/src/app/anchor/page.tsx` is a dedicated monitoring dashboard for when Sula is on the hook. It has a fixed **top zone** of panels (Depth, Position, Nearby Vessels, an apparent-wind course-up dial with gust ring, Anchor Watch + rode/scope calculator, Today & Now, and Systems/Tanks/Temps) plus a **slide-up drawer** at the bottom with sub-tabs:

- **Forecast** — Open-Meteo 7-day graph + hourly table (cached under `~/.g5000-router/weather-cache/`; degrades to last-good data offline).
- **Tides** — tide prediction (reuses the tides infrastructure).
- **Radar** — Windy radar embed (requires internet; shows a "no connection" state offline).
- **Sky** — suncalc sun/moon rise–set, golden hour, and civil-twilight times.
- **Solar** — per-MPPT solar yield + battery state from the Victron Cerbo GX.
- **AC** — Loads sub-tab: live per-circuit watts; History sub-tab: kWh DAY/WEEK/MONTH aggregates. Data comes from an **Emporia Vue 3** via its cloud API (AWS Cognito SRP auth, `authtoken` header) — separate from the Victron Cerbo. Simulated under `EMPORIA_SIM=1`; off when `EMPORIA_EMAIL`/`EMPORIA_PASSWORD` are unset.

Victron data flows from `VictronDriver` (live MQTT from the Cerbo) or `VictronSim` (under `VICTRON_SIM=1` or `DEMO_MODE=1`) → bus `electrical.*` channels → `/api/victron` route → `<SolarTab/>`. When `VICTRON_MQTT_HOST` is unset or `none` the driver is off and the Solar tab shows a "Cerbo offline" state; all other tabs are unaffected.

## Branching model

Two long-lived branches:

- **`develop`** — active work lands here. All new commits go on `develop` first. This is the default working branch on the Mac and what feature work is committed against.
- **`main`** — production. Tracks **what is running on the Pi**. Only updated via a "promote" step (fast-forward merge of `develop`) when work is ready to deploy.

**Commit autonomy:** Claude may commit completed, verified work to `develop` without asking first — no need to pause for permission once typecheck/tests/lint are green and the change is coherent. Promoting `develop` → `main` and deploying to the Pi remain explicit, on-request steps (they ship to a live boat).

Pi's `~/autopilot` is pinned to `main`. The Pi never sees `develop`. To deploy, promote `develop` → `main` on the Mac, then run the Pi rebuild (see _Deployment_ below).

Promote workflow (Mac):

```sh
# When develop is ahead of main and ready to ship:
git checkout main
git merge --ff-only develop   # fast-forward; abort if it would create a merge commit
git push origin main
git checkout develop          # go back to the working branch
# Then run the Pi rebuild — see below
```

The `--ff-only` guard ensures `main` is always a strict prefix of `develop`. If develop has been rebased or branches have diverged, the merge will refuse and you investigate before deploying. Don't `--no-ff` to "make the deploy visible in main's history" — promotion is intended to be invisible; the develop-side commits ARE the record.

For experimental work that shouldn't land on `develop` yet, branch off `develop` (`git checkout -b experiment-x develop`), iterate, then merge back when ready.

## Deployment

Production runs on RPi5 `sula-bassana` reachable via Tailscale (`100.64.0.117`), boat ethernet (`192.168.2.2`), boat wifi (`192.168.1.232`), or `https://g5000.sulabassana.net` (cloudflared). Systemd unit is `scripts/g5000-autopilot.service` (`Type=notify`, `WatchdogSec=60`). A separate `g5000-forecast-refresh.timer` pokes `/api/forecast/refresh` every ~3h on a curated bbox read live from `/api/settings`.

The Pi pulls from `origin/main` only — see _Branching model_ above for the promote step that gets work from `develop` onto `main` before deploying. Skipping the promote step and trying to `git pull` on the Pi will silently no-op (Pi is already at main's tip) and your "deploy" won't actually ship the develop-side changes.

> **⚠️ Deploys are AUTOMATIC: pushing to `main` triggers `.github/workflows/deploy-pi.yml` on a self-hosted Actions runner ON the Pi** (pull → conditional npm install → tsc composite refs → app build → web build → unit sync → restart → health check; `concurrency: deploy-pi` serialises runs). **Do NOT run a manual rebuild after pushing main — you will race the runner.** A manual `next build` colliding with the runner's fails with "Another next build process is already running", and restarting the service against the half-built `.next` (no `BUILD_ID`) takes the boat down — this exact collision caused a ~5-min production outage on 2026-07-09. To deploy: promote to main, push, then watch the run (`gh run list/watch` or wait for `systemctl is-active` + fresh `.next/BUILD_ID` on the Pi). Manual rebuilds are for when the runner itself is broken — first confirm no deploy is in flight (`pgrep -af 'next build'` on the Pi, check the Actions tab). Note the workflow aborts before the restart step if any build fails, so a failed deploy leaves the OLD process running but `.next` wiped — the service then cannot survive a restart until a good build lands.

Manual Pi rebuild order, runner-down case only (matters because of `composite` refs): `tsc -b core mast db compute bridge grib routing coastline` → build `g5000 app` → build `web` → `systemctl restart g5000-autopilot`.

> **Note:** `grib` MUST be in that tsc step even though `g5000 app` doesn't depend on it — `packages/web` imports types from `@g5000/grib` (e.g. `CurrentField` in `grib-context.ts`) and `next build` resolves those via the package's compiled `dist/*.d.ts`. Omit it and a stale `dist/types.d.ts` will make `next build` fail with confusing `Type "X" is not assignable to type "Y"` errors. Failed `next build` also wipes `.next/BUILD_ID`, which prevents the g5000 app from booting on the next restart — so leaving `grib` out turns a build error into a production outage. The same trap applies to `routing` and `coastline`: `packages/web/src/app/api/route/plan/route.ts` imports `plan` from `@g5000/routing`, and `next build` resolves it through `dist/`. If `routing/dist/` is stale (the package was updated but its dist wasn't rebuilt), the web build fails with `'plan' is not exported from '@g5000/routing'` even though the symbol exists in source. Both packages must be in the rebuild chain.

> **Stale-dist gotcha:** `tsc -b` is incremental — if it thinks nothing changed it skips work and leaves old `dist/` files in place. If you suspect a dist is stale (especially after rebases or branch swaps), `rm -rf packages/<name>/dist && npx tsc -b packages/<name> --force` is the nuclear option. The pattern that bit a recent deploy: `tsc -b packages/web` claimed clean on the Mac because `compute/dist/index.js` still had a removed export from before a refactor; the Pi's clean rebuild surfaced the real error.

### Mast display

The `/mast` view and the `@g5000/mast` package are part of the normal build (add
`packages/mast` to the `tsc -b` order above — same foot-gun class as the historical
`grib` omission).

**Layout + display settings live in `ConfigStore`, not in a file.** `MastService`
is a thin shell over `ConfigStore` (`apps/g5000/src/mast/service.ts`). The git-tracked
`apps/g5000/mast-layout.json` is a **boot seed only**: `MastService.start()` writes it
into `ConfigStore` _only if no layout is stored yet_ (`getMastLayout() === null`). On
every subsequent boot it logs `layout already in ConfigStore, skipping seed` and ignores
the file. So once `config.db` has a layout, editing the JSON and `git pull`-ing on the Pi
does **nothing** — the file watcher that used to hot-load it was removed in `d0ac078`.

To reconfigure at runtime, use the **`/mast-config`** page (or `PUT /api/mast/layout`):
it calls `ConfigStore.setMastLayout()`, which emits on `mastLayout$` and is pushed to the
screen over the `/api/mast/stream` SSE — no rebuild or restart needed. The other display
settings (brightness, night-mode, day-base-colour) live in the same store's
`DisplayConfig` and are edited the same way (`/mast-config` → `POST /api/mast/{brightness,night-mode,day-base-color}`),
also pushed over SSE. `tsc -b` / `next build` / `systemctl restart` are needed ONLY when
the mast _code_ changes.

`MAST_LAYOUT_PATH` (default `apps/g5000/mast-layout.json`, resolved relative to the app
module) overrides only the **seed** file path — it matters at first boot / against an empty
`config.db`, not for live edits.

## When designing new features

- Read `docs/superpowers/specs/` for design specs and `docs/superpowers/plans/` for the executable plans that produced the current code.
- `docs/design/autopilot-design-notes.md` captures hard-won lessons from running an H5000 autopilot — particularly that "Performance level" silently swaps algorithms behind the user's dial. Don't replicate that anti-pattern.
- `docs/ops/network-map.md` and `docs/ops/expedition-integration.md` are the canonical references for boat-network IPs and H-LINK protocol details respectively.
