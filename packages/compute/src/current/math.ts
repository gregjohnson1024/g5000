/**
 * Set & drift — the water current vector that's pushing the boat off course.
 *
 * Given the boat's ground velocity (SOG/COG, from GPS) and the boat's
 * through-water velocity (BSP/HDG, from paddle-wheel + compass), the current
 * is just the vector difference:
 *
 *   v_current = v_ground − v_water
 *
 * `set` is the compass direction the current is flowing TO (radians, 0 = N,
 * +ve toward E). `drift` is the current's speed (m/s).
 *
 * This ignores leeway — the assumption is the boat moves through the water in
 * the direction it's pointing. For a beam-reaching boat that's wrong by a few
 * degrees, but on a passage the residual is buried in GPS noise. If a future
 * version of the autopilot publishes a leeway estimate, swap HDG for
 * `HDG + leeway` here.
 */

export interface SetDriftInput {
  /** Speed Over Ground (m/s). */
  sog: number;
  /** Course Over Ground (radians, compass: 0 = N, π/2 = E). */
  cog: number;
  /** Boat speed through water (m/s) — paddle-wheel reading. */
  bsp: number;
  /** Heading (radians, compass: 0 = N, π/2 = E) — typically True. */
  hdg: number;
}

export interface SetDriftResult {
  /** Direction the current flows TO (radians, compass, wrapped to [0, 2π)). */
  setRad: number;
  /** Current speed (m/s). */
  driftMs: number;
}

export function computeSetDrift(input: SetDriftInput): SetDriftResult {
  const { sog, cog, bsp, hdg } = input;
  const groundE = sog * Math.sin(cog);
  const groundN = sog * Math.cos(cog);
  const waterE = bsp * Math.sin(hdg);
  const waterN = bsp * Math.cos(hdg);
  const curE = groundE - waterE;
  const curN = groundN - waterN;
  const driftMs = Math.hypot(curE, curN);
  // When drift is effectively zero the set angle is meaningless. Return 0
  // rather than NaN so callers don't have to special-case it.
  const setRad =
    driftMs < 1e-6 ? 0 : ((Math.atan2(curE, curN) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return { setRad, driftMs };
}
