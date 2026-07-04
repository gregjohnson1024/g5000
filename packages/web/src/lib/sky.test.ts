import { describe, it, expect } from 'vitest';
import { computeSky } from './sky';
describe('computeSky', () => {
  it('returns sunrise before sunset and a moon phase 0..1', () => {
    const s = computeSky(25.4859, -76.6372, new Date('2026-04-22T12:00:00Z'));
    expect(s.sunrise.getTime()).toBeLessThan(s.sunset.getTime());
    expect(s.moon.phase).toBeGreaterThanOrEqual(0);
    expect(s.moon.phase).toBeLessThanOrEqual(1);
    expect(s.dayLengthMs).toBeGreaterThan(0);
  });
});
