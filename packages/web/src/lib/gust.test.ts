import { describe, it, expect } from 'vitest';
import { rollingMax } from './gust';
describe('rollingMax', () => {
  it('returns the max value within the window', () => {
    const s = [
      { t: 0, v: 10 },
      { t: 1000, v: 21 },
      { t: 2000, v: 15 },
    ];
    expect(rollingMax(s, 5000, 2000)).toBe(21);
  });
  it('excludes samples older than the window', () => {
    const s = [
      { t: 0, v: 30 },
      { t: 60_000, v: 12 },
    ];
    expect(rollingMax(s, 10_000, 60_000)).toBe(12);
  });
  it('returns null for an empty window', () => {
    expect(rollingMax([], 1000, 0)).toBeNull();
  });
});
