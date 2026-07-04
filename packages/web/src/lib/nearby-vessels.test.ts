import { describe, it, expect } from 'vitest';
import { rankVessels } from './nearby-vessels';
const own = { lat: 25.4859, lon: -76.6372 };
describe('rankVessels', () => {
  it('computes range + age and sorts nearest-first', () => {
    const now = 100_000;
    const ranked = rankVessels(
      [
        { mmsi: 1, name: 'FAR', lat: 25.5, lon: -76.63, lastSeenMs: now - 5000 },
        { mmsi: 2, name: 'NEAR', lat: 25.486, lon: -76.637, lastSeenMs: now - 1000 },
      ] as never,
      own,
      now,
    );
    expect(ranked[0]?.name).toBe('NEAR');
    expect(ranked[0]?.rangeM).toBeLessThan(ranked[1]!.rangeM!);
    expect(ranked[0]?.ageMs).toBe(1000);
  });
  it('returns range null when own fix missing', () => {
    const ranked = rankVessels(
      [{ mmsi: 1, name: 'X', lat: 25.5, lon: -76.6, lastSeenMs: 0 }] as never,
      null,
      0,
    );
    expect(ranked[0]?.rangeM).toBeNull();
  });
});
