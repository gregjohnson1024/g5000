# B&G Tracks app feature notes — implications for g5000

Source: Simrad / B&G **Tracks App Guide**, English, document version 002, software version 2.3 (©2025 Navico Group). Applies to NSS 4, Zeus SR, NSX, and Zeus S — Navico's new-generation MFD line.

## What the manual covers (and doesn't)

This is a narrow, single-feature guide for the **Tracks** app — one of several stand-alone apps on the new MFDs (Chart, Tracks, Waypoints & Routes, etc.). It documents recording, tagging, filtering, sorting, importing, exporting, deleting, and converting tracks to routes, plus a built-in **Trip Log**. It is NOT a sailing-processor or chart-engine manual — there is nothing here about true wind, polars, laylines, race tools, weather routing, autopilot, or chart sources. So the takeaway list is narrower than the Hercules guide.

That said, g5000 already has a `/tracks` page, an `/api/tracks/*` backend, and a live `track-recorder` that auto-starts on the first GPS fix. The interesting question isn't "do we need tracks?" — it's "what features of the new B&G tracks UX are real gaps in ours?"

## What g5000 already has

For grounding, the current state in `packages/web/src/app/tracks/page.tsx` + `packages/web/src/app/api/tracks/**`:

- Live recorder with status panel (status, activeTrackId, pointsAppended, lastPoint).
- Auto-start on first GPS fix (no "start track" button needed).
- Saved-track list: number, ID, editable label, started/ended UTC, duration, distance (NM, over-ground), point count.
- `PUT /api/tracks/[id]` to rename, `DELETE /api/tracks/[id]` to remove.
- "Stop & start new" (interrupt) button that ends the active track and begins a fresh one in one click.
- `BroadcastChannel('tracks')` signal to `/chart` so the live breadcrumb trail clears on interrupt.
- `/passage` ties to the active track for distance integration: 1 h / 3 h / 6 h / 12 h / 24 h over-ground tiles + 7-day daily-distance history.
- `/marks-and-routes` pulls current position from the active track's last point.

So **track recording, listing, renaming, deleting, and live-trail rendering all exist.** The gaps below are organising-and-using-tracks features built on top of that foundation.

## High value — clear gaps that the manual exposes

### Track → route conversion (manual p10)

Tracks app: any saved track can be saved as a route with a single button (`Create route`). The new route shows up in the Waypoints & Routes app and can be navigated to.

We have a waypoint-and-route model (`/marks-and-routes`, `/api/route/plan`) and we have tracks, but no converter between them. A track → route endpoint that runs Douglas-Peucker simplification at ~0.05 NM tolerance to reduce a 5-hour breadcrumb into 6–12 waypoints would close this gap. Useful for "retrace the way I came out of this anchorage but skip the dead ends" and for turning a known-good delivery passage into a re-runnable route. Single endpoint + a button on the `/tracks` row Actions column.

### GPX import / export (manual p12–14)

Tracks app exports tracks to a microSD/USB stick in `.gpx`, `.usr`, and `.neon`. The microSD model is irrelevant for us (the Pi has no slot in regular use and our model is HTTP), but the wire formats matter:

- **GPX** is the universal interchange format — OpenCPN, Navionics, Garmin, PredictWind, Expedition all read and write it. An import route that accepts uploaded `.gpx` and produces internal track records, plus an export route that writes the same out, opens us to importing recorded passages from any other tool and to handing off our own tracks. Library options: `gpxparser` (small, no deps) or ~50 lines of manual `<trkpt lat="..." lon="...">` parsing — GPX is dead simple XML.
- `.usr` (Lowrance) and `.neon` (Navico) are proprietary container formats holding tracks + waypoints + routes + sonar + settings. Worth ignoring unless someone shows up with a USR file they want imported.

Pairs naturally with the track → route feature above: import a GPX track from a delivery skipper, convert it to a route, sail it.

### Distance "through water" alongside distance "over ground" (manual p17, Trip Log)

The Trip Log shows BOTH GPS distance over ground AND distance through water (boat-speed integration). The manual calls this out explicitly: the trip log "helps spot drift or current effects by tracking speed and distance" — the delta IS the current-set component over that trip.

We compute `totalDistanceM` from GPS only. We have BSP on the bus (`nav.bsp.value`). A second per-track field `waterDistanceM` integrating BSP between fixes would expose the through-water distance, and a derived "current set over this leg" tile on `/passage` (`overGround - throughWater` / duration as average current) would surface real information we already have raw on the bus. Storage cost is one extra number per track; compute cost is one extra integrator in the recorder.

### Track display on chart with time-range filter (manual p18, Track settings)

Track settings panel exposes `Show on chart` (master toggle) + a time-range radio of **Past day / Past week / Past month / Past year / All time**. Without this, a year of breadcrumbs becomes a chart-killing tangle of polylines on top of the current passage.

We render the current track as a live trail (the BroadcastChannel signal hints at this), but I see no historical-tracks layer with a time-range filter. As track count grows past ~10, this stops being optional. Cheap to ship: a layer that queries `GET /api/tracks?since=<iso>`, returns lightweight polyline coords (not all points, sub-sampled), and renders below the live boat marker. Maps onto the same `chart:layers` localStorage pattern that already controls the NOAA ENC toggle.

### End track without immediately starting a new one (manual p5)

Their flow has two distinct actions: **Start track** and **End track**. Our flow only has **Stop & start new** — there's no way to leave the recorder idle. For a continuously-on Pi this is mostly fine (we always want a track when underway), but if the boat is on the hard for the winter, the recorder is still creating empty single-point tracks every time the GPS briefly sees a fix.

Add a `POST /api/tracks/end` (or `mode: 'end' | 'restart'` on the existing interrupt route) and an "End current track" button next to "Stop & start new". Pairs with an idle-state recorder that doesn't begin a new track until the next continuous-fix window arrives.

## Medium value — useful organising features

### Tags shared across tracks, waypoints, and routes (manual p7–9)

Tracks app tags are free-form labels that can be **searched, autocompleted, and reused across all user-content types** — the same "Bermuda 2026" tag groups the outbound track, the dropped waypoints, and the return route in one filterable bundle. Their tag examples are fishing-flavoured (`Snapper`, `Atlantic Pollock`, `Crete`) but the data shape is general.

For us this is a small feature with a real organising payoff once track count is high. Schema: a `tags` table with `(name, ref_type, ref_id)` rows, joined to the existing `tracks`, `waypoints`, and `routes` (or whatever stores plans). UI: a tag chip below the track label + a tag-search filter in the page header. Worth doing only after we have rectangle/polygon spatial filter (below) — tags become important when there are too many tracks to scroll.

### Spatial filter: rectangle / polygon selection on the chart (manual p15)

The Filters panel has six options: None, **Rectangle selection**, **Polygon selection**, name, date, color, tag. The rectangle/polygon options let the user draw a region on the chart and the list filters to tracks that pass through it.

That's a real spatial-index query — rbush, which we already use in `@g5000/coastline` for land-avoidance. For a cruising boat with hundreds of recorded passages, "show me every time I've sailed in Buzzards Bay" is the right shape for re-finding a track from two years ago. Cost: an rbush index keyed by track id and storing per-track bbox or simplified polyline; rebuild on track end. Reusing the rbush already in the dependency tree means no new packages.

### Per-track color (manual: implicit in "Filter by color")

Each track has a color used in both the list chip and the chart polyline. We currently render whatever color the chart-layer code hard-codes. Adding `color` to the track schema and a colour-picker on the row edit is trivial; the value comes when paired with the time-range chart filter above — distinguishing outbound from return, or "the day we hit something" from everything else, requires colour to read at a glance.

### Sort by **Proximity to your vessel** (manual p16)

Sort options: A-Z, Recent, **Proximity**. The first two are obvious; proximity sorts by distance from current GPS to the nearest point of each track. Surfaces "what have I sailed near here?" without making the user remember names. If we ship the rbush bbox index for the spatial filter, proximity sort is free (compare track-bbox-centroid to live position).

### See-details modal (manual p6)

The Tracks app's track-detail view shows duration, distance, date travelled, tags, and offers options: Create route, Rename, Export, Delete, Add tag. We render most of these as a single row in a table; a detail page or modal that includes a small inline chart of the track polyline + speed profile (BSP vs time) would be the more useful evolution. Not blocking but a natural place to land per-track analysis (max heel, max gust, time-on-port-tack vs starboard, etc.) once we have it.

### Bulk operations: Tag all / Delete all / Export all (manual p9, 11, 13)

The options menu on the list header has bulk actions that apply to the currently-filtered list. Most useful is **Export all (filtered)** — combined with a tag filter, that becomes "export every track tagged Bermuda-2026 as a single GPX". Trivial wrapper around the per-track export once that exists; the filter integration is the part that matters.

## Low value or out of scope

### Auto-segmentation by speed threshold (manual p17, Trip Log idiom)

"Trip Log starts tracking automatically when your vessel reaches >3.0 kn." Our current behaviour starts on first GPS fix, which is arguably better (we capture the moment of leaving the dock, including manoeuvres below 3 kn) — but our trade-off is that we record dock-creep, drift in the slip, and GPS jitter while moored, and those all show up as tiny low-distance tracks.

Worth considering as a configurable "Auto-segment new track when SOG drops below X kn for Y minutes" knob, but the value is small for our use case. Don't ship until track count gets noisy.

### Trip Log as a separate UI page distinct from Tracks (manual p17)

The MFD has Tracks AND a Trip Log tab within Tracks, with its own "Save and reset" verb to roll over the current trip into a logbook. Our `/passage` page already serves the Trip Log role (active track elapsed + distance tiles + 7-day daily history), and our session-restart-friendly architecture means there's no "reset" verb to mash. The data is the same; the UI split is theirs, not a requirement. Don't reshape the page tree.

### microSD / USB import-export flow

Their physical-media model — the user inserts an SD card, picks files, imports — doesn't apply to us. The Pi has no plugged-in card and our model is HTTP upload. Borrow the user goal (move tracks in and out), not the storage transport.

### `.usr` and `.neon` proprietary formats

Lowrance and Navico container formats. GPX covers ~99% of real interchange and is the only one likely to come up unless we explicitly target migrating off a Zeus/B&G unit.

### Track recording from microSD as a primary storage path

The Tracks app stores tracks on the MFD's internal storage and offers export to removable media. Our model is opposite: storage is the Pi's persistent disk (`data/sessions/` and SQLite), and "removable media" is HTTP download. No change needed.

### "Look ahead" chart toggle as a named setting (manual p18)

Chart settings shows a `Look ahead` switch. We have an implicit version of this — `useChartCamera`'s orient-by-COG path pushes 30% top padding so the boat sits at lower-third. Exposing it as a standalone toggle independent of orientation cycle (so "look ahead but oriented north" is reachable) is a small change to the camera hook, but it's a chart concern, not a Tracks-app concern, and not particularly motivated by this manual.

## Suggested next picks

Ordered by value-to-effort given the existing foundation:

1. **Track → route conversion** with Douglas-Peucker simplification. One endpoint, one button on the row. Closes the most-asked-for gap — turning a known-good past path into a re-runnable route.
2. **Distance through water** integrated alongside distance over ground in the recorder, exposed as a per-leg "average current set" tile on `/passage`. One extra integrator; reuses BSP we already publish; surfaces information we currently throw away.
3. **GPX import / export.** Cheap, opens interchange with OpenCPN / PredictWind / Navionics / Expedition. Pairs perfectly with #1 (import a delivery skipper's GPX, convert to route, sail it).
4. **Time-range historical-tracks chart layer** (`Past day / week / month / year / all`). Becomes important once track count > ~10; cheap layer add.
5. **End-track-without-restart** verb on the recorder. Small but closes a real edge case for off-season periods.

Tags, spatial filters, per-track color, proximity sort, and the see-details modal all come later — they're organising features that only pay off once track count is high.

## A note on scope

This is a much narrower manual than the Hercules guide. Hercules is a 30-feature sailing-processor reference covering correction tables, cal wizards, race recording, and sensor health; Tracks is a single 18-page app guide for one feature on the new MFD line. The five high-value picks above are real but small — each is a 1-2 day shippable change, not a multi-week project. If we're looking for the bigger reshape of g5000's sailing-data layer, the Hercules notes (`docs/design/hercules-feature-notes.md`) are where the heavy work is.
