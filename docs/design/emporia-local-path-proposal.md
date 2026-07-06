# GJ-198 Phase 2 — Offline / Local Emporia Vue 3 Design

> **Status: PROPOSAL (not yet approved / not implemented).** Produced by a research + adversarial-verify + synthesis workflow on 2026-07-06. Read this, then decide whether to proceed to a formal spec → plan → build. The blocking gate is a one-time hardware check on the boat (§5).

## TL;DR

Read the boat's **existing Emporia Vue 3 fully offline** by flashing it with the community **ESPHome `emporia-vue-local` firmware (`@vue3` branch)** and having it publish per-circuit Watts to the **FlashMQ broker already on the boat LAN** (the one g5000 consumes for Victron). Ingest that with a new **local MQTT driver** that feeds the **same `EmporiaRegistry`** the cloud path already populates. `/anchor`'s AC tab and all three `/api/emporia/*` routes **never change**.

Two hard truths gate this:

1. **Stock firmware has no local path.** Emporia officially confirms _no_ Vue product exposes a local API — even on-LAN with internet down. The _only_ offline route is replacing the firmware.
2. **Flashing is destructive to the cloud path.** ESPHome wipes Emporia's firmware, so the unit leaves the app/cloud. Phase 1 (cloud) and Phase 2 (local) are **mutually exclusive on the same physical unit**.

**Recommendation: flash the existing Vue 3 for local-only offshore use.** It is a proven Gen-3 path (not Vue-2-only), reuses the hardware/CTs/panel install already on Sula, and drops into the existing data model. The single real gate is a one-time, fiddly serial-flash you must confirm feasible by opening the case first.

## Adversarial verification of the linchpin claim

**Claim under test:** the Vue 3 _specifically_ can be ESPHome-flashed for offline per-circuit reads (not a Vue-2-only capability).
**Verdict: CONFIRMED (high confidence).** An independent fact-checker did fresh searches, actively hunted for refuting "locked/encrypted Gen-3" reports, and found none.

- **Chip + security (Gen-3 measured, not inferred):** ESP32-D0WD-V3 rev v3.1, 8 MB flash, espefuse dump shows **no flash encryption, no secure boot, bootloader enabled** (emporia-vue-local Discussion #264, Mar 2024). Board also carries a Realtek RTL8201 Ethernet PHY.
- **Success reports (Gen-3):** digiblur flashed a Gen 3 (I2C SDA=GPIO5/SCL=GPIO18 @400 kHz, calibrated per-circuit CTs, Mar 2024 + Mar 2025); the `emporia-vue-local` docs carry a dedicated **"Hardware Preparation (Vue 3)"** section; an explicit `@vue3` YAML exists (16 CT sensors).
- **Still supported mid-2026:** Discussion #409 shows Gen-3 on ESPHome 2026.4.x; a temporary 2026.4.0 OTA/watchdog regression was fixed in 2026.4.1.
- **Every "failure" found is mechanical, not a lock:** missing `flash_size: 8MB` in YAML; post-flash I2C calibration; test-pad conformal coating blocking probe contact (soldering fixed it). In every case the bootloader accepted firmware once electrical contact was made.
- **Residual uncertainty (honest):** no public source ties _Sula's_ specific unit (Cognito pool `us-east-2_ghlOXVLi1`) to the flashed community boards — that identity is inferred from model class. **Opening the case and reading the SoC (§5.1) resolves it.**

## 1. Options weighed

| Option                                     | Per-circuit?                  | Offline? | New HW?           | Cloud kept?      | Effort                              | Verdict                                    |
| ------------------------------------------ | ----------------------------- | -------- | ----------------- | ---------------- | ----------------------------------- | ------------------------------------------ |
| **Flash existing Vue 3 (ESPHome → MQTT)**  | Yes (16 branch + mains)       | Yes      | No                | No (destroys it) | One-time serial flash + calibration | **RECOMMENDED**                            |
| Stock Vue 3 local read                     | —                             | **No**   | —                 | —                | —                                   | **Impossible** (no local API, officially)  |
| Stay cloud-only (accept blank AC offshore) | Yes online only               | No       | No                | Yes              | Zero                                | Do-nothing baseline                        |
| Buy a 2nd Vue 2 to flash                   | Yes                           | Yes      | Yes (+re-run CTs) | Yes (on Vue 3)   | High (redundant HW)                 | Rejected — Vue 3 is equally flashable      |
| Shelly Pro 3EM (no-flash, local MQTT)      | **No** (3 CT, mains/leg only) | Yes      | Yes (parallel)    | Yes (on Vue 3)   | Medium                              | **Fallback** if flash blocked/bricks       |
| IoTaWatt (14 CT, local, 5V DC)             | Yes (14)                      | Yes      | Yes               | Yes              | Medium                              | Fallback; but discontinued — sourcing risk |

**Why not stay cloud-only?** The whole point of GJ-198 is at-sea (no Starlink) visibility. Cloud-only leaves the AC tab dead exactly when it's wanted.

**Why not the Shelly as primary?** It's a clean no-flash local device, but only 3 CTs → mains/leg totals, not the Vue's 16 per-branch circuits. Keep it in reserve for the case where opening the Vue reveals a locked/non-ESP32 board.

## 2. What's true for the Vue **3** specifically (not Vue 2)

The Vue-2-vs-Vue-3 caution is correct for _pin/connector mapping_ but **not for flashability**. Gen-3 differences that matter for the ESPHome config: **I2C SDA=GPIO5 / SCL=GPIO18 @400 kHz**, added Ethernet (RTL8201F PHY), Phoenix-style CT connectors, possibly reordered phase channels. The one real access trend: newer units dropped the programming header, leaving only tiny (sometimes coated) test pads — a _mechanical_ nuisance, not a crypto lock.

## 3. g5000 integration design

### 3.1 The seam (verified in code)

The phase-1 integration is already seam-separated exactly where a local source plugs in (confirmed by reading the files):

- **UI + all three routes read ONLY two globalThis singletons:** `getSharedEmporia()` (an `EmporiaRegistry` → `EmporiaSnapshot`) and `getSharedEmporiaHistory()` (an `EmporiaHistoryFn`), defined in `packages/core/src/emporia-state.ts`. Nothing downstream of `startEmporia()` cares _how_ the snapshot was produced.
- **`startEmporia()` (`apps/g5000/src/emporia/index.ts`)** already branches cloud / sim / offline; every branch `createEmporiaRegistry()` then `setSnapshot`/`setDevices` (+ optional `setSharedEmporiaHistory`), never throws, returns a teardown. **A 4th `local` branch is the minimal change.**
- **`createEmporiaRegistry()`** is idempotent + singleton-backed; `markStale()` only flips `connected:false`.

A local producer that calls `registry.setSnapshot()/setDevices()` is **indistinguishable** from the cloud path to every consumer. **Zero changes** to core types, the routes, or the AC tab.

### 3.2 transform.ts is NOT reused

`transform.ts`'s `usageToWatts`/`deriveSnapshot` exist solely to convert the cloud's **kWh-per-bucket** into instantaneous Watts and to special-case the cloud's `channelNum='1,2,3'`→`mainsW` / `'Balance'`→`balanceW` quirks. ESPHome publishes **instantaneous Watts directly**, so the local mapper builds `EmporiaCircuit{channelNum,name,watts,multiplier}` with **no kWh conversion** and **computes `mainsW` (sum of legs) and `balanceW` itself**. The shared contract is the _output type_ `EmporiaSnapshot`, not `transform.ts`.

### 3.3 Transport: MQTT subscriber cloned from Victron

`packages/bridge/src/victron/mqtt-driver.ts` is the exact skeleton to copy: `mqtt.connect(url, {reconnectPeriod:5000, username, password})`, subscribe on `connect`, `registry.update` on `message`, `markStale()` on close/error, idempotent `stop()`. `mqtt@5` is already a `packages/bridge` dependency and FlashMQ is already proven on this boat. FlashMQ rejects anonymous connects (same caveat already handled for the Cerbo).

### 3.4 File plan

**CREATE:**

- `apps/g5000/src/emporia/local-map.ts` (+ `.test.ts`) — pure, testable Watts-native mapper: `mapLocalToSnapshot(state, now): EmporiaSnapshot`, `mapLocalToDevices(state): EmporiaDevice[]`.
- `apps/g5000/src/emporia/local-driver.ts` (+ `.test.ts`) — `startEmporiaLocalDriver(opts): ()=>void`, MQTT variant mirroring `mqtt-driver.ts`.

**MODIFY:**

- `apps/g5000/src/emporia/index.ts` — add a `local` branch + `EMPORIA_SOURCE` selection.

**NO changes to:** `packages/core` types, the three `/api/emporia/*` routes, the `/anchor` AC tab, `transform.ts`, `registry.ts`, `sim.ts`, `client.ts`.

### 3.5 Env gates + source selection

Keep all existing vars. Add:

- `EMPORIA_SOURCE=cloud|local|auto` (default **auto**)
- `EMPORIA_LOCAL_MQTT_HOST` / `_PORT` / `_USER` / `_PASS` / `_TOPIC_PREFIX`

Boot-time order in `index.ts` (explicit beats auto-detect so a stale local env can't hijack demo):

1. `EMPORIA_SOURCE==='local'` **OR** (`==='auto'` AND `EMPORIA_LOCAL_MQTT_HOST` set) → **local branch**
2. else `EMPORIA_EMAIL`+`EMPORIA_PASSWORD` → **cloud** (existing)
3. else `EMPORIA_SIM`/`DEMO_MODE` → **sim** (existing)
4. else → **offline no-op** (existing)

**Pick ONE source per boot — no runtime cross-fade.** The singleton registry has a single `setSnapshot`; two concurrent producers would race. Seamless cloud↔local failover is a materially larger spec (a registry-ownership wrapper) and is explicitly _out of scope_ for phase 2 — the boot flag covers the real scenario (offshore = local, in-port = cloud, chosen by which env drop-in is active).

### 3.6 History handling

A Watts-native source has **no kWh time-series server**, so the AC-History DAY/WEEK/MONTH tab has no free offline equivalent.

- **Option A (ship first):** install NO history fn in local mode → the AC-History sub-tab shows its existing graceful offline state (the history route already returns `{offline:true},200` when `getSharedEmporiaHistory()` is undefined).
- **Option B (if at-sea history wanted):** add a disk-backed ring buffer under `~/.g5000-router/emporia-history/` that integrates live Watts → kWh buckets and serves an `EmporiaHistoryFn`. Its `channelNum`/`gid` keys MUST match what the local snapshot advertises, or `/api/emporia/history` lookups silently return empty. Must persist across `WatchdogSec` restarts.

Ship **Option A** first.

## 4. Key risks

1. **Cloud/local mutual exclusivity** — flashing is destructive; decide local-only vs. a second stock Vue for in-port.
2. **One-time flash brick risk** — tiny/coated pads; back up factory firmware first (`esptool read-flash 0 ALL`); flash on shore.
3. **Identity gap** — Sula's specific board not web-confirmed; §5.1 resolves.
4. **Calibration + CT crosstalk** — reads hot, 65535 sentinels on empty channels, EMI; local mapper carries the same filters.
5. **Community-firmware fragility offshore** — pin ESPHome + component versions; never OTA at sea (a 2026.4.0 regression already happened).
6. **Channel-identity mismatch** — local ids differ from cloud; matters only if a history buffer is added; mapper must compute mains/balance itself.
7. **Single-producer registry race** — one source per boot, enforced.

## 5. Hardware checks BEFORE we build (blocking)

1. **Open the case, read the SoC** — confirm ESP32-D0WD-V3 (or any ESP32). **The single go/no-go gate.**
2. **Locate RXD/TXD/GND + GPIO0 pads**; check for conformal coating (forces direct soldering).
3. **WiFi vs Ethernet** on the boat LAN (RTL8201F is more robust but disabled in reference configs).
4. **Vue 3 ↔ FlashMQ same LAN + broker auth** (Cerbo GX 192.168.1.129:1883; anonymous rejected).
5. **In-port cloud decision** — keep a second stock Vue, or accept losing the app.
6. **AC power dependency** — Vue is AC-mains-powered (100–240 VAC), dies with the inverter (nothing to meter then anyway); DC-independent metering would argue for IoTaWatt instead.
7. **CT count populated vs 16** — so the mapper covers exactly the live circuits and skips 65535 empties.

## 6. If the honest answer turns out to be "not worth it"

If §5.1 reveals a **locked or non-ESP32** Vue 3 revision, or the flash **bricks** with no easy replacement offshore: **do NOT keep fighting the Vue 3.** Install a **Shelly Pro 3EM** (native local MQTT/HTTP/WebSocket, zero flashing) as a parallel meter and feed the same `EmporiaRegistry` via the same local MQTT driver — accepting 3-CT mains/leg granularity instead of 16 per-branch circuits.

## Phased plan (if we proceed)

- **Phase 0 — Hardware confirmation (BLOCKING, on the boat, before any code):** power down the AC circuit, open the Vue 3 (~5 screws), read the SoC, locate test pads, check for coating. The one true go/no-go. Not an ESP32 / locked → jump to Shelly fallback.
- **Phase 1 — Flash + calibrate (hardware):** back up factory firmware first; flash `emporia-vue-local@vue3` (esp-idf, SDA=5/SCL=18 @400 kHz, 16 CTs, `flash_size:8MB`); verify per-circuit Watts on the bench; add an `mqtt:` block → FlashMQ; apply per-CT multipliers + `abs()`/validity filtering (65535 empties); pin versions.
- **Phase 2 — g5000 local driver (software, drop-in):** create `local-driver.ts` + `local-map.ts` (+ tests); add the `local` branch to `index.ts`. Zero changes to core types / routes / AC tab.
- **Phase 3 — Source selection + env gates:** `EMPORIA_SOURCE` + `EMPORIA_LOCAL_MQTT_*`; boot-time ordered selection; Pi drop-in `emporia-local.conf` mirroring `emporia.conf`.
- **Phase 4 — Offline kWh history (CONDITIONAL):** ship Option A (no offline history) first; add the disk ring buffer only if at-sea history is wanted.
- **Phase 5 — Verify + deploy:** bench-verify Watts in `/anchor`, confirm mains/balance, typecheck/tests/lint, develop → main → Pi rebuild, on-water calibration pass.
