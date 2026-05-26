import { describe, it, expect } from 'vitest';
import { pruneByBearingBucket, type FrontierNode } from './prune.js';

const START = { lat: 30, lon: -75 };
const END = { lat: 38, lon: -75 }; // due north of start

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
  it('keeps the node closest to the destination in each bearing bucket', () => {
    // a and b are both due north of start → same bearing bucket. a is still
    // approaching the destination (lat 35, 3° short); b has OVERSHOT it
    // (lat 42, 4° past) and is therefore further from BOTH start and end.
    // The old "furthest from start" prune kept b; the progress prune keeps a.
    const a = mk(35, -75, 1_000_000); // approaching — closer to END
    const b = mk(42, -75, 100_000); // overshot — further from END (and start)
    const c = mk(32, -74, 50_000); // NE of start — different bucket
    const out = pruneByBearingBucket([a, b, c], START, END, 2);
    expect(out.length).toBe(2);
    expect(out).toContain(a);
    expect(out).toContain(c);
    expect(out).not.toContain(b);
  });

  it('handles empty input', () => {
    expect(pruneByBearingBucket([], START, END, 2)).toEqual([]);
  });

  it('ranks by remaining distance to destination, not accumulated path length', () => {
    // Regression: the prune must not be fooled by FrontierNode.distFromStart
    // (accumulated water distance). An oscillating node racks up a huge
    // distFromStart but ends up further from the destination than a node that
    // made genuine progress; remaining-distance-to-end correctly prefers the
    // latter regardless of path length.
    const realProgress = mk(35, -75, 120_000); // closer to END, short path
    const oscillation = mk(33, -75, 900_000); // further from END, long path
    const kept = pruneByBearingBucket([realProgress, oscillation], START, END, 2);
    expect(kept).toEqual([realProgress]);
  });
});
