# Track annotations + period markers

**Issue:** Standalone feature. Inspired by Hercules race-recording event markers (`docs/design/hercules-feature-notes.md`).
**Status:** Approved, ready for plan.
**Date:** 2026-05-22.

## Summary

Add a floating "drop marker" widget on `/chart` and `/helm` that lets the user tag the current moment with a label (sail changes, manoeuvres, custom text) or open / close a test period. Annotations are persisted inside the active track's JSON file. `/tracks` gains an annotations list and a slice viewer that lets the user see and download the cropped data between any pair of `periodStart` / `periodEnd` markers — for offline analysis.

## Why

Today, recorded tracks under `~/.g5000-router/tracks/<id>.json` are point arrays with no semantic markers — there's no way to say "this is where I hoisted the J3" or "we ran this test for 12 minutes, here's the chunk I want for analysis". The user wants to drop labelled markers in real time and later crop track slices for offline analysis. The Hercules manual codifies the pattern (pre-set quick labels + custom text + event markers embedded in the recording); we're mirroring it scaled to our file-based track model.

## Data model

Extend `packages/web/src/lib/tracks.ts`:

```ts
export interface TrackAnnotation {
  /** Unix ms when the marker was dropped. Server-assigned; immutable. */
  tsMs: number;
  /** Display label — pre-set ("J3", "Tack", "Reef in") or custom free text. */
  label: string;
  /** Discriminator. `event` = single moment. `periodStart` / `periodEnd`
   * come in pairs and define a croppable range. */
  kind: 'event' | 'periodStart' | 'periodEnd';
}

export interface Track extends TrackMeta {
  points: TrackPoint[];
  /** Hand-dropped markers in chronological order. Absent on older files;
   * always read as [] when not present. */
  annotations?: TrackAnnotation[];
}
```

Stored inside the existing track JSON file. Tracks without an `annotations` field read as an empty array — no migration step. Annotations are append-only (no edit/delete in v1).

### Open-period derivation

An "open period" is the most recent `periodStart` annotation in a track that is NOT followed by a `periodEnd`. The dropper widget computes this from the annotations array on each poll/response and uses it to:

- Promote the "End period" button visually (larger, filled, top of the panel).
- Change the collapsed pill label from `+ marker` to `⏺ open period — N min`.

Computed in a pure helper so it's testable:

```ts
export function openPeriodStart(annotations: TrackAnnotation[]): TrackAnnotation | null;
```

Returns the most recent `periodStart` if there is no later `periodEnd`, otherwise `null`.

## Floating widget — `<AnnotationDropper>`

A small pill anchored top-right of the host page. Positioned at `top-2 right-14` on `/chart` to clear the existing `<LayersControl>` NOAA button at `top-2 right-2`. On `/helm` it sits at `top-2 right-2` (no collision).

### Collapsed state
- No active track / no GPS fix: pill is disabled, label `+ marker`, tooltip "No active track — wait for GPS".
- Active track, no open period: pill enabled, label `+ marker`.
- Active track, open period: pill enabled, amber background, label `⏺ open period — 4 min` (where the duration is `now - open.tsMs`, formatted as minutes).

### Expanded state
Click the pill to expand a panel containing five rows of buttons + a custom-text input.

| Row | Buttons | kind |
|---|---|---|
| Manoeuvres | Tack · Gybe · Reef in · Reef out | `event` |
| Main / jib | Main up · Main down · J1 · J2 · J3 | `event` |
| Spinnaker | Spinnaker up · Spinnaker down | `event` |
| Test period | Start period · **End period** (prominent when open period exists) | `periodStart` / `periodEnd` |
| Custom | text input + kind toggle (event / period start / period end) + Add button | as toggled |

When an open period exists, the "End period" button:
- Sits at the TOP of the panel (above the manoeuvre row).
- Renders in amber with bold weight.
- Label includes the elapsed duration: `End period (4 min)`.

Every button POSTs to `/api/tracks/active/annotation` with `{ label, kind }`. Server stamps `tsMs = Date.now()`, appends to the active track, returns the updated annotations list. On success: widget shows a one-second flash (`✓ Marked: J3 at 14:23:07Z`), collapses back, and updates its open-period state from the response.

### Polling for state

On mount and every 30 s, the widget GETs `/api/tracks/active/annotation` to refresh its view of open-period state. After every successful POST, the response is used to update state without a fresh poll. This keeps the open-period indicator accurate when the user toggles between pages (the dropper on `/helm` reflects what the dropper on `/chart` did 30 s ago).

## API

### `GET /api/tracks/active/annotation`

Returns `{ annotations: TrackAnnotation[], trackId: string | null }`. The trackId is null when there's no active track. Lightweight — no points array.

### `POST /api/tracks/active/annotation`

Body: `{ label: string, kind: 'event' | 'periodStart' | 'periodEnd' }`. Validates the body (label non-empty, kind is one of the three literals). Server stamps `tsMs = Date.now()`, appends to the active track, returns `{ annotations: TrackAnnotation[], trackId: string }`. Returns 404 with `{ error: 'no active track' }` if there isn't one.

### `GET /api/tracks/[id]/slice?from=<tsMs>&to=<tsMs>`

Returns `{ points: TrackPoint[], annotations: TrackAnnotation[] }` filtered to the inclusive timestamp range. `from` and `to` are required query params (both Unix ms). 404 if the track doesn't exist. 400 if the params are missing or non-numeric.

No GPX / CSV export endpoint in v1 — the JSON payload is enough for any analysis tool downstream. Easy follow-up to add when needed.

## `/tracks` page changes

For each track, the existing summary row gets an expandable "Annotations" disclosure showing all annotations in chronological order:

- One row per annotation: `<icon> <label> <time-from-track-start>`
  - Icon: `●` for `event`, `▶` for `periodStart`, `■` for `periodEnd`.
- Periods (paired `periodStart` + later `periodEnd`) render with a "View slice (X min, Y points)" link below the period-end row. Click opens an inline panel:
  - Period label, start label, end label, point count, total distance, duration.
  - "Download JSON" button — fetches `/api/tracks/[id]/slice?...` and triggers a browser download of the JSON.
- Unpaired `periodStart` (no `periodEnd` yet) renders with "open period — drop an End period marker to close it".

No editing/deleting from this page in v1.

## File scope

| File | Action |
|---|---|
| `packages/web/src/lib/tracks.ts` | modify — add `TrackAnnotation` type, extend `Track` with optional `annotations`, add `appendAnnotation(id, ann)` helper, add `openPeriodStart(annotations)` pure helper |
| `packages/web/src/lib/tracks.test.ts` | new (or extend existing if any) — test `openPeriodStart` across the obvious cases (empty, only events, single open, paired, two periods one open) |
| `packages/web/src/app/api/tracks/active/annotation/route.ts` | new — GET (lightweight) + POST |
| `packages/web/src/app/api/tracks/active/annotation/route.test.ts` | new — vitest covering POST happy path, POST validation, POST no-active-track, GET both with-track and no-track |
| `packages/web/src/app/api/tracks/[id]/slice/route.ts` | new — GET slice handler |
| `packages/web/src/app/api/tracks/[id]/slice/route.test.ts` | new — vitest covering inclusive bounds, missing params → 400, missing track → 404 |
| `packages/web/src/components/AnnotationDropper.tsx` | new — floating widget |
| `packages/web/src/app/chart/page.tsx` | modify — mount `<AnnotationDropper>` |
| `packages/web/src/app/helm/page.tsx` | modify — mount `<AnnotationDropper>` |
| `packages/web/src/app/tracks/page.tsx` | modify — annotations disclosure + slice viewer |

No new dependencies. No bus channels. No new DB tables.

## Testing

### Automated
- `openPeriodStart` (pure): empty array → null; only events → null; single `periodStart` no end → that one; `periodStart` + `periodEnd` → null; two periods, second open → second one's start; closed period followed by another `periodStart` → that newest start.
- Slice route: from/to inclusive boundaries; from > to → empty arrays; non-numeric params → 400; missing track → 404.
- Annotation POST route: happy path appends and returns updated list; missing body fields → 400; no active track → 404; invalid `kind` → 400.

### Manual
1. Load `/chart`. Confirm the dropper pill renders top-right and doesn't overlap the NOAA button.
2. Click pill → panel expands. Click "Tack" → flash "✓ Marked: Tack at ..." and panel collapses.
3. Click "Start period" → flash; collapsed pill changes to amber "⏺ open period — 0 min".
4. Wait 1+ minutes; pill label updates to "⏺ open period — 1 min".
5. Open the panel again — "End period (1 min)" button is at the top in amber. Click it. Pill returns to normal "+ marker".
6. Use the custom text input to add a free-text event annotation.
7. Navigate to `/helm`. Confirm the dropper renders there too (top-right). State agrees (same open-period status if any).
8. Navigate to `/tracks`. Expand the current track's "Annotations" disclosure. Confirm all dropped markers appear in order with correct icons. Confirm any paired period shows the "View slice" link.
9. Click "View slice" → inline panel shows point count + duration; "Download JSON" triggers a JSON download whose `points` are bounded by the period's timestamps.

## Non-goals

- **Editing or deleting annotations.** Wrong label = drop another one. Easy to add later (`DELETE /api/tracks/[id]/annotation/[tsMs]`).
- **Showing annotation markers on the chart map itself.** Could be useful but adds visual clutter; defer to a follow-up. The /tracks page is where you see them.
- **GPX / CSV export.** Slice JSON is enough for v1. Add when the analysis workflow demands it.
- **Free-floating annotations not tied to a track.** All annotations attach to the current active track at drop time. No active track = no drop.
- **User-configurable preset labels.** The four rows of quick buttons are hard-coded. Move to a config later if users want custom rosters (cruising vs racing labelsets).
- **Auto-detecting open periods from sensor patterns.** Not on the table.

## Risk

Low. Track files are append-only JSON that we already mutate from API routes. The widget is a small client-side state machine. Worst case: the annotations array somehow gets a malformed entry on read — `openPeriodStart` and the page renderer both treat unknown `kind` values as `event` so the UI degrades gracefully rather than crashing.
