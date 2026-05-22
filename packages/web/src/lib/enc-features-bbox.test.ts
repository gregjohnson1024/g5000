import { describe, it, expect } from 'vitest';
import { parseBbox, quantizeBbox, bboxKey } from './enc-features-bbox';

describe('parseBbox', () => {
  it('parses a comma-separated lonMin,latMin,lonMax,latMax string', () => {
    expect(parseBbox('-71.5,41.3,-71.2,41.6')).toEqual({
      lonMin: -71.5,
      latMin: 41.3,
      lonMax: -71.2,
      latMax: 41.6,
    });
  });

  it('rejects malformed bboxes', () => {
    expect(parseBbox('')).toBeNull();
    expect(parseBbox('1,2,3')).toBeNull();
    expect(parseBbox('a,b,c,d')).toBeNull();
    expect(parseBbox('-71.5,41.3,-71.2,41.6,extra')).toBeNull();
  });

  it('rejects out-of-range or inverted bboxes', () => {
    // lonMin > lonMax
    expect(parseBbox('1,0,-1,1')).toBeNull();
    // latMin > latMax
    expect(parseBbox('-1,2,1,1')).toBeNull();
    // out of range
    expect(parseBbox('-181,0,1,1')).toBeNull();
    expect(parseBbox('0,91,1,92')).toBeNull();
  });

  it('rejects bboxes wider than 5° (guard against runaway queries)', () => {
    expect(parseBbox('-80,40,-70,42')).toBeNull(); // 10° wide
    expect(parseBbox('-80,40,-79,46')).toBeNull(); // 6° tall
    expect(parseBbox('-80,40,-75.5,44.5')).not.toBeNull(); // 4.5°×4.5° OK
  });
});

describe('quantizeBbox', () => {
  it('rounds each edge to 0.1° to make a stable cache key', () => {
    const q = quantizeBbox({ lonMin: -71.523, latMin: 41.317, lonMax: -71.184, latMax: 41.612 });
    expect(q).toEqual({ lonMin: -71.6, latMin: 41.3, lonMax: -71.1, latMax: 41.7 });
  });
});

describe('bboxKey', () => {
  it('produces a stable string from a quantised bbox', () => {
    expect(bboxKey({ lonMin: -71.6, latMin: 41.3, lonMax: -71.1, latMax: 41.7 })).toBe(
      '-71.6,41.3,-71.1,41.7',
    );
  });
});
