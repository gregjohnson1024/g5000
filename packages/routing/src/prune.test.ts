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
});
