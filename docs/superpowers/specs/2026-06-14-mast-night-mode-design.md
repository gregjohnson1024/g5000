# Manual mast-display night mode (red-on-black)

**Date:** 2026-06-14
**Status:** design (approved in brainstorming)
**Builds on:** the remote-brightness feature (`docs/superpowers/specs/2026-06-14-mast-brightness-control-design.md`) — reuses the same `DisplayConfig` + mast-control SSE + `/mast-config` control pattern. g5000-only; no appliance changes.

## Summary

Add a **manual night-mode toggle** for the mast display: a persisted boolean, settable remotely from g5000, that forces the existing red-on-black `.mast-night` theme on/off — independent of time of day. The `/mast` page already has the red-on-black CSS (`.mast-night`: black bg, red fg, semantic colours collapsed to red for night vision); today it's driven automatically by `isNight()` (sun < −6° civil twilight). This replaces that automatic switch with a manual toggle, because the auto path needs a GPS fix and gives no control at the dock/bench.

Night mode is just a CSS class the browser applies — so unlike brightness (OS backlight, needs an appliance agent), this is entirely g5000: the `/mast` page reads the setting off the mast-control SSE and toggles the class. No appliance changes.

## Goals

- A night-mode toggle in g5000 flips the mast display to red-on-black within ~1 s.
- **Persists** (g5000 ConfigStore = source of truth) across g5000 and unit reboots; replays on SSE reconnect.
- Manual: replaces the automatic sun-driven switch (consistent with brightness being manual-only).
- Reuses the existing `.mast-night` palette — no CSS redesign.

## Non-goals / future

- **Auto sun-driven mode** — removed here (manual-only by choice). `isNight()` stays in `@g5000/mast` as an unused utility, available if an "auto" mode returns later (would XOR with the manual setting).
- **Per-cell colours / graphical cells / rows×columns layout / error-state styling** — separate brainstorms queued; out of scope. (Note: when per-cell colours land, night mode must collapse all of them to red — the existing `.mast-night` already collapses the current palette, and the per-cell-colour spec will extend that.)
- No platform-wide night mode (mast display only).

## Architecture (mirrors brightness)

### State (extend the existing DisplayConfig — no new table)

- `DisplayConfig` currently `{ brightnessPct }` (`packages/db/src/defaults.ts`). Add `nightMode: boolean`, default `false`. The merge-over-defaults load already in ConfigStore picks up the new field; the schema/table is unchanged (same single JSON row).
- `DEFAULT_DISPLAY_CONFIG = { brightnessPct: 80, nightMode: false }`.

### Runtime + SSE

- `MastRuntime` (`packages/mast/src/types.ts`) gains `readonly nightMode$: Observable<boolean>` + `getNightMode(): boolean`.
- `MastService` (`apps/g5000/src/mast/service.ts`) implements them from `configStore.displayConfig$` (`map(c => c.nightMode)`) + `getDisplayConfig().nightMode` — exactly like `brightness$`/`getBrightness`.
- `/api/mast/stream` emits a `nightmode` event (boolean), sent on connect and on change, alongside `layout`/`override`/`brightness`.

### Setter route

- `POST /api/mast/night-mode { nightMode: boolean }` → validate it's a boolean (400 otherwise) → `setDisplayConfig({ ...current, nightMode })` → returns `{ ok: true, nightMode }`. `GET` returns `{ ok: true, nightMode }`. Mirrors `/api/mast/brightness/route.ts`.

### Apply it (the `/mast` page)

- `packages/web/src/hooks/use-mast-control.ts` (already subscribes to `/api/mast/stream`) gains a `nightMode: boolean` field (listens for the `nightmode` event; default false until received).
- `packages/web/src/app/mast/page.tsx`: replace `const night = pos ? isNight(pos.lat, pos.lon, new Date()) : false;` with `const { …, nightMode } = useMastControl();` → `const night = nightMode;`. The `<div className={\`mast-root${night ? ' mast-night' : ''}\`}>`is unchanged. Remove the now-unused`isNight`/`pos`-for-night usage (keep `pos`if still used for anything else; it's also used for nothing else night-related — verify and drop the`isNight` import if fully unused).

### Control UI

- `/mast-config` (which already has the brightness slider): add a **night-mode toggle** (checkbox/switch) next to it. Loads current state via `GET /api/mast/night-mode`; POSTs on change (no debounce needed — it's a discrete toggle).

## Data flow

toggle in g5000 → `POST /api/mast/night-mode` → ConfigStore (persist) → `nightMode$` → SSE `nightmode` event → the kiosk `/mast` page flips `.mast-night` instantly. Persists across reboots; replays on reconnect. No appliance involvement.

## Error handling / edges

- `/mast` page before the first `nightmode` event arrives → defaults to day (false); flips when the event lands on connect.
- Invalid POST (non-boolean) → 400, state unchanged.
- g5000 restart → persisted, replayed on the SSE; the page re-applies on reconnect.
- (Broader display error states — disconnect/stale-data styling — are a separate queued brainstorm, not handled here. The existing "NO DATA — g5000 disconnected" banner is unchanged.)

## Testing

- **ConfigStore (vitest):** `DisplayConfig` round-trip including `nightMode` (default false → set true → reopen → true), mirroring the brightness test.
- **Route (vitest):** `GET` returns `{ ok, nightMode }`; `POST true` persists (GET→true); `POST` rejects non-boolean (e.g. `1`, `"x"`) with 400. Mirrors the brightness route test.
- **SSE:** emits `nightmode` with the current value on connect (covered by tsc + manual; the stream has no unit harness).
- Gates: `npx tsc -b` (exit 0) + `npx vitest run packages/db packages/web/src/app/api/mast`; `cd packages/web && npm run build`. Manual: flip the toggle → `/mast` goes red-on-black instantly; reload → state persists.

## Files

**g5000.** Modify: `packages/db/src/defaults.ts` (add `nightMode` + default), `packages/db/src/config-store.test.ts` (round-trip incl. nightMode), `packages/mast/src/types.ts` (`nightMode$`/`getNightMode`), `apps/g5000/src/mast/service.ts` (wire from `displayConfig$`), `packages/web/src/app/api/mast/stream/route.ts` (emit `nightmode`), `packages/web/src/hooks/use-mast-control.ts` (`nightMode` field), `packages/web/src/app/mast/page.tsx` (apply from setting, drop `isNight`), `packages/web/src/app/mast-config/page.tsx` (toggle). Create: `packages/web/src/app/api/mast/night-mode/route.ts` (+ `route.test.ts`). Unchanged: `mast.css` (reuses `.mast-night`), the appliance.
