# `/sensors`: show every channel (curated cards + "All channels")

**Date:** 2026-06-16
**Status:** design (approved in brainstorming)
**Scope:** g5000 web only (`packages/web`). No backend, selector, config, API, bus, or appliance changes.

## Problem

`/sensors` renders only a hand-curated list of 8 `SENSOR_DEFS`, so most channels g5000 produces are invisible. Live now there are ~38 channels — 13 measured (`n2k:`) + 25 computed — but only ~8 named cards show. The user wants to see **every channel** g5000 produces — every mapped-N2K channel _and_ every computed one — with human-readable labels and device-named sources, and the same single-source pin control. (Raw, unmapped N2K PGNs are out of scope; the `/sniff` page already shows those.)

## Goals

- Show every **live** channel on `/sensors`: the curated cards as today, plus an always-expanded **"All channels"** section listing every _other_ observed channel.
- Group the section into **Measured (from devices)** and **Computed (g5000)** so the provenance distinction (e.g. measured heading vs `computed:true_wind`) is explicit.
- Human-readable channel labels + the existing device-named per-source values + Auto/source pin radios.
- DRY: extract the per-channel render+pin block (currently inlined in `SensorCard`) into a shared `ChannelPanel` used by both the curated cards and the new section.

## Non-goals

- No raw/unmapped N2K PGN view (that's `/sniff`).
- No known-but-silent channels: the section is driven by **live observed** channels (`/api/sources/observed`), not the full `channels.ts` registry. A channel with no source in the observed window simply isn't listed.
- No backend/selector/config/API change. No new nav entry (`/sensors` already under **Network**).
- No collapsing — the section is always expanded.

## Data flow (unchanged backend)

`/api/sources/observed` already returns every live `{ channel, source, lastValue, ageMs }`. The page groups by channel. **Curated channels** = the union of every `SENSOR_DEF.channels`; they render in their existing cards. **Other channels** = observed channels not in that set; they render in the "All channels" section. No duplication — a channel appears in exactly one place.

## Components / files (web-only)

### New pure helper: `packages/web/src/lib/channel-label.ts` (+ `.test.ts`)

- `channelLabel(channel: string): string` — prettify the dotted id into a human label: split on `.`, split camelCase segments into words, join with spaces, capitalise the first letter, and **upper-case known acronyms** (`gps cog sog vmg twa tws twd awa aws ais imu eta hdg xte rpm utc`). Examples: `boat.rudder.angle` → "Boat rudder angle"; `wind.true.direction` → "Wind true direction"; `nav.gps.cog.magnetic` → "Nav GPS COG magnetic"; `performance.target.vmg` → "Performance target VMG"; `groove.helmSource` → "Groove helm source". A small `CHANNEL_LABEL_OVERRIDES: Record<string, string>` is consulted first for any id whose derived label reads poorly (populated during implementation; may be empty if none needed).
- `channelKind(sourcesForChannel: string[]): 'measured' | 'computed'` — `'measured'` if any source starts with `n2k:` or `0183:`, else `'computed'`.

### New component: `packages/web/src/app/sensors/ChannelPanel.tsx`

The per-channel block lifted out of `SensorCard`: shows the friendly `channelLabel(channel)` + the raw `channel` id (small mono) and the pin-aware headline value, then the radio group (`Auto — most recent` + one row per source: device label · value · age, with the pinned-but-stale source kept visible). All pin behaviour is identical to today (`pinnedSourceForChannel` / `setPinnedSource` / `onSaveRules`). Props: `{ channel: string; entries: ObservedEntry[]; rules: SourcePriorityRule[]; devices: Map<number, DeviceLabelInfo>; saving: boolean; onSaveRules: (next: SourcePriorityRule[]) => Promise<void> }`.

### Modify `packages/web/src/app/sensors/SensorCard.tsx`

Render each `def.channels` entry via `<ChannelPanel>` instead of the inlined block. Keep the card header (freshness dot from the card's min age), "Directly used by", and cal-page link. (Per-channel rows now show friendly labels too — a small consistency improvement.)

### New component: `packages/web/src/app/sensors/AllChannels.tsx`

Props: `{ observed, rules, devices, saving, onSaveRules }`. Computes `curated = new Set(SENSOR_DEFS.flatMap(d => d.channels))`; `others = distinct observed channels not in curated`. Splits `others` into measured/computed via `channelKind(sources of that channel)`, sorts each group by channel id, and renders a heading "All channels" with two subgroups — "Measured (from devices)" and "Computed (g5000)" — each a list of `<ChannelPanel>`. If `others` is empty, render "No other channels.".

### Modify `packages/web/src/app/sensors/page.tsx`

Render `<AllChannels observed={observed} rules={rules} devices={devices} saving={saving} onSaveRules={onSaveRules} />` after the curated `SENSOR_DEFS.map(...)`.

### Reused unchanged

`/api/sources/observed`, `/api/devices`, `deviceLabel`, `groupSourcesByChannel`, `source-pin` (`pinnedSourceForChannel`/`setPinnedSource`), `freshnessOf`, `formatChannelValue`, `sensors-types` (`ObservedEntry`), `@g5000/core` (`SourcePriorityRule`), the selector/db/api/appliance.

## Error handling / edges

- A channel with **both** measured and computed sources → grouped under **Measured** (it has a device source); both source rows are shown so the device value and the computed value sit side by side (the H5000-vs-g5000 comparison).
- No "other" channels observed → "No other channels."
- A channel id that doesn't prettify cleanly → falls to `CHANNEL_LABEL_OVERRIDES` or the raw-id mono line still shows it precisely.
- Observed window/staleness behaviour unchanged (5 s window in `/api/sources/observed`).

## Testing

- `channel-label.test.ts`: path prettify (multi-segment, camelCase), acronym upper-casing (`gps`/`cog`/`vmg`/`twa`), override-map precedence, `channelKind` measured (n2k/0183) vs computed.
- `ChannelPanel` / `AllChannels` are presentational — no React-component tests (repo convention); their logic (grouping, kind, label) is covered by the pure-helper tests.
- Gates: `npx tsc -b` (exit 0); `npx vitest run packages/web/src/lib packages/web/src/app/sensors` (from repo root); `cd packages/web && npm run build` (`/sensors` in manifest).
- Manual: `/sensors` shows the curated cards plus an "All channels" section; `wind.true.direction` appears under Computed showing `computed: true wind`; `boat.rudder.angle`/`autopilot.mode` under Measured with device names; pinning a multi-source channel there behaves like the curated cards.
