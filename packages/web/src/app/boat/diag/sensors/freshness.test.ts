import { describe, it, expect } from 'vitest';
import { freshnessOf, FRESH_THRESHOLD_MS, STALE_THRESHOLD_MS } from './freshness';

describe('freshnessOf', () => {
  it('returns red when ageMs is null (no sample observed)', () => {
    expect(freshnessOf(null)).toBe('red');
  });
  it('returns green below the fresh threshold', () => {
    expect(freshnessOf(0)).toBe('green');
    expect(freshnessOf(FRESH_THRESHOLD_MS - 1)).toBe('green');
  });
  it('returns yellow between fresh and stale thresholds', () => {
    expect(freshnessOf(FRESH_THRESHOLD_MS)).toBe('yellow');
    expect(freshnessOf(STALE_THRESHOLD_MS - 1)).toBe('yellow');
  });
  it('returns red at or above the stale threshold', () => {
    expect(freshnessOf(STALE_THRESHOLD_MS)).toBe('red');
    expect(freshnessOf(60_000)).toBe('red');
  });
  it('thresholds are 2 s and 10 s', () => {
    expect(FRESH_THRESHOLD_MS).toBe(2_000);
    expect(STALE_THRESHOLD_MS).toBe(10_000);
  });
});
