import { describe, it, expect } from 'vitest';
import { tideSnapshot } from './snapshot.js';
import type { TidalEvent } from './types.js';

const min = 60_000;
const events: TidalEvent[] = [
  { type: 'LW', timeMs: 0, heightM: 1.0 },
  { type: 'HW', timeMs: 6 * 60 * min, heightM: 5.0 },
  { type: 'LW', timeMs: 12 * 60 * min, heightM: 1.2 },
];

describe('tideSnapshot', () => {
  it('composes height, state and next event', () => {
    const s = tideSnapshot(events, 3 * 60 * min);
    expect(s.heightNowM).toBeCloseTo(3.0, 6);
    expect(s.state).toBe('rising');
    expect(s.next?.type).toBe('HW');
    expect(s.next?.timeMs).toBe(6 * 60 * min);
  });
  it('nulls height/state but still finds next when before first event', () => {
    const s = tideSnapshot(events, -1 * min);
    expect(s.heightNowM).toBeNull();
    expect(s.state).toBeNull();
    expect(s.next?.timeMs).toBe(0);
  });
});
