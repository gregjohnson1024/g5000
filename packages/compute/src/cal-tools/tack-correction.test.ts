import { describe, it, expect } from 'vitest';
import { computeTackCorrection, type TackCapture } from './tack-correction.js';
import { DEFAULT_AWS_AWA_CAL } from '@h6000/db';

const cap = (overrides: Partial<TackCapture>): TackCapture => ({
  twd: 0,
  tws: 5,
  awa: 0.6,
  aws: 5,
  ...overrides,
});

describe('computeTackCorrection', () => {
  it('returns zero delta when both tacks agree on TWD', () => {
    const port = cap({ twd: Math.PI / 2, awa: 0.6 });
    const starboard = cap({ twd: Math.PI / 2, awa: -0.6 });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    expect(r.delta).toBeCloseTo(0, 6);
    expect(r.cell.awsIdx).toBeGreaterThanOrEqual(0);
    expect(r.cell.awaIdx).toBeGreaterThanOrEqual(0);
  });

  it('produces delta = -(TWD_port - TWD_starboard) / 2', () => {
    const port = cap({ twd: (94 * Math.PI) / 180 });
    const starboard = cap({ twd: (86 * Math.PI) / 180, awa: -0.6 });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    expect(r.delta).toBeCloseTo(-(4 * Math.PI) / 180, 4);
  });

  it('handles the TWD wraparound at 0/2π', () => {
    const port = cap({ twd: (358 * Math.PI) / 180 });
    const starboard = cap({ twd: (2 * Math.PI) / 180, awa: -0.6 });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    expect(r.delta).toBeCloseTo(-(2 * Math.PI) / 180, 3);
  });

  it('returns the cell snapped to the average AWS and |AWA| of the port capture', () => {
    const port = cap({ aws: 6, awa: 0.785 });
    const starboard = cap({ aws: 6, awa: -0.785 });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    expect(r.cell.awsIdx).toBe(2);
    expect(r.cell.awaIdx).toBe(3);
  });

  it('returns the previewed table after applying the delta to the cell', () => {
    const port = cap({ twd: (94 * Math.PI) / 180, aws: 6, awa: 0.785 });
    const starboard = cap({
      twd: (86 * Math.PI) / 180,
      aws: 6,
      awa: -0.785,
    });
    const r = computeTackCorrection(DEFAULT_AWS_AWA_CAL, port, starboard);
    expect(r.previewed.angleCorrection[r.cell.awsIdx]![r.cell.awaIdx]).toBeCloseTo(r.delta, 6);
    expect(r.previewed.angleCorrection[0]![0]).toBe(0);
  });
});
