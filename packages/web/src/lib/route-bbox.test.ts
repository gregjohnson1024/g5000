import { describe, it, expect } from 'vitest';
import { boundingBoxFor } from './route-bbox.js';

describe('boundingBoxFor', () => {
  it('encloses a single start/end pair with the buffer', () => {
    const b = boundingBoxFor(
      [
        { lat: 38, lon: -64 },
        { lat: 40, lon: -62 },
      ],
      2,
    );
    expect(b).toEqual({ latMin: 36, latMax: 42, lonMin: -66, lonMax: -60 });
  });

  it('expands to enclose intermediate waypoints off the direct line', () => {
    // A via point west of both endpoints must widen lonMin.
    const b = boundingBoxFor(
      [
        { lat: 38, lon: -64 },
        { lat: 41, lon: -71 },
        { lat: 40, lon: -62 },
      ],
      2,
    );
    expect(b.latMin).toBe(36);
    expect(b.latMax).toBe(43);
    expect(b.lonMin).toBe(-73);
    expect(b.lonMax).toBe(-60);
  });
});
