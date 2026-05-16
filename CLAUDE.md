# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

G5000 is a sailing instrumentation platform for a real boat (`Sula`). It ingests NMEA 2000 / NMEA 0183 from B&G/Navico/YDWG hardware, runs compute pipelines (true wind, polars, currents, routing), serves a Next.js web UI with helm/chart/forecast/autopilot views, and exposes its data back out via an H-LINK TCP server so Expedition can read it. Production target is a Raspberry Pi (`sula-bassana`) running a single Node systemd service.

Git remote is Forgejo (`git.rbr-global.com`), not Bitbucket.

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
npm run dev --workspace @g5000/autopilot-server   # local dev: tsx watch, web mounted at :3000
npm run fetch --workspace @g5000/coastline        # one-shot: pull coastline data (gitignored)
npm run bench --workspace @g5000/routing          # routing benchmarks
```

Node ≥22, ESM-only, strict TypeScript (`noUncheckedIndexedAccess`, composite project refs).

**Known gotcha:** the top-level `tsconfig.json` still lists `apps/router` in its `references`. That dir was merged into `packages/web` and `tsc -b` reports `TS5083 Cannot read file …/apps/router/tsconfig.json`. Individual workspace builds (`npm run build`, `npm test`) work; only the orchestrated `tsc -b` stops at the missing ref. Remove the ref when convenient.

## Architecture

### One process, many roles

`apps/autopilot-server` is the **only runtime artifact in production**. It boots in this order (see `src/index.ts`):

1. Opens the shared `ConfigStore` (SQLite via Drizzle), publishes the singleton on `globalThis`.
2. Builds a `Bus` (RxJS-backed pub/sub) and a `SourceModeController` that swaps between **live**, **demo**, and **replay** base sources.
3. Live mode opens NGT-1 (USB serial), YDWG-02 (TCP `192.168.1.100:1457`), and optional NMEA 0183 serial ports, runs the bridge, starts a session logger, and starts `startTrueWindPipeline`, `startPolarPipeline`, plus the rolling SOG/COG/HDG/motion stats workers.
4. Starts the H-LINK TCP server (default :5050) so external tactical software can read bus data.
5. Calls `next({ dev, dir: …/packages/web })` and serves the UI on the same HTTP listener (port 3000). **`packages/web` is not deployed independently** — `next start` is not used in prod; the autopilot-server custom-server pattern is.
6. Notifies systemd ready, then heartbeats a `WATCHDOG=1` ping inside the configured `WatchdogSec`. If the event loop blocks, systemd SIGKILLs and restarts.

### Process-wide singletons live on `globalThis`

The `Bus`, `ConfigStore`, `DeviceRegistry`, and `AlertsRegistry` are all stored under `globalThis.__g5000_*__` keys. This survives Next.js / Turbopack re-evaluating a module (which used to silently create a second instance and break route handlers). It's also why `packages/web/next.config.ts` lists `@g5000/core`, `@g5000/db`, `@g5000/compute`, `@g5000/bridge`, and `@canboat/canboatjs` in `serverExternalPackages` — bundling them would defeat the singleton and (for `better-sqlite3`) trip the native addon. **Do not remove that list when touching `next.config.ts`.**

### Package graph

- `@g5000/core` — `Bus`, channel pattern matching (`foo.*.bar`, `wind.**`), `Channels` constants, alerts/AIS/autopilot type plumbing, JSON-safe helpers, rolling-window stat libs. No I/O.
- `@g5000/db` — Drizzle schema + `ConfigStore`. Every config table is `(id, value JSON)`; nested cal grids / polar tables don't get column-level typing.
- `@g5000/bridge` — wire drivers (`Ngt1Driver`, `YdwgRawTcpDriver`, `SerialPort0183Driver`, `ReplayDriver`), N2K decoder, channel-mapper, true-wind TX (fast-packet split, NGT-1 only), session logger.
- `@g5000/compute` — true-wind, polars, CPA/TCPA, current math, cal-tools. Pure functions + RxJS pipelines that read/write the `Bus`.
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

`SourceModeController` (`apps/autopilot-server/src/source-mode-controller.ts`) is the single switch between **live** (real hardware), **demo** (synthetic injector — note: demo publishes calibrated wind directly, so the true-wind pipeline is *not* started in demo mode), and **replay** (a session `.jsonl.gz` from `data/sessions/`). The web UI flips it via `/api/source-mode`. Code that needs to gate behaviour on mode should consult the controller, not poll the bus.

### Persistence

- `data/config.db` — SQLite via `ConfigStore`. Created at boot under `--cwd`.
- `data/sessions/<iso>.jsonl.gz` — raw wire frames + decoded samples; replayable end-to-end.
- `~/.g5000-router/*` — OSM tile cache + GRIB cache. Disk-persistent because offshore has no internet; pre-warm on shore wifi.

## Test layout

Tests sit next to source as `*.test.ts(x)` in `packages/*/src/**`, `packages/*/test/**`, `apps/*/src/**`. Vitest uses `pool: 'forks'` (because of `better-sqlite3`). Integration tests for GRIB live in `packages/grib/src/parse-grib2.integration.test.ts`. Property tests use fast-check in `packages/routing`.

## Conventions

- Prettier: 100 cols, single quotes, trailing commas all, 2-space.
- All times on the UI are UTC. Never mix UTC and local on the same panel.
- Lat/lon display format is compact DMM: `33 42.232n 66 25.240w` (lowercase hemisphere glued to the minute, no symbols).
- Discovery/audit docs use Verified / Reported / Unidentified tiers — don't overstate properties (see `docs/ops/network-map.md` for the rule and tone).

## Deployment

Production runs on RPi5 `sula-bassana` reachable via Tailscale (`100.64.0.117`), boat ethernet (`192.168.2.2`), boat wifi (`192.168.1.232`), or `https://g5000.sulabassana.net` (cloudflared). Systemd unit is `scripts/g5000-autopilot.service` (`Type=notify`, `WatchdogSec=60`). A separate `g5000-forecast-refresh.timer` pokes `/api/forecast/refresh` every ~3h on a curated bbox read live from `/api/settings`.

Pi rebuild order (matters because of `composite` refs): `tsc -b core db compute bridge` → build `autopilot-server` → build `web` → `systemctl restart g5000-autopilot`.

## When designing new features

- Read `docs/superpowers/specs/` for design specs and `docs/superpowers/plans/` for the executable plans that produced the current code.
- `docs/design/autopilot-design-notes.md` captures hard-won lessons from running an H5000 autopilot — particularly that "Performance level" silently swaps algorithms behind the user's dial. Don't replicate that anti-pattern.
- `docs/ops/network-map.md` and `docs/ops/expedition-integration.md` are the canonical references for boat-network IPs and H-LINK protocol details respectively.
