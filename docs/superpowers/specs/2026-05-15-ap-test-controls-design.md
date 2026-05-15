# AP Test Controls — Design

**Date:** 2026-05-15
**Status:** Approved (brainstorming complete; ready for implementation plan)
**Scope:** Augment the existing `/autopilot` page with Mac-only autopilot control buttons that transmit real PGN 130850 commands to the H5000 over the YDWG-02 RAW TCP gateway.

## 1. Context & goal

Today `/autopilot` is a read-only display of mode, target heading, vessel heading, heading error, and commanded rudder. The G5000 has never transmitted on the N2K bus — every existing PGN path is RX-only.

Goal: enable a Mac developer to engage / disengage / nudge the live autopilot from the browser, with safety gates that make accidental TX on the production Pi physically impossible.

This work is a precursor to broader integrated autopilot control (route-driven heading nudges, tack assist, etc.), but those are explicitly out of scope. This spec ships the minimum viable TX path with maximum safety.

## 2. Existing state

- `/autopilot` page (`packages/web/src/app/autopilot/page.tsx`): client-side, channel-driven readouts via `useSse` hook. Footer literally says "Listen-only. The G5000 does not transmit any autopilot commands."
- YDWG-RAW driver (`packages/bridge/src/ydwg-raw-tcp-driver.ts`): has a `txPgn(pgn)` method. Previously threw on fast-packet; now delegates to `encodePgnToCanFrames` (Task 1) which wraps canboatjs's `pgnToYdgwRawFormat` (the correct per-CAN-frame encoder — `pgnToActisenseSerialFormat` returns a single reassembled-payload line, not per-frame).
- Bridge singletons: established `globalThis.__g5000_*__` pattern with paired `setShared*` / `getShared*` getters (see `packages/core/src/alerts.ts:84-95` as the canonical example).
- canboat PGN database (verified during brainstorming): PGN 130850 has 11 variants discriminated by `Proprietary ID` (1=Alarm, 2=Follow-up, 255=AP command). Mode commands use `PropID=255, CommandType=10` with `Event` values 6=Standby, 9=Heading, 10=Nav, 12=NoDrift, 15=Wind, 17=Tack. Course-change uses `Event=26` with undocumented magnitude/direction encoding (needs Triton capture).
- `/sniff` page (just extended): captures PGN 130850 + 130845 frames with marker insertion for keypad-press identification.

## 3. Files manifest

### Create

| File | Purpose |
|---|---|
| `packages/core/src/autopilot-tx.ts` | Defines `AutopilotTx` interface (`sendCommand(req): Promise<{ok, error?}>`) + `setSharedAutopilotTx` / `getSharedAutopilotTx`. Mirrors `alerts.ts` pattern. |
| `packages/bridge/src/tx/fast-packet.ts` | Pure helper `encodePgnToCanFrames(pgn: OutgoingPgn): RawCanFrame[]`. Wraps canboatjs `pgnToYdgwRawFormat`, parses each YDWG-RAW line into a RawCanFrame, asserts frame# strictly ascending. |
| `packages/bridge/src/tx/fast-packet.test.ts` | Unit tests: round-trip for PGN 130850 → 2 ordered frames; single-frame regression for PGN 60928; canboatjs failure throws. |
| `packages/web/src/app/autopilot/control-panel.tsx` | Client component: buttons, confirmation modal, recent-command log. Reads capture-codes via `/api/autopilot/capture-codes`. |
| `packages/web/src/app/api/autopilot/command/route.ts` | POST endpoint. Layer-2 env-var gate, calls `getSharedAutopilotTx().sendCommand(...)`. Single-in-flight serialization. |
| `packages/web/src/app/api/autopilot/capture-codes/route.ts` | GET endpoint returns the contents of `~/.g5000-router/ap-tx-codes.json` (or empty `{captures:{}}` if missing). Used by control-panel to gate increment buttons. |

### Modify

| File | Change |
|---|---|
| `packages/bridge/src/ydwg-raw-tcp-driver.ts` | Rewrite the `lines.length !== 1` branch in `txPgn`: instead of throwing, parse all lines via `encodePgnToCanFrames`, await `txCan(frame)` for each in order. Drop the `frame.data.length > 8` throw (no longer reachable post-split). |
| `packages/bridge/src/ydwg-raw-tcp-driver.test.ts` | Replace the existing "Fast Packet split not implemented" rejection test with a positive test: send PGN 130850 → assert N CAN frames written, each ending `\n`, frame counters strictly ascending. |
| `packages/bridge/src/bridge.ts` | At boot, if `process.env.G5000_ENABLE_AP_TX === '1'`, construct the AutopilotTx implementation (closes over the driver + a serialization mutex) and call `setSharedAutopilotTx(...)`. Otherwise log a one-line disabled message and skip registration. |
| `packages/web/src/app/autopilot/page.tsx` | Convert to a Server Component shell that reads `process.env.G5000_ENABLE_AP_TX`, then renders the existing read-only content (split into a client component) followed by `<ControlPanel />` only when the flag is set. Rewrite the trailing footnote conditionally. |

### No change

`packages/web/src/app/sniff/page.tsx`, `packages/web/src/app/api/sniff/pgn/route.ts` — already extended for 130845 in the same session.

## 4. Architecture

### Data flow

```
Browser /autopilot button click
  → confirmation modal accept
  → POST /api/autopilot/command { event: 'standby' | 'auto' | 'course_+1' | ... }
  → Layer-2 env check (403 if disabled)
  → getSharedAutopilotTx() (503 if not registered)
  → AutopilotTx.sendCommand(req)
     → resolve event → PGN 130850 field-bag (from canboat enum OR ap-tx-codes.json for captures)
     → driver.txPgn({ pgn: 130850, prio: 3, dst: 255, fields })
       → canboatjs encodes → multi-line Actisense text
       → encodePgnToCanFrames() → ordered RawCanFrame[]
       → for each frame: await txCan(frame)
         → "16:XX...\n" line → socket.write()
  → returns { ok: true, txMs }
  → UI logs send + watches autopilot.mode channel for 2 s → records ack or "no ack"
```

### Mac-only gating (three layers)

1. **Bridge boot** (`bridge.ts`): registration of `setSharedAutopilotTx(...)` is wrapped in `if (process.env.G5000_ENABLE_AP_TX === '1')`. On the Pi this is never true; the singleton is `undefined` forever.
2. **API route**: explicit env-var check returns 403 if unset. Catches env-set-but-bridge-not-rebooted edge case.
3. **UI**: page is a Server Component that reads `process.env.G5000_ENABLE_AP_TX` and conditionally renders the control panel. On the Pi the buttons literally don't exist in the rendered HTML.

The Pi's `g5000-autopilot.service` systemd unit does not set `G5000_ENABLE_AP_TX`. The Mac dev start command does. A post-deploy assertion in the deploy procedure checks the Pi service's `Environment` does NOT contain this var.

### Fast Packet TX

NMEA 2000 fast-packet protocol (NOT ISO-TP):

- Each CAN frame is 8 bytes. First byte is the "frame counter byte": top 3 bits = sequence number (constant across one PGN instance), bottom 5 bits = frame index (0, 1, 2, …).
- Frame 0 only: byte 1 = total payload length in bytes; bytes 2–7 carry 6 payload bytes.
- Subsequent frames: bytes 1–7 carry 7 payload bytes each. Last frame pads with 0xFF.

PGN 130850 sub-PGNs (PropID=Autopilot) are 11–14 bytes per canboat, so 2 fast-packet frames each. canboatjs's `pgnToYdgwRawFormat` produces one YDWG-RAW wire-format line per CAN frame, with the NMEA-2000 Fast Packet order byte (top 3 bits = sequence, bottom 5 = frame#) already baked into byte 0. The implementation parses each line into a `RawCanFrame` and emits in order via the existing `txCan` path. No inter-frame delay needed — TCP preserves order to the YDWG, which forwards frame-by-frame to the bus.

Sequence number is managed internally by canboatjs; we trust it but add a regression test that two consecutive sends use different sequence values.

### Capture-codes file

`~/.g5000-router/ap-tx-codes.json`:

```json
{
  "version": 1,
  "captures": {
    "course_+1":  { "propId": 255, "commandType": 10, "event": 26, "direction": "Starboard", "angle_deg": 1 },
    "course_-1":  { "propId": 255, "commandType": 10, "event": 26, "direction": "Port",      "angle_deg": 1 },
    "course_+10": { "propId": 255, "commandType": 10, "event": 26, "direction": "Starboard", "angle_deg": 10 },
    "course_-10": { "propId": 255, "commandType": 10, "event": 26, "direction": "Port",      "angle_deg": 10 }
  }
}
```

Schema is open-ended on purpose — the captured Triton frame may use Direction+Angle, or Event+Direction-with-magnitude-encoded, or something unforeseen. The API route uses whatever fields the JSON provides as the canboatjs PGN field-bag. Hand-edited after capture.

ENABLE / DISABLE buttons do NOT use this file — they hardcode the well-documented canboat events (6 = Standby, 9 = Heading).

## 5. UX

Layout under the existing readouts, only rendered when `G5000_ENABLE_AP_TX=1`:

- Amber warning banner: "Sends real PGN 130850 frames to the live AP. Confirm each press."
- Two-button mode grid: `ENABLE (AUTO)` / `DISABLE (STBY)`.
- Four-button course grid: `−10` / `−1` / `+1` / `+10`. Greyed when capture-codes file lacks the entry; tooltip names the missing key.
- Recent-command log: last 10 sends, format `HH:MM:SS  COMMAND  → <result>`. The "ack" is a heuristic correlation, not a true protocol ack — we watch the existing `autopilot.mode` channel for a state change within a 2 s window. Could be a false positive if someone presses the Triton during the window. Results:
  - `mode→<value> (<ms>)` — channel changed within 2 s
  - `no mode change within 2 s` — sent OK but AP didn't transition (may be intentional, e.g. +1 while in heading mode shifts target without mode change)
  - `TX error: <message>`
  - `bus down — check YDWG` (503 from API)

Every press shows a confirmation modal with command-specific text describing the AP-side effect. No "don't ask again". 500 ms button cooldown after a successful send.

## 6. Safety

| Risk | Mitigation |
|---|---|
| Accidental TX on the Pi | Three-layer gating; Pi's systemd unit has no `G5000_ENABLE_AP_TX`; post-deploy assertion |
| Sending while bus is down (YDWG half-open) | API returns 503 if driver's RX count is zero in last 30 s |
| Interleaved fast-packet sequences | Single-in-flight serialization mutex in `AutopilotTx.sendCommand` |
| Incorrect captured-code clobbers the AP | Capture buttons are disabled until JSON entry exists; user hand-edits with the values they saw at `/sniff`; modal still confirms |
| Unintended retries | API does not auto-retry on `txPgn` failure; error surfaces to user; resend is a deliberate second click |
| User confusion about ack | Recent-command log clearly labels the result as "mode change observed", not a true ack; +1 / −1 / +10 / −10 specifically may show "no mode change within 2 s" even on success because they shift target heading without leaving Heading mode |

## 7. Test plan

### Unit (Vitest, CI)

- `encodePgnToCanFrames`: PGN 130850 round-trip → 2 frames, frame counters [0, 1], byte-1-of-frame-0 = 12.
- Sequence counter: two consecutive `txPgn(PGN 130850)` calls → sequence-bits differ in the order byte.
- Single-frame regression: `txPgn` for PGN 60928 (ISO Address Claim, 8 bytes) still emits exactly one frame.
- Singleton gating: with `G5000_ENABLE_AP_TX` unset, `getSharedAutopilotTx()` after `boot()` is `undefined`; with `='1'`, it's defined.
- API gate: 403 when env unset, 503 when env set but singleton missing, 200 + ack when both present.

### Integration (FakeYdwgSocket, CI)

- Send PGN 130850 → assert N socket.write calls, lines end in `\n`, frame counters strictly ascending.
- API → driver: POST `/api/autopilot/command { event: 'standby' }` → fake socket received 2 frames matching expected canId and encoded fields.

### Manual (on Mac with live YDWG + boat)

- ENABLE → mode badge transitions to "Heading" within 2 s.
- DISABLE → mode badge transitions to "Standby" within 2 s.
- Capture-edit-reload loop for `+1`: press +1 on Triton at `/sniff`, hand-edit JSON, reload `/autopilot`, click `+1`, observe target-heading channel increment by 1°.
- Bus-down: stop the YDWG (pull breaker), click ENABLE within 60 s → API returns 503, log shows "bus down — check YDWG".

## 8. Out of scope

- Increment buttons functioning out-of-the-box (requires Triton capture as a prerequisite).
- TX from the Pi (deliberately gated off; future work if the test app proves stable).
- Wiring the test page's commands into route-following (heading nudges from the planner). Future work.
- Autopilot-state persistence across page reloads.
- Multi-user/multi-tab serialization (Mac-only single-user assumed).
- Recording / replaying captured frames as a development aid.

## 9. Open items needing capture before increment buttons ship

1. The exact PGN/sub-PGN + field-bag emitted by the Triton when pressing each of +1, −1, +10, −10. May be PGN 130850 PropID=255 Event=26 with Direction+Angle, or may be PGN 130845 (Simnet: Key Value) with a Key value, or may be both in a sequence.
2. Whether the H5000 accepts these frames when sourced from `src=254` (J1939 null address, current default in the driver) or whether it requires a known keypad/MFD source address. If the latter, the driver needs a configurable `src` override and we capture the working src from `/sniff`.

Both questions are answered by a 5-minute capture session at the helm; neither blocks implementing the rest of this design.
