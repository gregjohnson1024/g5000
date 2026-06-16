# `/sensors`: per-source value breakdown + device names

**Date:** 2026-06-16
**Status:** design (approved in brainstorming)
**Scope:** g5000 web only (`packages/web`). No backend, bus, or appliance changes.

## Problem

A value like **TWD (true wind direction)** is observed jumping 0° → 83° → 323°. The likely cause is **multiple N2K broadcasters** publishing the same channel, one or more of them wrong, and the display showing whichever updated most recently. Today there is no way to *see* each source's own value to identify the rogue device.

## Background — what already exists (reuse, don't rebuild)

g5000 already tracks the source device for every value end-to-end:

- Every bus `Sample` carries a `source` tag: `n2k:<PGN>@0x<SRC>` (e.g. `n2k:130306@0x11`) or `computed:<name>` (e.g. `computed:true_wind`). (`packages/core/src/types.ts`)
- **`GET /api/sources/observed`** returns one entry **per (channel × source)**, each with that source's *own* latest value:
  `ObservedEntry = { channel: string; source: string; lastSeenMs: number; ageMs: number; lastValue: unknown }`
  (tracker: `apps/g5000/src/observed-sources.ts`; route: `packages/web/src/app/api/sources/observed/route.ts`)
- **`GET /api/devices`** returns `{ devices: DeviceInfo[] }`, `DeviceInfo = { src: number; lastSeenMs: number; manufacturerName?: string; modelId?: string; deviceFunctionName?: string; ... }` from N2K PGN 60928 (Address Claim) + 126996 (Product Info). (`packages/bridge/src/devices/device-registry.ts`; route `packages/web/src/app/api/devices/route.ts`)
- Helpers in `packages/web/src/lib/friendly-source.ts`: `parseN2kSource(tag) → { pgn; srcHex; src } | null`, `friendlySourceLabel(tag) → string` (e.g. `"Wind · 0x11"`), `formatChannelValue(v) → string`.
- **`/sensors`** (`packages/web/src/app/sensors/`) already polls `/api/sources/observed` every 1 s, renders a `SensorCard` per `SENSOR_DEFS` entry, and includes a working **source-priority editor** (`SourcePriorityEditor`) to choose which source wins per channel.

**The gap:** `SensorCard.tsx:37–42` keeps only the *single freshest* `ObservedEntry` per channel for display and (separately) lists the unique source *names* — it never shows each source's own `lastValue`. So the per-source values are fetched but collapsed away before render. That collapse is exactly why TWD "flaps": the card alternates between competing sources.

## Goals

- On each `/sensors` card, show — per channel — **every active source's own current value**, labelled with the **real device name**, so a user can see e.g. `Garmin gWind (0x11) → 0°` vs `B&G WS320 (0x15) → 323°` and identify the bad broadcaster.
- Keep the existing per-channel headline value (what the rest of the app currently sees) and the source-priority editor on the same card, so see-it → fix-it is one place.
- Graceful: never crash or blank a card when device info or the API is missing.

## Non-goals (v1)

- **No automatic "disagree" detection / ⚠ flagging.** Per-channel disagreement needs per-channel tolerances and circular math for angles (0° vs 359° are 2° apart). Out of scope; values are shown plainly side by side and the eye catches conflicts. Possible follow-up.
- No new page, no nav change (`/sensors` is already under the **Network** menu).
- No backend/API/bus changes. No appliance changes.

## Architecture / data flow

Entirely browser-side, reusing the two existing APIs:

1. `/sensors` `page.tsx` continues polling `GET /api/sources/observed` (1 s) → `ObservedEntry[]`.
2. `page.tsx` also fetches `GET /api/devices` on mount and refreshes every 15 s (devices change rarely; cheap). Builds `devices: Map<number, DeviceInfo>` keyed by `src`. On fetch error, uses an empty map (labels fall back).
3. `page.tsx` passes `devices` into each `SensorCard`.
4. `SensorCard` already computes `own = observed.filter(e => def.channels.includes(e.channel))` — that array already contains **one entry per (channel × source) with `lastValue`**. The card groups `own` by channel and, under each channel, renders one line per source: `deviceLabel(source, devices) · formatChannelValue(lastValue) · ageMs`.

## Components

### New pure helper: `packages/web/src/lib/device-label.ts` (+ `.test.ts`)

```
DeviceLabelInfo = { src: number; manufacturerName?: string; modelId?: string; deviceFunctionName?: string }

deviceLabel(source: string, devices: Map<number, DeviceLabelInfo>): string
```

Rules (first match wins):
1. `parseN2kSource(source)` is non-null **and** `devices.get(src)` exists with `manufacturerName` and/or `modelId` →
   `"<manufacturerName> <modelId> (0x<srcHex>)"`, omitting whichever of manufacturer/model is absent
   (e.g. `"Garmin gWind (0x11)"`, or `"Garmin (0x11)"` if only manufacturer, or `"gWind (0x11)"` if only model).
2. `parseN2kSource(source)` non-null and a device row exists but has no product info →
   `"<deviceFunctionName ?? 'Device'> (0x<srcHex>)"` (e.g. `"Wind (0x15)"`).
3. Otherwise (no device row, or `parseN2kSource` returns null, or a `computed:` tag) → `friendlySourceLabel(source)`.

Pure and decoupled: takes a minimal `DeviceLabelInfo` map, no `@g5000/bridge` import. (`page.tsx` maps the `/api/devices` JSON into this map.)

### New pure helper: `packages/web/src/app/sensors/group-sources.ts` (+ `.test.ts`)

```
groupSourcesByChannel(own: ObservedEntry[]): Map<string, ObservedEntry[]>
```

Groups a card's `own` entries by `channel`, each list sorted by `source` (stable display order). Tested independently so the React component stays presentation-only (repo convention: test pure logic + routes, not components).

### Modify `packages/web/src/app/sensors/SensorCard.tsx`

- Accept a new prop `devices: Map<number, DeviceLabelInfo>`.
- Keep the existing per-channel headline (freshest value) and freshness dot.
- Under each channel, render the per-source breakdown from `groupSourcesByChannel(own)`: one compact line per source — `deviceLabel(e.source, devices)` · `formatChannelValue(e.lastValue)` · `(e.ageMs/1000).toFixed(1)} s`. Always shown (one line when a single source; the conflict is visible when >1).
- The existing combined "Source: …" summary line is replaced by this richer per-source list (it conveyed strictly less). The `SourcePriorityEditor` `<details>` stays unchanged.

### Modify `packages/web/src/app/sensors/page.tsx`

- Add `devices` state + a `useEffect` to fetch `/api/devices` on mount and every 15 s; build `Map<number, DeviceLabelInfo>`; tolerate fetch errors (empty map).
- Pass `devices` to each `<SensorCard>`.

## Error handling / edges

- `/api/devices` fails or returns empty → `devices` map empty → every source falls to rule 3 (`friendlySourceLabel`); per-source values still render. No crash.
- `computed:*` sources → `friendlySourceLabel` (rule 3) → e.g. `"computed: true wind"`.
- Source tag unparseable → rule 3 fallback.
- A channel with no observed sources → existing "No source observed." path (unchanged).
- Values already age out via the 5 s `windowMs` of `/api/sources/observed` (unchanged).

## Testing

- `device-label.test.ts`: device match (manufacturer+model), manufacturer-only, model-only, device row without product info (function-name fallback), no device row (friendly fallback), `computed:` tag, unparseable tag.
- `group-sources.test.ts`: multiple sources on one channel grouped + sorted; multiple channels; empty input.
- No React-component test (repo convention).
- Gates: `npx tsc -b` (exit 0); `npx vitest run packages/web/src/lib packages/web/src/app/sensors`; `cd packages/web && npm run build`.
- Manual: open `/sensors`; a channel fed by two sources shows both values with device names; confirm the rogue source is visible; use the existing priority editor to deprioritize it.

## Files

**Modify:** `packages/web/src/app/sensors/page.tsx` (fetch `/api/devices`, pass `devices`), `packages/web/src/app/sensors/SensorCard.tsx` (per-source breakdown).
**Create:** `packages/web/src/lib/device-label.ts` (+ `device-label.test.ts`), `packages/web/src/app/sensors/group-sources.ts` (+ `group-sources.test.ts`).
**Unchanged / reused:** `/api/sources/observed`, `/api/devices`, `friendly-source.ts` (`parseN2kSource`/`friendlySourceLabel`/`formatChannelValue`), `SourcePriorityEditor`, `sensor-definitions.ts`, the bus/bridge/appliance.
