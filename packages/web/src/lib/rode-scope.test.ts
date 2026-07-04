import { describe, it, expect } from 'vitest';
import { computeScope } from './rode-scope';
describe('computeScope', () => {
  it('scope = rode / (depth + bowHeight)', () => {
    const r = computeScope({ chainCounter: 122, droopDeduct: 5, depthM: 12.5, bowHeightM: 1.7 });
    expect(r.rode).toBe(117);
    expect(r.totalPlusBow).toBeCloseTo(14.2, 5);
    expect(r.scope).toBeCloseTo(117 / 14.2, 4);
  });
  it('returns null scope when depth+bow is zero', () => {
    expect(
      computeScope({ chainCounter: 30, droopDeduct: 0, depthM: 0, bowHeightM: 0 }).scope,
    ).toBeNull();
  });
});
