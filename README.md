# G5000

A sailing instrumentation platform for a real boat ([Sula](https://github.com/gregjohnson1024/g5000/blob/main/docs/ops/network-map.md)). Ingests NMEA 2000 and NMEA 0183 from B&G / Navico / YDWG hardware, runs compute pipelines (true wind, polars, current set-and-drift, isochronic routing), serves a Next.js web UI with helm / chart / forecast / autopilot / passage views, and re-emits its data over an H-LINK TCP server so Expedition can consume it.

Built for one boat, by one person. Not a product. Source is public so the patterns are reusable.

## What it does

- **Helm** — live wind, speed, heading, course display from the boat's N2K backbone.
- **Chart** — MapLibre-rendered chart with the live boat position, projected COG, AIS targets, waypoints, range rings, toggleable NOAA raster charts and Esri satellite imagery, and overlays for GFS / ECMWF wind and Copernicus Marine currents.
- **Passage** — distance / log / ETA tiles, cumulative-mileage sparkline, fuel-stop diversion math (Block Island vs Newport vs Nantucket geometry), and an embedded PredictWind tracker.
- **Forecast** — fetched on the Pi every 3 h on a configurable bbox; lives on disk so it survives offshore-internet outages.
- **Router** — isochronic-fan routing with land-avoidance against an OSM coastline index, fed by the live wind cache and (optionally) Copernicus currents. Property-tested with fast-check.
- **Autopilot research** — N2K decode of H5000 PGNs, fast-packet TX (NGT-1 today; PiCAN-M with ISO Address Claim in progress), three-layer env-var gate on transmission for safety.
- **Sources / Sessions / Replay** — live ingest, gzipped JSONL session logging, full-fidelity replay end-to-end through the same compute pipelines.

## Stack

- **Node.js ≥22**, ESM-only, strict TypeScript with composite project refs (`tsc -b`)
- **Next.js 16** (App Router) + **React 19** + **Tailwind CSS 4** + **MapLibre GL** + **d3-contour**
- **RxJS** pub/sub bus, dotted channel names with `*` / `**` patterns
- **SQLite** via **better-sqlite3** + **Drizzle ORM**
- **`@canboat/canboatjs`** for NMEA 2000 PGN decode / encode
- **`serialport`** for NGT-1 USB; native **SocketCAN** (PiCAN-M HAT) as an opt-in alternative
- **wgrib2** + **`copernicusmarine`** Python client for forecast / current grids
- **Vitest** + **fast-check** for tests
- **systemd** (Type=notify, `WatchdogSec=60`) on a Raspberry Pi 5

See [CLAUDE.md](./CLAUDE.md) for the deep architecture overview — package graph, data-flow diagram, runtime singletons, env-var gates, deployment specifics.

## Repository layout

```
apps/
  g5000 app/       # The single production runtime. Custom Node server that
                          # mounts Next.js, wires the drivers + bus + compute
                          # pipelines, and runs an H-LINK TCP server alongside.
packages/
  core/                   # Bus, channels, alerts / AIS / autopilot type plumbing
  db/                     # Drizzle schema + ConfigStore (SQLite, JSON columns)
  bridge/                 # Wire drivers (NGT-1, YDWG-02 TCP, SocketCAN, 0183
                          # serial, replay), N2K decoder, channel mapper, TX
  compute/                # True-wind, polars, CPA/TCPA, current, cal-tools
  grib/                   # GFS / ECMWF / RTOFS fetch + GRIB2 parse + interpolation
  coastline/              # OSM coastline loader + rbush spatial index
  routing/                # Isochronic-fan router with property tests
  web/                    # Next.js App Router UI + API routes
scripts/                  # Pi systemd units, network probes, deploy helpers
docs/
  design/                 # Hard-won lessons (e.g., autopilot-design-notes.md)
  ops/                    # Boat network map, Expedition integration, H-LINK
  superpowers/            # Design specs + executable plans that produced the code
```

## Local development

```bash
git clone https://github.com/gregjohnson1024/g5000.git
cd g5000
npm install
npm run dev --workspace @g5000/app    # custom Node server + Next on :3000
```

Without a boat on the local network, the NGT-1 / YDWG drivers fail to connect (logged, not fatal) and the UI is empty. To get synthetic data:

```bash
DEMO_MODE=1 npm run dev --workspace @g5000/app
```

Or flip the toggle at `/settings` after the server is up.

```bash
npm test                                  # 70+ test files across packages/* and apps/*
npm run typecheck                         # tsc -b all project refs
npm run build                             # build every workspace (web uses --webpack)
npm run lint                              # prettier --check .
npm run bench --workspace @g5000/routing  # routing benchmarks
```

Node ≥22 is required; the project relies on Node 22's native `fetch` and ESM-only behaviour.

## Deployment

Production runs on a Raspberry Pi 5 (`sula-bassana`) reachable over Tailscale, boat ethernet, boat WiFi, or `https://g5000.sulabassana.net` via Cloudflared.

The g5000 app is the only deployed artifact — Next.js is mounted into it as a custom server, so `next start` is not used. Deploy is `git pull` + a documented rebuild order (composite project refs matter):

```bash
git pull
npx tsc -b packages/core packages/db packages/compute packages/bridge packages/grib
npm run build --workspace @g5000/app
npm run build --workspace @g5000/web
sudo systemctl restart g5000-autopilot
```

See [CLAUDE.md → Deployment](./CLAUDE.md#deployment) for the full procedure and known pitfalls (missing `grib` from the `tsc -b` list is a real foot-gun that has caused a production outage).

## Hardware

The boat-side wiring is documented in [`docs/ops/network-map.md`](./docs/ops/network-map.md). The supported ingest paths:

| Path                    | How it connects      | Latency   | When to use                                                |
| ----------------------- | -------------------- | --------- | ---------------------------------------------------------- |
| **YDWG-02** TCP gateway | Boat WiFi, port 1457 | ~10–30 ms | Current default; works from any device on the boat network |
| **NGT-1** USB           | USB serial on the Pi | ~5 ms     | Backup / dev                                               |
| **PiCAN-M** SocketCAN   | GPIO HAT, native CAN | <1 ms     | Opt-in; enables direct bus participation (in progress)     |
| **NMEA 0183** serial    | RS-422 to USB        | n/a       | Legacy sentences only                                      |

All four are designed to coexist — the bridge dedupes by source address + PGN.

## What's notable

- **One process, many roles** — the g5000 app is the _only_ runtime artifact in production. Next.js, the N2K bridge, the routing engine, the H-LINK TCP server, and the SQLite store all live in the same Node process. The "custom Next server + `globalThis` singletons" pattern is what keeps this coherent — explicitly defended in `next.config.ts` and `CLAUDE.md`.
- **Replay parity** — any `.jsonl.gz` session file plays back end-to-end through the same compute pipelines and decoders, so bugs reproduce against historical wire-level captures.
- **Disk-persistent caches** for OSM / NOAA chart / Esri satellite tiles and GRIB grids under `~/.g5000-router/`, so offshore-without-internet routes still plan against the last-fetched wind field (pre-warm satellite coverage on shore wifi with `scripts/sat-seed.ts`).
- **Memory and `docs/superpowers/`** capture not just the code but the _reasoning_ — design specs, executable implementation plans, post-mortems of hard-won lessons (e.g., the autopilot's "Performance level" silently swapping algorithms behind the user's dial — a UX anti-pattern to avoid replicating).

## License

[MIT](./LICENSE) — copyright 2026 Greg Johnson. Use, modify, redistribute. No warranty.
