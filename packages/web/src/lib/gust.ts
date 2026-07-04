'use client';

import type { JsonSafeSample } from '@g5000/core';
import { useChannelHistory } from '../hooks/use-channel-history';

export interface TV {
  t: number;
  v: number;
}

export function rollingMax(samples: TV[], windowMs: number, now: number): number | null {
  let max: number | null = null;
  for (const s of samples) {
    if (s.t >= now - windowMs && (max === null || s.v > max)) max = s.v;
  }
  return max;
}

/**
 * Rolling gust (max) over a channel's history, in the channel's own units.
 * Pass `channels.get('wind.apparent.speed')` (from useSse) as `sample`.
 */
export function useGust(sample: JsonSafeSample | undefined, windowMs: number): number | null {
  const hist = useChannelHistory(sample, windowMs);
  const samples = hist.history.map((h) => ({ t: h.t_ms, v: h.value }));
  return rollingMax(samples, windowMs, Date.now());
}
