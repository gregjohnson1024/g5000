import { describe, it, expect } from 'vitest';
import { deriveDepths } from './depth-offset';
describe('deriveDepths', () => {
  it('raw only when no offsets', () => {
    expect(deriveDepths(6.3, {})).toEqual({ sounderM: 6.3, underKeelM: null, totalM: null });
  });
  it('adds under-keel and total when offsets set', () => {
    const d = deriveDepths(6.3, { keelBelowTransducerM: 0.3, transducerToWaterlineM: 0.5 });
    expect(d.underKeelM).toBeCloseTo(6.0, 5);
    expect(d.totalM).toBeCloseTo(6.8, 5);
  });
});
