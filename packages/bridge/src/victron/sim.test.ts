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
});
