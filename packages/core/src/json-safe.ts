import type { Sample } from './types.js';

/**
 * JSON-safe shape of a Sample. Differs from Sample only in that `t_ns` (a
 * `bigint`, unserializable by JSON.stringify) becomes `t_ms`, a number of
 * milliseconds since Unix epoch (precision loss is acceptable for any
 * boundary that crosses JSON — millisecond timestamps are sufficient for
 * UI display, persistence, and Signal K interop).
 */
export interface JsonSafeSample {
  channel: string;
  t_ms: number;
  value: Sample['value'];
  source: string;
}

export function toJsonSafe(sample: Sample): JsonSafeSample {
  return {
    channel: sample.channel,
    t_ms: Number(sample.t_ns / 1_000_000n),
    value: sample.value,
    source: sample.source,
  };
}

export function fromJsonSafe(jss: JsonSafeSample): Sample {
  return {
    channel: jss.channel,
    t_ns: BigInt(jss.t_ms) * 1_000_000n,
    value: jss.value,
    source: jss.source,
  };
}
