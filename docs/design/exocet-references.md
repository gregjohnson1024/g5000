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

> *"The Pixel sur Mer Exocet Essential exemplifies this approach—it
> functions as an expert system sitting between the user and the B&G
> H5000 controller, changing the requested heading based on sensor
> inputs."* — Yachting World, "Everything you need to know about high
> performance autopilots"

**Exocet does NOT replace the H5000 CPU/course computer. It overlays on
top of it.** That has real implications for our Phase 0b/0c topology
choice — see §4 below.

## 1. Pixel sur Mer product line (publicly known)

The release-notes PDF logs 106 versions but never describes the products.
The marketing pages do:

| Product | Role |
|---|---|
| **Exocet Essential** | Entry-level all-in-one: navigation + data logger + autopilot (overlay). Targets Class 40 / IRC / multihulls / Mini 6.50. Marketed as "offshore racing tech for a wider community". |
| **Exocet Silver** | Mid-tier (specs not public). |
| **Exocet Blue** | Multi-protocol data logger + monitoring + web visual programming interface (i.e. Manta) with real-time viewing. The data-recording side of the stack. |
| **Exocet Gold** | Foiling flight controller. 350 g aluminum IP67 box, 9–51 V / 4 W, -10 to +50 °C, CE EN 60945 + FCC. 1× Ethernet, 2× CAN 2.0, 6× analog 16-bit @ 50 Hz, 2× digital in, 3× digital out, 5× RS232, 1× RS232/RS422. Inertial+height-sensor fusion claimed to "centimetre accuracy". For AC75 / IMOCA / Ultim foilers. Won Dame Award 2021 special mention. |
| **Exocet Safety** | Newer product (2025+) focused on safety functions (MOB, anti-collision integration with sea.ai). |
| **Exocet Cloud** | Cloud-hosted variant (details behind login). |
| **Exocet FlyingShape** | Joint product with MDS: real-time 3D sail shape measurement. |

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

## 4. The overlay-vs-replace question (the load-bearing decision)

Pixel sur Mer's Exocet Essential implementation is an **overlay** on the
H5000 system, not a replacement. From the Yachting World article:

> "The Exocet's overlays take the form of an expert system – a type of
> AI – that sits between the user and the H5000 controller, with the
> system changing the requested pilot heading depending on inputs from
> sensor data, including speed, heel and wind data."

So Exocet:

- Receives the user's intent (target heading or wind-angle)
- Reads sensor data from the bus
- Computes a *modified* target heading (e.g. bear away in a gust before
  heel builds)
- **Sends the modified target to the H5000 course computer via the
  normal PGN 127237 or H-LINK channel**
- Lets the H5000 do the actual rudder-drive PID — the validated
  rudder-load, hard-over-time, etc., logic stays B&G's

Our master spec §7 was written assuming we'd replace the H5000 CPU with
our own primary/standby/shadow model. Compare topologies:

| Approach | Pros | Cons |
|---|---|---|
| **Replace (current spec)** | Full ownership of pilot algorithm; can use any course computer; not gated by H5000 firmware | We become responsible for rudder safety, sanity bounds, hardware-level fault handling. Big surface area. |
| **Overlay (Exocet's approach)** | Keep H5000's validated rudder-drive logic. Only need to ship "expert systems" that bias the target. Much smaller surface area for Phase 0c. User can disable our overlay and fall back to vanilla H5000 mid-sail. | Tied to whatever target-heading-bias the H5000 will accept; bounded by H5000's PID response (so we can't fix bad H5000 behaviour). |

**For our build**, the overlay topology is probably the right place to
start, even if the spec eventually evolves to "replace". Reasons:

1. The H5000 course computer is already on the boat. Its rudder-drive
   PID is tuned and works. Re-validating that ourselves is a multi-day
   on-water exercise we don't need to take on first.
2. Phase 0b shadow mode → Phase 0c overlay is a *much smaller step*
   than Phase 0b shadow → Phase 0c replace. The shadow log already
   compares our intended target heading against the H5000's. To go live
   in overlay mode, we just emit the same target to the H5000 instead
   of writing it to the file sink. The H5000 keeps doing all the
   actual steering work.
3. If we later decide we want to fully replace, the spec already covers
   that path — we don't lose any architectural flexibility, we just
   defer the replace work.
4. The "expert systems" (Gust Response, TWS Response, Heel Compensation
   from the H5000 design notes) are exactly the things we'd build in an
   overlay. The blur.se autopilot post says these are also where the
   real value is — the underlying PID is already commodity.

**Recommended revision to master spec §7:** Add an Overlay mode between
shadow (§7.5) and primary (§7.3). The "Phase 0c live engagement" step
in §10 then becomes "Phase 0c overlay" (we modify the H5000 target via
PGN 127237 / H-LINK fn 83 `TARGET TWA`), with full primary mode
remaining a future option for after-the-boat-is-known-good.

This is also consistent with what we already built today:
- H-LINK fn 83 already in our function-number table (writes are not yet
  implemented but the protocol slot is there).
- Source priority would let an operator pick "Exocet target" over
  "raw user target" for `autopilot.target.heading` channel arbitration.
- The "TX gated when not live" pattern is what an overlay needs.

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

- Class 40, mid-Channel, gusting 30 kn close-hauled: *"our heading
  feathers up a little into the wind to avoid excess heel, while
  simultaneously maximising VMG"* — exactly the Gust Response + Heel
  Compensation behaviour we'd model.

From Rupert Holmes (Yachting World):

- *"I've sailed raceboats with complex and expensive electronics that
  require extensive set up to get decent performance, yet every setting
  was still on the factory default even after the completion of a Rolex
  Fastnet Race."*

That last quote is the strongest argument for our "all expert systems
default off, sensible base config" stance from the autopilot design
notes — the failure mode in this industry is *not* under-engineering,
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
