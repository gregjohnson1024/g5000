# G5000 autopilot design notes

**Status:** Notes, not spec. Captures lessons from H5000 operator experience
(particularly the _"8 things I wish I'd known about the B&G H5000 autopilot"_
post by Tobias Hammar at blur.se) that should shape our Phase 0b/0c design.

Master spec §7 ("N2K & autopilot integration") was written before this
material. Treat these notes as inputs to the next revision of that section.

## 1. There are two pilots inside H5000, blended by "Perf level"

H5000 has two underlying steering algorithms:

- **Classical PID** (Perf 1): rudder gain × proportional + counter-rudder × derivative + AutoTrim × integral. Tunable, debuggable.
- **"Performance Sail" mathematical model** (Perf 2–5): hidden boat-model with fixed gain tables you cannot inspect or tune. Perf 2–5 gradually phases this in; by Perf 3 your rudder-gain dial is mostly ignored.

**Implication for us:** Don't bake in a hidden algorithm and expose a "performance dial" as the user-visible knob. That's how H5000 users end up tuning a parameter that no longer matters at their chosen level. Our Phase 0c should:

- Ship a transparent PID as the only steering algorithm initially. Inputs and gains are inspectable on `/autopilot`.
- If we later add a model-based mode, expose it as a _separate mode_ (e.g. "Adaptive"), not a dial that silently changes the algorithm.

## 2. "Expert Systems" are target-shifters, not rudder-commanders (with one exception)

The H5000 autopilot has three add-on systems that everyone confuses:

| System                | What it actually does                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Gust Response**     | Detects heel-rate spike, **shifts target TWA wider** to bear away pre-emptively                                  |
| **TWS Response**      | Low-passes wind-speed trend; **shifts target TWA** to bias for the average breeze                                |
| **Heel Compensation** | Directly applies rudder as a _fast-learning_ weather-helm offset (the only one that touches the rudder directly) |

**Implication for us:** Don't lump these into "autopilot tuning". Build them as separate subsystems that each take typed inputs and produce typed outputs:

- Gust/TWS Response → publish a `performance.target.twa.bias` channel that the autopilot reads alongside `performance.target.twaUpwind`/`Downwind`. Pure compute; testable in isolation.
- Heel Compensation → its own fast-learning weather-helm filter in the autopilot pipeline. Different time constant from AutoTrim.

This also makes the failure mode debuggable. From the blog: _"If the boat bears away too much in gusts, adjust Gust Response gain before Rudder Gain. If it rounds up, check Heel Compensation before the performance level."_

## 3. Cruising Speed is a PID-scaling constant, not a speed reference

H5000's "Cruising Speed" parameter does NOT mean "the speed I usually sail at". It's the speed around which PID gains are scaled:

- Boat below this speed → rudder gets MORE rudder (sluggish, needs more authority)
- Boat above this speed → rudder gets LESS rudder (responsive, needs less)
- Doubles as failsafe if BSP and SOG both fail

B&G's published guidance: 5–6 kn for 10 m boats, 7 kn for 12 m, 10 kn for 20 m. Performance boats push higher (8–12 kn for a SunFast 3300).

**Implication for us:** Whatever we call this, document its role clearly. Don't surface it as "Cruising speed (kts)" — surface it as "Reference speed for steering gains" or similar. A tooltip explaining the scaling relationship would prevent the most common H5000 mis-tune.

## 4. Pilot samples 30 s of rudder before engaging

When you press AUTO, H5000 averages your rudder over the last ~30 s and uses that as the AutoTrim baseline (initial weather-helm offset).

**Implication for us:** When we implement AutoTrim, this behaviour is necessary — but it MUST be paired with a clear UI cue. The `/autopilot` engage path should:

- Show a "steady for 30 s" countdown / ready indicator before AUTO is armed
- If the user engages anyway, expect 30–60 s of poor steering while AutoTrim re-converges

Real cost from the blog: _"On doublehanded boats transitioning to foredeck work, those 60 seconds of poor steering matter."_

## 5. AWA vs TWA upwind: mode choice matters by condition

Conventional Auto mode (AWA upwind ≤60° TWA, TWA downwind) breaks in two regimes:

- **Light air (< 8–10 kts true):** AWA fluctuates wildly with every puff/lull. Pilot chases the fluctuations. TWA is more stable; produces smoother steering. The blog says some experienced pilots use TWA upwind _most_ of the time for light-air consistency.
- **Heavy air (> 18 kts, TWA 55–62°):** TWA prevents pinching in lulls — you want a stable wider target than AWA gives you.

**Implication for us:** Wind mode should be a first-class user choice (Auto / Apparent / True / Polar), not buried in advanced settings. The `/autopilot` page should make the trade-off legible (a short blurb under each option). H5000 has this as a four-way picker; ours should too.

## 6. Leeway-corrected wind MUST NOT feed the autopilot

This is a clean, repeatable failure mode in H5000. If the pilot consumes leeway-corrected TWA:

1. Wind gusts → boat heels → leeway changes
2. Leeway changes → "true wind angle" the pilot sees shifts
3. Pilot chases the moving target → constant rudder activity
4. Constant rudder activity → speed loss

The fix is structural: keep leeway correction for navigation displays and tactical software, but feed the autopilot raw (non-leeway-corrected) wind.

**Implication for us:** Our master spec §6.4 has a leeway model. The output should fan out to TWO channels:

- `wind.true.angle` (raw, fed to autopilot pipeline and to H-LINK fn 89)
- `wind.true.angle.leewayCorrected` (or some similar suffix; fed to displays and to layline math)

The autopilot subscriber explicitly takes the raw form. Source priority shouldn't be allowed to swap these — they're semantically distinct, not alternative sources of the same value.

This is the kind of decision that's cheap to get right at design time and expensive after the autopilot ships.

## 7. Rudder hard-over time is a load-bearing calibration

The time to swing the rudder from full-port to full-stbd is implicitly calibrated into PID gains. H5000 owners report measurable improvements just from setting hard-over time correctly (down to ~12 s on performance boats).

How to measure: NFU mode, drive full one way, stopwatch swing the other way.

**Implication for us:** Make this a first-class calibration step in any autopilot commissioning wizard, alongside dockside commissioning and the rudder-feedback zero. Display the value on `/autopilot`. If we ever auto-tune, hard-over time is an input to that tuning.

## 8. Troubleshoot in layers, bottom-up

H5000 users default to twisting Rudder Gain when steering goes wrong. The blog argues most problems are _not_ in the steering algorithm — they're below it:

1. **Drive** — motor, ram, rudder-feedback zero, battery voltage
2. **Sensors** — paddlewheel fouled? Compass calibrated? Wind trustworthy?
3. **Mode/Target** — right mode? TWA calibrated for these conditions?
4. **Algorithm** — PID gains (Perf 1) or PS-model (Perf 2–5)
5. **Expert Systems** — Gust/TWS Response, Heel Compensation interacting badly?

_"A fouled paddlewheel produces the same symptoms as bad PID tuning."_

**Implication for us:** Our `/autopilot` page should structure its troubleshooting view this way. We already have most of the underlying observables:

- Sensors → `/inspect` already shows per-channel sample ages
- Source-priority/observed publishers → `/sources` shows which sensor is winning per channel
- Mode/target → autopilot page surfaces this directly
- Algorithm → only autopilot-page surface
- Drive → `boat.rudder.angle` is on the bus

The cheap UX win: a "diagnose" panel on `/autopilot` that walks the layers in order and flags which one looks suspect (e.g. "boat.speed.water stale > 5 s" → fix sensor first).

## 9. Disable Adapt (H5000 2.0.0.2 firmware-specific gotcha)

The author's claim — _"the single most important setting change you can make"_ — is to disable "Adapt" after upgrading to 2.0.0.2. Adapt continuously refines rudder-to-turn-rate understanding and apparently degrades performance under the latest firmware.

**Implication for us:** Not a design lesson per se, but a warning: if we ship a "continuously learning" rudder-response feature, we _must_ be able to disable it from the UI, _and_ we should treat firmware changes that alter its dynamics as breaking changes that require re-validation. Continuous learning is a maintenance liability if it's not transparent.

## 10. Start minimal, add features one at a time

The author's commissioning advice: Perf 3 / Wind Mode Auto / _everything else disabled_. Then add TWS Response, then Heel Comp, then Gust Response, one at a time, in conditions where you can see the effect.

**Implication for us:** Defaults matter. Our shipped `/autopilot` config should be:

- A single mode (Auto)
- A single algorithm (transparent PID)
- All Expert Systems off
- Cruising speed at a sane default for the boat's LOA

The user opts into each Expert System individually. The UI should _visibly_ show which systems are on (chips? checkboxes with a "default off" indicator). This makes "what did I change last time?" inspectable.

---

## Action items for master-spec revision (§7)

- [ ] Add an "Expert Systems" subsection. Document Gust Response, TWS Response, Heel Compensation as separate subsystems with their own inputs/outputs. Be explicit about which act on the target TWA vs the rudder.
- [ ] Rename "Cruising speed" (if we use it) to "Reference speed for steering gains" or add a tooltip.
- [ ] Add 30-s steady-rudder pre-engagement requirement for any future AutoTrim feature.
- [ ] Add a first-class wind-mode picker (Auto / Apparent / True / Polar) to `/autopilot`.
- [ ] Document the leeway-correction split: `wind.true.angle` (raw, for autopilot) vs leeway-corrected variant (for nav/laylines).
- [ ] Add a hard-over-time calibration wizard to commissioning. Display the value on `/autopilot`.
- [ ] Add a layered troubleshooting panel to `/autopilot` (sensors → mode → algorithm → drive).
- [ ] Default to all Expert Systems OFF on first boot; surface them as opt-in checkboxes.
- [ ] If we ship any continuous-learning feature: must be disable-able from the UI; firmware changes require revalidation.

## Source

Tobias Hammar, "8 things I wish I'd known about the B&G H5000 autopilot",
blur.se, 2026-05-04.
<https://www.blur.se/2026/05/04/8-things-i-wish-id-known-about-the-bg-h5000-autopilot/>
