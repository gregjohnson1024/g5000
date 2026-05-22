# Sensors panel

**Issue:** Standalone UX work inspired by the B&G Hercules Sensors view (manual p17).
**Status:** Approved, ready for plan.
**Date:** 2026-05-21.

## Summary

Replace `/sources` with a new `/sensors` page that groups channels by physical sensor (Heading, BSP, Apparent wind, GPS, Depth, Motion, Battery). Each sensor renders as a card with the live readings, a freshness dot, a static "Directly used by" list of downstream pipelines, links to the relevant cal pages, and the per-channel source-priority editor embedded inline (collapsed by default).

The existing cal pages (`/damping`, etc.) and the `/devices` page stay as-is. Derived channels (true wind, race calcs, sail recommendation, autopilot) keep their existing homes on the feature pages where they're already shown.

## Why

Today, when a measurement looks wrong, the user has to triangulate between three pages: `/sources` for "who is publishing what right now", `/devices` for "is the N2K box even alive", and one of the cal pages for "is the offset correct". The Hercules Sensors panel collapses all of that into one place and adds a critical column — **Directly used by** — that names the downstream pipelines that go red when this sensor goes bad. That column turns "boat speed reading looks off" into "boat speed reading looks off — therefore true wind, VMG, polar %, current estimate, and ETA are all suspect", in one glance.

## Sensor cards

| Sensor card | Channels | Cal page | Directly used by |
|---|---|---|---|
| Heading (compass) | `boat.heading.magnetic`, `boat.heading.true`, `nav.magvar` | `/damping` (heading section) | True wind · Layline angles · COG–HDG comparison · Polar % · AIS bearing |
| Speed through water (BSP) | `boat.speed.water` | `/damping` (BSP section) | True wind · VMG · Polar % · Current estimate · Sail-timeline ETA |
| Apparent wind | `wind.apparent.angle`, `wind.apparent.speed` | `/damping` (AWS-AWA section) | True wind · Polars/targets · Race wind-shift detector · Sail crossover · VMC |
| GPS | `nav.gps.position`, `nav.gps.cog`, `nav.gps.cog.magnetic`, `nav.gps.sog` | (no cal page) | SOG · COG · VMC · Distance/ETA · Route plan · AIS CPA · Anchor watch · Live boat marker · Track recorder · Start-line geometry |
| Depth | `nav.depth` | (depth offset is on `/settings`) | Anchor watch · Shallow alarm |
| Motion (IMU) | `motion.heel`, `motion.pitch`, `motion.yaw`, `motion.rateOfTurn` | (no cal page) | *(display-only; no downstream consumers today)* |
| Battery | `electrical.battery.voltage` | (no cal page) | Low-battery alarm (when configured) |

The Motion card is included even though nothing currently consumes its channels. The value is diagnostic: the card answers "is my IMU alive and what is it reading right now" without forcing the user to hunt for an N2K live-frame inspector.

**Excluded** from `/sensors`:

- `wind.true.*` (true wind) — derived. Already on `/helm`, `/race`, `/polars`, `/chart`.
- `race.*` (line, VMC, polar%, laylines, shifts) — derived. Already on `/race`.
- `sail.recommendation` — derived. On `/sails`.
- `autopilot.*` — its own page at `/autopilot`.
- `boat.rudder.angle` — defer until a use case appears.

If a single-pane "everything live, at a glance" view is desired later, that's what the `/dashboard` feature in the Hercules notes is for. It's a separate ticket and aggregates `/sensors` + derived numbers + system load.

## Per-card layout

Each card renders in this order, top to bottom:

1. **Header** with the sensor name and a freshness dot.
   - Green: at least one of this sensor's channels has a sample under 2 s old.
   - Yellow: most-recent sample is between 2 s and 10 s old.
   - Red: > 10 s old, or no source ever observed.
   - The threshold is the same for every sensor in v1. If a sensor with naturally slow update rate (e.g. depth at 0.2 Hz) ends up showing as yellow during normal operation, we'll add per-sensor thresholds in v2.
2. **Live values** — one row per channel, with the value formatted for the channel (degrees, knots, metres, etc.). The first listed channel is the "primary" reading and gets prominent type. Magnetic variation displays alongside heading; COG / SOG / position share one block under GPS.
3. **Source line** — a single line: `Source: <friendly source label> — last update <X> s ago`. Friendly label uses the existing `friendlySourceLabel` helper from `packages/web/src/lib/friendly-source.ts`. When multiple channels for a sensor come from different sources, list them on separate lines.
4. **Directly used by** — bullet list from the static mapping above.
5. **Operations** — one button-link per cal page mentioned in the table above. Where there is no cal page (GPS, Motion, Battery), this section is omitted; we do not show an empty section.
6. **Source priorities** disclosure — a `<details>` element collapsed by default, labeled `Source priorities (N channels)`. Inside, an instance of `<SourcePriorityEditor>` for the channels owned by this sensor. The editor mirrors the rule-editor section of today's `/sources` page (rule per channel; ordered source list with up/down/delete; freshness slider).

The page itself is a single scrolling column of cards, in the order listed in the table above. No left-side navigation. The current `/sources` page already uses a vertical scroll layout — this matches it.

## Architecture

### File scope

| File | Action | Approx LOC |
|---|---|---|
| `packages/web/src/app/sensors/page.tsx` | new — page shell; polls `/api/sources/observed`; renders one `<SensorCard>` per entry in `SENSOR_DEFS` | ~120 |
| `packages/web/src/app/sensors/sensor-definitions.ts` | new — static `SENSOR_DEFS: SensorDef[]` with the table contents; exported type `SensorDef` | ~100 |
| `packages/web/src/app/sensors/SensorCard.tsx` | new — renders one sensor's card: live values, freshness dot, source line, used-by list, ops links, collapsed priority editor | ~130 |
| `packages/web/src/app/sensors/SourcePriorityEditor.tsx` | new — extracted from today's `/sources/page.tsx`; takes a list of channels and the full priority config, renders the rule editors for just those channels, persists via existing `/api/sources/config` route | ~280 |
| `packages/web/src/app/sources/page.tsx` | delete — absorbed | -794 net |
| `packages/web/src/app/Navbar.tsx` | modify — rename the link from "Sources" → "Sensors", point at `/sensors` | ~2 changed |
| `packages/web/src/app/sources/page.test.tsx` (if it exists) | delete | — |

No backend changes. Reuses `/api/sources/observed` (polled) and `/api/sources/config` (GET/PUT) exactly as `/sources` does today.

### Data flow

1. Page mounts. A `useEffect` polls `/api/sources/observed` every 1 s (same cadence as `/sources` today) and `/api/sources/config` once on mount.
2. Observed entries are reshaped from `Map<channel, ObservedEntry[]>` into a per-sensor view: for each `SensorDef`, gather the entries for its listed channels.
3. Each `<SensorCard>` receives its sensor's observed entries + the relevant slice of the rule config + the full rule config (for the editor's drag-reorder UX). The card computes its own freshness dot from the most recent entry.
4. The `<SourcePriorityEditor>` inside the card calls `fetch('/api/sources/config', { method: 'PUT', body: JSON.stringify(nextRules) })` when the user edits a rule. On success, the page state updates.

### `SensorDef` shape

```ts
export interface SensorDef {
  /** Stable id, used as React key and as the `<details>` open-state localStorage key. */
  id: 'heading' | 'bsp' | 'apparent-wind' | 'gps' | 'depth' | 'motion' | 'battery';
  /** Card header label. */
  label: string;
  /** Channels belonging to this sensor, in display order. The first is the "primary" reading. */
  channels: string[];
  /** Optional link to the cal page for this sensor. Omitted if there is no cal page. */
  calPage?: { label: string; href: string };
  /** Static list of downstream pipelines that consume this sensor's readings. */
  usedBy: string[];
  /** How to format each channel's value for display. Keyed by channel name. */
  format: Record<string, (v: number | { lat: number; lon: number } | unknown) => string>;
}
```

The `format` map is the only place where per-channel display logic lives. Heading values come in radians and display as `034°`; positions display in the existing DMM convention via the existing `fmtLatLonDmm` helper; speeds display as knots; depth in metres. All of these have helpers already in `packages/web/src/lib`.

## Testing

### Automated

Vitest for the pieces with non-trivial logic:

- `sensor-definitions.test.ts` — assert every channel listed in any `SensorDef` exists in `Channels` constants from `@g5000/core` (catches typos when channel names get refactored). Assert all sensor ids are unique.
- `freshness-dot.test.ts` — small pure helper for the green/yellow/red threshold, easy to test in isolation.

Skip a full mount-with-SSE-mock test of `<SensorCard>` — there's no logic worth exercising past the freshness threshold, and JSDOM with timers is painful.

### Manual

1. Load `/sensors` while connected to the boat network. Confirm all seven cards render in order: Heading, BSP, Apparent wind, GPS, Depth, Motion, Battery.
2. With YDWG online: all cards except Battery show green dots and live values.
3. Disconnect the depth sounder (or wait long enough): the Depth card transitions green → yellow → red over ~10 s; other cards unaffected.
4. Expand a card's "Source priorities" disclosure. Confirm the rule editor renders, that editing and saving updates the underlying config, and that the change persists on reload.
5. Click "Damping / offset →" on the Heading card. Confirm navigation to `/damping`.
6. Navbar shows "Sensors" (not "Sources"). Hitting the old `/sources` URL directly should 404 (Next.js will serve the default not-found page).
7. Verify no other page broke — quick smoke through `/chart`, `/helm`, `/race`, `/sails`, `/autopilot`.

## Non-goals

- **Inlining cal pages.** Damping / BSP cal / compass cal pages keep their own URLs and routes. `/sensors` links to them.
- **Dynamic "Directly used by" introspection.** The mapping is static, hand-maintained in `sensor-definitions.ts`. Update when pipelines change. Pipelines change slowly enough that this is cheaper than instrumenting every subscriber.
- **Sensor health alarming.** The freshness dot is informational. Alarms continue to live in `/alerts`.
- **Per-sensor auto-cal wizards (Hercules p17).** The Hercules-style "press button → boat does maneuvers → correction table updates" workflow is its own multi-week project. Documented in `docs/design/hercules-feature-notes.md` under correction tables.
- **Derived-value cards.** True wind, race calcs, sail recommendation, autopilot stay on their existing pages.

## Risk

Low. This is a UI rearrangement of data that already flows through the existing observed/config endpoints. The non-trivial piece is extracting `SourcePriorityEditor` from the current 794-line `/sources/page.tsx` — but that code is well-contained (the rule-editor lives in roughly half the file). Worst case: a rule-editor edge case ports incorrectly during extraction; behaviour is identical to today on the original `/sources` page so we can diff-test against the existing implementation.
