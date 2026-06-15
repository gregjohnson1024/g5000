# Mast display: black background + settable daytime base colour

**Date:** 2026-06-14
**Status:** design (approved in brainstorming)
**Builds on:** the night-mode + brightness features (`DisplayConfig` + mast-control SSE + `/mast-config` pattern). g5000-only; browser-applied (no appliance changes).

## Summary

Two coupled changes to the mast display's colour system:
1. **Black background always.** The daytime theme flips from white-bg to black-bg (night mode is already black). Cell **values** use a configurable base colour; **labels/units** stay muted grey.
2. **Settable daytime base colour.** A single global setting `dayBaseColor` (one of 8 high-contrast colours) drives the day-mode value foreground. **Alarm thresholds still override** the base colour per cell when triggered. **Night mode is unchanged** — it still collapses everything to red on black, and the base colour applies only in day mode so it never fights the red.

Per-cell colours are explicitly NOT part of this (considered and dropped).

## The 8 colours

Bright on black; default is `white`:

| name | hex |
|------|-----|
| white | `#ffffff` |
| red | `#ff5555` |
| orange | `#ff9f43` |
| yellow | `#ffd23f` |
| green | `#4ade80` |
| cyan | `#22d3ee` |
| blue | `#60a5fa` (light blue — dark blue is low-contrast on black) |
| magenta | `#e879f9` |

## Architecture (mirrors night mode / brightness)

### State (extend DisplayConfig — no new table)
- `DisplayConfig` gains `dayBaseColor: DayBaseColor`, default `'white'`. Add to `defaults.ts`:
  ```ts
  export const DAY_BASE_COLORS = ['white','red','orange','yellow','green','cyan','blue','magenta'] as const;
  export type DayBaseColor = (typeof DAY_BASE_COLORS)[number];
  ```
  `DEFAULT_DISPLAY_CONFIG.dayBaseColor = 'white'`. Merge-over-defaults gives existing rows `'white'` automatically.

### Runtime + SSE
- `MastRuntime` gains `readonly dayBaseColor$: Observable<DayBaseColor>` + `getDayBaseColor(): DayBaseColor`.
- `MastService` implements them from `configStore.displayConfig$` (`map(c => c.dayBaseColor)`) — like `nightMode$`.
- `/api/mast/stream` emits a `daybasecolor` event (the string name), on connect + on change.

### Setter route
- `POST /api/mast/day-base-color { dayBaseColor }` → validate it's in `DAY_BASE_COLORS` (400 otherwise) → `setDisplayConfig({ ...current, dayBaseColor })` → `{ ok:true, dayBaseColor }`. `GET` returns `{ ok:true, dayBaseColor }`. Mirrors `/api/mast/night-mode`.

### Colour→hex map (shared, presentation)
- A web module (e.g. `packages/web/src/app/mast/colors.ts`) exports `MAST_BASE_COLOR_HEX: Record<DayBaseColor, string>` (the table above), importing `DayBaseColor`/`DAY_BASE_COLORS` from `@g5000/db`. Used by both the `/mast` page and the `/mast-config` picker (single source of truth for the swatch hexes).

### Apply it (`/mast` page)
- `use-mast-control.ts` gains a `dayBaseColor: DayBaseColor` field (listens for `daybasecolor`; default `'white'`).
- `mast/page.tsx`: on the `.mast-root` div, set the value colour via an inline CSS variable **only in day mode**, so night's red always wins:
  ```tsx
  <div className={`mast-root${night ? ' mast-night' : ''}`}
       style={night ? undefined : ({ ['--mast-fg']: MAST_BASE_COLOR_HEX[dayBaseColor] } as React.CSSProperties)}>
  ```
  (Inline style > class, so it must be omitted in night mode; `.mast-night` then drives `--mast-fg: red`.)

### CSS (`mast.css`)
- `.mast-root` (day base): `--mast-bg: #000000` (was `#ffffff`), `--mast-fg: #ffffff` (was dark navy — this is the fallback; the page overrides it with the chosen base colour), and **brighten the threshold colours for black contrast**: `--mast-green: #4ade80`, `--mast-amber: #f59e0b`, `--mast-red: #ef4444`; keep `--mast-muted` readable on black (e.g. `#9ca3af`).
- `.mast-night` block is UNCHANGED (still black bg, `--mast-fg: #ff4d4d`, all semantic → red).

### Control UI (`/mast-config`)
- A day-base-colour picker next to the brightness slider + night toggle: 8 swatches (buttons coloured with `MAST_BASE_COLOR_HEX`, the selected one ringed) or a labelled `<select>`. Loads via `GET /api/mast/day-base-color`; POSTs on change.

## Data flow
picker → `POST /api/mast/day-base-color` → ConfigStore (persist) → `dayBaseColor$` → SSE `daybasecolor` → `/mast` page sets `--mast-fg` (day only) → cell values render in the chosen colour. Thresholds still drive `--mast-green/amber/red` per cell. Night toggle independently flips to red. Persists across reboots; replays on reconnect.

## Error handling / edges
- Page before first `daybasecolor` event → default `'white'`.
- Invalid POST (not one of the 8) → 400, unchanged.
- Night + a base colour both "set": base colour only applied in day (inline style omitted in night), so night red wins — no conflict.
- Thresholds: a triggered threshold cell uses its semantic var (green/amber/red), overriding the base `--mast-fg` for that cell — existing behaviour, preserved.
- DisplayConfig migration: old rows gain `dayBaseColor:'white'` via merge-over-defaults.
- **Kiosk reload after deploy:** page-rendered, so the kiosk must reload to show it after the g5000 deploy (known gotcha; restart the kiosk).

## Testing
- **ConfigStore (vitest):** `DisplayConfig` round-trip including `dayBaseColor` (default white → set e.g. 'green' → reopen → 'green').
- **Route (vitest):** GET returns `{ok, dayBaseColor}`; POST a valid colour round-trips; POST rejects an invalid colour (e.g. `'mauve'`, `42`) with 400. Mirrors the night-mode route test.
- **SSE:** emits `daybasecolor` on connect (tsc + manual).
- Gates: `npx tsc -b` + `npx vitest run packages/db packages/web/src/app/api/mast`; `cd packages/web && npm run build`. Manual: pick a colour → day-mode `/mast` values change to it; black bg in day; night toggle still red; thresholds still alarm-colour.

## Files
**g5000.** Modify: `packages/db/src/defaults.ts` (`DAY_BASE_COLORS`/`DayBaseColor`/`dayBaseColor` + default), `packages/db/src/config-store.test.ts` (round-trip), `packages/mast/src/types.ts` (`dayBaseColor$`/`getDayBaseColor`), `apps/g5000/src/mast/service.ts` (wire from `displayConfig$`), `packages/web/src/app/api/mast/stream/route.ts` (emit `daybasecolor`), `packages/web/src/hooks/use-mast-control.ts` (`dayBaseColor` field), `packages/web/src/app/mast/page.tsx` (inline `--mast-fg`, day only), `packages/web/src/app/mast/mast.css` (black bg + brightened thresholds), `packages/web/src/app/mast-config/page.tsx` (picker). Create: `packages/web/src/app/mast/colors.ts` (hex map), `packages/web/src/app/api/mast/day-base-color/route.ts` (+ `route.test.ts`). Unchanged: `.mast-night` rules, the appliance.
