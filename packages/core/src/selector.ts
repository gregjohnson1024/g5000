import type { Bus } from './bus.js';
import type { Sample } from './types.js';

/**
 * Source-priority arbitration helper.
 *
 * The bus is "last-write-wins by sample arrival time" — fine when one source
 * publishes a given channel, but ambiguous when two compete (e.g. GPS over
 * N2K and over 0183, two wind sensors, …). This helper lets a consumer
 * subscribe with an ordered preference list and a freshness window: the
 * highest-priority source whose latest sample is younger than the window
 * wins; fall through to the next on stale.
 *
 * The bus topology is unchanged — every source still publishes every sample.
 * `subscribeSelected` is a filtering layer that only delivers samples from
 * the current winner.
 *
 * Source patterns: an entry in `rule.sources` matches a Sample.source string
 * either by exact equality OR — when the entry ends in `*` — by string
 * prefix (the `*` is stripped, then `source.startsWith(prefix)` is checked).
 * No other wildcard form. Bus channel patterns (with `**` / `.*.`) are
 * different syntax and live on the Bus.
 *
 * Emission semantics: update internal per-source last-sample state for every
 * matching publish, then emit only when the just-received sample is from the
 * source that is currently winning (i.e. the highest-priority entry in the
 * rule's `sources` list whose latest seen sample is within
 * `freshnessSeconds`). If the published sample's source isn't in the rule's
 * `sources` at all, nothing is emitted. If no source qualifies as fresh,
 * nothing is emitted (the channel goes "stale" from the consumer's point of
 * view).
 *
 * If no rule matches the channel pattern, behave like `bus.subscribe`: every
 * sample passes through (last-write-wins).
 *
 * When multiple rules in the config could match a channel, the first match
 * wins (rules are scanned in array order).
 */

export interface SourcePriorityRule {
  /** Channel pattern (exact name or `wind.**`-style wildcard, same syntax as Bus). */
  channelPattern: string;
  /**
   * Ordered list of source patterns. Lower index = higher priority.
   * Matching: exact string equality OR trailing-`*` prefix wildcard.
   */
  sources: string[];
  /**
   * Freshness window in seconds. If the preferred source hasn't published a
   * sample within this window, the selector falls through to the next source.
   */
  freshnessSeconds: number;
}

export type SourcePriorityConfig = SourcePriorityRule[];

/**
 * Test if a sample-source string matches one of the rule's source patterns,
 * and if so return the index. Returns -1 on no match. Lower index = higher
 * priority.
 */
function matchSourceIndex(source: string, sources: readonly string[]): number {
  for (let i = 0; i < sources.length; i++) {
    const pat = sources[i]!;
    if (pat.endsWith('*')) {
      const prefix = pat.slice(0, -1);
      if (source.startsWith(prefix)) return i;
    } else if (source === pat) {
      return i;
    }
  }
  return -1;
}

/**
 * Compile the same dot-segmented channel pattern syntax the Bus uses.
 * Duplicated rather than imported because `compilePattern` isn't exported
 * from bus.ts. Keep behaviour in sync if bus.ts ever changes.
 */
function compileChannelPattern(pattern: string): (channel: string) => boolean {
  if (!pattern.includes('*')) {
    return (ch) => ch === pattern;
  }
  const segs = pattern.split('.');
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === '**') {
      throw new Error(`Pattern "${pattern}": ** must appear only as the trailing segment`);
    }
  }
  const trailingDoubleStar = segs[segs.length - 1] === '**';
  const fixed = trailingDoubleStar ? segs.slice(0, -1) : segs;
  return (ch) => {
    const chSegs = ch.split('.');
    if (trailingDoubleStar) {
      if (chSegs.length < fixed.length) return false;
    } else if (chSegs.length !== fixed.length) {
      return false;
    }
    for (let i = 0; i < fixed.length; i++) {
      const f = fixed[i];
      const c = chSegs[i];
      if (f === '*') continue;
      if (f !== c) return false;
    }
    return true;
  };
}

/**
 * Find the first rule in `config` whose channelPattern matches `channel`.
 * Returns the matching rule or null. First match wins (config order).
 *
 * Exposed for tests; not part of the public selector surface.
 */
export function findRuleForChannel(
  config: SourcePriorityConfig,
  channel: string,
): SourcePriorityRule | null {
  for (const rule of config) {
    if (compileChannelPattern(rule.channelPattern)(channel)) return rule;
  }
  return null;
}

/**
 * Per-source last-sample snapshot for a single channel. Internal — exposed
 * only so `pickWinner` can be unit-tested without building real Sample
 * objects.
 */
export interface SourceSnapshot {
  t_ns: bigint;
}

/**
 * Pure function: given a rule, the latest-sample timestamps per source, and
 * a "now" reference, return the winning source name (the highest-priority
 * source in `rule.sources` whose latest sample is within
 * `rule.freshnessSeconds` of `nowNs`) or null if no source qualifies.
 *
 * "Source" here means a literal source tag (e.g. `n2k:127250@dev0x10`,
 * `demo`) — not a pattern. The arbitration walks the configured pattern
 * list, and for each pattern picks the freshest source-tag whose tag matches
 * that pattern (if multiple tags map to the same priority bucket, the
 * freshest one wins). Then the first pattern whose freshest tag is within
 * the freshness window is the winner.
 *
 * @returns the winning literal source-tag string, or null.
 */
export function pickWinner(
  rule: SourcePriorityRule,
  latestSamplesBySource: Map<string, SourceSnapshot>,
  nowNs: bigint,
): string | null {
  const freshNs = BigInt(Math.round(rule.freshnessSeconds * 1e9));
  // For each pattern in priority order, find the freshest source-tag that
  // matches the pattern. If that freshest tag is within the freshness
  // window, it wins. Otherwise advance to the next pattern.
  for (const pattern of rule.sources) {
    let bestTag: string | null = null;
    let bestT: bigint = -1n;
    for (const [tag, snap] of latestSamplesBySource.entries()) {
      if (matchSourceIndex(tag, [pattern]) < 0) continue;
      if (snap.t_ns > bestT) {
        bestT = snap.t_ns;
        bestTag = tag;
      }
    }
    if (bestTag !== null) {
      const age = nowNs - bestT;
      if (age <= freshNs && age >= 0n) {
        return bestTag;
      }
    }
  }
  return null;
}

/** Function returned by {@link subscribeSelected} to detach the handler. */
export type UnsubscribeFn = () => void;

/**
 * Subscribe to a channel with source-priority arbitration.
 *
 * `getConfig` is called fresh on every sample so the live RxJS config is
 * honoured without restarting the subscription.
 *
 * @param bus           The shared Bus.
 * @param channelPattern  Bus-style channel pattern (e.g. `wind.apparent.angle` or `wind.**`).
 * @param getConfig     Live config accessor. Called once per matching sample.
 * @param handler       Called with the sample when its source is the current winner.
 * @returns             Unsubscribe function.
 */
export function subscribeSelected(
  bus: Bus,
  channelPattern: string,
  getConfig: () => SourcePriorityConfig,
  handler: (sample: Sample) => void,
): UnsubscribeFn {
  // Per-channel state: { source -> last sample time }. Kept in this closure
  // so each subscribe call gets its own state — no global accumulation.
  const stateByChannel = new Map<string, Map<string, SourceSnapshot>>();

  return bus.subscribe(channelPattern, (sample) => {
    const config = getConfig();
    const rule = findRuleForChannel(config, sample.channel);

    // No rule → passthrough (last-write-wins).
    if (!rule) {
      handler(sample);
      return;
    }

    // Source not in the rule → drop. We deliberately do NOT update state
    // for sources we're not arbitrating between, so an unrelated publish
    // can't poison the winner picker.
    if (matchSourceIndex(sample.source, rule.sources) < 0) {
      return;
    }

    // Update state with this sample.
    let byChannel = stateByChannel.get(sample.channel);
    if (!byChannel) {
      byChannel = new Map();
      stateByChannel.set(sample.channel, byChannel);
    }
    byChannel.set(sample.source, { t_ns: sample.t_ns });

    // Recompute the current winner relative to this sample's timestamp
    // (using sample.t_ns rather than wall-clock keeps replay deterministic).
    const winner = pickWinner(rule, byChannel, sample.t_ns);

    // Emit only if the just-received sample is from the current winner.
    if (winner === sample.source) {
      handler(sample);
    }
  });
}
