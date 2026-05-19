# Exocet (Pixel sur Mer) — reference inventory & architectural takeaways

**Status:** Notes from a web sweep on 2026-05-11 looking for more Exocet
documentation beyond the release-notes PDF at the repo root.

## TL;DR

The release notes PDF (`RELEASE-NOTES_EN_EXOCET_2026-05_03-00-00.pdf`) and
the Exocet Gold product sheet are the most technical Exocet documents
publicly accessible. **The Manta (visual dataflow editor), WebApp, and
PSM decoder are NOT publicly documented** — Pixel sur Mer keeps that
material behind a customer/partner login. For G5000 design we have to
work from the release-notes feature list + marketing pages + third-party
reviews.

The single most important architectural finding from this sweep:

> _"The Pixel sur Mer Exocet Essential exemplifies this approach—it
> functions as an expert system sitting between the user and the B&G
> H5000 controller, changing the requested heading based on sensor
> inputs."_ — Yachting World, "Everything you need to know about high
> performance autopilots"

**Exocet does NOT replace the H5000 CPU/course computer. It overlays on
top of it.** That has real implications for our Phase 0b/0c topology
choice — see §4 below.

## 1. Pixel sur Mer product line (publicly known)

The release-notes PDF logs 106 versions but never describes the products.
The marketing pages do:

| Product                | Role                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Exocet Essential**   | Entry-level all-in-one: navigation + data logger + autopilot (overlay). Targets Class 40 / IRC / multihulls / Mini 6.50. Marketed as "offshore racing tech for a wider community".                                                                                                                                                                     |
| **Exocet Silver**      | Mid-tier (specs not public).                                                                                                                                                                                                                                                                                                                           |
| **Exocet Blue**        | Multi-protocol data logger + monitoring + web visual programming interface (i.e. Manta) with real-time viewing. The data-recording side of the stack.                                                                                                                                                                                                  |
| **Exocet Gold**        | Foiling flight controller. 350 g aluminum IP67 box, 9–51 V / 4 W, -10 to +50 °C, CE EN 60945 + FCC. 1× Ethernet, 2× CAN 2.0, 6× analog 16-bit @ 50 Hz, 2× digital in, 3× digital out, 5× RS232, 1× RS232/RS422. Inertial+height-sensor fusion claimed to "centimetre accuracy". For AC75 / IMOCA / Ultim foilers. Won Dame Award 2021 special mention. |
| **Exocet Safety**      | Newer product (2025+) focused on safety functions (MOB, anti-collision integration with sea.ai).                                                                                                                                                                                                                                                       |
| **Exocet Cloud**       | Cloud-hosted variant (details behind login).                                                                                                                                                                                                                                                                                                           |
| **Exocet FlyingShape** | Joint product with MDS: real-time 3D sail shape measurement.                                                                                                                                                                                                                                                                                           |

## 2. Confirmed software architecture

Inferable from the release notes + marketing copy:

- **Manta** is a graphical dataflow editor. The user wires "boxes" (typed
  nodes) into a "Manta Graph". Boxes for N2K decode/encode, NMEA0183
  encode/decode, calibration LUT (1D/2D), expressions, PID, FailSafe,
  AHRS, ASCII parsers, Nortek AD2CP (current profiler) integration,
  GoFree (B&G WiFi nav), Expedition in/out, Telegram alerts, Python
  scripting, H5000_Pilot, H5000_Analog, Display_BandG, DisplayGarmin.
  No public documentation exists for the box catalogue or graph format —
  the release notes are the only place box names are mentioned by name.
- **WebApp** is the user-facing dashboard. Configurable widgets (polar,
  circular/linear gauge, graph, simple data, segmented control, data
  table, alerts, anticollision). Live data via WebSocket. Configurable
  multi-MFD groups. No public documentation.
- **PSM decoder** is a sidecar (Windows command-line tool, mentioned in
  release notes); apparently used for offline log decoding. Not public.
- **Exocet itself** is the runtime that executes the Manta graph. Per the
  Gold product sheet, the algorithms are "derived from aeronautics and
  space industries" and "tuned using an automated tool chain".

## 3. What's publicly accessible

- ✅ `RELEASE-NOTES_EN_EXOCET_2026-05_03-00-00.pdf` (in repo root) — 106
  release entries from 2019 to 2026-04, terse "New features / Updates"
  bullets. The de-facto product catalogue + feature timeline.
- ✅ Exocet Gold product sheet (3.8 MB PDF, downloadable from
  pixelsurmer.com — but the link redirects to login on subsequent
  fetches; we grabbed it once).
- ✅ Product pages on pixelsurmer.com (Essential, Gold, Silver, Safety,
  FlyingShape, Cloud).
- ✅ Pixel sur Mer news posts — useful for real-world performance data
  (e.g. "Exocet Essential tested at 19 kn on the JPK 10.50 under
  spinnaker").
- ✅ Yachting World's autopilot survey article (covers H5000, Exocet,
  Madintec, Raymarine Evolution, NKE Gyropilot).
- ✅ blur.se "8 things I wish I'd known about the B&G H5000 autopilot"
  — operator-level wisdom, see `autopilot-design-notes.md` for the
  distilled lessons.

## 4. Topology note: Exocet overlays, we're replacing

Worth flagging because the topologies are visibly different and a future
maintainer might wonder: **Exocet Essential is an overlay on the H5000,
not a replacement.** From Yachting World:

> "The Exocet's overlays take the form of an expert system – a type of
> AI – that sits between the user and the H5000 controller, with the
> system changing the requested pilot heading depending on inputs from
> sensor data, including speed, heel and wind data."

So Exocet modifies the _target_ the H5000 course computer receives but
lets the H5000 own the actual rudder-drive PID.

**Our master spec §7 deliberately picks the other path: replace the
H5000 CPU outright** with our own primary/standby/shadow model
(§7.3, §7.5, §10 step 21). We take ownership of the full pilot stack —
target generation, PID, safety bounds, hardware fault handling — and
the H5000 course computer becomes just the rudder-drive amplifier we
talk to via PGN 127237 + the B&G proprietary 1857 PGNs.

The replace path is more work but is what the spec says we're doing.
The Exocet feature inventory below is therefore strictly a survey of
_what features we might want to copy_ — not a topology argument.

## 4a. Feature-gap inventory (Exocet has it, we don't yet)

Cross-referenced against the master-spec §10 build sequence and the
current commit. Sorted by my judgement of value-for-our-boat.

### High value — should add

| Exocet feature                                                                                                       | Our state                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Man Over Board** (button + DR bearing/range channels — H-LINK fns 185, 186)                                        | Not in master spec                                                               | Safety. Big red button on the page; stamps GPS pos; surfaces `mob.dr.bearing` + `mob.dr.range` channels; helm tile group.                                                                                                                                                                                                                                                                  |
| **Alerts engine + `/alerts` page** (history, mute, per-channel sector/low/high rules; H-LINK message types 32/33/34) | We have `alarm.autopilot.watchdog` channel name and that's it — no engine, no UI | Define an alarm-rule type per channel; central engine subscribes the bus and publishes `alarm.*` events; UI lists active + history.                                                                                                                                                                                                                                                        |
| **Tidal Set + Drift as first-class channels** (Exocet exposes; H5000 H-LINK fns 131, 132)                            | Spec §6.4 Kalman model produces this vector internally but doesn't expose it     | One small follow-on once §6.4 lands: publish `tidal.set` (rad) and `tidal.drift` (m/s) channels; helm tile pair.                                                                                                                                                                                                                                                                           |
| **Operating-variable channels — daggerboard up/down at minimum**                                                     | Polar is keyed only by TWS/TWA; no provision for boards-up vs boards-down        | Real catamaran impact: boards-up vs boards-down can shift target speeds by 10–20%. Today the sail wardrobe handles sail config but not appendage config. Two options: (a) add a boards-position channel + a boards-axis to the polar table, (b) use the wardrobe to encode "Default — boards down" + "Default — boards up" as separate sail configs. (b) is cheaper, (a) is more flexible. |
| **PHSPD / PASHR 0183 frames**                                                                                        | We parse MWV; not these                                                          | PHSPD = high-precision speed-and-heading (B&G/Garmin), PASHR = Applanix/Hemisphere proprietary attitude. Worth knowing they exist — add only if a sensor on the boat emits them.                                                                                                                                                                                                           |
| **Layered diagnose view on `/autopilot`**                                                                            | Not in master spec                                                               | Per the H5000 design notes (`autopilot-design-notes.md`). The Exocet UI surfaces sensor freshness + algorithm state separately. We already publish all the underlying observables; just need the assembly page.                                                                                                                                                                            |

### Medium value — worth a follow-up

| Exocet feature                                                                                                          | Our state                                                               | Notes                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Race timer + start-line tools** (start-line bearing, port/stbd-end distance, line bias; H-LINK fns 152, 272-275, 281) | Master spec §2.1 explicitly excluded                                    | Spec exclusion was about scope, not about value. Race timer is small; start-line tools are bigger. Worth re-opening if a regatta is on the calendar.                                                                           |
| **Bidirectional Expedition integration** (`Expedition_in` + `Expedition_out` boxes)                                     | We import polar CSV; no live data exchange                              | Most race tactical software wants live data IN and waypoint/route OUT. We could expose a `/expedition` integration that speaks their UDP/serial format. H-LINK is already most of the path (Expedition supports H-LINK reads). |
| **GoFree integration** (B&G's WiFi nav protocol)                                                                        | Not in spec                                                             | The Zeus SR plotter on the boat speaks GoFree. We could read waypoint/route info over WiFi without going through the N2K bus. Useful for /autopilot Navigation mode.                                                           |
| **Heel correction on BSP** (H5000 has 2D BSP[heel_bin][speed_bin])                                                      | Our BSP cal is 1D                                                       | H5000 default; meaningful on a heeling monohull, much less on a cat. Worth knowing the table shape if we ever decide to add it; YAGNI for now.                                                                                 |
| **Optimum Wind Angle channel** distinct from Target TWA (H-LINK fns 53 + 83)                                            | We have `performance.target.twaUpwind` only                             | H5000 exposes both — function 53 (absolute optimum TWA, polar-derived) and function 83 (signed target TWA accounting for tack). Worth surfacing as separate channels for clarity.                                              |
| **Damping config exposed via H-LINK** (H5000 H-LINK message type 206)                                                   | We have damping config exposed via REST + `/damping` UI; not via H-LINK | Add H-LINK message type 206 support if tactical software wants it; small extension to the H-LINK server.                                                                                                                       |

### Out of scope (explicit) — for reference

- **Manta graphical box editor** — master spec §4.4 rejected this approach (TypeScript channel-mapping wins).
- **Cloud connectivity / Telegram / Python box / AI prompt** — master spec §2.1 out-of-scope.
- **AIS / anti-collision / TargetManager** — master spec §2.1 out-of-scope.
- **Nortek AD2CP** (direct current-profiler hardware) — would obsolete §6.4 Kalman if added, but hardware-dependent; not on this boat.
- **Cellular telemetry / fleet tracking** — master spec §2.1 out-of-scope.
- **NMEA 2000 certification + IP67 enclosure** — master spec §2 out-of-scope; we're a personal build.
- **Many heavily-instrumented operating-variable load cells** (mainsheet load, runner port/stbd, J1/J2/J3 halyard loads, foil port/stbd loads, etc., H-LINK fns 341-349, 350-359) — hardware-dependent; not on this boat.

## 5. What we can NOT get publicly

- Manta box catalogue / box-graph file format
- Manta-to-runtime compilation pipeline / VM design
- WebApp widget catalogue / config schema
- Per-product hardware schematics
- Exocet ↔ H5000 protocol details (which PGNs / H-LINK functions Exocet
  reads + writes when in overlay mode — we'd have to packet-capture)
- PSM decoder format / API
- Pricing (everything we found is "contact us")

If we ever need this material for direct interop testing, the path is
to contact Pixel sur Mer directly (their site says
`contact@pixelsurmer.com`, offices in Lorient and Brest).

## 6. Real-world performance anchors

From Pixel sur Mer's own demo material (so take with marketing-grain
of salt, but the boats are real):

- JPK 10.50 (Régis Vian): 19 kn under autopilot, including under
  spinnaker, sustained at 20 kn boat speed in quartering seas.

From Yachting World (real-racing context):

- Class 40, mid-Channel, gusting 30 kn close-hauled: _"our heading
  feathers up a little into the wind to avoid excess heel, while
  simultaneously maximising VMG"_ — exactly the Gust Response + Heel
  Compensation behaviour we'd model.

From Rupert Holmes (Yachting World):

- _"I've sailed raceboats with complex and expensive electronics that
  require extensive set up to get decent performance, yet every setting
  was still on the factory default even after the completion of a Rolex
  Fastnet Race."_

That last quote is the strongest argument for our "all expert systems
default off, sensible base config" stance from the autopilot design
notes — the failure mode in this industry is _not_ under-engineering,
it's over-engineering with un-tuned settings.

## 7. Sources

- [Pixel sur Mer — Exocet Essential](https://www.pixelsurmer.com/en/services-products/product-sales-and-distribution/exocet-essential)
- [Pixel sur Mer — Exocet Gold](https://www.pixelsurmer.com/en/services-products/product-sales-and-distribution/exocet-gold)
- [Pixel sur Mer — Exocet Safety](https://www.pixelsurmer.com/en/services-products/product-sales-and-distribution/exocet-safety)
- [Pixel sur Mer — Exocet Silver](https://www.pixelsurmer.com/en/services-products/product-sales-and-distribution/exocet-silver)
- [Pixel sur Mer — Exocet Essential 2025 announcement](https://www.pixelsurmer.com/en/news/exocet-essential-2025-more-accessible-more-powerful)
- [Pixel sur Mer — JPK 10.50 sea trial (19 kn under autopilot)](https://www.pixelsurmer.com/en/news/first-sail-with-regis-vian-exocet-essential-put-to-the-test-on-the-jpk-10-50)
- [Pixel sur Mer — Exocet FlyingShape (sail-shape measurement)](https://www.pixelsurmer.com/en/news/pixel-sur-mer-and-mds-unveil-exocet-flyingshape-a-technological-breakthrough-for-real-time-3d-sail-shape-measurement)
- [Pixel sur Mer — Pixel sur Mer × B&G partnership](https://www.pixelsurmer.com/en/news/pixel-sur-mer-and-b-g-partnership)
- [Yachting World — Everything you need to know about high-performance autopilots](https://www.yachtingworld.com/yachts-and-gear/everything-you-need-to-know-about-high-performance-autopilots-160009)
- [blur.se — 8 things I wish I'd known about the B&G H5000 autopilot](https://www.blur.se/2026/05/04/8-things-i-wish-id-known-about-the-bg-h5000-autopilot/)
- `RELEASE-NOTES_EN_EXOCET_2026-05_03-00-00.pdf` (in repo root)
