import type { RouteLeg, SailTimelineSegment } from './types.js';

const SHORT_SEGMENT_SEC = 15 * 60;

/**
 * Collapse a leg sequence into segments by `configId`. Two passes:
 *
 *   1. Merge adjacent same-config legs into segments.
 *   2. Absorb segments shorter than 15 min into whichever neighbour
 *      (left or right) is the longer of the two — defaulting to the
 *      left if tied. This kills "sail thrash" in the recommended
 *      timeline without burdening the router itself with sail-change
 *      costs.
 *
 * The 15-min threshold is a constant for now. Promote to a setting only
 * if real routes show it's a problem.
 */
export function computeSailTimeline(legs: RouteLeg[]): SailTimelineSegment[] {
  if (!legs.some((l) => l.configId)) return [];

  // Pass 1: merge.
  type Pending = { fromIdx: number; toIdx: number; configId: string };
  const merged: Pending[] = [];
  for (let i = 0; i < legs.length; i++) {
    const id = legs[i]!.configId;
    if (!id) continue;
    const last = merged[merged.length - 1];
    if (last && last.configId === id) {
      last.toIdx = i;
    } else {
      merged.push({ fromIdx: i, toIdx: i, configId: id });
    }
  }

  if (merged.length === 0) return [];

  // Pass 2: absorb short runs.
  // Duration of a segment runs from its first leg's `t` to the next segment's
  // first leg's `t`. For the trailing segment (no leg after it) we infer the
  // step length from the prior leg pair so a singleton-at-end isn't seen as
  // "zero duration" — that would let absorption swallow the route's final
  // segment, which represents arrival rather than sail-thrash.
  const durOf = (p: Pending): number => {
    const start = legs[p.fromIdx]!.t;
    if (p.toIdx < legs.length - 1) {
      return legs[p.toIdx + 1]!.t - start;
    }
    // Trailing segment: infer step from the prior leg pair if possible.
    if (p.toIdx > p.fromIdx) {
      return legs[p.toIdx]!.t - start;
    }
    // Singleton trailing leg: infer from the leg just before it.
    if (p.fromIdx > 0) {
      const step = legs[p.fromIdx]!.t - legs[p.fromIdx - 1]!.t;
      return step;
    }
    return 0;
  };

  const absorbed: Pending[] = [...merged];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < absorbed.length; i++) {
      if (durOf(absorbed[i]!) >= SHORT_SEGMENT_SEC) continue;
      const leftDur = i > 0 ? durOf(absorbed[i - 1]!) : -1;
      const rightDur = i < absorbed.length - 1 ? durOf(absorbed[i + 1]!) : -1;
      if (leftDur < 0 && rightDur < 0) break; // singleton
      if (leftDur >= rightDur && i > 0) {
        absorbed[i - 1]!.toIdx = absorbed[i]!.toIdx;
        absorbed.splice(i, 1);
      } else if (i < absorbed.length - 1) {
        absorbed[i + 1]!.fromIdx = absorbed[i]!.fromIdx;
        absorbed.splice(i, 1);
      }
      changed = true;
      break;
    }
  }

  // Pass 3: after absorption, adjacent runs may share the same configId. Re-merge.
  const remerged: Pending[] = [];
  for (const p of absorbed) {
    const last = remerged[remerged.length - 1];
    if (last && last.configId === p.configId) {
      last.toIdx = p.toIdx;
    } else {
      remerged.push({ ...p });
    }
  }

  return remerged.map((p) => {
    const startTime = legs[p.fromIdx]!.t;
    const endTime = p.toIdx < legs.length - 1 ? legs[p.toIdx + 1]!.t : legs[p.toIdx]!.t;
    return {
      fromLegIdx: p.fromIdx,
      toLegIdx: p.toIdx,
      configId: p.configId,
      startTime,
      endTime,
      durationHours: durOf(p) / 3600,
    };
  });
}
