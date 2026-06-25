import { describe, it, expect } from 'vitest';
import { rangeBboxCorners } from './geo';

describe('rangeBboxCorners', () => {
  it('returns TL,TR,BR,BL square centred on the radar', () => {
    const [tl, tr, br, bl] = rangeBboxCorners(40, -70, 1852); // 1 nm
    expect(tl[1]).toBeGreaterThan(br[1]); // top lat > bottom lat
    expect(tr[0]).toBeGreaterThan(tl[0]); // right lon > left lon
    expect(tl[0]).toBeCloseTo(bl[0], 6); // left edge shares lon
    // ~1nm half-extent in latitude ≈ 1852/111320 deg
    expect(tl[1] - 40).toBeCloseTo(1852 / 111320, 3);
  });
});
