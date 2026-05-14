import { describe, it, expect } from 'vitest';
import { pruneByBearingBucket, type FrontierNode } from './prune.js';

const START = { lat: 30, lon: -75 };

function mk(lat: number, lon: number, distFromStart: number): FrontierNode {
  return {
    pos: { lat, lon },
    t: 0,
    parent: null,
    heading: 0,
    twa: 0,
    tws: 0,
    bsp: 0,
    sogGround: 0,
    distFromStart,
  };
}

describe('pruneByBearingBucket', () => {
  it('keeps only the furthest node per bearing bucket', () => {
    // Three nodes in roughly the same bearing-from-start; only the farthest stays.
    const a = mk(31, -75, 100_000);  // due north of start
    const b = mk(32, -75, 200_000);  // also due north, further
    const c = mk(30, -74, 80_000);   // due east — different bucket
    const out = pruneByBearingBucket([a, b, c], START, 2);
    expect(out.length).toBe(2);
    expect(out).toContain(b);
    expect(out).toContain(c);
    expect(out).not.toContain(a);
  });

  it('handles empty input', () => {
    expect(pruneByBearingBucket([], START, 2)).toEqual([]);
  });

  it('does not let A→B→A oscillation inflate the prune metric', () => {
    // Regression: prune used to bucket-by-bearing and keep the highest
    // FrontierNode.distFromStart, which is accumulated path length. A node
    // that bounced A→B→A→B has the same final position as one that took a
    // single step to A, but a much higher distFromStart — the old prune
    // wrongly preferred it, producing visible zigzag in real routes.
    //
    // Real progress: one step due north to lat 31. distFromStart ≈ 111 km.
    const realProgress = mk(31, -75, 111_000);
    // Oscillation: bounced around but ended up at almost the same place
    // (slightly south, same lon). Accumulated path length is much larger.
    const oscillation = mk(30.9, -75, 600_000);
    const kept = pruneByBearingBucket([realProgress, oscillation], START, 2);
    expect(kept).toEqual([realProgress]);
  });
});
