# G5000 Unified GUI Overhaul — The Definitive Proposal

> **Status: PROPOSAL (not approved / not implemented).** Produced 2026-07-06 by a 15-agent Fable workflow: 10 parallel per-tab design audits → a current-state consolidation → 3 competing overhaul directions (Unified Marine Dashboard / Context-Adaptive Cockpit / Pro Tactical) → a chief-designer synthesis that picked a spine and grafted the best of the others. This is a design artifact for review — decide whether to proceed to a spec → plan → phased build.

**Role:** Chief-designer synthesis of three overhaul directions against the verified current state.
**Verdict in one line:** Direction 1's dashboard spine, wearing Direction 3's instrument skin where it counts, protected by Direction 2's safety grammar.
**Status:** Design artifact. Buildable, phased, non-big-bang. No implementation in this document.

---

## 1. Executive summary

G5000's front end is 37 real screens sharing an 18-line design system and ~50 files of copy-paste convention. The audit found the right things already exist — HelmTile, TargetsTable, StatusBadge, the anchor drawer, the /damping dirty-save, the WindLegend derive-from-stops trick, the Map.tsx gesture engine — surrounded by 400 uses of `text-xs`, three page blacks, a 136:105 border coin-flip, seven jobs for amber, silent-freezing helm numerals, and a 34-destination nav.

This proposal:

1. **Adopts Direction 1 (Unified Marine Dashboard) as the spine** — six intent sections, extraction-not-invention components, tokens-first phasing — because it is the only direction that is honestly shippable in slices on a live boat and whose IA is derived from the verified route clusters rather than a behavioral hypothesis.
2. **Grafts Direction 3's marine-instrument edge**: a true black-on-paper SUN mode (physics beats aesthetics in direct sunlight), hairline-divided instrument cell grids on glance surfaces, per-station numeral scaling (phone/Pi/mast), a status strip that is itself a readout, and the Pi keyboard map.
3. **Grafts Direction 2's safety layer**: the StalenessShroud state machine on every live value, full-viewport Takeover for critical alarms, "system proposes / sailor disposes" boat-state suggestions, and port/starboard split from status colors with a strict all-red, shape-encoded night grammar.
4. **Rejects decisively**: boat-wide MODEs, the Locker, automatic chart-preset switching, numbered pages, the softkey row, the all-at-once landing, dark-theme sunlight, and every emoji.

The result: **one token layer, three light palettes, ~20 components, 6 sections + a bell, 8 phases** — with night mode shipping app-wide in phase 1, before a single screen is rebuilt.

---

## 2. The decision record

| Question           | Decision                                    | Source                                             | Why                                                                                 |
| ------------------ | ------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| IA shape           | 6 intent sections + bell                    | D1                                                 | Matches verified routeClusters 1:1; stable spatial memory beats inferred modes      |
| Boat awareness     | Suggestion dots + toast, never auto         | D2 (law), D1 (placement)                           | The autopilot design notes' "silent algorithm swap" anti-pattern, applied to IA     |
| Sunlight mode      | True paper (light) inversion                | D3 (concept), D2 (warm values)                     | Reflected ambient light crushes dark themes in sun; every marine plotter agrees     |
| Night mode         | All-red, luminance-capped, shape-encoded    | D2+D3 strictest union                              | Dark adaptation is non-negotiable; hue is forbidden, behavior/shape carry semantics |
| Component strategy | Extract from named best widgets             | D1                                                 | Lowest risk; preserves seamanship logic verbatim                                    |
| Glance aesthetics  | Hairline CellGrid inside rounded Panels     | D3, scoped                                         | Instrument look where it pays, without D3's one-wave migration trap                 |
| Shell              | Top AppBar-as-readout + phone bottom TabBar | D1 (shape), D3 (readout), D2 (MOB/alarm residency) | Zero layout shift; safety controls get fixed global placement                       |
| Numeral font       | IBM Plex Mono, self-hosted, numerals only   | D2/D3                                              | Tabular + slashed zero is a legibility upgrade; bounded offline risk                |
| Body ink           | Keep `#cdd6f4`                              | D2                                                 | It is the brand; zero churn on unmigrated screens                                   |
| AIS                | Chart dock lens + global threat feed        | D1+D3 (agree)                                      | One target vocabulary instead of three renderings                                   |
| Migration          | Tokens-first with compat bridge, 8 phases   | D1                                                 | The only plan that keeps the boat sailing                                           |

---

## 3. Design principles

1. **Instrument, not website.** The numbers are the interface; chrome is either a readout or absent.
2. **Consistency compounds into trust.** One Panel, one tile, one label voice, one table, one dialog. Sameness across 37 screens _is_ the feature.
3. **Three lights, one layout.** DAY / NIGHT / SUN are token palettes on `<html data-theme>`. No component branches on theme; layout never changes with light.
4. **Stability under stress.** Fixed slots, reserved lanes, zero layout shift. Absent data renders `—`; alarms land in a pre-reserved lane; muscle-memorized numbers never move.
5. **Honest data or no data.** Every live value carries its age: fresh renders, aging dims, stale hollows + age chip, link loss is declared in the shell.
6. **The system proposes, the sailor disposes.** Boat state suggests a section; suncalc suggests night mode. Dots and dismissible toasts only — never auto-navigation, never auto-theming.
7. **One accent, earned.** Amber = selected / primary action / own-boat. Nothing else. Warning, danger, offline, and data series are split off permanently; port/stbd never appear on controls.
8. **Extract, don't invent.** Every component is promoted from a named best-in-app widget; the seamanship keep-list is preserved verbatim (§12).
9. **Touch and mouse are peers.** 44px floor (56px glance primaries, 36px only on `pointer:fine` work rows); hover previews but never exclusively informs.
10. **Ship every phase.** The token bridge re-themes unmigrated screens from day one; legacy URLs redirect forever; the app deploys to the Pi at the end of every phase.

---

## 4. The unified design system

### 4.1 Theme architecture

- Three palettes: **DAY** (dark, default), **NIGHT** (red, luminance-capped), **SUN** (paper).
- Mechanism: semantic CSS custom properties on `:root` / `[data-theme='night']` / `[data-theme='sun']`, exposed as Tailwind v4 utilities via `@theme inline` in `packages/web/src/app/globals.css`.
- Persistence & sync: theme lives in `DisplayConfig` (ConfigStore) — the mast display's existing brightness/night plumbing promoted app-wide — pushed over SSE so the Pi chart, phones, and the Chipsee mast flip together. Per-device override chip in the clock popover.
- Switching: manual 3-way chip in the AppBar (`DAY → NIGHT → SUN`); suncalc (already shipped for SkyTab) raises a one-time civil-twilight toast _suggesting_ NIGHT. Never auto-switches.
- Law: **no component may branch on theme.** If a component needs `if (night)`, the token set is missing a role.
- Map rasters: `--map-filter` applied to the tile layers' container — DAY `none`, NIGHT `brightness(.4) sepia(.9) saturate(2.4) hue-rotate(-30deg)`, SUN `none` (OSM/NOAA are already light — the chart looks native on paper).

### 4.2 Color roles

#### DAY (default — today's identity, disciplined)

| Role            | Token                                               | Hex                                                                                                                                                     | Rule / source                                                                                                                                |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas          | `--canvas`                                          | `#0B0E14`                                                                                                                                               | The ONE page black. `bg-black` and `bg-slate-950` page canvases die.                                                                         |
| Surface         | `--surface`                                         | `#0F172A`                                                                                                                                               | Panel fill (slate-900's 103 uses win)                                                                                                        |
| Surface raised  | `--surface-raised`                                  | `#1E293B`                                                                                                                                               | Popovers, hover, nested wells                                                                                                                |
| Surface sunken  | `--surface-sunken`                                  | `#020617`                                                                                                                                               | Input wells, AppBar, drawer track                                                                                                            |
| Hairline        | `--hairline`                                        | `#1E293B`                                                                                                                                               | THE border + CellGrid dividers (ends the 136:105 split)                                                                                      |
| Hairline strong | `--hairline-strong`                                 | `#334155`                                                                                                                                               | Interactive outlines, overlay edges only                                                                                                     |
| Ink value       | `--ink-value`                                       | `#F1F5F9`                                                                                                                                               | Numerals                                                                                                                                     |
| Ink             | `--ink`                                             | `#CDD6F4`                                                                                                                                               | Body text — **kept; it is the brand** (D2 over D1)                                                                                           |
| Ink 2           | `--ink-2`                                           | `#94A3B8`                                                                                                                                               | Labels                                                                                                                                       |
| Ink 3           | `--ink-3`                                           | `#64748B`                                                                                                                                               | Hints, units, aging values                                                                                                                   |
| Ink 4           | `--ink-4`                                           | `#475569`                                                                                                                                               | Disabled, placeholders, empty-slot `—`                                                                                                       |
| Accent          | `--accent`                                          | `#D97706`                                                                                                                                               | Selected + primary action. Nothing else.                                                                                                     |
| Accent hi       | `--accent-hi`                                       | `#F59E0B`                                                                                                                                               | Hover, live edges                                                                                                                            |
| Accent ink      | `--accent-ink`                                      | `#FBBF24`                                                                                                                                               | Accent as text/underline/glyph; own-boat; active route                                                                                       |
| On accent       | `--on-accent`                                       | `#0B0E14`                                                                                                                                               | Text on amber fills                                                                                                                          |
| Focus           | `--focus`                                           | `#FBBF24`                                                                                                                                               | 2px ring + 1px offset on EVERY focusable (today: two textareas; now: all)                                                                    |
| OK              | `--ok` / `--ok-strong`                              | `#34D399` / `#059669`                                                                                                                                   | One success pair (emerald/green forks collapse)                                                                                              |
| Warn            | `--warn` / `--warn-strong` / `--on-warn`            | `#FACC15` / `#CA8A04` / `#211603`                                                                                                                       | Text/border/chip ONLY — never a filled button (kills the 1.6:1 yellow banner)                                                                |
| Danger          | `--danger` / `--danger-strong` / `--danger-surface` | `#F87171` / `#DC2626` / `#3A0D10`                                                                                                                       | One danger family (rose/red forks collapse)                                                                                                  |
| Info            | `--info` / `--info-strong`                          | `#38BDF8` / `#0284C7`                                                                                                                                   | Sky = water = information; the cyan accent drift is re-homed here                                                                            |
| Port            | `--port`                                            | `#FB7185`                                                                                                                                               | **Distinct token from danger** even when near in hue (D2 law); data + dials only, never controls                                             |
| Starboard       | `--stbd`                                            | `#4ADE80`                                                                                                                                               | **Distinct token from ok**; same restriction                                                                                                 |
| Live            | `--live`                                            | `#34D399` pulse                                                                                                                                         | Connection chip                                                                                                                              |
| Stale           | `--stale`                                           | `#64748B`                                                                                                                                               | StalenessShroud tint                                                                                                                         |
| Demo / Replay   | `--demo` / `--replay`                               | `#FBBF24` / `#A78BFA`                                                                                                                                   | Mode chips (from /settings' fieldset tints)                                                                                                  |
| Series 1–8      | `--series-1…8`                                      | `#38BDF8 #FBBF24 #34D399 #F472B6 #A78BFA #FB7185 #4ADE80 #FACC15`                                                                                       | PLOT_PALETTE verbatim (verified in MultiSourcePlot.tsx), now tokens; GFS/solar/diesel move here, off "accent"                                |
| Sequential ramp | `--seq-1…6`                                         | `#0C4A6E #0284C7 #38BDF8 #FDE047 #F97316 #DC2626`                                                                                                       | ONE ramp for all heatmaps/wind fills; canonical stops = the wind overlay FILL_STOPS; **legends must derive from stops** (WindLegend law, D3) |
| Diverging       | `--flow-flood` / `--flow-slack` / `--flow-ebb`      | `#38BDF8` / `#64748B` / `#FB923C`                                                                                                                       | Names the ebb=orange=now collision away                                                                                                      |
| Chart semantics |                                                     | now-line `#E2E8F0`@60% · own-boat `#FBBF24` · threat `--danger` · route-active `#FBBF24` · route-alt `#22D3EE` · track `#94A3B8` · ais-normal `#7CC7E8` | Ends emerald=stbd=charging and orange=now=ebb                                                                                                |
| Scrim           | `--scrim`                                           | `rgba(2,6,23,.72)`                                                                                                                                      | Dialogs, Takeover backdrop                                                                                                                   |

**Deletions:** the zinc ramp (4 files → surface roles), all light-theme fossils (/sails, /sails/crossover, CategoryRecommendation, white MOB modal, `bg-gray-200` mute, white tracker iframe container), inverted-white active states (night hazard), the `.fc-slider` hex skin (→ Slider component).

#### NIGHT (red, luminance-capped — strictest union of D1+D2+D3)

Laws: nothing brighter than ~35% relative luminance except the danger invert block; **hue is forbidden** — no green, no blue, no yellow anywhere, including dials; severity is encoded by _behavior_ (steady / bright+glyph / inverted-pulse); port/stbd are encoded by _glyph + shape_ (`P◄`/`►S`, filled=port / hollow=stbd — D3); motion frozen except the ≤1Hz alarm pulse; **no bright fills** — accent renders as outline.

| Role                                               | Hex                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| canvas / surface / surface-raised / surface-sunken | `#000000` / `#0E0505` / `#1A0B0A` / `#000000`                                                                             |
| hairline / hairline-strong                         | `#450A0A` / `#7F1D1D`                                                                                                     |
| ink-value / ink / ink-2 / ink-3 / ink-4            | `#F87171` / `#EF4444` / `#B91C1C` / `#991B1B` / `#7F1D1D`                                                                 |
| accent (selected/primary)                          | outline style: border `#F87171`, fill `#2A0908`, text `#F87171`                                                           |
| focus                                              | `#F87171`                                                                                                                 |
| ok / warn / danger                                 | steady dot `#B91C1C` / `#EF4444` + `!` glyph / inverted block (bg `#F87171`, ink `#000`) pulsing ≤1Hz + full panel border |
| port / stbd                                        | filled glyph / hollow glyph, both red-family — **no green at night** (D1's dim-green exception rejected)                  |
| series                                             | 4 brightness steps `#F87171 #CF4433 #A53522 #7C2716` × line styles solid/dash/dot/dash-dot                                |
| sequential ramp                                    | `#240905 #3C0F08 #5C170C #7F2010 #A52A15 #CF4433 #FF6B4A`                                                                 |
| now-line / scrim                                   | `#FF6B4A` / `rgba(0,0,0,.85)`                                                                                             |
| map                                                | `--map-filter: brightness(.4) sepia(.9) saturate(2.4) hue-rotate(-30deg)`                                                 |

Night deliberately sacrifices categorical chart fidelity (4 red steps + line styles) — detailed analysis is a day activity; night vision is not negotiable.

#### SUN (true paper — grafted from D3, warm values from D2's Glare)

Rationale: in direct sunlight, reflected ambient light lifts dark pixels toward grey and destroys dark-theme contrast; a maximum-luminance paper palette aligns emitted and reflected light. This is why B&G/Garmin day palettes are light. Warm paper (not pure white) cuts blue glare.

| Role                                      | Hex / rule                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| canvas                                    | `#F0EDE3`                                                                                                                                                            |
| surface / surface-raised / surface-sunken | `#FFFFFF` / `#F7F5EC` / `#E9E5D8`                                                                                                                                    |
| hairline / hairline-strong                | `#CFC9B8` (at 1.5px) / `#6D685A`                                                                                                                                     |
| ink-value / ink / ink-2 / ink-3 / ink-4   | `#0B1220` / `#10141D` / `#3A4256` / `#5D6579` / `#9AA0AF`                                                                                                            |
| accent / on-accent / focus                | `#92400E` / `#FFFFFF` / `#92400E` (3px)                                                                                                                              |
| ok / warn / danger / info                 | `#047857` / `#B45309` (chip bg `#FBBF24`, ink `#211603`) / `#B91C1C` / `#075985`                                                                                     |
| port / stbd                               | `#BE123C` / `#15803D`                                                                                                                                                |
| series                                    | 600-weight versions: `#0284C7 #B45309 #047857 #DB2777 #7C3AED #BE123C #15803D #CA8A04`                                                                               |
| sequential ramp                           | same 6 stops at 85% opacity over white, labels in ink                                                                                                                |
| Rules                                     | font weights +100; display numerals near-black; shadows OFF (borders instead); translucent fills forbidden (all tints become opaque mixes); badges solid + dark text |

Contrast floors (all themes): values ≥ 12:1 on their surface; labels ≥ 4.5:1 at their size; every status pair AA on its stated ground.

### 4.3 Typography

18px root stays (the one existing token that was right). Two families:

- **Numerals/data:** IBM Plex Mono w500/600, `tabular-nums`, slashed zero — self-hosted via `next/font/local` (offline Pi/Chipsee safe), subset to ~100KB, fallback metrics tuned to `ui-monospace` so the cell grid cannot shift on load.
- **UI text:** system stack (`ui-sans-serif, system-ui`) — unchanged, zero risk.

**Display tiers** (Plex Mono, w600; w700 in SUN; unit rendered at 0.4× in `--ink-3`):

| Token | Size           | Use                                             |
| ----- | -------------- | ----------------------------------------------- |
| `d1`  | 4.5rem / 81px  | Race timer, autopilot headline, mast hero       |
| `d2`  | 3.5rem / 63px  | Helm core strip                                 |
| `d3`  | 2.25rem / 40px | Secondary tiles, chart-dock readouts            |
| `d4`  | 1.5rem / 27px  | Panel hero values (anchor cards, passage stats) |

**Station scale (D3 graft):** a `DisplayConfig` multiplier applied to `d*` tiers only — phone **1.0**, Pi helm **1.15**, mast Chipsee **1.6**. Race timer on the Pi ≈ 93px; mast hero ≈ 130px. One mechanism replaces per-device size forks.

**Text tiers** (system stack):

| Token     | Size                                                 | Use                                                   |
| --------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `title`   | 1.111rem / 20px, w600                                | Page + panel-group titles (ends four h1 dialects)     |
| `body`    | 1rem / 18px                                          | Prose, forms                                          |
| `body-sm` | 0.833rem / 15px                                      | Dense work rows, buttons                              |
| `caption` | 0.722rem / 13px                                      | Hints, badges, table meta                             |
| `label`   | 0.667rem / 12px, w600, UPPERCASE, +0.08em, `--ink-2` | THE label voice (replaces ≥4 section-header variants) |

**Floor: 12px effective, SVG included** (SVG text in rem). `text-[9px]/[10px]/[11px]` and `fontSize < 12` are lint-banned. `tabular-nums` is mandatory on every numeric readout, not sporadic.

### 4.4 Space, density, targets

4px base: `s1..s8` = 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.

- Panel padding `s4` (`s3` inside drawers); grid gap `s3` (anchor's `gap-3` codified); page gutter `s4` phone / `s5` Pi+desktop; section stack `s5`.
- **Two named densities, only two:**
  - **GLANCE** (helm, race, autopilot, anchor, mast, chart chrome): display-tier numerals, targets ≥44px, glance primaries (MOB, drawer handle, phone tabs) ≥56px (D2's glove floor), reserved min-height slots, absent data = `—` — the grid never reshuffles.
  - **WORK** (Boat hub, Conditions/Voyage tables, diagnostics): rows 36px on `pointer:fine`, 44px on touch; anything destructive or stateful ≥44px on every device.
- Whole-cell / whole-row hit targets (D3): density without pillowy controls. Dense tables get row→detail-sheet on phones.
- Chart corner chrome uses one inset token (`s3`); slots push each other — `top-[100px]` magic dies.

### 4.5 Radius & elevation

| Token       | Value | Use                                                                                           |
| ----------- | ----- | --------------------------------------------------------------------------------------------- |
| `r-control` | 6px   | Buttons, inputs, chips                                                                        |
| `r-panel`   | 8px   | Panels, cards, dialogs                                                                        |
| `r-sheet`   | 12px  | Drawer/sheet top corners                                                                      |
| `r-badge`   | 999   | Pills, status chips                                                                           |
| `r0`        | 0     | **CellGrid interior cells only** (hairline-divided instrument clusters — the scoped D3 graft) |

Bare `rounded` (4px, 394 uses) retires as components migrate.

Elevation (borders-are-elevation): `e0` canvas · `e1` panel = `--surface` + 1px `--hairline` · `e2` overlay = `--surface-raised` + `--hairline-strong` + `0 8px 24px rgb(0 0 0 / .55)` · `e3` modal/Takeover = e2 + `--scrim` + focus trap. SUN replaces all shadows with 1.5–2px borders.

### 4.6 Motion

150ms ease-out standard · drawer 250ms · section transition 300ms crossfade (the ONLY large motion — D2's "scene change between contexts, stillness within") · alarm pulse ≤1Hz · **digits never animate** (D3) · NIGHT freezes all transitions except the alarm pulse · `prefers-reduced-motion` honored.

### 4.7 Iconography

**Lucide only**, stroke 1.75–2px, `currentColor`, 20/24px inside ≥44px targets. All emoji (⏱⚓☀🌑🔊✓) and Unicode control glyphs (⊙⊕▲▼●◉○▸▾) are retired — they cannot inherit the night recolor and render differently on Pi chromium / phone / Chipsee. Text glyphs remain legal only _as data grammar_ (bearing arrows, `P◄`/`►S`), where they are the data.

### 4.8 Tailwind v4 implementation notes

```css
/* globals.css — the shape, not the full listing */
:root,
[data-theme='day'] {
  --canvas: #0b0e14;
  --surface: #0f172a;
  --ink: #cdd6f4; /* … */
}
[data-theme='night'] {
  --canvas: #000000;
  --surface: #0e0505;
  --ink: #ef4444; /* … */
}
[data-theme='sun'] {
  --canvas: #f0ede3;
  --surface: #ffffff;
  --ink: #10141d; /* … */
}

@theme inline {
  /* semantic utilities: bg-surface, text-ink-2, border-hairline, text-accent-ink … */
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  /* …every role above… */

  /* PHASE-1 COMPAT BRIDGE (deleted in phase 7): repoint the utilities the app
     already uses onto theme vars, so EVERY screen flips with data-theme
     before any component is rebuilt. */
  --color-slate-900: var(--surface);
  --color-slate-800: var(--surface-raised);
  --color-slate-950: var(--surface-sunken);
  --color-slate-700: var(--hairline-strong);
  --color-slate-400: var(--ink-2);
  --color-slate-500: var(--ink-3);
  --color-amber-600: var(--accent);
  --color-zinc-900: var(--surface); /* kills the zinc fork instantly */
  /* …per the audit's utility census… */
}
```

- `@theme inline` is the v4 mechanism that lets utilities reference runtime-switched vars.
- The bridge is an approximation by design (slate-700 was both border and fill); imperfections on unmigrated screens are accepted and tracked. Semantic classes (`bg-surface`) are the end state; the bridge buys app-wide NIGHT/SUN in phase 1.
- The ~30 SVG-embedded hex literals cannot ride the bridge — they are hand-migrated in phase 1 using the audit's inventory as the checklist.
- Lint (phase 0, tightened per phase): ban raw hex in `tsx` outside the token file, `text-[9-11px]`, `window.confirm|alert|prompt`, `new EventSource` outside the store, internal `<a href`, and (phase 7) any `slate-*`/`zinc-*` utility.

---

## 5. Component library

Every component names its seed. Tokens only — a component containing a hex literal fails review.

### Tier 0 — Shell

| Component          | Seed                        | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NavShell`         | Navbar.tsx (replaced)       | AppBar 48px: brand · 6 section tabs (44px, active = accent chip) · **AlarmLane** (reserved center cell — always present, zero shift; warn shows statement + ACK; tap → /alerts) · UTC clock (`14:32:05z`) · **link LED** (`● LIVE` pulse / `◐ RECONNECTING` / `○ LINK LOST + age`) · ThemeChip · ModeChip (LIVE/DEMO/REPLAY) · AlertsBell (badge) · **MOB cell** (HoldButton 1.5s, glance surfaces). Row 2: SectionTabs 40px underline (hidden on /chart and /anchor). Phone: slim top strip (section · alarm lane · clock · MOB) + bottom TabBar 64px, 6 items ≥56px. All `next/link`. |
| `Takeover`         | D2                          | Critical alarms + MOB: full-viewport `e3`, giant statement (`d1`), one primary action + hold-to-silence, red-keyed in every theme. Anchor-drag breach and MOB land here.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ThemeController`  | mast DisplayConfig plumbing | data-theme switch, ConfigStore+SSE sync, per-device override, suncalc suggestion toast.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SectionSuggestor` | D2's signal engine, demoted | Boat-state signals (watch armed; race timer armed; SOG >2.5kt 90s; active route leg >25nm) light a dot on a section tab + one-time toast. Never navigates. Logged to ship's log.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Keyboard map       | D3, minus softkeys          | `1–6` sections, `[`/`]` sub-tabs, `f/o/l` chart follow/orientation/layers, `Esc` closes, arrows+Enter in tables. MOB is never on a bare key.                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Tier 1 — Primitives

| Component              | Seed                                                                      | Contract                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Panel`                | anchor DepthPanel                                                         | Header (label voice + optional StatusChip + optional 44px action) / body / footer; variants `default · hero · alarm` (alarm = `--danger-strong` border + tinted header); built-in EmptyState (`—` + honest reason line). Absorbs the 13+ copy-pasted card recipes and /settings' status-tinted fieldsets.                                                                         |
| `InstrumentTile`       | **HelmTile** (verified API: label/value/unit/severity/sub/small/children) | Grown: `size d1–d4`, trend chevron, severity edge (3px left edge — D3), children slot, **built-in StalenessShroud**, slot-stable (reserves space, renders `—`). Absorbs 6 StatTile clones, autopilot Readouts, anchor BigValues, PositionTile.                                                                                                                                    |
| `CellGrid`             | D3                                                                        | Hairline-divided, gap-0, `r0` interior grid of InstrumentTiles for glance clusters (helm core strip, race, mast). Fixed slot count; whole-cell targets. Lives _inside_ a rounded Panel — the scoped instrument aesthetic.                                                                                                                                                         |
| `StalenessShroud`      | D2                                                                        | Per-value state machine from sample timestamps: fresh <2s normal · aging 2–10s `--ink-3` · stale >10s hollow numerals + age chip · transport loss = shell LINK LOST. Not optional on live values.                                                                                                                                                                                 |
| `StatusChip`           | StatusBadge                                                               | Tinted bg/20 + border + ink recipe; kinds ok/warn/alarm/info/neutral/live(pulse)/stale(age)/demo/replay/armed.                                                                                                                                                                                                                                                                    |
| `Button`               | —                                                                         | primary (accent fill) / secondary (`--hairline-strong` outline) / ghost / danger (`--danger-strong`); md 44px, sm 36px work-only. `IconButton` 44px hit. `HoldButton` (MOB hold-with-progress seed): 600ms–1.5s radial fill — MOB, disarm, AP engage, race reset, irreversible deletes.                                                                                           |
| `SegmentedControl`     | TzToggle + HelmTabs                                                       | ONE implementation (replaces 5 dialects); selected = accent fill (DAY/SUN) / red outline (NIGHT); keeps `aria-pressed`. `Tabs` = underline style, `--accent-ink`, scrollable on phone.                                                                                                                                                                                            |
| Field family           | lib/coords parser                                                         | `TextField` `NumberField` (44px steppers) `CoordField` (paste-anything DMM parser lifted verbatim) `SelectField` (custom popover — native selects retire) `Slider` (retires `.fc-slider` hexes) `Checkbox/Radio` (24px custom). One recipe: sunken well, `--hairline` border, `r-control`, 44px, focus ring; label voice above, caption hint below, danger-colored error caption. |
| Save contracts         | /damping + /settings fieldsets                                            | **Two, made visible:** `Switch` = instant-apply (always) + `AppliedTick` inline ✓/✗; field groups = staged via `SaveBar` (sticky, dirty-count, route-leave guard — /damping generalized) writing **per-key PATCH** (kills the whole-file PUT clobber race). Identical control types may no longer behave oppositely.                                                              |
| `DataTable`            | **TargetsTable**                                                          | Sortable, pinned rows (threats-always-on-top invariant preserved verbatim), sticky header, units-in-header-once, mono right-aligned numerics, 36px `pointer:fine` / 44px touch rows, row→detail-sheet on phone.                                                                                                                                                                   |
| `Popover/Menu`         | Navbar dropdown + LayersControl (both retired)                            | Keyboard nav + Escape + outside-click, `e2`.                                                                                                                                                                                                                                                                                                                                      |
| `Dialog/ConfirmDialog` | —                                                                         | Focus trap, Escape, names the record ("Delete waypoint _BR-4_?" — never by id); danger variant; HoldButton inside for irreversible. Retires `window.confirm/prompt/alert` ×9 and the white MOB modal.                                                                                                                                                                             |
| `Toast` + `MsgLine`    | D3 rule                                                                   | Toast bottom-center, ok/alarm/info, action slot — **WORK surfaces only**. On GLANCE surfaces acks report via the AppBar MsgLine; nothing may ever cover a numeral. Silent `catch{}` is banned; every mutation acks somewhere visible.                                                                                                                                             |
| `Drawer/BottomSheet`   | anchor drawer                                                             | peek(56px)/half/full, drag handle + click, snap points; also the chart dock on narrow screens.                                                                                                                                                                                                                                                                                    |
| `PageHeader`           | wind-diag voice                                                           | title + StatusChip + one line of honest domain prose; collapses to a slim strip on glance pages. Plus `EmptyState`, `KeyValueList`.                                                                                                                                                                                                                                               |

### Tier 2 — Instruments & charts

| Component                       | Seed                        | Contract                                                                                                                                                                                                                                                                                                   |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dial`                          | anchor WindDial             | Course-up, **correct port/stbd arcs** (`--port`/`--stbd`; night = filled/hollow + glyphs), gust ring; compass + rudder variants.                                                                                                                                                                           |
| `LinearGauge`                   | anchor Systems              | Tanks, battery, solar.                                                                                                                                                                                                                                                                                     |
| `TimeSeriesPanel`               | **MultiSourcePlot** chassis | Real y-ticks (3), optional fixed domain (ends the ±0.1°-renders-as-drama trap on wind-diag), `--now-line`, responsive viewBox (no stretched 600px), 12px SVG floor, mono legend with live values, **legend derived from render stops**. Absorbs WindShiftPlot + 3 sparklines; Meteogram becomes a variant. |
| `StripChart`                    | tide/currents twins         | ONE component for both (pin button + source badge included — heals the verified drift); ebb/flood tokens; tap-scrub on touch.                                                                                                                                                                              |
| `HeatmapGrid` + `RampLegend`    | 4 heatmaps unified          | One `--seq-*` ramp; **legend mandatory**; tap-inspect replaces `title=` tooltips (ISO/m-s tooltips die).                                                                                                                                                                                                   |
| `PolarPlot` / `RadarScopePanel` | existing                    | Re-tokened only; ARPA glyph grammar and marine literacy preserved verbatim.                                                                                                                                                                                                                                |

### Tier 3 — On-map chrome

| Component          | Seed                  | Contract                                                                                                                                                                                                                                                     |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CornerSlots`      | hand-measured CORNERS | TL follow/orientation stack · TR tool rail · BL scale · BR inspect; slots push each other from one `s3` inset token. MOB leaves the map (it lives in the shell).                                                                                             |
| `MapIconButton`    | TR rail               | 44px (36px visual on `pointer:fine` inside 44px hit).                                                                                                                                                                                                        |
| `LayerDock`        | 360px sidebar         | Right dock on Pi/desktop ↔ BottomSheet on phone; lens tabs (Layers / AIS / Route). Includes the **manual preset picker**: Default / Race / Anchor / Passage, explicit active-preset pill, "reset to default" — user-invoked only (D2's idea, de-automated).  |
| `InspectPanel`     | CursorReadout         | Hover previews on Pi; click/tap **pins** it with actions (Drop mark / Route here). The richest inspection tool finally reaches touch.                                                                                                                        |
| Preserved verbatim | Map.tsx               | Gesture engine (500ms long-press, 8px tolerance, click-swallow), `originalEvent` user-vs-programmatic discrimination, 3° bearing dead-band, `__above-wind__` z-sentinel, tile-proxy pattern, source `maxzoom` caps, ImageSource-not-CanvasSource radar rule. |

### Supporting architecture (consumed by the above)

- **One data layer:** a context-level SSE store (single EventSource; exposes channels, link state, last-sample timestamps — the source of truth StalenessShroud and the link LED read) + `usePoll(url, ms)` with URL-keyed refcounting. Kills the verified waste: /race ×3 @1Hz, anchor Victron ×2 @2s, Navbar+AlarmBanner ×2 @2s, two rogue EventSources, ~20 ad-hoc intervals. Client-side nav (next/link) is what lets it live across screens.
- **One alarm store:** severity-ranked, feeds bell + AlarmLane + audio + Takeover; AIS threats and anchor-drag breach are promoted into it; silence-based Navico clearing preserved.
- **Per-key settings PATCH:** `/api/settings` gains key-level PATCH; SaveBar batches dirty keys. Ends the two-client read-merge-write clobber race.

---

## 6. Information architecture

**Accounting:** 39 filesystem routes → 37 real screens → 34 surfaced destinations (17 tabs + 16-item dropdown + bell) + 3 orphans (/grib, /window, /mast). Reorganized to **6 sections + a bell**; every screen ≤2 taps; zero orphans.

```
1  SAIL        /sail          glance · night-critical
     Helm      /sail            (default; CoreStrip + task tabs preserved)
     Race      /sail/race
     Autopilot /sail/autopilot
     Mast      /mast            (bare kiosk route, linked from SAIL and Boat▸Displays)

2  CHART       /chart         full-bleed; SectionTabs hidden — the dock is the sub-nav
     Dock lenses: Layers · AIS (scope + table as a lens) · Route
     (Radar lens joins when the radar-overlay branch merges)

3  ANCHOR      /anchor        unchanged structure — the app-wide template
     Drawer: Forecast · Tides · Radar · Sky · Solar · AC

4  CONDITIONS  /conditions    “what will it be like, and when can I go?”
     Forecast  /conditions      (default)
     Tides     /conditions/tides     ┐ one StripChart
     Currents  /conditions/currents  ┘ (heals the drifted twins)
     Models    /conditions/models    (GRIB; finally shares cache state with Forecast)
     Windows   /conditions/windows   (departure decisions; de-orphaned)

5  VOYAGE      /voyage        plan → monitor → review
     Passage   /voyage          (default when underway)
     Plan      /voyage/plan     (waypoints + routes unified; import/export;
                                 retires the /marks-and-routes fossil)
     Logbook   /voyage/logbook  (tracks + trips + log: one day-grouped feed,
                                 kind filter; trips' StatCard grammar wins)
     Tracker   /voyage/tracker

6  BOAT        /boat          hub landing = card index WITH status lines
                              (“wind cal 12d old” · “3 devices silent” · “2 sessions today”)
     Performance: Polars /boat/polars · Sails /boat/sails · Crossover /boat/crossover
     Setup:       Settings /boat/setup · Profile /boat/setup/profile ·
                  Displays /boat/setup/displays (mast-config + theme defaults + station scale) ·
                  Damping /boat/setup/damping · Calibration /boat/setup/cal/{wind,bsp,compass}
     Diagnostics: Wind Dx /boat/diag/wind · Devices · Sensors · Sniff · Inspect ·
                  Sessions · Logs   (under /boat/diag/*)

GLOBAL
     /          → /sail
     /alerts    sheet behind the bell (URL kept, deep-linkable); one alarm store
     MOB        AppBar cell on glance surfaces → Takeover
```

**Shell behavior**

- **Pi/desktop:** AppBar 48px (sections + AlarmLane + UTC + link LED + theme + bell + MOB) · SectionTabs 40px (hidden on /chart, absent on /anchor). Keyboard: `1–6`, `[`/`]`, chart chords.
- **Phone:** bottom TabBar (6 items, 64px tall, ≥56px targets, thumb-reach) replaces the 3–4 wrapped flex rows; secondary tabs = scrollable pill row under the slim top strip.
- **Zero-reflow guarantees:** AlarmLane is pre-reserved (nothing moves when an alarm fires); settings-gated destinations (Tide/Currents) gate _tabs inside_ Conditions, so the section row never pops after hydration.
- **Suggestion, never teleportation:** watch armed → dot on ANCHOR; timer armed → dot on SAIL; underway → SAIL; active route → VOYAGE. One-time toast offers the jump.
- **Legacy redirects (permanent):** /helm→/sail · /race→/sail/race · /autopilot→/sail/autopilot · /ais→/chart?lens=ais · /tide→/conditions/tides · /currents→/conditions/currents · /forecast→/conditions · /grib→/conditions/models · /window→/conditions/windows · /passage→/voyage · /tracker→/voyage/tracker · /waypoints,/routes,/marks-and-routes→/voyage/plan · /tracks,/trips,/log→/voyage/logbook · /polars→/boat/polars · /sails→/boat/sails · /sails/crossover→/boat/crossover · /settings→/boat/setup · /boat→/boat/setup/profile · /mast-config→/boat/setup/displays · /damping→/boat/setup/damping · /calibration/_→/boat/setup/cal/_ · /wind-diag→/boat/diag/wind · /devices,/sensors,/sniff,/inspect,/sessions,/logs→/boat/diag/\* · /alerts stays · /mast stays.

---

## 7. Per-tab redesign directions

Organized by the current tabs for traceability; each names its new home.

### 7.1 Helm → SAIL ▸ Helm (glance)

CoreStrip becomes a 6-slot **CellGrid** of InstrumentTiles (hairline-divided instrument wall); task tabs (NAVIGATE / PERFORMANCE / WIND / ENGINE) become the one SegmentedControl; the Starting group moves to Race. Every value wears StalenessShroud; conditional tiles get **fixed slots** (NavigatingGroup's `—` behavior generalized — PerformanceGroup may no longer reshuffle). AlertsPanel stops inserting above the strip — alarms live in the AppBar lane. MOB moves to the shell.

```
 AppBar — AlarmLane is RESERVED: content never moves when it fires.
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ g5000 ▐SAIL▌ CHART ANCHOR COND VOYAGE BOAT │  (alarm lane — clear)  │ 14:32:05z ●LIVE │
│                                            │                        │ DAY  BELL2 ▐MOB▌│ 48px
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Helm   Race   Autopilot                                                             │ 40px
│  ────                                                                                │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ┌ CORE ──────────┬────────────────┬────────────────┬───────────────┬────────┬──────┐ │
│ │ SOG         kn │ HDG         °T │ COG         °T │ DEPTH       m │ AWS  kn│ AWA  °│ │
│ │                │                │                │▌              │        │       │ │
│ │    7.8         │    042         │    038         │▌   12.6       │  14.2  │  32 P │ │
│ │    ▲ +0.3      │                │    gps         │▌  under keel  │        │ port  │ │
│ └────────────────┴────────────────┴────────────────┴───────────────┴────────┴──────┘ │
│   CellGrid: gap-0, hairline dividers, r0 cells inside a rounded Panel.               │
│   ▌= 3px severity edge (shoaling warn). d2 numerals, Plex Mono, tabular.             │
│                                                                                      │
│  ▐NAVIGATE▌  PERFORMANCE   WIND   ENGINE          ← one SegmentedControl, 44px      │
│ ┌────────────────┬────────────────┬────────────────┬───────────────────────────────┐ │
│ │ TWS         kn │ TWD          ° │ VMG         kn │ XTE                → wpt BR-4 │ │
│ │  ‹11.8›        │   214          │   5.9          │  0.02 nm R        dtw 3.4 nm  │ │
│ │  STALE 12s     │                │                │                               │ │
│ ├────────────────┼────────────────┼────────────────┼───────────────────────────────┤ │
│ │ %POLAR       % │ TARGET BSP  kn │ HEEL         ° │ CURRENT SET/DFT               │ │
│ │   96.7  [ok]   │   8.10         │   14 S         │        —                      │ │
│ └────────────────┴────────────────┴────────────────┴───────────────────────────────┘ │
│  ‹11.8› = StalenessShroud stale state: hollow numerals + age chip.                   │
│  “—” = stable-slot law: no source, slot stays.                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘
 NIGHT: canvas #000, cells #0E0505, hairlines #450A0A, numerals #F87171; selected
 segment = red OUTLINE (no fill); severity by behavior; AWA port = filled glyph ◄.
 SUN: cells #FFFFFF on #F0EDE3, numerals #0B1220 w700, hairlines #CFC9B8 @1.5px.
```

### 7.2 Race → SAIL ▸ Race

Timer at `d1` (Pi ≈93px via station scale), sync-to-gun optimistic snap and audible schedule preserved verbatim. **Fixes:** LinePingPanel's inverted port/stbd corrected to `--port`/`--stbd` (its local comma fmtCoord fork deleted → lib/coords); **Reset gets ConfirmDialog + HoldButton** (it currently sits unguarded beside hammered ± buttons); mute button loses `bg-gray-200`. Line geometry, bias, and OCS readouts move onto InstrumentTile; helm's Starting group merges here.

### 7.3 Autopilot → SAIL ▸ Autopilot

Defense-in-depth chain (env gate → capability gate → confirm → cooldown → ack log) preserved verbatim; the confirm becomes a real Dialog (focus trap + Escape). Readout triplets → InstrumentTile with StalenessShroud — _the_ page where a frozen number is most dangerous. Engage/disengage = HoldButton. Command log renders UTC (currently local — convention violation). RAD_TO_DEG local re-implementation → shared util.

### 7.4 Chart → CHART (flagship)

Full-bleed map; dock lenses replace the fixed 360px sidebar; /ais absorbed as the AIS lens; MOB and alarms leave the map for the shell. Map.tsx engine untouched.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ g5000  SAIL ▐CHART▌ ANCHOR COND VOYAGE BOAT │▐! EVER FWD CPA 0.4nm 8m — ACK▌│14:32:05z│
│                                             │  (AlarmLane carrying live threat)  ▐MOB▌│
├───────────────────────────────────────────────────────────────────┬──────────────────┤
│ ┌────────┐                                              ┌────┐    │ LAYERS ▐AIS▌ ROUTE│
│ │ FOLLOW │ TL slot stack — slots push,                  │ ≣  │    ├──────────────────┤
│ │   ON   │ one s3 inset, no magic px                    ├────┤    │ TARGETS  12 in rng│
│ ├────────┤                                              │NOAA│    │ CPA sort · threats│
│ │ ↑ HDG  │                                              ├────┤    │ pinned            │
│ └────────┘                                              │SAT │    │┌────────────────┐ │
│                  · · · raster chart · · ·               ├────┤    ││! EVER FWD      │ │
│                                                         │BUOY│    ││  CPA 0.4 TCPA 8│ │
│        ○ BR-3                                           └────┘    ││  brg 214 7.8kn │ │
│       ╱ route (route-active #FBBF24)                  TR rail     ││ ▐MUTE 10m▌▐SHOW▌│ │
│      ╱                                                 44px       │└────────────────┘ │
│     ▲ own boat (amber)── cog vector                               │  ORION    CPA 2.1 │
│      ╲                                                            │  MAERSK K CPA 3.4 │
│       ▷ threat wedge (--danger)                                   │  SV KIWA  anchored│
│                                                                   │ rows 44px · mono  │
│ ┌──────────┐            ┌───────────────────────────┐             │ units in header   │
│ │ 0───2 nm │            │ INSPECT (pinned)      ✕   │             ├──────────────────┤
│ └──────────┘            │ 41 28.10n 71 19.92w       │             │ PRESET: SAILING ▾ │
│  BL scale               │ dpt 12m · tws 14kn        │             │ manual picker —   │
│                         │ cur 0.8kt→095             │             │ never auto-switch │
│                         │ ▐DROP MARK▌ ▐ROUTE HERE▌  │             │                   │
│                         └───────────────────────────┘             │ (phone: this dock │
│                          BR InspectPanel: hover=preview,          │  = BottomSheet    │
│                          tap=pin — touch parity                   │  peek/half/full)  │
├───────────────────────────────────────────────────────────────────┴──────────────────┤
 NIGHT: rasters via --map-filter red-shift; threat stays red; route drops to #B91C1C.
 SUN: rasters unfiltered (already light); chrome flips to paper; strokes 2.5px.
 Mute re-arm rule is printed ON the sheet — no more title= tooltip carrying safety info.
```

### 7.5 AIS & Tracker

**AIS** stops being a page: scope + table become the Chart AIS lens (threats-always-pinned DataTable; per-vessel mute with CPA-snapshot re-arm preserved verbatim, its rule now visible text). Threat state feeds the global alarm store — visible from every tab (today it is invisible off /ais). Range/CPA columns finally state NM (units-in-header). Accepted loss (named in D1): the standalone full-page table — dock-at-full is ~80% of it; `/chart?lens=ais` keeps deep links. **Tracker** → VOYAGE ▸ Tracker: dark Panel container, honest offline EmptyState; the white PredictWind iframe gets a framed, labeled well (iframe internals can't be themed — say so on-screen).

### 7.6 Anchor → ANCHOR (the template)

Structure unchanged — it is what the rest of the app is converging to. Deltas: tokens; slim PageHeader strip; drawer handle + snap points formalized into BottomSheet; 44/56px targets; Dial keeps correct port/stbd; **anchor-drag breach escalates to Takeover** (today: a text-xs pulse in one card).

```
┌──────────────────────────────────────────┐   ┌──────────────────────────────────────┐
│ ANCHOR  watch ●ARMED r=45m     03:12:05z │   │ ██████████ ANCHOR DRAG ██████████     │
├──────────────────────────────────────────┤   │   (Takeover · NIGHT · 1Hz invert)     │
│ ┌ WIND ──────────────┐ ┌ DEPTH ────────┐ │   │                                       │
│ │      N   gust 22.4 │ │   3.8 m       │ │   │    DISTANCE   67 m   ▲ rising         │
│ │   .-─────.         │ │   under keel  │ │   │    RADIUS     52 m   BREACH +15       │
│ │ W |  ▲   | E  AWS  │ │   5.2 total   │ │   │    BRG FROM DROP     214              │
│ │   '-─────'   16.4  │ └───────────────┘ │   │                                       │
│ │      S    port/stbd│ ┌ POSITION ─────┐ │   │   ▐ VIEW ON CHART ▌                   │
│ └────────────────────┘ │ 32 22.612n    │ │   │   ▐ ◌ hold — SILENCE 5 MIN ▌          │
│ ┌ NEARBY ──── 3 vsl ─┐ │ 64 40.723w    │ │   │   every pixel red-family on #000      │
│ │ SV Meridian  120 m │ │ drift 0.3 kn  │ │   └──────────────────────────────────────┘
│ │ MV Kestrel   310 m │ └───────────────┘ │
│ └────────────────────┘ ┌ WATCH ●ARMED ─┐ │      PHONE (390px): 2-col Panel grid,
│ ┌ TODAY & NOW ───────┐ │ radius   45 m │ │      wind dial full-width, drawer peek
│ │ HW 17:42 +2.1m     │ │ swing    28 m │ │      56px above the bottom TabBar
│ │ sunset 20:14z      │ │ rode 4:1      │ │      (SAIL CHRT ANCH COND VOY BOAT).
│ └────────────────────┘ │ ▐DISARM hold▌ │ │
│ ┌ SYSTEMS: batt 87% ▓▓▓▓░ solar 340W ─┐ │
├──┴──────────────────────────────────┴──┴─┤
│ ══ handle ══  Forecast Tides Radar Sky   │  ← BottomSheet peek 56px
│               Solar AC                   │
└──────────────────────────────────────────┘
```

### 7.7 Passage → VOYAGE ▸ Passage

ETA hero + progress + engine on InstrumentTile/Panel (six StatTile clones die). Full-bleed layout kept (it won over /race's centered column for underway pages). Engine panel reflects the motoring reality (constant-speed routing). TzToggle retires — **UTC everywhere** per the boat convention; sparklines → TimeSeriesPanel.

### 7.8 Tide / Currents / Forecast (+GRIB, +Window) → CONDITIONS

One section answering one question. Tides + Currents share the single StripChart (pin + source badge on both — the drift heals); **`Time (local)` becomes UTC** (convention violation fixed); ebb/flood use `--flow-*` and the now-line stops sharing ebb's orange. Forecast is the section default; Models (GRIB) and Forecast finally share one cache/refresh state (no more mutual unawareness); Windows is de-orphaned as the decision view. The `.fc-slider` skin dies with the Slider component. Forecast's 114-row table gets a scroll container + sticky header.

### 7.9 Waypoints / Routes / Tracks / Trips / Log → VOYAGE ▸ Plan + Logbook

**Plan** = waypoints + routes as one workspace (the /marks-and-routes redirect proved the intent): shared toolbar (search, import/export, add), DataTable, CoordField everywhere, chart handoff via the existing `chart:planState`. **Logbook** = tracks + trips + log as one day-grouped feed with a kind filter; trips' StatCard grammar wins; MODE_BADGE/KIND_BG maps merge into StatusChip; delete confirms name the record ("Delete track _Bermuda leg 3_?"), never internal ids; destructive rows get 44px targets separated from Edit.

### 7.10 Polars / Sails / Crossover → BOAT ▸ Performance

The app's worst visual debt (two stranded light-theme pages) — deleted, not themed, in the token phase. One workspace with formalized tabs replacing ad-hoc inline links. PolarPlot re-tokened + RampLegend; PolarHeatmap's double-click-to-edit gets an explicit edit affordance; SailRegionEditor gains drag-paint (dozens of precise 14px clicks is a seaway hazard); duplicated axis-label code collapses into the chart chassis; native alert() dies.

### 7.11 Settings / Calibration / Boat / Mast(-config) / Damping / Diagnostics → BOAT

Hub landing = grouped card index **with status lines** ("wind cal 12d old", "3 devices silent") — the junk drawer becomes a dashboard. Forms move to the Field system with the two visible save contracts; per-key PATCH ends the clobber race; SaveBar sits at the bottom of what it saves (the save-button-above-three-screens pattern dies). The 4× duplicated 5-second capture wizard → one CaptureWizard (progress + cancel); 3 bin-table editors → one BinTableEditor; calibration keeps its excellent hint copy and live-readouts-beside-controls verbatim. Displays absorbs mast-config + theme defaults + station scale + brightness (and /mast-config finally works after dark — night mode configures night mode). Diagnostics adopts the wind-diag PageHeader voice; wind-diag charts get fixed y-domains so a ±0.1° flatline no longer renders as drama; Sniff/Inspect/Sessions/Logs are WORK density with keyboard-navigable DataTables. **Mast** kiosk route is unchanged; same tokens, station scale 1.6, theme sync via the SSE it already has.

### 7.12 Alerts → bell + AlarmLane + Takeover

One alarm store (Navbar + AlarmBanner double-polling dies) with three tiers: **notice** → bell badge + /alerts sheet · **warn** → AlarmLane statement + ACK + audio per config · **critical** (anchor drag, MOB, imminent CPA) → Takeover. AIS threats and anchor drag are promoted into it. /alerts remains the deep-linkable sheet: alarm list + thresholds + ntfy config. Silence-based Navico clearing preserved verbatim.

---

## 8. Marine specifics

- **Sunlight:** SUN is a true paper inversion because physics demands it — reflected ambient light lifts dark pixels and crushes dark-theme contrast; emitted+reflected align on paper. Weights +100, borders 1.5px, no translucency, no shadows, numerals near-black. The light OSM basemap makes CHART native in SUN.
- **Night:** all-red, luminance-capped, hue-free. Severity = behavior (steady/bright+glyph/invert-pulse ≤1Hz); port/stbd = glyph + filled/hollow; accent = outline; charts collapse to red steps + line styles; rasters red-shift via CSS filter; transitions freeze. The white MOB modal, inverted-white active states, and `bg-gray-200` mute — today's night-vision destroyers — are deleted in phase 1.
- **One-handed / seaway:** 44px floor everywhere; 56px glance primaries; whole-cell/whole-row targets; phone bottom TabBar in thumb reach; no precision drags required anywhere (drag-paint has click fallback); destructive = ConfirmDialog naming the record; irreversible = HoldButton (600ms–1.5s) — hold tolerates a lurch, a double-tap does not.
- **Mouse AND touch:** hover may preview (Pi mouse), never exclusively inform. Every `title=` tooltip carrying real information (mute re-arm rule, disabled reasons, heatmap cells) becomes visible text or tap-to-inspect. CursorReadout pins on tap. Per the Pi-mouse preference: right-click affordances stay; focus rings finally exist for the mouse+keyboard Pi.
- **Offline honesty:** EmptyStates state the dependency ("Windy radar needs internet"); degraded caches show last-good + age; demo/replay chips are permanent while active ("this data is fake" preserved).
- **Time & coords:** UTC everywhere, one `z` suffix convention (violations enumerated in §7 all fixed); compact DMM via the single lib/coords with the paste-anything parser; 3-digit bearings; NM scale bar; mono+tabular numerals globally.

---

## 9. Migration plan (phased, shippable throughout)

Rules: the app builds, deploys to the Pi, and passes the known-baseline test set at the end of every phase; `develop` → `main` promotion per existing branching; no phase blocks sailing. Known environmental test failures remain the baseline.

**Phase 0 — Guardrails & plumbing** (no visual change)
Keep-list doc committed (§12); all nav → `next/link`; coordinate libs merged (format-coords + LinePingPanel fork deleted); localStorage namespace unified (`g5000:*` + read-migration shim); lint bans (raw hex, `text-[9-11px]`, window.confirm/alert/prompt, rogue EventSource, internal `<a href`); shared SSE store + `usePoll` land and the verified duplicate pollers cut over. _Gate: zero duplicate connections in devtools; nav no longer full-reloads._

**Phase 1 — Tokens & three themes, app-wide**
`@theme inline` semantic tokens + DAY/NIGHT/SUN palettes; **compat bridge** repoints existing slate/zinc/amber utilities onto theme vars — every unmigrated screen flips with `data-theme` immediately; ThemeController (DisplayConfig + SSE, per-device override, suncalc toast); light-theme fossils and the 5 page-canvas forks deleted; ~30 SVG hex literals migrated per the audit inventory; Plex Mono numerals via next/font/local. _Gate: NIGHT and SUN usable on every screen; boat-wide theme flip verified Pi+phone+mast._

**Phase 2 — Shell & IA**
NavShell (AppBar-as-readout: sections, AlarmLane, UTC, link LED, theme chip, bell, MOB cell; SectionTabs; phone TabBar); 6-section route tree + full redirect table; one alarm store feeding bell+lane+audio; SectionSuggestor dots; Lucide swap in shell; keyboard map. _Gate: every legacy URL lands correctly; alarm fires with zero layout shift; old pages render inside the new shell untouched._

**Phase 3 — Primitives & safety redesign**
Panel, InstrumentTile+StalenessShroud, CellGrid, StatusChip, Button/IconButton/HoldButton, SegmentedControl, Field family, Dialog/ConfirmDialog (window.confirm ×9 + white MOB modal retired), Toast/MsgLine, Takeover. Safety wave: staleness on /helm + /autopilot; anchor drag + MOB → Takeover; LinePingPanel port/stbd fixed; race Reset guarded. _Gate: pull the YDWG cable — every helm value visibly stales within 10s and the shell declares LINK LOST._

**Phase 4 — Glance surfaces**
Helm rebuilt on CellGrid at /sail; Race + Autopilot on the same grammar; Anchor polish (tokens, BottomSheet, 44/56px); Mast on tokens + station scale 1.6. _Gate: night sail acceptance — helm/race/autopilot/anchor/mast fully usable in NIGHT._

**Phase 5 — Chart flagship**
Dock lenses (Layers/AIS/Route; dock ↔ BottomSheet on phone); /ais absorbed, threats → global alarm store; CornerSlots; InspectPanel tap-to-pin; manual layer presets; map night filter. Map.tsx untouched. _Gate: chart usable one-handed on a phone; AIS threat visible from every section via the lane._

**Phase 6 — Work surfaces & consolidation**
Conditions (StripChart merge, shared GRIB cache state, Windows de-orphaned, UTC fixes); Voyage (Plan + Logbook on DataTable/RecordList); Boat hub with status lines; forms → Field + SaveBar + **per-key PATCH**; one CaptureWizard + BinTableEditor; chart-library consolidation (TimeSeriesPanel/StripChart/HeatmapGrid/RampLegend, fixed y-domains); Performance re-skin completes. _Gate: two clients editing /boat/setup simultaneously cannot clobber each other._

**Phase 7 — Cleanup & enforcement**
Compat bridge deleted; dead legacy page code removed; lint tightened to full token enforcement (no slate-_/zinc-_ utilities); QA sweep: every screen × 3 themes × Pi/phone/mast; keep-list re-verified against shipped behavior.

**Definition of done, per migrated screen:** tokens only (no hex, no palette utilities) · targets ≥44px (≥56px glance primaries) · StalenessShroud on live values · UTC + DMM via shared libs · EmptyState with honest reason · save contract visible (Switch vs SaveBar) · no `title=`-only information · renders correctly in all three themes · fixed slots (no reshuffle) · Lucide only.

---

## 10. Risks & open questions

1. **SUN palette needs on-deck validation** — paper is the right physics, but the exact warm-paper values and 85%-opacity ramps need a cockpit test before phase 6 polish. Fallback: values are tokens; retuning is a palette edit, not a rework.
2. **NIGHT reds need on-water validation** (as D2 conceded) — especially the shape-encoded port/stbd grammar. Validate during phase 4's night-sail gate.
3. **Plex Mono fallback metrics** must be tuned (`size-adjust`) or the CellGrid shifts on cold load; test on the Pi's chromium.
4. **AIS dock-at-full vs the old full page** — if real use misses the full-width table, add a "expand to full" affordance inside the lens (cheap; the lens is the same DataTable).
5. **Per-key PATCH** is server work in `apps/g5000` route handlers — small but must precede the forms wave.
6. **Compat-bridge visual drift** on unmigrated screens in NIGHT/SUN is accepted and tracked per phase; anything safety-relevant that renders wrong under the bridge gets hand-fixed immediately rather than waiting for its phase.

---

## 11. What was taken from where (summary table)

| Idea                                                                                                                                      | Source                                     | Disposition                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------- |
| 6-section IA, extraction strategy, tokens-first phasing, redirect map, dock lenses, drawer/BottomSheet, suggestion-not-teleport placement | D1                                         | **Spine**                             |
| True paper SUN mode                                                                                                                       | D3 (values from D2's Glare)                | Grafted — replaces D1's dark sunlight |
| CellGrid hairline instrument grammar + severity edge                                                                                      | D3                                         | Grafted, scoped to glance clusters    |
| Station numeral scale (1.0/1.15/1.6)                                                                                                      | D3                                         | Grafted                               |
| AppBar-as-readout (AlarmLane, UTC, link LED) + MsgLine/no-glance-toasts                                                                   | D3                                         | Grafted into D1's shell               |
| Keyboard map                                                                                                                              | D3                                         | Grafted, minus softkey row            |
| Canonical ramp = FILL_STOPS; legends derive from stops                                                                                    | D3 (generalizing the app's own WindLegend) | Grafted as law                        |
| StalenessShroud                                                                                                                           | D2                                         | Grafted as mandatory                  |
| Takeover                                                                                                                                  | D2                                         | Grafted for critical tier             |
| System proposes / sailor disposes + signals                                                                                               | D2                                         | Grafted as dots+toast                 |
| Port/stbd ≠ status tokens; night hue ban; shape/behavior encoding                                                                         | D2 (+D3 filled/hollow)                     | Grafted, strictest union              |
| Manual chart layer presets                                                                                                                | D2, de-automated                           | Grafted                               |
| Plex Mono numerals; keep #cdd6f4; 56px glove floor; motion law                                                                            | D2/D3                                      | Grafted                               |
| Five boat-wide MODEs; Locker; Conn readout suppression; auto presets; per-mode drawers                                                    | D2                                         | **Rejected**                          |
| Numbered pages; softkey row; app-wide zero-radius; one-wave landing; Barlow                                                               | D3                                         | **Rejected**                          |
| Dark sunlight theme; #cdd6f4 retirement; page-level MOB; night dim-green                                                                  | D1                                         | **Rejected**                          |

---

## 12. The keep-list (codified — the overhaul may not regress these)

Map.tsx gesture engine (500ms long-press/8px tolerance/click-swallow, `originalEvent` discrimination, 3° bearing dead-band, `__above-wind__` sentinel, tile-proxy pattern + maxzoom caps, ImageSource-not-CanvasSource radar rule) · AIS threats-float-to-top + per-vessel mute with CPA-snapshot auto-re-arm + stale-target exclusion · race audible schedule + sync-to-gun optimistic snap · silence-based Navico alert clearing · AP defense-in-depth (env gate → capability gate → confirm → cooldown → ack log) · MOB hold-with-progress interaction · demo-mode "this data is fake" messaging · compact DMM + paste-anything parser · UTC discipline · mono/tabular numerals · NM scale bar + 3-digit bearings · WindDial's correct port/stbd · stable per-source session colors · /damping's dirty-tracked save · offline-honest empty states · `aria-pressed`/role=radio habits · helm CoreStrip + task-tabs IA · anchor card grammar + bottom drawer · wind-diag header voice · trips' StatCard + day-grouped feed · /settings' status-tinted container idea.

_End of proposal._
