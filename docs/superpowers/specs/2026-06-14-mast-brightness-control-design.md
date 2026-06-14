# Remote mast-display brightness control

**Date:** 2026-06-14
**Status:** design (approved in brainstorming)
**Spans two repos:** `g5000` (the control + state + API/SSE/UI — most of the work) and `sula-mast-display` (the appliance agent that applies it to the panel hardware). This spec lives in g5000 because the substantial, testable engineering is here; the appliance files live in `/Users/gregjohnson/code/sula-mast-display/appliance/`.

## Summary

Let the mast-display panel's screen brightness be set **remotely from g5000**. g5000 holds a single, persisted brightness value (0–100 %), exposes a slider to set it, and broadcasts it on the existing mast-control SSE. A small agent on the Chipsee unit applies it to the panel's PWM backlight, and also dims the **boot splash** to the last-set level (so a night-time reboot doesn't blind anyone). Manual-only: the existing sun-based auto-dimmer is removed.

The mast display browser **cannot** write the backlight (`/sys/class/backlight/pwm-backlight/brightness` is an OS node), so the value is applied by an OS-level appliance agent, not the kiosk page. The `/mast` page itself does not change.

## Goals

- A brightness slider in g5000 sets the panel brightness within ~1 s.
- The setting **persists** (g5000 ConfigStore = source of truth) across g5000 and unit reboots.
- The **boot/splash screen** comes up at the last-set brightness (locally cached on the unit, since there's no network that early).
- Manual-only: remove the sun-based auto-dimmer so nothing fights the setting.
- The brightness setter is **source-agnostic** so an N2K input can drive it later with no redesign.

## Non-goals / future extensions

- **N2K dimming (future).** NMEA 2000 display dimming is largely manufacturer-proprietary (B&G/Navico use their own "display group" PGNs; not a universal standard). Future work: decode the B&G dimming PGN in `@g5000/bridge` (sniff the real network via `/sniff` to identify it) and call the same `setBrightness` setter so the mast display follows the boat's master dim; later, optionally **transmit** the PGN from g5000 to sync the B&G displays (needs loop-prevention via a `source` tag on the setter). Out of scope now; the single-source-of-truth state makes it cheap later.
- **Auto day/night dimming** — removed in this build (manual-only by request). Could return later as a mode that drives the same setter.
- **Per-display brightness** — one unit now; brightness is a single global value. Per-display is a later refinement.

## Verified hardware facts (the live unit)

- Backlight: `/sys/class/backlight/pwm-backlight/brightness`, `max_brightness=99`, node writable by group `video` (the kiosk `pi` user can write it without sudo). PWM overlay `dtoverlay=pwm-backlight,pin=18`.
- The boat g5000 is reachable from the unit at `https://g5000.sulabassana.net/api/mast/stream` (Cloudflare, HTTPS/HTTP2) — confirmed the SSE works from the unit.
- An existing auto-dimmer (`backlight-sync.sh` + `mast-backlight.timer`) is installed on the unit — to be removed.

## Architecture

### g5000 side (control + source of truth)

Mirrors the existing mast-control plumbing (the `override`/`active-page` pattern), with brightness **persisted** like `TideConfig` (override is transient; brightness must survive reboots).

- **ConfigStore** (`packages/db/src/config-store.ts` + `defaults.ts`): add a persisted `DisplayConfig { brightnessPct: number }` (0–100, default 80) following the `TideConfig` single-row pattern — table, `BehaviorSubject`, `getDisplayConfig()`/`setDisplayConfig()`, `displayConfig$`, merge-over-defaults on load.
- **MastService** (`apps/g5000/src/mast/service.ts` + `MastRuntime` in `packages/mast/src/types.ts`): expose `brightness$: Observable<number>` (0–100) sourced from `configStore.displayConfig$` (map to `brightnessPct`), plus `getBrightness()`. (No transient subject — ConfigStore is the source, so it replays the current value to new SSE subscribers and persists.)
- **SSE** (`packages/web/src/app/api/mast/stream/route.ts`): emit a third named event `brightness` (the integer percent) alongside `layout`/`override`, replayed on every connect (so the agent gets the current value immediately on connect/reconnect).
- **Setter route** (`packages/web/src/app/api/mast/brightness/route.ts`, new): `POST { brightnessPct }` → validate integer 0–100 → `store.setDisplayConfig({ ...cfg, brightnessPct })` → `displayConfig$` emits → SSE re-broadcasts. Mirrors `active-page/route.ts`. Optional `GET` returns the current value.
- **UI** (`packages/web/src/app/mast-config/page.tsx`): a brightness **slider** (0–100 %) showing the current value, POSTing to `/api/mast/brightness` on change (debounced). g5000 stays hardware-agnostic — it only deals in a percentage.
- **No change** to `use-mast-control.ts` or the `/mast` page — the page doesn't apply brightness; only the appliance agent consumes the new SSE event.

### Appliance side (`sula-mast-display` repo, applies it to hardware)

- **`appliance/brightness-agent.sh`** + **`appliance/mast-brightness.service`** (new, systemd, `Restart=always`): a `curl -N` client streaming `${MAST_URL%/mast}/api/mast/stream` (i.e. `https://g5000.sulabassana.net/api/mast/stream`), parsing the SSE for `event: brightness` / `data: <pct>`. On each value:
  1. read `max_brightness` from sysfs (hardware-agnostic), map `raw = round(pct/100 × max)`, enforce a **floor** `MAST_BACKLIGHT_MIN` (default 2 of 99) so it can never go fully black;
  2. write `raw` to `/sys/class/backlight/pwm-backlight/brightness`;
  3. atomically cache `raw` to `/var/lib/mast-display/brightness`.
  On SSE drop, `curl` exits → systemd restarts → reconnects (replays current value).
- **`appliance/brightness-boot.sh`** + **`appliance/mast-brightness-boot.service`** (new, early oneshot, `DefaultDependencies=no`, ordered as early as possible — before the splash settles, `WantedBy=sysinit.target`): read the cached raw value (or a safe default 80 %→raw if absent) and write it to the backlight, so the boot/splash comes up dim. The backlight node exists early (kernel DT overlay); exact ordering tuned on the unit.
- **`provision.sh`**: install the two new services + scripts, create `/var/lib/mast-display`, enable both; **remove the auto-dimmer** (`systemctl disable --now mast-backlight.timer`; delete `backlight-sync.sh`, `mast-backlight.{service,timer}`).

## Data flow

```
g5000 slider → POST /api/mast/brightness → ConfigStore.setDisplayConfig (persist)
            → displayConfig$ emits → /api/mast/stream "brightness" event
            → appliance brightness-agent → map %→raw(+floor) → write sysfs
                                          → cache raw to /var/lib/mast-display/brightness
unit boot   → mast-brightness-boot (early) → write cached raw → dim splash
            → (network up) → agent connects → re-syncs to g5000's current value (authoritative)
```

## Range, mapping, defaults

- g5000 value: integer **percent 0–100**, default **80**. UI slider 0–100.
- Appliance mapping: `raw = max(MAST_BACKLIGHT_MIN, round(pct/100 × max_brightness))`, `max_brightness` read live (99), `MAST_BACKLIGHT_MIN` default **2** (never fully black). Factored into a tiny pure helper so it's unit-testable standalone.

## Error handling / edge cases

- Agent can't reach g5000 (boot window, outage): panel stays at the cached/last brightness (boot service set it); agent retries until the SSE connects. No blackout (floor enforced).
- No cache yet (first-ever boot): boot service applies the default (80 %).
- Invalid POST (`brightnessPct` not an int 0–100): 400, state unchanged.
- `max_brightness` read fresh each apply → works if a different panel is swapped in.
- g5000 restart: brightness persisted in ConfigStore, replayed on the SSE; agent re-applies on reconnect.

## Testing

- **g5000 (vitest, pure + route):** `DisplayConfig` clamp/validation (reject <0, >100, non-int; default 80); ConfigStore `getDisplayConfig`/`setDisplayConfig` round-trip + merge-over-defaults (mirror the TideConfig tests); `POST /api/mast/brightness` validation + persist + `{ok}` (mirror tide-pin route tests); the SSE emits `brightness` with the current value on connect. Whole-workspace `tsc -b` + `vitest run`.
- **Appliance:** the **%→raw mapping+floor** as a tiny pure function tested standalone (e.g. `bash` with sample inputs, or extracted so it can be checked); `bash -n` on the scripts; `systemd-analyze verify` on the units where available. Manual end-to-end on the real unit: move the g5000 slider → panel dims within ~1 s; set low, reboot → splash comes up dim; pull g5000 power → panel holds last brightness.

## Files

**g5000 (create):** `packages/web/src/app/api/mast/brightness/route.ts`. **Modify:** `packages/db/src/defaults.ts` (`DisplayConfig` + default), `packages/db/src/config-store.ts` (table + subject + get/set + `displayConfig$`), `packages/mast/src/types.ts` (`MastRuntime.brightness$`/`getBrightness`), `apps/g5000/src/mast/service.ts` (wire `brightness$` from `displayConfig$`), `packages/web/src/app/api/mast/stream/route.ts` (emit `brightness`), `packages/web/src/app/mast-config/page.tsx` (slider). **Unchanged:** `use-mast-control.ts`, the `/mast` page.

**sula-mast-display (create):** `appliance/brightness-agent.sh`, `appliance/mast-brightness.service`, `appliance/brightness-boot.sh`, `appliance/mast-brightness-boot.service`. **Modify:** `appliance/provision.sh` (install new services, remove auto-dimmer), `appliance/README.md`. **Delete:** `appliance/backlight-sync.sh`, `appliance/mast-backlight.service`, `appliance/mast-backlight.timer`.
