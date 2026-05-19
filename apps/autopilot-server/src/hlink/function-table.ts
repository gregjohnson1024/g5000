import type { ChannelValue } from '@g5000/core';

/**
 * One row of the H-LINK function-number table — maps a B&G H5000 function
 * number to one of our bus channels plus a value formatter.
 *
 * The H5000 protocol expresses every quantity in human-friendly units (knots,
 * degrees, %, meters); our bus uses SI internally. The formatter handles the
 * conversion and any wrapping (heading→0..360, optimum-wind→abs) so the
 * server layer can stay value-agnostic.
 */
export interface FunctionMapping {
  /** H-LINK function number (e.g. 65 = boat speed). */
  fn: number;
  /** Bus channel this function corresponds to. */
  channel: string;
  /**
   * Render a bus ChannelValue as the ASCII payload that follows the
   * function number on the wire. Returns `null` if the value's `kind`
   * doesn't match what this function expects (so the server can skip it).
   */
  format: (value: ChannelValue) => string | null;
}

const KN_PER_MPS = 1 / 0.514444; // ≈ 1.943844
const DEG_PER_RAD = 180 / Math.PI;

function fmt2(n: number): string {
  return n.toFixed(2);
}

function fmt1(n: number): string {
  return n.toFixed(1);
}

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function scalar(value: ChannelValue): number | null {
  return value.kind === 'scalar' ? value.value : null;
}

/** Speed: m/s → knots, 2 dp. */
function fmtSpeed(value: ChannelValue): string | null {
  const v = scalar(value);
  return v === null ? null : fmt2(v * KN_PER_MPS);
}

/** Signed angle: rad → degrees, 2 dp. */
function fmtAngleSigned(value: ChannelValue): string | null {
  const v = scalar(value);
  return v === null ? null : fmt2(v * DEG_PER_RAD);
}

/** Wrapped angle: rad → degrees in [0, 360), 2 dp. */
function fmtAngleWrap(value: ChannelValue): string | null {
  const v = scalar(value);
  return v === null ? null : fmt2(wrap360(v * DEG_PER_RAD));
}

/** Absolute angle: rad → |degrees|, 2 dp. Used for "optimum wind angle". */
function fmtAngleAbs(value: ChannelValue): string | null {
  const v = scalar(value);
  return v === null ? null : fmt2(Math.abs(v * DEG_PER_RAD));
}

/** Passthrough meters, 2 dp. */
function fmtMeters(value: ChannelValue): string | null {
  const v = scalar(value);
  return v === null ? null : fmt2(v);
}

/** Passthrough percent, 1 dp. */
function fmtPercent(value: ChannelValue): string | null {
  const v = scalar(value);
  return v === null ? null : fmt1(v);
}

/**
 * The mapping table. Ordered roughly by function number; gaps are
 * intentional (those functions exist in H5000 but we don't expose them).
 */
const ROWS: FunctionMapping[] = [
  { fn: 11, channel: 'boat.rudder.angle', format: fmtAngleSigned },
  { fn: 52, channel: 'motion.heel', format: fmtAngleSigned },
  // fn 53 — "optimum wind angle (abs)"
  { fn: 53, channel: 'performance.target.twaUpwind', format: fmtAngleAbs },
  { fn: 65, channel: 'boat.speed.water', format: fmtSpeed },
  // Heading is conventionally 0..360 even though the spec doesn't say so.
  { fn: 73, channel: 'boat.heading.magnetic', format: fmtAngleWrap },
  { fn: 77, channel: 'wind.apparent.speed', format: fmtSpeed },
  { fn: 81, channel: 'wind.apparent.angle', format: fmtAngleSigned },
  // fn 83 — same channel as fn 53 but signed
  { fn: 83, channel: 'performance.target.twaUpwind', format: fmtAngleSigned },
  { fn: 85, channel: 'wind.true.speed', format: fmtSpeed },
  { fn: 89, channel: 'wind.true.angle', format: fmtAngleSigned },
  { fn: 109, channel: 'wind.true.direction', format: fmtAngleWrap },
  { fn: 124, channel: 'performance.percentPolar', format: fmtPercent },
  { fn: 125, channel: 'performance.target.boatSpeed', format: fmtSpeed },
  { fn: 127, channel: 'performance.vmg', format: fmtSpeed },
  { fn: 155, channel: 'motion.pitch', format: fmtAngleSigned },
  { fn: 193, channel: 'nav.depth', format: fmtMeters },
  { fn: 233, channel: 'nav.gps.cog', format: fmtAngleWrap },
  { fn: 235, channel: 'nav.gps.sog', format: fmtSpeed },
  { fn: 285, channel: 'performance.target.vmg', format: fmtSpeed },
];

/** Lookup by function number. */
export const FUNCTION_TABLE: Map<number, FunctionMapping> = new Map(ROWS.map((r) => [r.fn, r]));

/**
 * Reverse lookup: bus channel → all function numbers that map to it.
 * One channel can feed multiple functions (e.g. performance.target.twaUpwind
 * → fn 53 AND fn 83). The streaming subscriber uses this to find which
 * function streams to wake up on each bus sample.
 */
export const CHANNEL_TO_FUNCTIONS: Map<string, number[]> = (() => {
  const m = new Map<string, number[]>();
  for (const row of ROWS) {
    const list = m.get(row.channel) ?? [];
    list.push(row.fn);
    m.set(row.channel, list);
  }
  return m;
})();

/**
 * Format a bus ChannelValue for a given H-LINK function number.
 * Returns the raw payload string (e.g. `"4.37"`) — caller wraps it in the
 * `V<NNN>,<MMM>,<FFF>,...` envelope.
 *
 * Returns `null` if the function isn't mapped or the value kind doesn't
 * match. Callers should use `FUNCTION_TABLE.has(fn)` to distinguish
 * unmapped from mis-kinded.
 */
export function hlinkFormat(fn: number, value: ChannelValue): string | null {
  const row = FUNCTION_TABLE.get(fn);
  if (!row) return null;
  return row.format(value);
}
