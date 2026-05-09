/**
 * Hierarchical channel name (e.g. "wind.apparent.angle"). Stored as a string
 * so wildcards/patterns are easy; constants live in channels.ts.
 */
export type Channel = string;

/** Sample value variants. Extend as new channel types appear. */
export type ChannelValue =
  | { kind: 'scalar'; value: number; unit?: string }
  | { kind: 'vec3'; value: [number, number, number] }
  | { kind: 'quat'; value: [number, number, number, number] } // x, y, z, w
  | { kind: 'geo'; value: { lat: number; lon: number } }
  | { kind: 'enum'; value: string };

export type SourceTag = string; // e.g. "n2k:127250@dev0x10", "0183:port1"

export interface Sample {
  channel: Channel;
  /** Nanoseconds since Unix epoch. BigInt to avoid Number precision loss. */
  t_ns: bigint;
  value: ChannelValue;
  source: SourceTag;
}
