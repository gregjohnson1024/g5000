import { describe, it, expect } from 'vitest';
import {
  stalenessState,
  stalenessClasses,
  ageLabel,
  FRESH_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
} from './staleness';

// ---------------------------------------------------------------------------
// stalenessState
// ---------------------------------------------------------------------------

describe('stalenessState', () => {
  // Fresh zone
  it('returns fresh at 0 ms', () => {
    expect(stalenessState(0)).toBe('fresh');
  });

  it('returns fresh at 500 ms', () => {
    expect(stalenessState(500)).toBe('fresh');
  });

  it('returns fresh at 1000 ms', () => {
    expect(stalenessState(1000)).toBe('fresh');
  });

  it('returns fresh at 1999 ms (just below threshold)', () => {
    expect(stalenessState(FRESH_THRESHOLD_MS - 1)).toBe('fresh');
  });

  // Aging zone
  it('returns aging at exactly 2000 ms', () => {
    expect(stalenessState(FRESH_THRESHOLD_MS)).toBe('aging');
  });

  it('returns aging at 3000 ms', () => {
    expect(stalenessState(3000)).toBe('aging');
  });

  it('returns aging at 9999 ms (just below stale threshold)', () => {
    expect(stalenessState(STALE_THRESHOLD_MS - 1)).toBe('aging');
  });

  // Stale zone
  it('returns stale at exactly 10000 ms', () => {
    expect(stalenessState(STALE_THRESHOLD_MS)).toBe('stale');
  });

  it('returns stale at 10001 ms', () => {
    expect(stalenessState(10001)).toBe('stale');
  });

  it('returns stale at 60000 ms', () => {
    expect(stalenessState(60000)).toBe('stale');
  });

  // Edge case: negative input treated as 0 (fresh)
  it('treats negative ageMs as 0 (fresh)', () => {
    expect(stalenessState(-1)).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------
// stalenessClasses
// ---------------------------------------------------------------------------

describe('stalenessClasses', () => {
  it('returns empty string for fresh', () => {
    expect(stalenessClasses('fresh')).toBe('');
  });

  it('includes text-ink-3 for aging', () => {
    expect(stalenessClasses('aging')).toContain('text-ink-3');
  });

  it('includes text-ink-4 for stale (hollow numerals)', () => {
    expect(stalenessClasses('stale')).toContain('text-ink-4');
  });

  it('fresh does NOT include text-ink-3 or text-ink-4', () => {
    const cls = stalenessClasses('fresh');
    expect(cls).not.toContain('text-ink-3');
    expect(cls).not.toContain('text-ink-4');
  });

  it('aging does NOT include text-ink-4 (stale-only class)', () => {
    expect(stalenessClasses('aging')).not.toContain('text-ink-4');
  });
});

// ---------------------------------------------------------------------------
// ageLabel
// ---------------------------------------------------------------------------

describe('ageLabel', () => {
  it('returns "< 1s" for 0 ms', () => {
    expect(ageLabel(0)).toBe('< 1s');
  });

  it('returns "< 1s" for 500 ms (less than 1 second)', () => {
    expect(ageLabel(500)).toBe('< 1s');
  });

  it('returns "1s" for 1000 ms', () => {
    expect(ageLabel(1000)).toBe('1s');
  });

  it('returns "12s" for 12345 ms', () => {
    expect(ageLabel(12345)).toBe('12s');
  });

  it('returns "59s" for 59999 ms', () => {
    expect(ageLabel(59999)).toBe('59s');
  });

  it('returns "1m" for exactly 60000 ms', () => {
    expect(ageLabel(60000)).toBe('1m');
  });

  it('returns "1m 30s" for 90000 ms', () => {
    expect(ageLabel(90000)).toBe('1m 30s');
  });

  it('returns "2m" for 120000 ms', () => {
    expect(ageLabel(120000)).toBe('2m');
  });

  it('returns "1h" for exactly 3600000 ms', () => {
    expect(ageLabel(3600000)).toBe('1h');
  });

  it('returns "1h 1m" for 3661000 ms', () => {
    expect(ageLabel(3661000)).toBe('1h 1m');
  });

  it('drops seconds when hours are present', () => {
    // 3661 s = 1h 1m 1s — at hour scale, seconds are omitted
    expect(ageLabel(3661000)).toBe('1h 1m');
  });

  it('treats negative input as 0', () => {
    expect(ageLabel(-500)).toBe('< 1s');
  });
});

// ---------------------------------------------------------------------------
// Timestamp-based age computation (frozen-parent contract)
//
// StalenessShroud now accepts `t_ms` (raw Unix-ms timestamp) and computes
// ageMs = Date.now() - t_ms internally on every tick. This means a frozen
// parent (SSE stopped) no longer prevents threshold crossings: the shroud
// re-derives the age each time its interval fires.
//
// These tests verify that `stalenessState(Date.now() - t_ms)` — the exact
// computation the shroud performs — yields correct results for timestamps in
// the past, giving confidence that the age-from-timestamp path is correct.
// ---------------------------------------------------------------------------

describe('age-from-timestamp pattern (frozen-parent fix)', () => {
  it('a timestamp 1s ago yields fresh', () => {
    const t_ms = Date.now() - 1_000;
    expect(stalenessState(Date.now() - t_ms)).toBe('fresh');
  });

  it('a timestamp 5s ago yields aging', () => {
    const t_ms = Date.now() - 5_000;
    expect(stalenessState(Date.now() - t_ms)).toBe('aging');
  });

  it('a timestamp 15s ago yields stale', () => {
    const t_ms = Date.now() - 15_000;
    expect(stalenessState(Date.now() - t_ms)).toBe('stale');
  });

  it('a deeply frozen timestamp (1 min ago) stays stale', () => {
    const t_ms = Date.now() - 60_000;
    expect(stalenessState(Date.now() - t_ms)).toBe('stale');
  });
});

// ---------------------------------------------------------------------------
// Module smoke
// ---------------------------------------------------------------------------

describe('module exports', () => {
  it('FRESH_THRESHOLD_MS is 2000', () => {
    expect(FRESH_THRESHOLD_MS).toBe(2000);
  });

  it('STALE_THRESHOLD_MS is 10000', () => {
    expect(STALE_THRESHOLD_MS).toBe(10000);
  });

  it('stalenessState is a function', () => {
    expect(typeof stalenessState).toBe('function');
  });

  it('stalenessClasses is a function', () => {
    expect(typeof stalenessClasses).toBe('function');
  });

  it('ageLabel is a function', () => {
    expect(typeof ageLabel).toBe('function');
  });
});
