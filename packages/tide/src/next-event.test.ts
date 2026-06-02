import { describe, it, expect } from 'vitest';
import { nextEvent } from './next-event.js';
import type { TidalEvent } from './types.js';

const min = 60_000;
const events: TidalEvent[] = [
  { type: 'LW', timeMs: 0, heightM: 1.0 },
  { type: 'HW', timeMs: 6 * 60 * min, heightM: 5.0 },
];

describe('nextEvent', () => {
  it('returns the first event strictly after now', () => {
    expect(nextEvent(events, 3 * 60 * min)?.type).toBe('HW');
  });
  it('returns null when none remain', () => {
    expect(nextEvent(events, 7 * 60 * min)).toBeNull();
  });
});
