# Halo radar support — Phase 1: chart-overlay foundation

**Date:** 2026-06-25
**Status:** Design approved; spec for review
**Scope:** Phase 1 of a multi-phase effort (see roadmap). Built against mayara's
emulator; validated on the real Halo once installed.

## Context & goal

Sula will have a Navico/B&G **Halo** radar. The end goal is MFD-grade radar in
g5000 — echoes, ARPA targets with CPA/TCPA, guard-zone alarms, and a dedicated
PPI view. That spans several independent subsystems, so it is decomposed into
phases. **This spec covers Phase 1: live radar echoes as a georeferenced overlay
on `/chart`, controllable, and reachable both on and off the boat.**

### Phase roadmap (this spec = Phase 1)

- **Phase 1 — Echoes on the chart (foundation).** mayara as a service; the
  browser decodes spokes and renders georeferenced echoes on `/chart` with
  persistence/fade and legend colours (incl. Doppler); a layers toggle; core
  controls (range, gain, sea/rain clutter, opacity); config + a minimal
  server-side status poller. ← **this spec**
- **Phase 2 — Targets & alarms.** Consume mayara's ARPA target API (CPA/TCPA),
  render targets on the chart reusing the AIS-target machinery, and wire guard
  zones into g5000's `AlertsRegistry`.
- **Phase 3 — Dedicated PPI page (`/radar`).** Heading-up scope, range rings,
  EBL/VRM — the MFD feel, on the now-proven data path.

Each phase is independently shippable and gets its own spec → plan → build cycle.

## Background: mayara + the spoke protocol

`mayara-server` (Rust; MarineYachtRadar) translates proprietary radar network
protocols into a Signal-K-style open API. Tested on real HALO 20/24/2000–6000
hardware. The facts below are **Verified** from mayara's published docs/source
unless tagged otherwise.

- **CLI:** `-i/--interface <iface>` (limit discovery to one interface),
  `-p/--port <port>` (HTTP+WS listener, **default 6502**), `-b/--brand navico`,
  `--emulator` (built-in emulator), `-v`/`-vv`/`-q` (verbosity).
- **HTTP API** under `…/signalk/v2/api/vessels/self/radars`:
  - `GET /radars` — discover; returns each radar's `id` and its spoke WS URL.
  - `GET /radars/{id}/capabilities` — `spokes_per_revolution`, max spoke length,
    and the **legend** (a lookup mapping each data byte → colour/meaning,
    including Doppler approaching/receding).
  - `GET`/`PUT /radars/{id}/controls/{cid}` — range, gain, sea/rain clutter, etc.
  - `POST`/`DELETE /radars/{id}/targets` — ARPA target acquisition (Phase 2).
  - `GET …/radars/resources/openapi.json` — full API spec.
- **Spoke stream** — `ws://…/radars/{id}/spokes`, binary protobuf. Schema
  (Verified from `src/lib/protos/RadarMessage.proto`):

  ```protobuf
  message RadarMessage {
    message Spoke {
      uint32 angle = 1;             // [0..spokes_per_revolution), from bow, clockwise
      optional uint32 bearing = 2;  // [0..spokes_per_revolution), offset from True North
      uint32 range = 3;             // metres of the last cell in `data`
      optional uint64 time = 4;     // ms since UNIX epoch
      optional double lat = 6;      // radar position at generation
      optional double lon = 7;
      bytes data = 5;               // one byte per range cell; value→colour via the legend
    }
    repeated Spoke spokes = 2;
  }
  ```

- **Reference web GUI** lives in mayara's `web/gui/` (a classic PPI display) — a
  rendering reference, not what we ship.

**Reported (verify on install):** the Halo's exact Ethernet addressing and
multicast. Navico radars announce via multicast on the radar's Ethernet segment;
mayara must run on a host with an interface on that segment and be pointed at it
with `-i`. Exact subnet/multicast and any host IP/route setup come from mayara's
Navico setup docs and are confirmed when the radar is physically on the boat.

## Architecture

Two cooperating processes on the Pi, plus the browser.

**`mayara.service` (new systemd unit).** Runs the mayara binary on the Navico
Ethernet: `mayara-server -i <radar-iface> -p 6502 -b navico` (or `--emulator`
until the radar exists). Owns its HTTP+WS listener on `:6502`. g5000 neither
launches nor supervises it — they are siblings (the same way grafana runs beside
the xCal stack). Interface / port / emulator are set in a systemd `override.conf`
drop-in so they can change without editing the unit.

**g5000 (mostly unchanged).** The only new server-side code is a small status
poller (below). The heavy spoke stream never enters g5000's Node process, keeping
it clear of the `WatchdogSec=60` event-loop watchdog.

**Browser.** Does the real radar work: opens the spoke WS, decodes, renders to a
canvas, blits onto the chart, and issues control PUTs.

**Reachability (decided: Tailscale-only).** The browser reaches mayara at **the
Pi's Tailscale address:6502** — direct/low-latency on the boat (browser and Pi
co-located on the tailnet) and relayed when away. No cloudflared tunnel for radar
(deferred; remote use is over Tailscale). **Mixed-content constraint:** a g5000
page served over `http://` (e.g. the tailnet IP `:3000`) may open `ws://…:6502`
directly; a page served over `https://` may open only `wss://`, so HTTPS access
needs a TLS endpoint in front of mayara (e.g. Tailscale Serve). The web app
derives `ws`/`wss` from its own `location.protocol`. The mayara base URL is
stored in ConfigStore (`radar.mayaraBaseUrl`) and editable in `/settings`.

## Components

| # | Component | Path | Responsibility |
|---|-----------|------|----------------|
| 1 | systemd unit | `scripts/mayara.service` (+ `override.conf`) | run mayara on the radar interface; restart on failure |
| 2 | config | `packages/db` ConfigStore + `/settings` field | `radar.mayaraBaseUrl`, radar defaults — server-side, cross-client, persistent |
| 3 | mayara client | `packages/web/src/lib/radar/mayara-client.ts` | discovery, capabilities (incl. legend), open spokes WS (`arraybuffer`), decode `RadarMessage` (protobufjs from a vendored `RadarMessage.proto`), control GET/PUT |
| 4 | renderer | `packages/web/src/lib/radar/renderer.ts` | offscreen radar-centric canvas; spoke → coloured range line at its bearing using the legend; per-frame fade (persistence/trails); exposes canvas + geo extent |
| 5 | overlay layer | `packages/web/src/components/RadarOverlay.tsx` | MapLibre layer mirroring `WindOverlay` (idempotent `ensure()`, `styledata` retry, `CanvasSource` corner-pinned to [centre ± range], throttled updates, opacity via `setPaintProperty`); owns WS lifecycle + reconnect/backoff |
| 6 | controls + toggle | `chart/LayersControl.tsx`, `chart/ChartToolbar.tsx`, `chart/page.tsx` | `radar` toggle (three-file edit + `chart:layers` default); compact control panel (range; gain/sea/rain each with auto-toggle + manual slider; opacity) reflecting mayara control read-back; UI-only bits in `chart:radar` localStorage |
| 7 | status poller | `apps/g5000` + `packages/core/src/channels.ts` | GET mayara state every few seconds → publish `radar.connected`, `radar.range.m` scalar channels; async, non-blocking |

## Data flow

```
Halo ──(Navico ethernet)──> mayara.service (Pi, :6502)
                              │  HTTP  discover / capabilities / controls
                              │  WS    /radars/{id}/spokes  (binary protobuf)
        ┌──────────────────────┴──────────── wss via Tailscale / cloudflared ──┐
        ▼                                                                        ▼
  Browser RadarOverlay                                                 Browser control panel
   WS arraybuffer → decode RadarMessage{ angle,bearing,range,lat,lon,data }   range/gain/clutter → PUT mayara
   → renderer: spoke → offscreen canvas (+fade, legend colours)      (panel reflects mayara read-back)
   → CanvasSource corner-pinned to radar extent on MapLibre
   → opacity via setPaintProperty

  apps/g5000 status poller (server): GET mayara state → bus: radar.connected, radar.range.m
```

**Key property:** spokes carry their own `bearing`, `range`, and `lat/lon`, so
georeferencing does not depend on g5000's heading — which matters given Sula's
divergent/null heading sources. Fallback ladder: if `bearing` is absent (radar
not heading-stabilised) → use `angle` from bow + boat heading; if boat heading is
null → render head-up-relative and label it as such.

## Rendering approach (the one novel piece)

g5000 has **no** custom/canvas MapLibre layer today — every overlay is raster
tiles or GeoJSON. Phase 1 introduces the first one.

Chosen approach: keep an offscreen square canvas in radar-centric metres; paint
each incoming spoke as a coloured radial line (centre → `range`, cells coloured
by the legend); fade the whole canvas each animation frame for persistence/
trails; expose it to MapLibre as a **`CanvasSource` corner-pinned** to the
radar's geographic bounding box (centre = spoke `lat/lon` or boat position;
half-extent = `range` metres → ±Δlat/Δlon). MapLibre then handles projection,
zoom, and rotation; overlay opacity is a raster layer's `raster-opacity`.

Rationale: dramatically less code than a WebGL custom layer, and accurate enough
for a boat-centred disk over a few nautical miles. **Upgrade path:** a WebGL
`type:'custom'` layer if the Pi browser's performance or large-range accuracy
demands it. **Risk:** this is the unproven part of the design — prototype it and
verify visually against `--emulator` before building the controls.

## Configuration & persistence

- **ConfigStore** (server, cross-client, persistent): `radar.mayaraBaseUrl`,
  default range/gain, and whether radar is enabled boat-wide. Edited via
  `/settings`.
- **localStorage** (per-browser UI): `chart:layers.radar` (toggle) and
  `chart:radar` (opacity, persistence/fade level, colour-scheme preference) —
  the same split already used for `chart:layers` vs ConfigStore.
- **Radar parameters** (range/gain/sea/rain): the **radar is the source of
  truth** via mayara; the panel issues PUTs and reflects read-back rather than
  holding local state.

## Error handling

- mayara down / WS dropped → non-fatal "radar offline" badge + exponential-
  backoff reconnect; the chart keeps working.
- No radar discovered → "no radar" state (expected pre-install / emulator off).
- Spokes stall → persistence fades out (no frozen echoes); overlay shows "stale".
- HTTPS page + `ws://` mayara URL → detected and surfaced as "needs wss".
- Heading null + non-heading-stabilised radar → head-up-relative render, labelled.
- Nothing on the radar path can block g5000's event loop (only the async status
  poller runs server-side).

## Testing

- **mayara `--emulator`** is the dev + CI fixture: point g5000 at it and verify
  echoes render and controls round-trip.
- **Unit tests:** protobuf decode (golden `RadarMessage` bytes → expected
  spokes); renderer geometry (spoke angle/range → canvas pixel; canvas extent →
  geo corners); legend → colour; reconnect/backoff.
- **Early visual prototype** of the corner-pinned `CanvasSource` against the
  emulator to de-risk the novel piece, before the controls are built.
- **Real-Halo validation** on install: range/bearing accuracy vs known targets,
  gain/clutter behaviour, and confirmation of the interface/multicast setup.

## Excluded from Phase 1 (future)

ARPA targets / CPA-TCPA / guard zones / alarms (Phase 2); the `/radar` PPI page
(Phase 3); dual-range and advanced Doppler/sector-blanking UI; recording radar
into session replay (a future hook — the renderer's spoke input is the natural
tap point).

## Risks / open items

- **Rendering approach** (corner-pin canvas) is unproven in this repo → early
  prototype against the emulator.
- **Navico/Halo Ethernet addressing + multicast + host interface** are Reported,
  not yet Verified → confirm on install.
- **mayara JSON shapes** (`GET /radars`, capabilities/legend, control ids) are
  read live → pin them against the running emulator while building the client.
- **wss/TLS:** HTTPS access to g5000 needs a `wss` mayara endpoint (e.g.
  Tailscale Serve); the `http` tailnet path needs none. A cloudflared radar
  tunnel is deferred (Tailscale-only chosen).
