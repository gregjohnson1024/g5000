# G5000 UI Overhaul — On-the-Boat Acceptance Checklist

> Generated 2026-07-07 by a 5-agent workflow grounded in the shipped code, the proposal
> (§4 themes / §5 components / §7 per-tab), the keep-list, and the per-phase review findings.
> The one thing no build/test/route-smoke gate could verify is exactly this visual/interaction
> layer — themes, staleness animation, hold-feel, per-station scale, cross-device sync.

## Status notes (read first)

- **Unresponsive-UI bug: FIXED + deployed** (`cc617c5`, 2026-07-07). Root cause was an SSE
  re-render storm — the app-wide store re-rendered the whole shell on every data message.
  Now backed by `useSyncExternalStore` selectors so consumers re-render only on their own
  slice. **Hard-refresh the browser** (⌘/Ctrl-Shift-R) to pick up the new bundle.
- **Three bugs this guide surfaced (not yet fixed — queued as a follow-up):**
  1. **NIGHT map basemap doesn't recolour red** — `--map-filter` is defined per theme but
     applied to no element; the biggest surface on the boat stays full-colour at night.
     Also blue at night: anchor WindDial arrow (`#38bdf8`), AnchorWatch swing ring, AC-loads
     history chart (hardcoded rainbow) — all raw hex that bypasses the theme.
  2. **MOB from the AppBar sends no position** — `NavShell` renders `<MobButton livePos={null}>`,
     so a MOB fired from the shell captures no fix (alarm sounds, but Takeover shows no lat/lon
     and no chart marker). Verify with a live GPS fix.
  3. **Suspected start-line port/stbd inversion** — `StartLineLayer` appears to paint the port
     end green and stbd end red (backwards). Eyeball before racing.

---

The checklist below is tickable; run it standing at a display.

## 1. 30-SECOND SMOKE TEST (if any fail → stop, consider rollback)
- [ ] /sail loads on the Pi in DAY, no white/broken page, no red console errors
- [ ] Top AppBar intact: UTC clock ticking (HH:MM:SSz mono), link LED, theme chip, bell, MOB — not wrapped to 2 rows
- [ ] Helm instrument wall shows 6 cells (SOG/HDG/COG/DEPTH/AWS/AWA), aligned, no doubled borders, no missing tile
- [ ] Kill a live feed → a numeral dims then hollows + shows an age chip within ~10s (a frozen bright number = STOP)
- [ ] Press-and-HOLD MOB fires only on hold; single click does nothing
- [ ] Basemap pans/zooms/rotates on /chart; dock doesn't swallow map gestures

## 2. THEMES (cycle DAY → NIGHT → SUN via the AppBar chip)
- [ ] Theme chip recolours the WHOLE app each click; reload on NIGHT/SUN → no white/DAY flash
- [ ] DAY looks like the old app — no panels a shade too light/dark, hairlines still visible
- [ ] **NIGHT map basemap recolours red** — KNOWN BUG: tiles stay full-colour blue/green (`--map-filter` applied nowhere)
- [ ] NIGHT anchor WindDial arrow/ticks are red, not blue (KNOWN: hardcoded #38bdf8)
- [ ] NIGHT AnchorWatch swing-ring + boat dot are red, not blue (KNOWN: hardcoded)
- [ ] NIGHT AC-loads history chart is red brightness-steps, not an 8-colour rainbow (KNOWN: hardcoded palette)
- [ ] NIGHT hunt: no green LIVE LED, no emerald OK text, no amber selected chips, no blue/cyan chart routes; selected = red OUTLINE not amber fill
- [ ] NIGHT chart wind/current/GulfStream overlay fills aren't full-bright
- [ ] NIGHT Conditions/Voyage/Boat tables + SVG charts + forms — no blue links, no bright axes/series
- [ ] NIGHT Takeover/MOB/AlarmLane are red-only (only the ≤1Hz inverted danger block may be bright)
- [ ] SUN is genuine paper: warm off-white canvas, near-black text, nothing light-grey-on-white; WindDial/AnchorWatch dark navy faces don't clash
- [ ] Theme flips one device → Pi + phone + mast all recolour within ~1s (confirm boat-wide sync is acceptable)

## 3. SAFETY & MARINE BEHAVIOUR (boat-critical)
- [ ] StalenessShroud: EVERY live numeral (scan the whole wall) dims → hollows → age chip when its feed drops; repeat on Pi + phone
- [ ] Absent value renders '—' in a reserved slot — never a fake 0, never a frozen last value (check Position/Depth/Wind)
- [ ] MOB requires hold (~800ms) with red fill sweep; release early cancels; 'MOB ✓' only after server confirms
- [ ] **MOB captures position** — fire with a live fix: Takeover must show a DMM lat/lon AND a marker pins on /chart (KNOWN BUG: livePos=null → blank)
- [ ] Critical Takeover (MOB / anchor-drag): full-screen red, Escape does NOT dismiss, focus trapped, only hold-to-silence clears it; red in all 3 themes
- [ ] AIS threats float to top of the list regardless of sort; red dot + 'N threats' badge; stale (>60s) dims, dropped (>5min) vanishes
- [ ] AIS audio: Arm → Test beeps; per-vessel mute shows 'muted ≥0.xx nm' as visible text; confirm whether a threat also rings the shell bell
- [ ] Port=RED / stbd=GREEN on the wind dial — AND **check the race start-line dots** (SUSPECTED inversion: port end painted green, stbd end red)
- [ ] Autopilot (Mac): ⚠ TEST banner present; ±buttons disabled until captures exist; engage/disengage = hold → confirm dialog → 2nd hold; cooldown disables briefly; ack log is UTC; readouts go stale (not frozen 'AUTO') when bus stops
- [ ] AlarmLane fires/clears with ZERO horizontal shift of clock/LED/theme/bell/MOB
- [ ] Bell reflects worst severity (red+pulse for CRITICAL, count badge, +N overflow) and links to /alerts
- [ ] UTC everywhere — AppBar clock, ack log, alerts, forecast/tide, voyage feeds all end in 'z'
- [ ] DEMO/replay mode still shows an unmistakable 'data is fake' banner that survives navigation
- [ ] Per-station scale: mast ~1.6x, Pi ~1.15x, phone ~1.0x — mast numerals clearly biggest, none clipped
- [ ] Calibration capture (/boat/setup/cal/bsp + cal/compass): ~5s averaging, Apply persists, Discard doesn't change stored cal (at rest it errors '>0.1 m/s' by design — not a bug)

## 4. SECTION WALKTHROUGH (6 sections, terse)
- [ ] SHELL: exactly ONE amber chip (active section); phone → 6-item bottom tab bar, ≥56px, never wraps
- [ ] SAIL: SegmentedControl swaps second grid through all 4 groups, cell count never changes; race timer huge/mono; Reset guarded by confirm+hold
- [ ] CHART: right-side LayerDock (Layers/AIS/Route) on desktop → bottom-sheet (peek/half/full) below 1024px; follow toggle + orientation cycle (N→↑COG→↑HDG); offscreen amber pill re-enters follow
- [ ] CHART AIS lens: /ais redirects into /chart with AIS tab active; list + threats render IN the dock, not a separate page; unit-in-header columns; empty 'Waiting for GPS fix…' at dock is expected
- [ ] CHART Route lens: RoutePlanPanel + scrubber + wind timeline present; FLAG the surviving TzToggle if set to local
- [ ] ANCHOR: section sub-tabs hidden; drawer drags through snap points; wind dial port/stbd correct; drag breach → full-screen Takeover
- [ ] CONDITIONS Tides/Currents: now-line is neutral (NOT ebb orange); axis times end 'z'; currents has sane y-floor when flat
- [ ] CONDITIONS Forecast: long table scrolls under a sticky header (not a 114-row wall); refresh syncs to Models; Windows heatmap has a legend
- [ ] VOYAGE Passage: ETA hero + progress/engine panel (not 6 stat cards); FLAG surviving local-time toggle (passage:tz)
- [ ] VOYAGE Plan: waypoints+routes one workspace; paste DMM into CoordField parses; coords show compact DMM; send-to-chart works
- [ ] VOYAGE Logbook: day-grouped feed, kind filter, mode StatusChips; delete confirm names the record (not an id)
- [ ] BOAT hub: grouped cards with live status lines (ok/warn tints; '—' when unknown, never fake 0); NIGHT tints red-family
- [ ] BOAT Performance (polars/sails/crossover): NO surviving white/light page; sail add/delete uses themed Dialog, not browser alert()
- [ ] BOAT setup forms: SaveBar pinned at bottom with dirty-tracking; immediate-save toggles show no SaveBar

## 5. WHERE BUGS HIDE (known-risk spots)
- [ ] Legacy bookmarks 30x correctly: /helm→/sail, /ais→/chart(AIS lens), /settings→/boat/setup, /polars→/boat/polars, /tracks→/voyage/logbook, /calibration/bsp→/boat/setup/cal/bsp
- [ ] /api/settings saves per-key: change one section, reload, then change another — first section MUST still be there (full-PUT form would blank it)
- [ ] Dialogs: Escape closes, Tab traps focus, scrim-click dismisses, focus returns to trigger, destructive confirm names the record
- [ ] STRAY: native browser confirm() on /boat/diag/sessions delete (un-themed, worst in NIGHT) — flag
- [ ] STRAY: purple REPLAY banner on /boat/diag/sessions in NIGHT (unbridged colour family) — flag
- [ ] Phase 6 surfaces (Conditions/Voyage/Boat) — devtools console open: no '—' where data exists, no un-drawn charts, no thrown errors
- [ ] RampLegend: sequential ramps read as even gradients; flag any legend whose swatch widths don't match value spacing (latent diverging-ramp defect)

---
**Rollback:** if something is seriously wrong (fails smoke test, dangerous behaviour), roll back with `git reset --hard 887dcae` on `main` + force-push + redeploy to the Pi.

---

# Results — remote pass 2026-07-09 (02:06–02:22z)

Run against the live boat (`https://g5000.sulabassana.net`, main @ `419ca9f`, boat docked Bristol
Marine, ~0.5 kn TWS) via Chrome automation from the Mac. Boat-wide theme was cycled
DAY→NIGHT→SUN during the pass and restored to DAY at the end. Items needing a physical
finger/display are listed under *Remaining manual* below.

## Verified good

- Smoke test: /sail loads in all 3 themes, AppBar single-row (clock ticking `HH:MM:SSz`,
  LIVE LED, theme chip, bell, MOB), 6-cell instrument wall, no layout breakage.
- Themes recolour the whole app per click; NIGHT is red-family everywhere checked
  (AppBar zoom: no green LED, no emerald text); SUN is genuine paper; theme survives reload
  (no DAY revert); boat-wide sync observed (server-persisted).
- **NIGHT map filter (3680481) works** — `brightness(0.4) sepia(0.9) saturate(2.4)
  hue-rotate(-30deg)` verified on the MapLibre canvas; basemap renders muted red/amber.
- **Shell MOB position fix (3680481) verified structurally** — NavShell's MobButton now
  receives a live fix (`41.7644n 71.1278w` + cog) instead of `livePos={null}`.
- MOB single click does nothing (hold-only confirmed on the click side).
- Absent values render '—' (DEPTH, TIDE, VMC, AC loads); tide feed flapped during the pass
  and the age chip ("12s") appeared organically — staleness chip works in the wild.
- AIS dock lens: /ais → /chart?lens=ais; targets table IN the dock; unit-in-header columns;
  stale targets dim italic; CPA/TCPA guard chip present.
- Legacy redirects: /helm /ais /settings /polars /tracks /calibration/bsp /currents /passage
  all land correctly (see Bugs for /tides).
- Sections walkthrough clean at NIGHT: CONDITIONS (Forecast admin, GRIB cache, Windows
  scanner — all 'z'/UTC-labelled), VOYAGE (Passage engines panel, Plan workspace with
  DMM paste field + GPX, Logbook UTC label + honest zero-states), BOAT hub cards with live
  status lines, /boat/polars no longer white, /boat/setup SocketCAN + sat-cache panels,
  /mast renders its ConfigStore layout.
- Cursor hover on chart shows DMM position + current/depth/bearing panel.

## Bugs found (fixed in this branch after the pass)

1. **Five+ MapLibre layers silently missing** — `var(--token)` strings in paint specs;
   MapLibre can't parse CSS vars, `addLayer` throws, layer never mounts. Live-verified
   missing: live-trail-layer, wind-barb-line, wind-barb-pennant, wind-isobar-line,
   current-arrows-layer. Code-verified also broken (mount later): StartLineLayer (so the
   3680481 port/stbd fix couldn't render at all), CogExtension, StationsOverlay.
   Fix: `cssColor()` resolver in `lib/map-colors.ts`.
2. **React #418 (args=HTML) on every prod page load** — pre-hydration theme/scale script
   mutates `<html>` attrs; fix `suppressHydrationWarning` on `<html>`.
3. **/tides 404** — redirect existed only as `/tide`; added `/tides`.

## Bugs found (open, follow-ups)

- **React #418 (args=text) second hydration mismatch** — text-node mismatch on /sail and
  /chart loads; prime suspect is a `new Date()`-derived default (route departure field);
  superseded/absorbed by the ship-time work.
- **NIGHT leaks:** ForecastRoi corner handles stay full-bright amber (HTML markers bypass
  the canvas filter); polar-grid heatmap + ramp legend render full-bright blue→red on
  /boat/polars; native checkbox/radio accent stays blue (route-dock GFS/ECMWF, setup
  Source-mode radios); /anchor WindDial navy face + blue tick (known deferred).
- Console noise: 1093 errors accumulated over ~15 min of browsing (mostly the two #418s
  repeating per navigation + the 5 map-layer errors).
- Junk waypoints `wp-1`…`wp-5` (2026-05-28, scattered: Lake Erie / Quebec / Florida /
  mid-Atlantic) are test artifacts polluting the live plan — confirm and delete.
  (`wp-6`/`wp-7`, created accidentally by this pass's synthetic drags, were deleted.)
- Tide *Planning* page is feature-flagged off, so CONDITIONS shows no Tides/Currents tabs —
  confirm this is intentional (helm tide data still flows).
- Cosmetic: /anchor drawer title renders "Ac" (should be "AC"); gust panel says "kts"
  (convention is "kn").

## Remaining manual (needs a person at the boat)

- Real-mouse pan/zoom/rotate on /chart (synthetic drag/wheel/dblclick don't drive MapLibre
  handlers; clicks demonstrably reach the canvas, so this is almost certainly an automation
  artifact — 10-second hand check).
- MOB hold-to-fire feel: fill sweep, early-release cancel, 'MOB ✓' server ack, Takeover
  red + position, Escape-no-dismiss, hold-to-silence. (Hold resists synthetic input — three
  techniques tried; arguably a good property for MOB.)
- Kill a live feed → dim→hollow→age-chip animation on the instrument wall.
- Per-station scale on mast (~1.6x) / Pi (~1.15x) / phone (1.0x); theme flip propagation
  ≤1 s across Pi + phone + mast.
- AIS audio Arm→Test beeps; anchor-drag Takeover; race start-line dot colours with a real
  pinged line; anchor drawer drag through snap points; calibration capture averaging;
  /api/settings per-key save round-trip (skipped: no settings mutated on the live boat).
- SUN/NIGHT reload flash (needs eyes; screenshots can't catch a flash).
