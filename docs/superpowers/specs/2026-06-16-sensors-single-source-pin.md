# `/sensors`: pin a single source per channel (replace priority editor)

**Date:** 2026-06-16
**Status:** design (approved in brainstorming)
**Scope:** g5000 web only (`packages/web`). No backend, config-store, schema, API, selector, bus, or appliance changes.

## Problem

A channel with two broadcasters (e.g. `boat.heading.magnetic` from `0x11` and `0x80`) currently shows whichever updated most recently (last-write-wins), so the value flaps between sources. The existing fix — an ordered **priority** rule with a freshness window and automatic failover — is the wrong model: the user does not want silent failover to a possibly-bad sensor. They want to **pick exactly one source** for a channel; if it stops, the value should freeze (a visible signal) rather than switch.

The current control (`SourcePriorityEditor`) is also collapsed in a `<details>` at the bottom of each card, far from the values, with reorder arrows and a freshness slider that this model doesn't need.

## Goals

- Per channel, choose **one source** (radio) or **Auto**. A pinned source is the *only* one the whole app uses for that channel — no failover.
- The control sits **inline with the per-source values**, **always expanded**.
- Reuse the existing arbitration machinery unchanged (a "pin" is a one-entry priority rule, which the selector already treats as "use only this source, never fail over").

## Non-goals

- No "None / blank the channel" state (dropped in brainstorming in favour of an explicit Auto row).
- No automatic failover, no freshness window, no reorder UI, no `blocked` list in the UI.
- No backend changes: `@g5000/core` selector, `@g5000/db` config-store/schema, and `/api/config/source-priority` are untouched. The config remains `SourcePriorityRule[]`.

## Model — three observations

1. **Pin** = a `SourcePriorityRule` with `sources: [chosenTag]`. The selector (`subscribeSelected`/`pickWinner`) drops every non-listed source and, with a single source, never fails over — so a one-entry rule already means "use only this source." A source always wins its own freshly-arrived sample, so `freshnessSeconds` is irrelevant here; it's stored as a constant (`PIN_FRESHNESS_SECONDS = 5`) to satisfy the API's positive-finite check and never shown.
2. **Auto** = no rule for the channel (delete it) → last-write-wins, the current default.
3. A pre-existing multi-source rule (e.g. the user's `[0x80, 0x11]`) reads as **pinned to its first source** (`sources[0]`) and normalises to a clean one-entry rule on the next pin. No migration script needed.

## UI (`SensorCard`)

For each of a card's channels, under the headline value, render an always-expanded radio group:

```
boat.heading.magnetic                 359°
  ( ) Auto — most recent
  (•) ZG100 Compass (0x80)         359°  0.0s
  ( ) Precision-9 Compass (0x11)   264°  0.0s
```

- **Rows** = `Auto` + the union of (sources currently observed for the channel) and (the pinned source, if any). Including the pinned source even when it is stale/unobserved keeps it visible and selectable; a pinned-but-stale source renders with `—` for its value.
- Each row is a radio (`name` = the channel, so the group is mutually exclusive). `Auto` checked when no rule; the pinned source's row checked otherwise.
- Selecting a source → write a one-entry rule via `onSaveRules`. Selecting `Auto` → delete the rule. (Native radios fire `onChange` on selection; no custom toggle needed since `Auto` provides the un-pin path.)
- Device names come from the existing `deviceLabel(source, devices)`; values from `formatChannelValue`; ordering from `groupSourcesByChannel`.

**Headline value per channel:** Auto → freshest observed (current behaviour); pinned → the pinned source's observed value, or `—` if the pinned source isn't currently observed (frozen/stale). This makes a pin visibly take effect on the card.

The collapsed **"Source priorities" `<details>` and the `SourcePriorityEditor` component are removed.**

## Components / files

**New (pure, tested):** `packages/web/src/lib/source-pin.ts` (+ `.test.ts`):
- `pinnedSourceForChannel(rules: SourcePriorityRule[], channel: string): string | null` — the pinned source tag (`sources[0]` of the first rule whose `channelPattern === channel`), or `null` for Auto.
- `setPinnedSource(rules: SourcePriorityRule[], channel: string, source: string | null): SourcePriorityRule[]` — `source` → replace/add a one-entry rule `{ channelPattern: channel, sources: [source], freshnessSeconds: PIN_FRESHNESS_SECONDS }`; `null` → remove any rule for the channel. Returns a new array; other channels' rules pass through unchanged.

**Modify:**
- `packages/web/src/app/sensors/SensorCard.tsx` — render the radio group; compute pinned source + headline; remove the editor `<details>`. Gains no new props (it already receives `rules`, `onSaveRules`, `devices`, `observed`).
- `packages/web/src/app/sensors/page.tsx` — stop rendering `SourcePriorityEditor`; keep passing `rules`/`onSaveRules` to the card. Update the type import (see relocation).

**Type relocation + delete:**
- `ObservedEntry` and the local `SourcePriorityRule` interface currently live in `SourcePriorityEditor.tsx` and are imported by `page.tsx`, `SensorCard.tsx`, and `group-sources.ts`. Move `ObservedEntry` into a new `packages/web/src/app/sensors/sensors-types.ts`; import `SourcePriorityRule` from `@g5000/core` (the canonical definition) everywhere it's needed. Then **delete `SourcePriorityEditor.tsx`** (and its test, if any).

**Unchanged / reused:** `@g5000/core` selector (`subscribeSelected`, `pickWinner`), `@g5000/db` config-store/schema/`DEFAULT_SOURCE_PRIORITY`, `/api/config/source-priority` (GET/PUT), `/api/sources/observed`, `/api/devices`, `deviceLabel`, `groupSourcesByChannel`, `formatChannelValue`, the bus, the appliance.

## Error handling / edges

- Pinned source goes stale (absent from the 5 s observed window) → still listed (from the rule) with value `—`; headline `—`; freshness dot reflects staleness. No failover.
- Legacy multi-source rule → read as pinned-to-`sources[0]`; normalised on next change.
- `onSaveRules` failure → existing error path on `/sensors` (rules error banner) surfaces it.
- A channel with no observed sources and no rule → `Auto` row only (today's "No source observed." case).

## Testing

- `source-pin.test.ts`: pin a source (adds one-entry rule); switch source (replaces); set Auto (removes rule); `pinnedSourceForChannel` returns `null` for Auto, `sources[0]` for a one-entry rule and for a legacy multi-source rule; other channels' rules untouched by `setPinnedSource`.
- No React-component tests (repo convention).
- Gates: `npx tsc -b` (exit 0); `npx vitest run packages/web/src/lib packages/web/src/app/sensors` (run from repo root); `cd packages/web && npm run build` (`/sensors` in manifest).
- Manual: on `/sensors`, pin `0x80` for `boat.heading.magnetic` → headline locks to 0x80's value and the app uses only 0x80 (no flap to 0x11); set Auto → reverts to most-recent.
