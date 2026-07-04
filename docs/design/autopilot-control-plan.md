# Autopilot Control Plan — proper N2K / Ethernet pilot command

Last updated: 2026-07-03 (Sula on the hard, Newport — N2K bus unpowered).

> **Evidence tiers** (same convention as `docs/ops/network-map.md`):
>
> - **Verified** — read directly in this repo's code, tested against real
>   hardware, or reproduced from a primary source (canboat / signalk decoders).
> - **Reported** — a third party (Orca, forum, comment, commit message) claims
>   it, but we have not reproduced it against _our_ hardware.
> - **Unidentified** — not yet determined; do not build load-bearing logic on it.
>
> Do not upgrade a tier without new evidence. In particular, nothing below is
> Verified _against Sula's H5000 Pilot_ — the pilot has never been commanded
> over any channel by g5000.

## Boat context

Sula carries a **B&G H5000 CPU** + **Triton² keypad/displays** + **Precision-9
compass** on NMEA 2000, plus a **B&G autopilot computer driven by the H5000**
("the pilot" below). g5000 reaches the bus through two gateways:

- **NGT-1** (USB serial, Actisense) — g5000's **TX** path (`Ngt1Driver.txPgn`).
- **YDWG-02** (`192.168.1.100:1457`, YD-RAW TCP) — g5000's **RX** path.

The H5000 CPU also exposes an **Ethernet data WebSocket** on
`ws://<h5000>:2053` (Verified — `docs/ops/network-map.md` lists `192.168.0.2`
port `2053` "H5000 WebSocket data feed"; commit `27236e6` connected to
`ws://10.10.10.208:2053` from a laptop). B&G's own H5000 mobile app steers the
pilot over this WiFi/Ethernet link.

---

## 1. Why the old (parked) N2K approach failed

The parked attempt lives in `packages/bridge/src/autopilot-tx-impl.ts`,
`packages/bridge/src/autopilot-commands.ts`, and the fast-packet encoder
`packages/bridge/src/tx/fast-packet.ts`, exposed through
`POST /api/autopilot/command`. It transmits **PGN 130850** (Simnet AP command)
and the H5000 rejected it. Three concrete reasons, all Verified from the code:

1. **Spoofed source address 254, no ISO address claim.** The encoder hardcodes
   `src: 254` — the J1939 "null address" — for every frame
   (`fast-packet.ts:37`). Its own comment is explicit: _"src defaults to 254 …
   the g5000 has not claimed an N2K address."_ The `OutgoingPgn` contract
   (`wire-driver.ts:38`) has no `src` field at all, so there is currently no way
   to transmit from a real claimed address. A device that has never sent a
   **PGN 60928 ISO Address Claim** is not a bus citizen; Simnet pilots (and the
   AC42/H5000 family especially — see §2) ignore commands from strangers.

2. **Broadcast, not addressed to the pilot.** The command is sent with
   `dst: 255` (broadcast — `autopilot-tx-impl.ts:44`) and an in-payload
   `Address: 0` field (`autopilot-commands.ts:42`). Verified pilot behaviour
   (§2) is that **broadcast AP commands are not acknowledged or actioned** — the
   in-payload address byte must be the _pilot's own source address_.

3. **No standing "device" presence.** Beyond the missing claim, g5000 sends no
   product info (126996), no NAME, and no keep-alive — so even if a single frame
   were parsed, the pilot has no bound controller to accept mode changes from.

Net: the parked path is a well-gated way to _emit_ a 130850 frame, but it emits
it as an anonymous, broadcast, unclaimed stranger — the three things a Simnet
pilot is designed to reject.

**What is worth keeping:** the three-layer safety gate (§4), the command→field
resolver, the single-in-flight serialization, and the `/autopilot` UI. The wire
addressing is what has to change.

---

## 2. Two candidate command paths

### Path A — N2K Simnet 130850 event commands (from a properly-claimed, pilot-addressed source)

The command protocol itself is **Verified** — tested on the Navico **NAC-3**
pilot per canboat / signalk decoders and Orca's published integration. What is
**not** verified is that Sula's **H5000-era pilot** accepts it (see the caveat).

**Command PGN 130850** "Simnet: Event Command: AP command". Frame payload shape:

```
41 9F <ap-addr> FF FF 0A <event> 00 …
```

where `<ap-addr>` is the **pilot's own source address** (the byte the parked
code sets to `0x00`).

**Event codes** (Verified against NAC-3 per canboat/signalk):

| Event | Meaning       | Notes                                                                                                   |
| ----: | ------------- | ------------------------------------------------------------------------------------------------------- |
|     6 | Standby       |                                                                                                         |
|     9 | Auto          | heading hold                                                                                            |
|    10 | Nav           | **Zeus sends it twice**                                                                                 |
|    12 | NoDrift       |                                                                                                         |
|    15 | Wind          |                                                                                                         |
|    17 | Tack          | exists in the enum but **untested** in sources — treat as Reported                                      |
|    26 | Change course | payload adds a Direction byte (`2`=port, `3`=stbd) + u16 angle in **radians × 1e-4** (175≈1°, 1745≈10°) |

**Addressing (Verified, critical):** the in-payload address byte MUST be the
pilot's source address. **Broadcast (`0xFF`) commands are NOT acknowledged or
actioned.** An _addressed_ command yields a byte-for-byte **PGN 130851** (or 130850) **ECHO within ~20–70 ms** — that echo **is** the ack. This gives us a
clean, cheap "did it land?" signal for the state machine (§4).

**Nav-mode acceptance (Verified on NAC-3):** for the pilot to _stay in_ Nav
mode, the commanding device must **continuously transmit 129283 (XTE) + 129284
(Navigation Data)**, and its ISO address claim (60928) must present **Device
Class 50 / Function 130 ("Navigator")** so the pilot accepts it as the nav
source. Without this, Nav is refused or silently drops.

**Keep-alive (Verified):** Zeus heads transmit **PGN 65305 at 1 Hz**; some
pilots drop to Standby without a controller keep-alive. Our controller must
maintain the same heartbeat once engaged.

> **CRITICAL CAVEAT (Reported).** The **AC42 computer** — the H5000 Pilot's
> WS-era sibling — **ignores 130850 from _unknown_ source addresses**. The
> observed workaround is to transmit from the source address of an
> already-known / bound device; **the binding mechanism is Unidentified.**
> There is **no public report of anyone commanding an H5000 Pilot specifically
> over N2K.** Therefore: **treat H5000-pilot N2K command acceptance as
> Unidentified**, even after we become a proper bus citizen. Orca's documented
> success is with **NAC-1/NAC-2/NAC-3-generation** Navico pilots; it proves the
> _protocol_ and the _addressing rule_, and it proves those pilots accept a
> well-behaved controller — it does **not** prove the older WS-era
> H5000/AC42 pilot will, given the AC42 "unknown source" behaviour above.

### Path B — H5000 Ethernet WebSocket (`ws://<h5000>:2053`)

**What is Verified about this endpoint:**

- The endpoint exists and serves live data. Commit `27236e6` connected to
  `ws://10.10.10.208:2053` from a laptop and read `targetTwa`, `targetSpeed`,
  `polarPerformance`, `vmgPerformance`, `leeway`, `optimumWindAngle`, and the
  per-item `valid` flags — the values matched g5000's N2K-derived decode
  exactly. `docs/ops/network-map.md` records the same port on `192.168.0.2`.
- **This repo has NO persistent WebSocket client for the H5000.** The `2053`
  feed was consulted **once, manually, as a validation oracle** — the numbers
  were pasted into the commit message, not read by any shipped code. The bridge
  gets the same H5000 performance data (PGN 130824) over **N2K** via the YDWG,
  decoded in `packages/bridge/src/bandg-perf.ts`. The only WebSocket clients in
  the tree are the radar (mayara) ones. So Path B is, today, **greenfield**:
  there is no read client to extend into a write client.

**What is Unidentified about this endpoint:**

- **The write/command protocol.** B&G's own H5000 app steers the pilot over
  WiFi/Ethernet, which _implies_ this WebSocket (or a sibling endpoint on the
  CPU) carries a writable command channel. But we have **not** proven the
  message shape, the auth/handshake, or even that steering rides `:2053` versus
  another port. **Do not assume Path B is writable until captured** (a WiFi
  packet capture of the B&G app steering the pilot — §5).

**What Orca's success does and does NOT prove here:** Orca integrates over
**N2K** (Path A), not this WebSocket. Its success says nothing about the H5000
Ethernet write protocol. Path B's only current evidence is "the vendor app does
it," which locates a channel but not a protocol.

### Head-to-head

|                        | Path A — N2K 130850                             | Path B — H5000 WebSocket                       |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Protocol known         | **Verified** (NAC-3)                            | **Unidentified** (write side)                  |
| H5000-pilot acceptance | **Unidentified** (AC42 "unknown source" caveat) | **Unidentified**                               |
| Repo scaffolding today | Substantial (gate, resolver, UI, TX path)       | **None** (no ws client)                        |
| Ack signal             | **Verified** — 130851/130850 echo in 20–70 ms   | Unidentified                                   |
| Same failure mode      | may be silently ignored by the H5000 pilot      | may require app-level auth we haven't captured |

---

## 3. Proper N2K citizenship plan (prerequisite for Path A)

Before _any_ command experiment, g5000's NGT-1 TX path must become a real bus
device. All of this is new work on `packages/bridge`:

1. **ISO Address Claim — PGN 60928.** On bridge start (when AP TX is enabled),
   pick a source address, transmit a 60928 claim, and run the standard J1939
   claim contention (back off / re-pick on a competing claim for the same
   address). The claimed **NAME** must present:
   - **Device Class 50 (Navigation)** / **Function 130 (Navigator)** — required
     for the pilot to accept us as a nav source (§2, Nav mode).
   - a unique Unique-Number + our manufacturer code, so the address is stable
     across reboots.
2. **Product Information — PGN 126996** and **Configuration Information 126998**
   on request, so other devices (and the pilot) can enumerate us as a normal
   product rather than a phantom.
3. **Respond to ISO Request (59904)** for 60928 / 126996 — chartplotters and the
   pilot will poll us; silence looks like a dead address.
4. **Transmit from the claimed source address, not 254.** The encoder
   (`tx/fast-packet.ts`) and `OutgoingPgn` (`wire-driver.ts`) must gain a
   configurable `src`; the claimed address flows from the claim state machine
   into every AP frame. This is the single change that turns "stranger" into
   "citizen."
5. **Address the pilot, not broadcast.** Discover the pilot's source address
   (from its own 60928 / product info on the bus, matched by Device
   Function = Autopilot), and set the in-payload address byte + `dst` to it.
6. **1 Hz keep-alive (PGN 65305)** once a mode is engaged, matching Zeus
   behaviour, so the pilot doesn't fall back to Standby.
7. **Nav-source registration:** while Nav mode is (or is about to be) engaged,
   continuously transmit **129283 (XTE)** + **129284 (Navigation Data)** derived
   from g5000's active route/waypoint. Without this, Nav is refused.

Only after steps 1–3 land can we even test whether the H5000 pilot _sees_ us as
a device — which is the first bench experiment in §5, and the gate on everything
after it.

---

## 4. Safety architecture

Keep the **existing three-layer gate** (Verified in
`api/autopilot/command/route.ts` and `autopilot-tx-impl.ts`) and extend it:

1. **Env gate** — `G5000_ENABLE_AP_TX === '1'` or the route returns **403**.
   The Pi's `g5000-autopilot.service` never sets this (research/bench only).
2. **Registration gate** — the shared `AutopilotTx` singleton must be registered
   by the bridge at boot, or the route returns **503**.
3. **Resolver/driver gate** — an unknown or unresolvable command returns
   `ok:false` without touching the bus.

Add, on top:

4. **>30° turn requires user approval (per Orca's model).** Mode changes and
   small nudges may execute directly; any commanded course change beyond ~30°
   requires an explicit user approval that can be **pre-granted ~15 minutes
   ahead** (so a planned gybe/tack at a waypoint isn't a scramble). Approvals
   expire; an expired approval falls back to "ask again."
5. **Command state machine.** Track pilot state (`standby | auto | nav | wind |
nodrift`) and a pending-command state. Every addressed command **waits for
   the 130851/130850 echo ack** (§2, 20–70 ms). No echo within a small timeout →
   mark the command failed, surface it, and **do not** escalate (never re-send a
   heading change on a silent bus).
6. **Dead-man / keep-alive timeout → Standby.** The controller must prove
   liveness: if the 1 Hz keep-alive loop stalls, or the operator's UI heartbeat
   stops, or the event loop is starved (the systemd watchdog already SIGKILLs on
   this), the design intent is that the pilot **reverts to Standby** rather than
   holding a stale course. Because the pilot itself drops to Standby without
   keep-alive (§2), _stopping_ our keep-alive is the safe default — but we should
   also send an explicit Standby (event 6) on controlled shutdown.
7. **Standby is always one action away** in the UI, and is the only command that
   is never gated behind approval.

---

## 5. Staged bench-test plan (next time Sula's N2K bus is powered)

Sula is on the hard in Newport; the bus is unpowered. When it is next live, run
these **in order**, and do not advance a stage until the prior stage's expected
observation is met.

### 5a. Passive sniff (read-only — do this first, TX disabled)

With `G5000_ENABLE_AP_TX` **unset**, capture the bus (YDWG RX / session logger)
while a human operates the pilot, and diff the two operating methods:

- [ ] **Press the pilot keypad / Triton² buttons** (Standby → Auto → +1° → +10°
      → Standby). Capture. Look specifically for **PGN 130850 event commands**
      and the **130851/130850 echo** — record the pilot's **source address**,
      the exact event bytes for each key, and the echo latency.
- [ ] **Steer via the B&G H5000 WiFi app** (same sequence). Capture **both** the
      N2K bus (is the app's command reflected as 130850 on N2K, or does it stay
      on Ethernet?) **and**, if possible, a WiFi packet capture of the app↔CPU
      `:2053` (or other port) traffic — this is the only way to learn Path B's
      write protocol.
- [ ] **Diff keypad vs app.** If the app's steering appears on N2K as 130850,
      Path A is strongly in play and we've learned the pilot's address for free.
      If it does **not** appear on N2K, the pilot is likely commanded over
      Ethernet only, and Path B (WebSocket capture) becomes the primary lead.
- [ ] Record the pilot's **source address** and the addresses of every device
      that echoes/acks, plus any 1 Hz keep-alive (65305) traffic.

**Expected observation:** at least one 130850 frame per keypad action, each
followed by a 130851/130850 echo. **Abort/branch criteria:** if keypad actions
produce _no_ 130850 on N2K, Path A over N2K is likely a dead end for this pilot
— pivot to Path B.

### 5b. Escalating TX experiments (TX enabled, one rung at a time)

Only with a spotter at the helm, engine available, and sea-room (or, ideally,
first at the dock with the drive clutch **disengaged** so the pilot can't move
the rudder). Each rung has an expected observation and an abort criterion; stop
at the first failure and diagnose before proceeding.

1. **Claim + presence.** Enable §3 steps 1–3 only (no AP commands). Observe
   whether the pilot / chartplotters enumerate g5000 as a device (it should
   answer ISO requests and appear in the bus device list).
   _Expected:_ g5000 shows up as a Navigator device; no address contention.
   _Abort if:_ our claim is contested and can't settle, or nothing on the bus
   acknowledges us — fix citizenship before any command.
2. **Addressed Standby echo test.** Send **event 6 (Standby)** _addressed to the
   pilot_ while it is already in Standby (a no-op that can't move the boat).
   _Expected:_ a 130851/130850 echo within ~70 ms. This is the single cleanest
   proof the H5000 pilot accepts _addressed_ commands from us — it resolves the
   §2 "H5000 acceptance = Unidentified" question with no motion risk.
   _Abort if:_ no echo — the pilot is ignoring us (likely the AC42 "unknown
   source" binding problem); do **not** proceed to any motion command.
3. **Heading nudge.** With the drive engaged, pilot in Auto, send **event 26
   Change course, +1° then +10°**. Watch actual heading response and the echo.
   _Expected:_ rudder/heading moves by the commanded amount; echo present.
   _Abort if:_ over/under-shoot, no echo, or any unexpected motion → Standby.
4. **Auto (heading hold).** Send **event 9**; confirm the pilot holds heading.
5. **Nav — LAST.** Only after 1–4 pass, and only with §3 step 7 (continuous
   129283/129284) running and the Navigator NAME claimed. Send **event 10**
   (twice, per Zeus). Confirm the pilot tracks the route and that dropping our
   XTE/nav TX makes it disengage (proving we're a real nav source, not a fluke).
   _Abort if:_ Nav is refused despite the nav-source TX → back to §3/§5b step 1.

---

## 6. Recommended implementation order in this codebase

Path A (N2K) has all the scaffolding; Path B (Ethernet) has none and an unknown
protocol. So the recommended order front-loads the **passive capture (§5a)**
because it decides which path is even viable, then builds N2K citizenship.

1. **Sniff tooling first (cheap, read-only, unblocks the decision).** Ensure the
   session logger / a `/sniff`-style capture cleanly records 130850 + 130851 and
   labels them, so §5a's diff is a data task, not a code task. No new TX risk.
2. **N2K citizenship in `packages/bridge`** (the big lift, gated behind
   `G5000_ENABLE_AP_TX`):
   - Add a configurable `src` to `OutgoingPgn` (`wire-driver.ts`) and thread it
     through `encodePgnToCanFrames` (`tx/fast-packet.ts`) — replace the
     hardcoded `src: 254`.
   - New module: ISO address-claim state machine (60928 claim + contention),
     126996 product info, 59904 request responder, NAME with Device Class 50 /
     Function 130. Register it at bridge boot alongside
     `registerAutopilotTxIfEnabled`.
   - 1 Hz keep-alive (65305) loop, engaged with pilot mode.
3. **Fix the command addressing** in `packages/bridge/src/autopilot-commands.ts`
   / `autopilot-tx-impl.ts`: set the in-payload address byte + `dst` to the
   discovered pilot address (from §5a) instead of `Address: 0` / `dst: 255`,
   and switch the resolver to the Verified numeric event codes (6/9/10/12/15/26)
   with the event-26 direction+angle encoding, retiring the hand-captured
   `course_*` codes once the real encoding is confirmed.
4. **Ack + state machine** (new, in bridge or app): correlate each addressed TX
   with its 130851/130850 echo; expose pilot-state + last-ack over the bus /
   SSE.
5. **Nav-source TX** (`apps/g5000` + `packages/bridge`): continuous 129283/129284
   from the active route while Nav is engaged (§3 step 7).
6. **Safety + UI** (`packages/web/src/app/autopilot/*` and
   `api/autopilot/command/route.ts`): add the >30° approval flow (pre-grantable
   ~15 min ahead), the dead-man timeout → Standby, and surface ack/echo status.
   The existing three-layer gate and control panel stay; extend, don't replace.
7. **Path B is a parallel research spike, not a build:** only after §5a yields a
   WiFi capture of the H5000 app steering the pilot do we know whether the
   `:2053` WebSocket is even the write channel. If it is, a small read-first
   WebSocket client (mirroring the mayara pattern) validates framing before any
   write is attempted. Until that capture exists, Path B stays Unidentified and
   unbuilt.

**Recommendation:** pursue **Path A** as the primary track — it has the protocol
(Verified), the ack (Verified), and the scaffolding — while treating the §5a
sniff as the go/no-go gate. The one thing that can kill Path A for _this_ pilot
is the AC42-class "ignores unknown sources" behaviour; §5b step 2 (addressed
Standby echo) is the cheapest possible experiment to resolve it, so sequence
everything to reach that test with the least code and zero motion risk.
