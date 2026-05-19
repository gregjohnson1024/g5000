import type { Sample } from './types.js';

/**
 * Per-channel exponential-moving-average (EMA) damping for outgoing samples.
 *
 * Damping (a.k.a. low-pass filtering) is applied at the boundary where samples
 * leave the system (SSE writer, H-LINK V emit) — never inside the bus or the
 * compute pipelines. Internal pipelines (true-wind, polars) need raw sensor
 * readings; damping the AWA before computing TWA would smear tack detection.
 *
 * Math:
 *   damped[t] = α · damped[t-1] + (1-α) · raw[t]
 *   α = exp(-Δt / τ)
 * where Δt is seconds since the previous sample for this channel and τ is the
 * user-configured time constant (seconds).
 *
 * Special cases:
 *   - τ = 0 or undefined → passthrough (no state, raw sample returned by ref)
 *   - First sample for a channel → returns raw (initializes state)
 *   - Non-scalar samples (geo, vec3, …) → passthrough
 *   - Δt > 10·τ → treat as fresh start (reset state); avoids stale-state jumps
 *
 * Angle channels (radians in [−π, π] or [0, 2π)) use the atan2(sin, cos)
 * trick — EMA is applied to the (sin, cos) components separately, then atan2
 * recovers the angle. This handles the ±π wraparound without blowing up.
 * The list of angle channels is hard-coded in {@link ANGLE_CHANNELS}.
 */

/**
 * Set of channel names whose scalar values are angles in radians and must be
 * damped via the (sin, cos) atan2 trick rather than naïve linear EMA.
 *
 * Includes both signed angles (heel, awa) and wrapped angles (heading, cog,
 * direction) — atan2 EMA handles both correctly.
 *
 * Extend this list as new angle channels are added to the bus.
 */
export const ANGLE_CHANNELS: ReadonlySet<string> = new Set<string>([
  'wind.apparent.angle',
  'wind.true.angle',
  'wind.true.direction',
  'nav.gps.cog',
  'boat.heading.magnetic',
  'boat.heading.true',
  'boat.rudder.angle',
  'motion.heel',
  'motion.pitch',
  'motion.yaw',
  'autopilot.target.heading',
  'autopilot.actual.heading',
  'autopilot.commandedRudder',
]);

interface ScalarState {
  kind: 'scalar';
  lastT_ns: bigint;
  lastValue: number;
}

interface AngleState {
  kind: 'angle';
  lastT_ns: bigint;
  lastSin: number;
  lastCos: number;
}

type ChannelState = ScalarState | AngleState;

/**
 * Function returned by {@link createDamper}. Call once per outgoing sample.
 *
 * @param sample The raw sample from the bus.
 * @param tau Damping time constant in seconds. 0 or undefined → passthrough.
 * @returns Either the original sample (when no damping applies) or a new
 *          Sample with the damped scalar value substituted. The original
 *          sample is never mutated.
 */
export type DampFn = (sample: Sample, tau: number | undefined) => Sample;

/**
 * Build a stateful damper. Each `Damper` keeps its own per-channel state
 * map — instantiate one per outgoing-client subscription (e.g. one per SSE
 * connection) so reconnects start fresh, OR one per process if you want all
 * clients to share warmed-up state. Either choice is correct; EMA self-warms
 * in one sample.
 *
 * The optional `getConfig` getter exists so callers can pass the current
 * damping config map for diagnostic / logging purposes. The actual τ used at
 * each call is the explicit `tau` argument to the returned damp function;
 * the getter is not consulted by `damp()` itself (kept simple — the SSE/H-LINK
 * callers already have the τ in scope from the config lookup).
 */
export function createDamper(): DampFn {
  const states = new Map<string, ChannelState>();

  return function damp(sample: Sample, tau: number | undefined): Sample {
    // Passthrough — no damping configured.
    if (tau === undefined || tau <= 0) return sample;

    // Passthrough — non-scalar sample kinds aren't damped.
    if (sample.value.kind !== 'scalar') return sample;

    const isAngle = ANGLE_CHANNELS.has(sample.channel);
    const prev = states.get(sample.channel);

    // First sample for this channel: initialize state, return raw.
    if (!prev) {
      initState(states, sample, isAngle);
      return sample;
    }

    // Δt in seconds. BigInt subtraction first, then Number — keeps precision.
    const dt = Number(sample.t_ns - prev.lastT_ns) / 1e9;

    // Stale-sample reset: long pause → don't smooth across the gap.
    if (dt > 10 * tau || dt < 0) {
      initState(states, sample, isAngle);
      return sample;
    }

    const alpha = Math.exp(-dt / tau);

    if (isAngle) {
      // Convert angle to (sin, cos), apply EMA to each, recover with atan2.
      // Handles ±π wraparound naturally.
      const ang = sample.value.value;
      const s = Math.sin(ang);
      const c = Math.cos(ang);
      const prevAngle = prev as AngleState; // we set this on init
      const newSin = alpha * prevAngle.lastSin + (1 - alpha) * s;
      const newCos = alpha * prevAngle.lastCos + (1 - alpha) * c;
      const dampedAngle = Math.atan2(newSin, newCos);
      states.set(sample.channel, {
        kind: 'angle',
        lastT_ns: sample.t_ns,
        lastSin: newSin,
        lastCos: newCos,
      });
      return {
        channel: sample.channel,
        t_ns: sample.t_ns,
        value: { kind: 'scalar', value: dampedAngle, unit: sample.value.unit },
        source: sample.source,
      };
    }

    // Scalar EMA.
    const prevScalar = prev as ScalarState;
    const dampedValue = alpha * prevScalar.lastValue + (1 - alpha) * sample.value.value;
    states.set(sample.channel, {
      kind: 'scalar',
      lastT_ns: sample.t_ns,
      lastValue: dampedValue,
    });
    return {
      channel: sample.channel,
      t_ns: sample.t_ns,
      value: { kind: 'scalar', value: dampedValue, unit: sample.value.unit },
      source: sample.source,
    };
  };
}

/** Initialize state for a channel from its current sample. */
function initState(states: Map<string, ChannelState>, sample: Sample, isAngle: boolean): void {
  if (sample.value.kind !== 'scalar') return; // unreachable; guarded by caller
  const v = sample.value.value;
  if (isAngle) {
    states.set(sample.channel, {
      kind: 'angle',
      lastT_ns: sample.t_ns,
      lastSin: Math.sin(v),
      lastCos: Math.cos(v),
    });
  } else {
    states.set(sample.channel, {
      kind: 'scalar',
      lastT_ns: sample.t_ns,
      lastValue: v,
    });
  }
}
