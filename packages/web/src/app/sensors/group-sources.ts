import type { ObservedEntry } from './SourcePriorityEditor';

/**
 * Group observed entries by channel for the per-source breakdown on a sensor
 * card. Each channel's list is sorted by source tag for stable display order.
 */
export function groupSourcesByChannel(own: ObservedEntry[]): Map<string, ObservedEntry[]> {
  const out = new Map<string, ObservedEntry[]>();
  for (const entry of own) {
    const list = out.get(entry.channel);
    if (list) list.push(entry);
    else out.set(entry.channel, [entry]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  }
  return out;
}
