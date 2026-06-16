import type { SourcePriorityRule } from '@g5000/core';

/**
 * Freshness window stored on a pin rule. Irrelevant for a single-source rule
 * (a source always wins its own freshly-arrived sample, and there's no other
 * source to fail over to), but the config API requires a positive finite
 * value, so we store a constant.
 */
export const PIN_FRESHNESS_SECONDS = 5;

/**
 * The source currently pinned for `channel`, or null for Auto (no rule).
 * Reads `sources[0]` of the first rule whose channelPattern equals the
 * channel, so a legacy multi-source rule reads as pinned-to-its-first.
 */
export function pinnedSourceForChannel(
  rules: SourcePriorityRule[],
  channel: string,
): string | null {
  const rule = rules.find((r) => r.channelPattern === channel);
  return rule?.sources[0] ?? null;
}

/**
 * Return a new rules array with `channel` pinned to `source`, or — when
 * `source` is null (Auto) — with any rule for `channel` removed. Replaces an
 * existing rule for the channel; other channels' rules pass through unchanged.
 */
export function setPinnedSource(
  rules: SourcePriorityRule[],
  channel: string,
  source: string | null,
): SourcePriorityRule[] {
  const others = rules.filter((r) => r.channelPattern !== channel);
  if (source === null) return others;
  return [
    ...others,
    { channelPattern: channel, sources: [source], freshnessSeconds: PIN_FRESHNESS_SECONDS },
  ];
}
