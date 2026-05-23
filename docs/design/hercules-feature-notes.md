# B&G Hercules feature notes — implications for g5000

Source: B&G Hercules / Hercules WTP / Hercules Expansion Basic Operation Guide, document version 002 (software v2.0-123), copyright 2024.

Hercules is B&G's high-end **sailing processor** (the box that runs true-wind, polars, calibrations and serves data) — not a chartplotter. Hercules WTP adds Python scripting; Hercules Expansion adds more analog/serial/digital I/O. Everything user-facing happens through a **web interface** (a B&G mobile app or any browser), not an MFD. g5000 is closer in DNA to Hercules than to a Zeus MFD — we're a sailing processor + chartplotter combined.

What follows is a working note of the Hercules features worth adopting in g5000, organised by priority. Not a spec — a backlog of design candidates.

## High value — strong fit with g5000's current direction

### Sensor-health + dependent-calcs view (Sensors panel, manual p17)

Each connected sensor has a card that shows:

- **Live data value** (with green/red status dot).
- **"Directly used by"** — list of downstream calculations that consume this reading. For example, the boat-speed sensor card lists "True wind speed", "VMG", "VMC", "Polar %" so the user knows exactly which calculations go red when this sensor goes red.
- **Input** — current source, ability to switch sources, view other readings from the same source.
- **Operations** — adjustments and offsets specific to this sensor (wind-angle offset, heel correction toggle, mast-rotation correction toggle, leeway correction toggle, etc.).

We already have `/devices` and `/sources` for source discovery and selection, and per-page calibration screens, but nothing that links a sensor to its downstream consumers or surfaces "what's broken because this sensor is bad" in one place. Worth designing a unified Sensors page modelled on this layout. Highest UX leverage of anything in the manual.

### Tack-to-tack correction tables (manual p18–21)

Hercules stores per-sensor correction lookup tables that are interpolated at runtime. The three correction tables plus the polar table:

1. **True wind angle correction** — `correction = f(TWA, TWS)`. Corrects port/starboard wind-angle bias across TWS.
2. **True wind speed correction** — `correction = f(TWA, TWS)`. Corrects upwash/downwash wind-speed bias.
3. **Boat-speed-by-heel correction** — `correction = f(heel angle, BSP)`. Corrects paddle wheel against heel.
4. **Polars** — `target BSP = f(TWA, TWS)`. We already have this.

Each is an editable grid (TWA columns × TWS rows or vice versa), with named saved sets and an **Auto-calibrate wizard** that prompts the user through specific maneuvers and computes the table automatically.

We have polars and we have a damping page; we do not have tack-bias correction or heel-corrected BSP correction tables, and we don't have any guided cal wizards. Implementing all three correction tables + a wind-angle auto-cal wizard would close the biggest measurement-accuracy gap between g5000 and Hercules.

Storage shape (proposed): each table is `{ name, axes: { rows: number[], cols: number[] }, values: number[][], activeSet: string }`. Identical schema for all three correction tables and the polar table. Persist in `config.db` via `ConfigStore` next to the existing polar revisions.

### Race-recording event markers (manual p27)

While a recording is running, the user can drop time-stamped event markers with pre-set labels or custom labels: **End race**, **Full main**, **J1 / J2 / J3** (jib changes), **Race 1 / 2 / 3**, etc. They show up as named points on the recording timeline so the post-race analysis can jump straight to "the moment we changed to J3".

We log raw N2K frames + decoded samples into `data/sessions/*.jsonl.gz` for replay, but we have no concept of named events embedded in the log. Adding a simple `event(label: string, ts: number)` writer to the session-logger, plus a one-tap "drop event" button on `/race` and `/helm`, would make race recordings useful for review rather than just for debugging.

### Recording profiles (manual p26)

Hercules ships preset profiles (Performance, Sensors, Start, Corrections) and lets the user create custom ones, each defining which channels to record at what sample rate (e.g. 1 Hz vs 4 Hz). Default profile captures the union of all the standard race-analysis channels at 1 Hz.

We currently record everything raw (good for debugging) but have no notion of "race-mode = these 30 channels at 4 Hz, debug-mode = all frames at native rate". Adding a profile mechanism to the session-logger would shrink file sizes for routine race analysis and stop forcing the user to grep through full-fidelity logs to find the bits they care about.

### Polar import in multiple formats (manual p22)

Hercules accepts polar uploads in `.pol`, `.txt`, and `.csv` formats — compatible with Expedition, PredictWind, Adrena, iPolar, and H5000. Today we have a polar editor and our own JSON-shaped revisions, but no import path from a third-party tool.

A small addition: an `/api/polars/import` route that accepts the three common formats and converts to our internal grid. Low effort, opens us up to existing polar libraries (PredictWind generates them, Adrena exports them, every race team has a stash of `.pol` files).

## Medium value — useful but not blocking

### Setup-guide / first-run wizard (manual p13–14)

Hercules splits its setup tasks into **At-the-dock tasks** (secure device, boat details, select sources, review depth offset, review GPS offsets) and **On-the-water tasks** (calibrate boat speed, calibrate compass, calibrate wind angle offset, all guided via wizards).

For a single-boat install (Sula) this is overkill. But if g5000 ever gets a second boat, a first-run wizard turns "where do I start" into a one-screen checklist. Note: we already have a multi-boat slot in `G5000_BOAT_ID`, so the foundation is there.

### Dashboard page (manual p15)

A single "everything you need to know at a glance" page combining:

- Selected sensor readings (heading, depth, wind angle/speed, GPS, SOG) with status dots.
- Data-recording status and one-click event-marker buttons (overlap with the recording profiles item above).
- CPU and N2K load gauges.
- Internet connectivity status and pending uploads.

`/helm` is closer to this than anything we have but is too tile-focused. A discrete `/dashboard` (or expanded home `/`) is a small lift; CPU/N2K load gauges would require a tiny stats publisher on the bus. Useful for at-anchor "what's running?" checks more than for active sailing.

### Heel-corrected / mast-rotated / leeway-corrected wind toggles (manual p17)

Hercules exposes three independent corrections as user-visible toggles, each computed when the relevant additional sensor (heel, mast rotation sensor, leeway) is available:

- Heel correction adjusts AWA to compensate for mast tilt.
- Mast-rotation correction adjusts AWA when a rotating-mast boat changes mast angle.
- Leeway correction adjusts AWA against the leeway angle estimate.

We compute true wind from AWA/AWS/BSP/HDG but don't expose these per-correction toggles. Sula doesn't have a heel sensor, mast-rotation sensor, or leeway-angle output, so the immediate value to us is zero — but it's a clean architecture point worth replicating when/if those sensors arrive.

### Start-line "bias advantage in meters" (manual p24)

Their start-line panel shows:

- Distance behind line (BTL)
- Distance to port end / Distance to starboard end
- Line bias (degrees, with port/starboard indicator)
- Boat speed
- **Bias advantage in meters** — the asymmetry expressed as "the favoured end is X metres closer to the upwind mark"

We have the first four. The "advantage in metres" presentation is a much more concrete number for a tactician than "the line is 4° biased to port" — they immediately know whether the 30-second risk of fighting traffic to the favoured end is worth it. Small addition to the start-line compute.

## Low value or out of scope

### Python scripting SDK (Hercules WTP only)

Hercules WTP exposes a Python scripting SDK so users can define custom variables and calibration routines on the box. Powerful but it's a Grand-Prix racing feature for teams that hire dedicated boat analysts. Not a fit for our single-user-single-boat reality. Note for the very-long-term if g5000 ever ships to anyone else.

### Mobile app + cloud upload

Hercules ships a B&G mobile app that pairs via QR code and uses Navico's cloud for recording uploads and account management. We are deliberately self-hosted (the Pi _is_ the box; Cloudflare tunnel is the public face). No cloud strategy needed. The mobile UX is already covered by the web UI being responsive.

### microSD recording path

Their high-rate recordings go to a physical microSD slot on the processor box. We use the SD card the Pi already boots from for everything, with `~/.g5000-router/` as the disk-persisted root. No change needed.

### Ethernet + N2K display IP-discovery flow

Hercules can broadcast its IP onto the N2K network so a connected MFD or display can show it for the operator to type into a browser. We already know our own IP and we tell the user explicitly. Not relevant.

## Suggested next pick

If we're picking one feature off this list to ship next, **the Sensors panel with the "Directly used by" + Operations layout** has the best UX-to-effort ratio. It pulls multiple existing-but-scattered concepts (`/sources`, `/devices`, the cal pages) into one navigable mental model, and it's the page the user reaches for first when something looks wrong. A close second is the **race-recording event markers**, which would immediately make our session replay useful for race review.

The **correction tables** are the highest-impact feature for measurement accuracy but they're a much bigger lift (data model + UI + auto-cal wizards) and probably want their own multi-week project.
