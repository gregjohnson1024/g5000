import { describe, it, expect } from 'vitest';
import { simSnapshotAt } from './sim.js';

describe('simSnapshotAt', () => {
  it('is deterministic for a fixed time', () => {
    const a = simSnapshotAt(12 * 3600); // local noon-ish
    const b = simSnapshotAt(12 * 3600);
    expect(a).toEqual(b);
  });
  it('produces more solar at midday than midnight', () => {
    const at = (t: number) =>
      Number(simSnapshotAt(t).find(([topic]) => topic.endsWith('system/0/Dc/Pv/Power'))?.[1] ?? 0);
    expect(at(12 * 3600)).toBeGreaterThan(at(0));
  });
  it('computes timeToGoS in seconds during discharge', () => {
    // At 2 AM (2 * 3600 s), battery is discharging (night)
    const tSec = 2 * 3600;
    const snapshot = simSnapshotAt(tSec);
    const timeToGoValue = snapshot.find(([topic]) =>
      topic.endsWith('system/0/Dc/Battery/TimeToGo'),
    )?.[1];
    // TimeToGo should exist at night (discharging) and be a finite positive number
    expect(timeToGoValue).toBeDefined();
    expect(typeof timeToGoValue).toBe('number');
    expect(timeToGoValue).toBeGreaterThan(60); // at least a minute
    expect(timeToGoValue).toBeLessThan(2_000_000); // less than ~23 days
  });
});
