/**
 * Shared types for the /sensors page, kept separate from any component so the
 * removal of SourcePriorityEditor doesn't take them with it.
 */

/** One (channel, source) observation from `/api/sources/observed`. */
export interface ObservedEntry {
  channel: string;
  source: string;
  lastSeenMs: number;
  ageMs: number;
  lastValue: unknown;
}
