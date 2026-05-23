import {
  setSharedObservedSources,
  type Bus,
  type ObservedSourceEntry,
  type ObservedSources,
} from '@g5000/core';

/**
 * Tracks which sources have recently published which channels, so the
 * `/sources` UI page can show the user what sources are currently competing
 * for each channel. Used purely for display — the actual selector
 * (`subscribeSelected`) keeps its own per-subscription state.
 *
 * Storage shape: nested map { channel -> { source -> last-seen t_ns } }.
 * Per-channel × per-source cardinality is tiny (handfuls), so a plain Map
 * is fine. Read-time filtering by age lets us behave as if it were a
 * ring buffer without paying the bookkeeping.
 */

interface SourceState {
  t_ns: bigint;
  value: import('@g5000/core').ChannelValue;
}

interface InternalState {
  // channel -> source -> { last-seen ns, last value }
  by: Map<string, Map<string, SourceState>>;
  unsubscribe: () => void;
}

/**
 * Install a bus subscriber that records every sample's (channel, source) +
 * timestamp. Returns the tracker + an explicit teardown for tests; also
 * registers the tracker via `setSharedObservedSources` so Next.js API
 * routes can resolve it through `getSharedObservedSources()`.
 */
export function installObservedSourcesTracker(bus: Bus): {
  tracker: ObservedSources;
  teardown: () => void;
} {
  const state: InternalState = {
    by: new Map(),
    unsubscribe: () => {},
  };

  state.unsubscribe = bus.subscribe('**', (s) => {
    let perSource = state.by.get(s.channel);
    if (!perSource) {
      perSource = new Map();
      state.by.set(s.channel, perSource);
    }
    perSource.set(s.source, { t_ns: s.t_ns, value: s.value });
  });

  const tracker: ObservedSources = {
    recent(windowMs = 5000): ObservedSourceEntry[] {
      const nowMs = Date.now();
      const nowNs = BigInt(nowMs) * 1_000_000n;
      const windowNs = BigInt(windowMs) * 1_000_000n;
      const out: ObservedSourceEntry[] = [];
      for (const [channel, perSource] of state.by.entries()) {
        for (const [source, { t_ns, value }] of perSource.entries()) {
          const age = nowNs - t_ns;
          if (age < 0n) continue; // future timestamps — ignore (replay edge case)
          if (age > windowNs) continue;
          out.push({
            channel,
            source,
            lastSeenT_ns: t_ns,
            lastSeenMs: Number(t_ns / 1_000_000n),
            ageMs: Number(age / 1_000_000n),
            lastValue: value,
          });
        }
      }
      out.sort((a, b) => {
        if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1;
        return a.source < b.source ? -1 : a.source === b.source ? 0 : 1;
      });
      return out;
    },
  };

  setSharedObservedSources(tracker);

  return {
    tracker,
    teardown: () => {
      state.unsubscribe();
      state.by.clear();
    },
  };
}
