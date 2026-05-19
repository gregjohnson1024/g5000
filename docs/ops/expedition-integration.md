# Expedition ↔ G5000 integration via H-LINK

**Goal:** Use Expedition (the race tactical software) to read live G5000
data — TWS/TWA, BSP, %polar, target speed, VMG, polars themselves —
without any G5000-side changes beyond what's already shipped.

**TL;DR:** Point Expedition's H-Link instrument input at the G5000's
TCP port `5050`. Expedition reads our `V` frames the same way it reads
B&G H5000 H-Link output. No extra translation layer required.

## What works today

The G5000 autopilot-server runs an H-LINK protocol server on
configurable port `HLINK_PORT` (default `5050`). The server is a faithful
implementation of B&G's documented H-Link command set (see
`docs/superpowers/specs/2026-05-08-h6000-design.md` references to the
H5000 Operation Manual chapter 11):

- ASCII line-based, mandatory XOR-8 checksum, `<CR><LF>` terminated.
- Read-only commands: `#OV,n,m,f` (one-shot value), `#OV,n,m,f,1`
  (enable streaming), `#OS,1` (start streaming), `#OS,0` (stop).
- Reply format: `V<NNN>,<MMM>,<FFF>,<value>*<CS>\r\n`.

Function numbers we currently expose (channel ↔ H5000 function mapping
lives in `apps/autopilot-server/src/hlink/function-table.ts`):

|  Fn | What it is                           | Internal channel               | Unit out    |
| --: | ------------------------------------ | ------------------------------ | ----------- |
|  11 | Rudder angle                         | `boat.rudder.angle`            | deg, signed |
|  52 | Heel                                 | `motion.heel`                  | deg, signed |
|  53 | Target TWA (absolute, polar-optimum) | `performance.target.twaUpwind` | deg         |
|  65 | Boat speed                           | `boat.speed.water`             | knots       |
|  73 | Heading (magnetic)                   | `boat.heading.magnetic`        | deg, 0–360  |
|  77 | AWS                                  | `wind.apparent.speed`          | knots       |
|  81 | AWA                                  | `wind.apparent.angle`          | deg, signed |
|  83 | Target TWA (signed, tack-aware)      | `performance.target.twaUpwind` | deg, signed |
|  85 | TWS                                  | `wind.true.speed`              | knots       |
|  89 | TWA                                  | `wind.true.angle`              | deg, signed |
| 109 | TWD                                  | `wind.true.direction`          | deg, 0–360  |
| 124 | Polar performance                    | `performance.percentPolar`     | %           |
| 125 | Target boat speed                    | `performance.target.boatSpeed` | knots       |
| 127 | VMG                                  | `performance.vmg`              | knots       |
| 155 | Fore/aft trim (pitch)                | `motion.pitch`                 | deg         |
| 193 | Depth                                | `nav.depth`                    | meters      |
| 233 | COG                                  | `nav.gps.cog`                  | deg, 0–360  |
| 235 | SOG                                  | `nav.gps.sog`                  | knots       |
| 285 | VMG performance (target)             | `performance.target.vmg`       | knots       |

The server also throttles each function to **5 Hz max per client**
(streaming bus traffic at 10–20 Hz would saturate slow TCP buffers and
serves no tactical-software purpose).

## What's not implemented yet

- **Writes**: `#IV` (Input Value) is parsed but ignored. Most of our
  channels are derived/computed; we don't expose the calibration tables
  as H-LINK writes. Polars and cal tables are edited through the web
  UI.
- **Table I/O**: `#TO` / `#TI` (full polar table upload/download via
  H-LINK) is not implemented. Expedition can import the polar via CSV
  through the web UI, which is the path most users take anyway.
- **Damping config**: H-LINK message type 206 not exposed. Damping is
  set via `/damping` REST today.
- **Position**: `#OL` (Output Latitude/Longitude) is not yet wired —
  the `nav.gps.position` channel exists on the bus but no H-LINK frame
  type for it has been defined. Easy add when needed.

## Expedition setup

These instructions are for Expedition's "H-Link" instrument type.
Steps were verified against Expedition's documented configuration; if
your Expedition version's UI differs, the underlying concept is the
same: Expedition reads H-Link ASCII frames from a serial or TCP source.

### TCP path (recommended)

1. In Expedition: **Settings → Instruments → Add**.
2. **Type:** H-Link.
3. **Connection:** TCP.
4. **Host:** the G5000 box's IP. On the boat LAN that's the static IP
   you assign the Pi; via Tailscale it's the tailnet name (e.g.
   `g5000-pi`) or IP (`100.64.0.117`).
5. **Port:** `5050`.
6. Save and enable the instrument.

Expedition will automatically issue `#OV,...,1` enables + `#OS,1` for
the function numbers it cares about. The G5000 server will start
streaming `V` frames at up to 5 Hz per function.

### Serial path (for older Expedition versions)

If your Expedition build only supports H-Link over a serial port, use
a TCP-to-serial bridge:

- **Windows:** `com0com` + a small relay script that connects to our
  TCP port and forwards bytes to a virtual COM port. Expedition reads
  the COM port.
- **macOS / Linux:** `socat` does this in a single line:
  ```bash
  socat pty,raw,echo=0,link=/tmp/ttyHLink TCP:g5000-pi:5050
  ```
  Then point Expedition at `/tmp/ttyHLink` at 115,200 baud.

### Configuring Expedition's variable mapping

Expedition lets you map H-Link function numbers to its internal
variables. The function numbers we expose (above) are the standard
B&G H5000 numbers, so Expedition's default mapping should work
unchanged. If a value reads as `0` or doesn't appear:

- Confirm the G5000 server logs an inbound connection: tail
  `journalctl -u g5000-autopilot.service`. You should see
  `H-LINK connection from <ip>` or similar.
- Confirm the function is in our table (the table above is the source
  of truth — anything not listed reads as an empty `V` frame).
- Confirm the data is actually publishing on our bus. In DEMO mode
  only the channels the demo injector publishes will stream — e.g.
  `wind.apparent.*`, `boat.speed.water`, `motion.heel`, `nav.gps.*`,
  `performance.*`. In live mode (NGT-1 connected) the picture depends
  on which N2K devices are publishing.

## Quick verification

Use this one-liner to confirm the server is alive and a function
streams correctly:

```bash
# One-shot read of TWS (function 85):
( printf '#OV,,1,85*5F\r\n'; sleep 0.5 ) | nc -w 1 g5000-pi 5050

# Expected output (in DEMO_MODE):
# V001,001,085,11.42*XX
```

A larger session emulating Expedition's first 5 seconds is in
`scripts/test-hlink-expedition.sh` (see below).

## Bidirectional and what's missing for it

Expedition can also write back: waypoint updates, route info, polar
upload. To support those we'd need:

- **Waypoints / routes from Expedition:** typically sent as NMEA 0183
  `$GPRMB`, `$GPWPL` sentences. Path: Expedition emits over a 0183
  output port → we ingest via a serial port → parse → publish to
  `nav.waypoint.*` channels. The 0183 parser plumbing exists from
  Plan 2; adding the GPRMB/GPWPL sentence handlers is a small follow-on.
- **Polar upload from Expedition:** `#TI` (Input Table) command. Not
  yet implemented in our H-LINK server. The CSV-import path via the
  web UI works today and is the common workflow.

Neither is currently needed for the read-side integration, so they're
deferred until someone actually wants to push data from Expedition to
the G5000.

## Smoke test

Run `scripts/test-hlink-expedition.sh` against a running G5000 (DEMO_MODE
is fine) to exercise an Expedition-shaped session:

1. Connect to TCP `5050`.
2. Enable streaming for ~8 common functions (BSP, AWS, AWA, TWS, TWA,
   TWD, COG, SOG).
3. `#OS,1` to start streaming.
4. Read frames for ~3 seconds.
5. `#OS,0` to stop.
6. Verify checksums are valid, frames are well-formed, and each enabled
   function appeared.

The script prints PASS/FAIL per check.
