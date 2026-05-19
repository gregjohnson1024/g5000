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
  | { kind: 'enum'; value: string }
  | {
      /** Active sail-crossover recommendation; payload published on Channels.SAIL_RECOMMENDATION. */
      kind: 'sail_recommendation';
      /** Snapped TWS in knots (matches fixed grid; same as `twsIdx` since step=1). */
      cellTwsKn: number;
      /** Snapped TWA in degrees (twaIdx * 5). */
      cellTwaDeg: number;
      /** Valid sail ids per category for the current cell, sorted by area desc. */
      valid: {
        headsail: string[];
        main: string[];
        downwind: string[];
      };
      /** Currently hoisted sail per category (mirrors SailWardrobe.active). */
      active: {
        headsail?: string;
        main?: string;
        downwind?: string;
      };
      /** Active sail has been out of its region for ≥ stableSeconds. */
      changeNeeded: {
        headsail: boolean;
        main: boolean;
        downwind: boolean;
      };
      /** UNIX seconds when this cell was first observed. */
      enteredAt: number;
      /** Hysteresis window from CrossoverSettings. */
      stableSeconds: number;
    };

export type SourceTag = string; // e.g. "n2k:127250@dev0x10", "0183:port1"

export interface Sample {
  channel: Channel;
  /** Nanoseconds since Unix epoch. BigInt to avoid Number precision loss. */
  t_ns: bigint;
  value: ChannelValue;
  source: SourceTag;
}
