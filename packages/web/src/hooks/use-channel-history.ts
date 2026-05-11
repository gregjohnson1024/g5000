'use client';

import { useEffect, useRef, useState } from 'react';
import type { JsonSafeSample } from '@h6000/core';

export interface ChannelHistoryPoint {
  t_ms: number;
  value: number;
}

export interface UseChannelHistoryResult {
  latest: number | null;
  history: readonly ChannelHistoryPoint[];
  average(): number | null;
  stdDev(): number | null;
}

/**
 * Maintain a rolling buffer of the last `windowMs` milliseconds of samples
 * on the given scalar channel. `sample` is provided by the parent
 * (typically from useSse().channels); the hook trims based on `t_ms`.
 */
export function useChannelHistory(
  sample: JsonSafeSample | undefined,
  windowMs: number,
): UseChannelHistoryResult {
  const historyRef = useRef<ChannelHistoryPoint[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!sample || sample.value.kind !== 'scalar') return;
    const now = sample.t_ms;
    const cutoff = now - windowMs;
    historyRef.current = [
      ...historyRef.current.filter((p) => p.t_ms >= cutoff),
      { t_ms: now, value: sample.value.value },
    ];
    setTick((t) => t + 1);
  }, [sample, windowMs]);

  const history = historyRef.current;
  const latest = history.length > 0 ? history[history.length - 1]!.value : null;

  return {
    latest,
    history,
    average() {
      if (history.length === 0) return null;
      const sum = history.reduce((s, p) => s + p.value, 0);
      return sum / history.length;
    },
    stdDev() {
      if (history.length < 2) return null;
      const sum = history.reduce((s, p) => s + p.value, 0);
      const mean = sum / history.length;
      const sumSq = history.reduce((s, p) => s + (p.value - mean) ** 2, 0);
      return Math.sqrt(sumSq / (history.length - 1));
    },
  };
}
