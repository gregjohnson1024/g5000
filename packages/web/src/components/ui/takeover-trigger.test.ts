/**
 * takeover-trigger.test.ts
 *
 * Unit tests for pickCriticalTakeover() — the pure function that decides
 * which (if any) active alarm escalates to full-viewport Takeover.
 *
 * Acceptance matrix:
 *   - MOB CRITICAL              → returns that row
 *   - anchor-watch CRITICAL     → returns that row
 *   - anchor-watch WARN         → null (WARN never qualifies)
 *   - CRITICAL non-{mob,anchor-watch} → null (id not in Takeover set)
 *   - two CRITICAL qualifiers   → returns the top-ranked (first) one
 *   - empty array               → null
 */

import { describe, it, expect } from 'vitest';
import { pickCriticalTakeover } from './takeover-trigger';
import type { AlarmRow } from '../AlarmStore';

// Helpers
const mob = (overrides?: Partial<AlarmRow>): AlarmRow => ({
  id: 'mob',
  severity: 'CRITICAL',
  label: 'MOB',
  ...overrides,
});

const anchorWatch = (overrides?: Partial<AlarmRow>): AlarmRow => ({
  id: 'anchor-watch',
  severity: 'CRITICAL',
  label: 'Anchor drag 42 m',
  ...overrides,
});

const shallowWater = (overrides?: Partial<AlarmRow>): AlarmRow => ({
  id: 'shallow-water',
  severity: 'CRITICAL',
  label: 'Shallow water',
  ...overrides,
});

describe('pickCriticalTakeover', () => {
  it('returns null for an empty active list', () => {
    expect(pickCriticalTakeover([])).toBeNull();
  });

  it('returns the MOB row when it is the only CRITICAL alarm', () => {
    const row = mob();
    expect(pickCriticalTakeover([row])).toBe(row);
  });

  it('returns the anchor-watch row when it is CRITICAL', () => {
    const row = anchorWatch();
    expect(pickCriticalTakeover([row])).toBe(row);
  });

  it('returns null when anchor-watch is WARN (not CRITICAL)', () => {
    const row = anchorWatch({ severity: 'WARN' });
    expect(pickCriticalTakeover([row])).toBeNull();
  });

  it('returns null when anchor-watch is INFO', () => {
    const row = anchorWatch({ severity: 'INFO' });
    expect(pickCriticalTakeover([row])).toBeNull();
  });

  it('returns null for a CRITICAL alarm whose id is not in the Takeover set', () => {
    expect(pickCriticalTakeover([shallowWater()])).toBeNull();
  });

  it('returns null for a CRITICAL low-battery alarm (not in Takeover set)', () => {
    const lowBattery: AlarmRow = { id: 'low-battery', severity: 'CRITICAL', label: 'Low battery' };
    expect(pickCriticalTakeover([lowBattery])).toBeNull();
  });

  it('returns the first qualifying alarm when two CRITICAL qualifiers are present (top-ranked wins)', () => {
    // AlarmStore sorts highest-severity first; ties by firedAt desc.
    // We simulate mob first (top-ranked) then anchor-watch second.
    const mobRow = mob();
    const anchorRow = anchorWatch();
    const result = pickCriticalTakeover([mobRow, anchorRow]);
    expect(result).toBe(mobRow);
  });

  it('returns anchor-watch when it is ranked first and mob is second', () => {
    const anchorRow = anchorWatch();
    const mobRow = mob();
    const result = pickCriticalTakeover([anchorRow, mobRow]);
    expect(result).toBe(anchorRow);
  });

  it('ignores non-qualifying CRITICAL rows and returns the qualifying one', () => {
    const sw = shallowWater();
    const row = mob();
    // shallowWater is CRITICAL but not in the Takeover set — should skip to mob
    expect(pickCriticalTakeover([sw, row])).toBe(row);
  });

  it('carries context through on the returned row (MOB position)', () => {
    const context = { lat: 32.3, lon: -64.8, t: '2026-06-26T12:00:00Z' };
    const row = mob({ context });
    const result = pickCriticalTakeover([row]);
    expect(result?.context).toEqual(context);
  });
});
