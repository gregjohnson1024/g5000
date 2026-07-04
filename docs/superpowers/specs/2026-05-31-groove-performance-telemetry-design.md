# Groove & performance telemetry for Sula

**Date:** 2026-05-31
**Status:** design (approved in brainstorming)
**Boat:** Sula — performance catamaran (heel + pitch sensors present; see Inventory)

## Summary

Add a performance-telemetry layer to g5000 that answers three nested questions
about how _Sula_ is being sailed:

1. **What the boat achieved** — live speed/angle/VMG/VMC against a target.
2. **What the boat was capable of** — an _achievable polar_ learned from Sula's
   own logged data (upper-percentile per wind bin), not a builder table.
3. **How the deficit between them partitions across the crew** — separating
   helm error (angle-driven loss) from trim/setup loss (loss at perfect angle).

The headline live feature is **"groove"**: a small, decomposable set of numbers a
helmsman or trimmer chases in the moment (time-in-groove %, VMG-efficiency %, a
steering-quality figure), plus a per-session/per-passage **scorecard** for
retrospective analysis. The harder, most valuable layer (the capability envelope
and crew-deficit attribution) sits at the end of a dependency chain and ships
last, behind a calibration + data-accumulation gate.

The implementation follows g5000's existing pattern: a compute pipeline
**subscribes** to channels already on the RxJS bus and **publishes** derived
channels. It _composes_ the true-wind and polar-target math that already exists
rather than re-deriving it. Because every metric is a bus channel, the same code
path feeds live tiles (helm + mast), the H-LINK re-emit, session logging, and
full-fidelity **replay** — so the retrospective scorecard is the live pipeline
run over a logged session, not a separate analytics stack.

## Goals

- A live "groove" readout on the `/helm` view and the Sula mast display, honest
  across all points of sail (upwind / reaching / downwind / motoring).
- Steering-quality metrics that distinguish **human helm** (coaching) from
  **autopilot** (health: hunting, effort, battery), via `autopilot.mode`.
- Cat-specific telemetry: pitchpole / bow-down risk, hot-downwind targets,
  puff-response (bear-away-into-pressure) quality.
- Maneuver cost (tack/gybe loss, recovery time, exit ratio).
- A learned **achievable polar** from Sula's own data, with coverage reporting.
- A **crew-deficit attribution** estimate (helm vs trim) with explicit caveats.
- Deterministic: identical `groove.*` output live and in replay for identical
  input (this is what makes the scorecard trustworthy).

## Non-goals

- **No black-box "score."** The displayed headline stays 2–3 decomposable
  numbers; composites that nobody can decompose erode trust.
- **No re-derivation** of true wind or polar targets — compose the existing
  `compute/src/true-wind` and `compute/src/race/polar-targets` outputs.
- **No sea-state normalization.** Raw steering statistics are worse in waves
  regardless of skill; this is documented, not engineered around.
- **No load-cell metrics** (sheet/forestay load tracking, trim anticipation-lag)
  — Sula has no rig load cells today. Called out as blocked-pending-hardware.
- **No mast-rotation-corrected AWA** — no mast-rotation sensor today.
- **No fleet/handicap comparison.** All analysis is self-referential against
  Sula's own envelope (see Limitations); external anchoring is a process, not
  code, beyond the replicated-leg tagging tool.

## Sensor & data inventory (Sula, as of this spec)

Ground truth is the owner + live bus, **not** the docs — `docs/design/
hercules-feature-notes.md:82` claims "Sula doesn't have a heel sensor, mast-
rotation sensor, or leeway-angle output." That doc is **stale**: Sula has heel
and pitch. Fix that doc as part of Phase 0.

**Have** (populated and used by compute today):

- Apparent wind: `wind.apparent.angle` (AWA), `wind.apparent.speed` (AWS).
- `boat.speed.water` (STW); `boat.heading.magnetic` / `.true` (HDG).
- `nav.gps.position` / `.cog` / `.sog` / `.depth`, `nav.magvar`.
- `motion.rateOfTurn` (yaw rate; feeds the true-wind masthead correction).
- **`motion.heel`, `motion.pitch`, `motion.yaw`** (PGN 127257 attitude) — present.
- `autopilot.mode`, `autopilot.commandedRudder`, `autopilot.target.*` (when the
  pilot is transmitting).
- `electrical.battery.voltage`.
- Derived: TWS/TWA/TWD (`wind.true.*`), `race.targetSpeed` / `race.targetTwa` /
  `race.percentPolar`, `race.vmc`, wind-shift, laylines, current set/drift
  (vector residual, currently **leeway-free**).

**Needs wiring** (on the bus per the owner, not yet mapped):

- **Rudder angle** → `boat.rudder.angle`. PGN 127245 today maps only the
  _commanded_ field to `autopilot.commandedRudder`; add the actual rudder
  **Position** field → `boat.rudder.angle`. The channel constant, damping entry,
  and H-LINK fn 11 already exist; this is one handler change + a mapper test.

**Lack** (no sensor → dependent metrics blocked on hardware):

- **Mast rotation** → no rotation-corrected AWA.
- **Rig / sheet / forestay loads** (no load cells) → no trim load-tracking or
  anticipation-lag.

**Data-state** (repo `config.db`; the Pi on the boat may differ — verify in
Phase 0):

- **No polar loaded** (`polars=0`, `polar_revisions=0`). Until a polar exists (a
  loaded cat polar _or_ the learned envelope), all target/%polar/groove math is
  inert.
- **AWS/AWA and BSP cal are identity/zero** (uncalibrated). TWA-binned
  statistics — and therefore the envelope and attribution layers — are
  unreliable until real calibration data is entered.

## Architecture

A new package module `packages/compute/src/groove/`, wired at boot from a small
`apps/g5000/src/groove-subsystem.ts` — mirroring how `race-subsystem.ts` wires
`startRaceComputePipeline`. It is a pure bus consumer + producer.

```
raw N2K / 0183  (AWS AWA STW HDG ROT heel pitch GPS rudder autopilot.mode)
  │
  ▼ calibration (AWS·AWA cal, BSP cal, compass dev)        ← must be REAL, not identity
  ▼ true-wind (masthead-rotation corrected)  → TWS/TWA/TWD  [existing]
  ▼ leeway model (heel-based)                → boat.leeway  [Phase 0, new]
  ▼ targets:  stored polar  OR  learned envelope → targetSpeed / targetTwa
  │
  ├─▶ LIVE groove pipeline (Phase 1) ──────────────────────────────────────────┐
  │     inGroove · timeInGroove · vmgEfficiency · vmg · targetTwaError ·        │
  │     twaSteadiness · speedCv · steeringEffort · buildRate ·                  │
  │     puffGain · puffLagSec · pointOfSail · helmSource                        │
  │   + maneuver detector → perf.maneuver events                                │
  │   + safety pitch monitor → safety.pitchRisk                                 │
  │                                                                             ▼
  │                                                            helm + mast tiles, H-LINK
  ▼ session log (gzipped JSONL)  ──replay──▶  SAME pipeline (deterministic)
  ▼ retrospective binning by (TWS,TWA) → 90–95th-pct envelope = achievable polar (Phase 2)
  ▼ attribution: realized−envelope gap; regress deficit on |TWA_err| (Phase 3)
  │     → helm slope / trim intercept
  ▼ per-session / per-passage scorecard
```

**Internal units** (each independently testable, mirroring the `race/` and
`polars/` module style):

- `point-of-sail.ts` — pure `(TWA, targetTwa, TWS, BSP, settings) → PointOfSail`.
- `windows.ts` — rolling time-window accumulators (ring buffers keyed on
  `t_ns`): time-weighted fraction-true, circular std-dev, mean, CV, zero-crossing
  / reversal count, max-slope. Pure, property-testable.
- `leeway.ts` — pure `λ = clamp(k·φ / max(STW, floor)²)`.
- `metrics.ts` — pure metric formulas (Metric Definitions below).
- `maneuver.ts` — tack/gybe detector + cost integrator (state machine).
- `puff.ts` — rolling cross-correlation of ΔTWS vs TWA-response.
- `pitch-risk.ts` — pure `(pitch, pitchRate, pointOfSail, aws) → RiskLevel`.
- `pipeline.ts` — wires subscriptions → updates accumulators → publishes
  (same "cache latest, recompute on tick" shape as `polar-targets.ts`).
- Retrospective (separate, Phase 2/3): `envelope/builder.ts` (bin + percentile),
  `attribution/regress.ts` (deficit ~ |TWA_error|), `scorecard/aggregate.ts`.

**Settings** persist in `ConfigStore` (a `groove_settings` row, same pattern as
`crossover_settings`) and are exposed via a getter-based `grooveSettingsRef` so a
settings PUT applies on the **next** sample without recreating the rolling
windows — the trick `race/wind-shift.ts` uses with `getThresholdRad`. Editable
via a `/groove-config` page styled like the existing mast/race settings editors.

**Boot ordering is irrelevant** — race and groove are independent bus
subscribers; groove produces nothing until its inputs (incl. `targetTwa` /
`targetSpeed`) start flowing, exactly as the race pipeline waits for its inputs.

## The three-layer model

Performance telemetry decomposes into _achieved_ (L1), _capable_ (L6 envelope),
and _the crew deficit between them, partitioned_ (L6 attribution). The layers in
between (L2 cat physics, L3 helm, L4 maneuver, L5 trim) are the observable
quantities that feed the partition. Layers L1–L5 are computable now; L6 is gated
behind calibration + accumulated data (see Phasing).

### Notation

- `TWA` true wind angle, signed rad (+stbd / −port); `|TWA|` magnitude.
- `TWS`, `STW`, `SOG`, `targetSpeed` in m/s; `targetTwa` magnitude in rad.
- `φ` heel (rad), `θ` pitch (rad, bow-down sign per IMU convention), `δ_rudder`
  rudder angle (rad). Settings: `δ` TWA tolerance, `k` speed fraction, `W` window,
  `ε` rudder dead-band.

## Metric definitions

### L1 — Boat performance ("how fast")

- **Polar performance ratio η** = `100·STW / targetSpeed(TWS,|TWA|)`. Exists as
  `race.percentPolar`. Primary KPI once the target source is trustworthy.
- **VMG** (to/from the wind) = `STW·cos(TWA)`. Publish `groove.vmg` (m/s). Cats
  run hot downwind — the optimum lives at `|TWA| ≈ 135–150°`, encoded by the
  **cat polar** via `optimalTwaForVmg`; no special-casing in groove code.
- **VMC** = `SOG·cos(BRG_mark − COG)`. Already `race.vmc`; surface it on tiles.
  Distinct from VMG and the metric that wins legs when the course isn't square.
- **Target Δ** = `|TWA| − targetTwa`. Publish `groove.targetTwaError` (rad,
  signed: + = sailing low / footing, − = pinching).

### Derived-signal foundations

- **True wind** — unchanged: masthead-rotation correction + 2D AWS/AWA cal +
  BSP cal + compass deviation. Heel-corrected AWA is now _feasible_ (heel present)
  but **deferred**: on a cat heel is small and the cal table absorbs steady-state
  upwash empirically. Listed as an available refinement, not Phase 0 work.
- **Leeway** (Phase 0, new) — `λ = k·φ / max(STW, STW_floor)²`, clamped to a
  configured `|λ_max|`, computed only when `STW > STW_floor`. `k` is a small,
  cat-tuned coefficient (settings). Publish `boat.leeway` (rad). Feed the
  `HDG + λ` hook already stubbed in `current/math.ts` so current set/drift and
  TWD improve. Small magnitude on a cat, but cheap and correct.

### L2 — Cat physics

- **Hot-downwind VMG** — handled entirely by loading a _cat_ polar (so
  `targetTwa` downwind is ~135–150°). No groove code.
- **Pitchpole / bow-down risk** (`safety.pitchRisk`, enum `normal`/`caution`/
  `warning`) — from bow-down pitch `θ` and pitch-rate `θ̇`, weighted by downwind
  point of sail and apparent wind. v1 is a transparent threshold function (not a
  learned model): caution/warning when `θ` exceeds configured bow-down angles
  _or_ `θ̇` exceeds a rate threshold, escalated downwind / at high AWS. Also
  publish raw `motion.pitch` to a tile. Conservative defaults, fully configurable;
  this is the inverse-of-monohull instinct made into a live safety cue.

### L3 — Helm competence

- **Groove width** — the angle component of time-in-groove (below).
- **`groove.twaSteadiness`** — circular std-dev of `TWA` over `W`, computed on
  TWA unwrapped about the window mean, **steady-segment gated** (excludes samples
  within ~8 s of a point-of-sail flip / detected maneuver so a tack doesn't read
  as bad steering). Lower = locked-on.
- **`groove.speedCv`** = `σ(STW)/μ(STW)` over a steady segment in fixed
  conditions. Penalizes oscillating through the groove even when mean speed looks
  fine.
- **`groove.steeringEffort`** — rudder work from `boat.rudder.angle` over `W`:
  `reversals/min = 60/W · count(sign-changes in Δδ_rudder, ignoring |Δδ_rudder|
< ε)`, with RMS of `δ̇_rudder` (°/s) computed alongside as a secondary readout.
  Skilled helms steer _less_; high reversal rate is sawing → induced drag.
- **`groove.helmNervousness`** ∈ [0,1] — fraction of heading-error variance above
  a cutoff frequency `f_c` (a transparent high-pass/low-pass energy split of
  `e(t) = HDG − HDG_mean(W)`; the correction-spectrum / autocorrelation idea
  reduced to one interpretable scalar). Good helm = low-frequency, low-amplitude;
  nervous helm = high-frequency energy. Heavier compute → **retrospective or
  low-rate live** only.
- **`groove.puffGain` / `groove.puffLagSec`** — rolling cross-correlation of
  `ΔTWS(t)` against the TWA-response over a window. Lag at peak |xcorr| = reaction
  latency (s); sign of gain tests whether the helm **bears away into pressure
  (+)** or pinches (−). Published only when windowed wind variance clears a floor
  (otherwise the correlation is noise).

### L4 — Maneuver cost (helm + crew jointly)

A `maneuver.ts` state machine detects tacks/gybes and emits one `perf.maneuver`
event per maneuver:

- **Detection** — onset when `|rateOfTurn|` exceeds a threshold _and_ `TWA` is
  transiting head-to-wind (tack: sign flip near `|TWA|→0`) or dead-downwind
  (gybe: sign flip near `|TWA|→π`); settle when `STW ≥ 0.95·targetSpeed` and
  heading is steady.
- **Loss** = `∫_window (VMG_target − VMG_actual) dt`, reported in **boat-lengths**
  (÷ LOA from `boat_config`) and equivalent **seconds lost** (÷ VMG_target).
- **Recovery τ** = time from `STW_min` back to `0.95·targetSpeed`. For a cat, τ
  is often more diagnostic than the speed-loss minimum (rebuilding apparent from
  a low-speed state is nonlinear) — τ is the headline.
- **Exit ratio** = `STW_min / STW_entry`.
  Event payload: `{ type: 'tack'|'gybe', t_ns, lossMeters, lossBoatLengths,
secondsLost, tauSec, exitRatio, entrySTW, minSTW }`. Aggregated in the scorecard.

### L5 — Trim competence

- **`groove.buildRate`** = `dSTW/dt` during the acceleration phase after a lull
  or maneuver (max positive slope over a short window). Reflects trimmers easing/
  sheeting to the pressure curve.
- **Load tracking, anticipation-lag** — **blocked** (no load cells). Schema
  leaves room; not implemented.
- **Trim-residual attribution** — the _intercept_ of the L6 regression (deficit
  at zero angle error) is the trim/setup contribution. See L6.

### L6 — Capability envelope & crew-deficit attribution

**Achievable polar (envelope).** Bin good-quality, steady samples by
`(TWS, TWA)` (default TWS bins 2 kn, TWA bins 5°). For each bin with `≥ N_min`
samples, the achievable speed is the **92.5th percentile** of `STW` (configurable
in the 90–95 range). Persist the surface as a `polar_revisions` entry tagged
`envelope`, with a **coverage map** (filled bins / total, and per-bin sample
count). Once coverage clears a threshold, the envelope can _be_ the target source
(`targetSpeed`/`targetTwa` served from it) — the one path that needs no
trustworthy builder polar, which matters if no good cat polar exists for Sula.

**Deficit must be VMG-referenced, not STW-referenced.** A speed-referenced
deficit `1 − STW/achievable(TWS,TWA)` _prices out_ the angle error it is trying to
measure: a helm footing 8° low is faster through the water, and the envelope at
that wider angle is also high, so the speed deficit reads ≈ 0 despite a large
angle error — the regression slope then comes out backwards and a chronic
pincher/footer scores as near-perfect. Instead use a **VMG-referenced** deficit:

```
VMG_achievable(TWS)  = max over angle of [ achievable(TWS, angle)·cos(angle) ]   // envelope's own optimal-VMG point
d_vmg                = 1 − (STW·cos TWA) / VMG_achievable(TWS)
```

Now sailing the wrong angle _does_ surface as deficit, so the partition recovers.

**Aggregate crew deficit** over a segment/session = `mean(d_vmg)` on quality-
passing steady samples.

**Partition (estimator, not clean separation).** **Upwind/downwind segments
only** — `|TWA_error|` is undefined on a reach (no VMG optimum), so reaching
segments are excluded from the regression. Over qualifying steady segments,
regress `d_vmg ≈ a + b·|TWA_error|`. The **slope b → helm** contribution (angle-
driven VMG loss); the **intercept a → trim/setup** (VMG loss at perfect angle).
Report `a`, `b`, `R²`, sample count, and the **coupling caveat** (helm and trim
co-adapt; validate by holding one role constant across matched legs). Requires
steady segments spanning a range of `|TWA_error|`.

**"Steady segment" is load-bearing and must be pinned in Phase 3** — `speedCv`,
`twaSteadiness`, and this entire regression depend on it. Working definition to
finalize in the plan: same point of sail throughout, ≥ T_min seconds, outside any
maneuver window (±~8 s), and windowed TWS variance below a floor.

**Self-referential anchoring.** Without a fleet reference, all of L6 measures
consistency against Sula's own envelope, which drifts as sailing improves. The
only escape in-scope is a **replicated-leg tool**: tag a leg, repeat it, compare
realized-vs-envelope across repeats. Two-boat testing is an external process,
noted but not built.

## Point-of-sail classifier & gating

`point-of-sail.ts`, pure `(TWA, targetTwa, TWS, BSP, settings) → 'upwind' |
'reaching' | 'downwind' | 'not-sailing'`:

1. **not-sailing** first — if `TWS < twsFloor` (~3 kn) **or** `STW < steerageFloor`
   (~1 kn): no usable wind / below steerage ⇒ groove undefined.
2. otherwise by `|TWA|`: `< 70°` → **upwind**, `> 110°` → **downwind**, `70–110°`
   → **reaching**. The `[70°,110°]` reaching band is tunable. This is an admitted
   heuristic (a boat at 75° could be footing on a beat or close-reaching);
   refining it with layline/waypoint awareness is a deliberate later step.

**Instantaneous in-groove** (`groove.inGroove`, enum `in`/`out` — the atomic
basis the windows aggregate):

```
angleErr = | |TWA| − targetTwa |
upwind / downwind:  inGroove = (angleErr ≤ δ) AND (STW ≥ k·targetSpeed)
reaching:           inGroove = (STW ≥ k·targetSpeed)         // angle set by course-to-mark
not-sailing:        inGroove = null (excluded from windows)
```

`δ` default **5°** (×1.5 downwind, where the groove is genuinely broader);
`k` default **0.95**.

**`groove.timeInGroove` (%)** — time-weighted fraction of the rolling window `W`
(default 60 s) spent in-groove, counting only _sailing_ samples (not-sailing
intervals drop out of numerator and denominator):

```
timeInGroove = 100 · Σ(Δtᵢ·inGrooveᵢ) / Σ(Δtᵢ over sailing samples)
```

**`groove.vmgEfficiency` (%)** — one channel, point-of-sail-correct:

```
upwind/downwind:  vmgEff = 100 · (STW·cos TWA) / (targetSpeed·cos targetTwa)
reaching:         vmgEff = 100 · STW / targetSpeed
```

Both cos terms share sign → valid up & downwind. Clamped `[0,120]`, published as a
short EMA (τ ≈ 6 s) so it's readable. Captures speed **and** angle together — you
can't game it by footing for speed at a bad angle.

**Gating behavior.** When **not-sailing**: publish `pointOfSail` + `helmSource`
(+ `steeringEffort`, since the pilot working under engine is informative);
suppress `timeInGroove`/`vmgEfficiency`/`twaSteadiness`/`speedCv` and drop the
samples from the windows; UI shows "Motoring — no groove." When **no polar /
`targetSpeed ≤ 0`**: classify `pointOfSail` by fixed bands, suppress polar-
dependent metrics; UI shows "no polar." Tacks/gybes blip `pointOfSail` through
the reaching zone then settle; the time-weighted window down-weights the
transition and `twaSteadiness`/`speedCv` exclude the maneuver window.

## Steering-source tagging

`groove.helmSource` (enum `human` / `autopilot`) from `autopilot.mode` (PGN
127237): active steering modes (Heading / Track / Wind / Nav) → `autopilot`;
Standby/off, or no mode sample within ~30 s → `human`. Same math, different
framing in the UI: `human` → "Helm: steadiness / corrections" (coaching);
`autopilot` → "Pilot: activity / hunting" (health — high reversals/min while
engaged ⇒ hunting ⇒ drag + battery draw). Thresholds shared in v1, per-source-
tunable later. Commanded-vs-actual rudder lag is a noted future "pilot hunting"
refinement.

## Channels published

| Channel                  | Kind / unit   | Phase | Notes                                      |
| ------------------------ | ------------- | ----- | ------------------------------------------ |
| `boat.rudder.angle`      | scalar, rad   | 0     | new producer mapping (PGN 127245 Position) |
| `boat.leeway`            | scalar, rad   | 0     | heel-based leeway estimate                 |
| `safety.pitchRisk`       | enum          | 1     | normal / caution / warning                 |
| `groove.pointOfSail`     | enum          | 1     | upwind / reaching / downwind / not-sailing |
| `groove.helmSource`      | enum          | 1     | human / autopilot                          |
| `groove.inGroove`        | enum          | 1     | in / out (atomic basis)                    |
| `groove.timeInGroove`    | scalar, %     | 1     | **hero number**                            |
| `groove.vmgEfficiency`   | scalar, %     | 1     | point-of-sail-correct, EMA                 |
| `groove.vmg`             | scalar, m/s   | 1     | VMG to/from wind                           |
| `groove.targetTwaError`  | scalar, rad   | 1     | signed (footing + / pinching −)            |
| `groove.twaSteadiness`   | scalar, rad   | 1     | circular SD; UI shows °                    |
| `groove.speedCv`         | scalar, ratio | 1     | σ/μ STW, steady segments                   |
| `groove.steeringEffort`  | scalar, 1/min | 1     | rudder reversals/min (+ RMS rate)          |
| `groove.buildRate`       | scalar, m/s²  | 1     | dSTW/dt on acceleration                    |
| `groove.puffGain`        | scalar        | 1     | sign = bear-away(+)/pinch(−)               |
| `groove.puffLagSec`      | scalar, s     | 1     | reaction latency                           |
| `groove.helmNervousness` | scalar, 0–1   | 3     | HF heading-error energy; retro/low-rate    |
| `perf.maneuver`          | event         | 1     | per-maneuver cost payload                  |

Add the new channel constants to `packages/core/src/channels.ts` and register
them in `knownChannelSet()` so they appear automatically in the mast layout
editor's channel picker (`/api/mast/channels`).

## Display

**Live (reuses existing transport** — `use-sse.ts` + `/api/stream` for helm,
`/api/mast/stream` for mast):

- **`/helm`** — a Groove tile cluster: hero **Time-in-groove %** (large, color-
  banded), **VMG-efficiency %**, **VMC**, and one **steering** readout that
  relabels by `helmSource`; a **point-of-sail badge**; a **pitch-risk** indicator
  that escalates color downwind. Tiles read `groove.*` / `safety.*` via the SSE
  hook.
- **Mast display** — because `groove.*` are first-class channels in
  `knownChannelSet()`, they're selectable tiles in the existing mast layout
  editor. One required step: teach the mast tile formatter the new units
  (`%`, `°`, `min⁻¹`, `s`) and reuse its per-cell threshold-colour support for
  the bands. Ship a starter mast layout preset with the groove cluster.
- **Color bands** (defaults in groove settings, shared by both surfaces): e.g.
  Time-in-groove ≥80 green / 50–80 amber / <50 red; VMG-eff ≥98 / 90–98 / <90.

**Retrospective scorecard** — a server-side aggregator subscribes to `groove.*`
and `perf.maneuver` identically whether fed by the live bus or by **replaying a
logged session** (the determinism Approach A buys). Per session it accumulates:
overall Time-in-groove % **split by point-of-sail and by helmSource**; median
`twaSteadiness` / `speedCv` / `steeringEffort`; longest in-groove streak and
worst-wander stretch; maneuver tally (count, mean loss, mean τ); time split
(sailing vs motoring, human vs pilot). Surfaced as a **Groove section on the
existing `/sessions` view**, generated on demand by replaying the session through
the groove pipeline. The **envelope** (Phase 2) adds an achievable-polar overlay

- coverage; **attribution** (Phase 3) adds the helm/trim split and the data-
  quality status.

## Phasing — dependency-gated

- **Phase 0 — Foundations & data quality.** Map rudder → `boat.rudder.angle`
  (+ mapper test); confirm heel/pitch/ROT live on the boat; leeway model + wire
  into current; a **calibration / data-quality gate** that tags every sample
  (cal real vs identity; required sensors present & fresh; steady vs maneuver) so
  downstream layers can exclude garbage — operationalizing the "garbage-in"
  warning. Load a cat polar _or_ bootstrap an interim envelope (config.db
  currently has no polar + identity cal). Fix the stale hercules-feature-notes.
- **Phase 1 — Live metrics** (approved v1 + sensor-free additions). Groove
  pipeline (inGroove, timeInGroove, vmgEfficiency, vmg, targetTwaError,
  twaSteadiness, pointOfSail, helmSource), Speed CV, VMC display, puff gain/lag,
  pitch-risk, build-rate, maneuver detector/cost. Helm + mast tiles. Needs only
  Phase-0 targets.
- **Phase 2 — Envelope-polar builder.** Batch over accumulated good-quality logs
  → percentile achievable polar; coverage reporting; persist as a `polar_revisions`
  entry. **Requires an accumulation window** of calibrated, logged sailing.
  Becomes the target source once coverage clears a threshold.
- **Phase 3 — Attribution & scorecard depth.** Realized-vs-envelope gap; helm/
  trim partition; correction-spectrum nervousness; replicated-leg tagging;
  full per-session scorecard. **Gated:** L6 outputs display only when envelope
  coverage + cal quality clear thresholds; otherwise the UI shows "calibrate /
  log more first." The most interesting layer is necessarily the most deferred.

## Settings (`groove_settings` in ConfigStore)

`twaToleranceDeg` (δ, 5), `downwindToleranceFactor` (1.5), `speedFraction`
(k, 0.95), `windowSec` (W, 60), `twsFloorKn` (3), `steerageFloorKn` (1),
`reachingBandDeg` ([70,110]), `rudderDeadbandDeg` (ε, 0.5),
`pitchCautionDeg`/`pitchWarningDeg`/`pitchRateThresh`, `leewayK` + `leewayMaxDeg`,
`puffWindVarFloor`, `nervousnessCutoffHz` (f_c),
envelope: `twsBinKn` (2), `twaBinDeg` (5), `percentile` (92.5), `minSamplesPerBin`,
`coverageThreshold`, attribution `minSteadySegments`, and per-metric color bands.
Exposed via a getter-based `grooveSettingsRef`; edited on a `/groove-config` page.

## Testing

Matches the repo's Vitest + fast-check, pure-module style:

- `point-of-sail.test.ts` — class boundaries, not-sailing floors, hysteresis.
- `windows.test.ts` — **fast-check properties**: fraction ∈ [0,1]; circular SD ≥ 0
  & wrap-correct; reversal count honours dead-band; CV well-defined; empty window
  → null.
- `metrics.test.ts` — vmgEfficiency up/down/reach incl. sign + clamp; in-groove
  band logic; k/δ thresholds; targetTwaError sign.
- `leeway.test.ts` — sign, low-STW clamp, `λ_max` cap.
- `maneuver.test.ts` — scripted tack/gybe sequences → correct onset/settle, loss
  integral, τ, exit ratio; no false trigger on a wind shift without a maneuver.
- `puff.test.ts` — synthetic puff with known lag → recovered lag/sign; noise →
  suppressed.
- `pitch-risk.test.ts` — threshold escalation by pitch / rate / point of sail.
- `pipeline.test.ts` — scripted bus sequence (beat → tack → reach → gybe → run →
  motor) asserts the published `groove.*` sequence, suppression on not-sailing /
  no-polar, and `helmSource` flips with `autopilot.mode`.
- `channel-mapper.test.ts` — PGN 127245 Position → `boat.rudder.angle`.
- `envelope/builder.test.ts` — binning, percentile per bin, `N_min` gating,
  coverage map.
- `attribution/regress.test.ts` — VMG-referenced deficit, upwind/downwind only;
  synthetic data with known helm-slope / trim-intercept → recovered within
  tolerance; a pure footing/pinching dataset yields a positive helm slope (guards
  against the STW-referenced sign inversion); reports R² and sample count.
- Replay/aggregator test — fixture session → scorecard aggregates, **and** live
  vs replay produce identical `groove.*` for identical input.

## Edge cases & error handling

- Missing inputs (no TWA / targetTwa / polar) → publish nothing for dependent
  metrics; never emit NaN/Inf (guard `targetSpeed > 0`, finite checks) — mirrors
  `polar-targets`' early-return.
- Stale channels beyond a TTL → treat as not-sailing/unknown, not stale-compute
  (reuse the mast view's staleness concept).
- SI internally (rad, m/s); convert to °/kn/% only in the formatter.
- `autopilot.mode` absent → default `human` after TTL.
- Maneuver that never settles (e.g., a bad tack into irons) → close the window on
  a timeout and flag the event `incomplete` rather than integrating forever.
- Envelope bins below `N_min` → excluded from the surface and the coverage count;
  attribution refuses to report below `minSteadySegments`.

## Limitations (documented, not engineered around)

- **Sea state.** `twaSteadiness`, `speedCv`, `steeringEffort` are worse in waves
  regardless of skill. Not normalized; an optional heel/pitch-variance "sea-state"
  context readout is a future nicety. (Heel + pitch are present, so this _could_
  be added later as context.)
- **Self-reference.** L6 measures consistency against Sula's own drifting
  envelope; replicated-leg / two-boat testing is the only external anchor.
- **Optimistic envelope.** The 92.5th-percentile-per-bin achievable polar absorbs
  gusts and wave-surfing, so the "achievable" surface runs slightly hot and every
  deficit reads marginally worse than reality. The data-quality gate mitigates
  but does not remove this; treat absolute deficit magnitudes as indicative.
- **Helm/trim coupling.** The attribution split is an estimator, not a clean
  separation; validate by holding one role constant across matched legs.
- **Calibration dependency.** Uncalibrated AWA/log contaminate every TWA-binned
  statistic; the data-quality gate excludes such data from L6, which is why L6 is
  gated behind real calibration.
- **Hardware gaps.** Mast rotation (rotation-corrected AWA) and rig load cells
  (trim load-tracking, anticipation-lag) are blocked pending hardware.

## Files (anticipated; the implementation plan will refine)

- `packages/bridge/src/channel-mapper.ts` — PGN 127245 Position mapping (+ test).
- `packages/core/src/channels.ts` — new channel constants; `knownChannelSet()`.
- `packages/compute/src/groove/` — `point-of-sail.ts`, `windows.ts`, `leeway.ts`,
  `metrics.ts`, `maneuver.ts`, `puff.ts`, `pitch-risk.ts`, `pipeline.ts`, `index.ts`
  (+ tests). Phase 2/3: `envelope/`, `attribution/`, `scorecard/`.
- `packages/db/src/` — `groove_settings` schema/defaults; envelope persisted via
  existing `polar_revisions`.
- `apps/g5000/src/groove-subsystem.ts` — boot wiring.
- `packages/web/src/app/helm/` — groove tile cluster; `/sessions` scorecard
  section; `/groove-config` settings page; mast formatter unit/threshold support.
- `docs/design/hercules-feature-notes.md` — correct the stale heel-sensor claim.
