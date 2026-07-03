import { describe, it, expect } from 'vitest';
import {
  computeTrueWind,
  bilinearInterpolate2D,
  applyBspCal,
  applyCompassDeviation,
  applyMisalignmentCal,
  type TrueWindInputs,
} from './math.js';
import {
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_BSP_CAL,
  DEFAULT_COMPASS_DEVIATION,
  DEFAULT_BOAT_CONFIG,
} from '@g5000/db';

const baseInputs = (overrides: Partial<TrueWindInputs> = {}): TrueWindInputs => ({
  aws: 5, // m/s
  awa: Math.PI / 4, // 45°
  bsp: 3, // m/s
  headingMagRad: 0,
  yawRateRad: 0,
  awsAwaCal: DEFAULT_AWS_AWA_CAL,
  bspCal: DEFAULT_BSP_CAL,
  compassDeviation: DEFAULT_COMPASS_DEVIATION,
  boatConfig: DEFAULT_BOAT_CONFIG,
  ...overrides,
});

describe('computeTrueWind — round trip', () => {
  it('produces sensible TWS/TWA when AW = vector(BSP, 0) (boat steaming straight into apparent wind)', () => {
    // Apparent wind aligned with bow at 5 m/s, boat moving forward at 3 m/s.
    // True wind should be 2 m/s, on the bow.
    const out = computeTrueWind(baseInputs({ aws: 5, awa: 0, bsp: 3 }));
    expect(out.tws).toBeCloseTo(2, 4);
    expect(out.twa).toBeCloseTo(0, 4);
  });

  it('produces a non-trivial TWS when apparent wind is on the beam at boat speed', () => {
    // AW = (0, 3) at the masthead, V = (3, 0). True wind = (-3, 3).
    // |TW| = 3*sqrt(2) ≈ 4.24
    const out = computeTrueWind(baseInputs({ aws: 3, awa: Math.PI / 2, bsp: 3 }));
    expect(out.tws).toBeCloseTo(Math.sqrt(18), 3);
  });

  it('with identity cal, produces finite TWS/TWA/TWD', () => {
    const out = computeTrueWind(baseInputs());
    expect(Number.isFinite(out.tws)).toBe(true);
    expect(Number.isFinite(out.twa)).toBe(true);
    expect(Number.isFinite(out.twd)).toBe(true);
  });

  it('TWD = TWA when heading = 0 (compass-style angles)', () => {
    const out = computeTrueWind(baseInputs({ headingMagRad: 0 }));
    // TWA can be negative; TWD is normalized to [0, 2π).
    // We check that the difference is ~0 modulo 2π.
    const diff = out.twd - out.twa;
    const norm = (diff + Math.PI * 4) % (Math.PI * 2);
    expect(Math.min(norm, Math.PI * 2 - norm)).toBeLessThan(1e-6);
  });

  it('rotating heading by 90° rotates TWD by 90° (modulo 2π)', () => {
    const a = computeTrueWind(baseInputs({ headingMagRad: 0 }));
    const b = computeTrueWind(baseInputs({ headingMagRad: Math.PI / 2 }));
    let delta = b.twd - a.twd;
    // Normalize delta into [-π, π]
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    expect(Math.abs(delta - Math.PI / 2)).toBeLessThan(1e-6);
  });
});

describe('bilinearInterpolate2D', () => {
  it('returns the cell value at exact bin centers', () => {
    const xBins = [0, 1, 2];
    const yBins = [0, 1, 2];
    const grid = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ];
    expect(bilinearInterpolate2D(xBins, yBins, grid, 1, 1)).toBe(4);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 0, 0)).toBe(0);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 2, 2)).toBe(8);
  });

  it('interpolates linearly between adjacent cells', () => {
    const xBins = [0, 2];
    const yBins = [0, 2];
    const grid = [
      [0, 10],
      [10, 20],
    ];
    // Halfway in both dims should be the average of all 4 corners = 10.
    expect(bilinearInterpolate2D(xBins, yBins, grid, 1, 1)).toBe(10);
  });

  it('clamps inputs outside the grid range', () => {
    const xBins = [0, 1, 2];
    const yBins = [0, 1, 2];
    const grid = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ];
    expect(bilinearInterpolate2D(xBins, yBins, grid, -5, -5)).toBe(0);
    expect(bilinearInterpolate2D(xBins, yBins, grid, 99, 99)).toBe(8);
  });
});

describe('applyBspCal', () => {
  it('returns BSP unchanged with identity multiplier', () => {
    expect(applyBspCal(5, DEFAULT_BSP_CAL)).toBe(5);
  });

  it('applies linearly-interpolated multiplier', () => {
    const cal = {
      bins: [0, 10],
      multiplier: [0.9, 1.1], // halfway → 1.0
    };
    // At bsp = 5 (halfway), multiplier should be 1.0 → output = 5.
    expect(applyBspCal(5, cal)).toBeCloseTo(5, 6);
  });
});

describe('computeTrueWind — zero-config regression (bit-identical)', () => {
  // Outputs captured from the pre-heel/pre-misalignment implementation on
  // these exact inputs. With no heel config and no misalignment cal, the new
  // stages must be skipped entirely and every output must match bit-for-bit.
  const fixtureInputs = [
    { aws: 5, awa: Math.PI / 4, bsp: 3, headingMagRad: 0, yawRateRad: 0 },
    { aws: 8.2, awa: -0.6, bsp: 3.6, headingMagRad: 1.2, yawRateRad: 0.03 },
    { aws: 12.5, awa: 2.4, bsp: 4.1, headingMagRad: 5.9, yawRateRad: -0.05 },
    { aws: 3.3, awa: -2.9, bsp: 2.2, headingMagRad: 3.1, yawRateRad: 0.01 },
    { aws: 0.4, awa: 0.1, bsp: 0.5, headingMagRad: 0.2, yawRateRad: 0 },
  ];
  const fixtureOutputs = [
    {
      tws: 3.5758630516846663,
      twa: 1.4204672165227834,
      twd: 1.1726304627395887,
      awsCal: 5,
      awaCal: 0.7853981633974483,
      bspCal: 3,
    },
    {
      tws: 6.06335377824179,
      twa: -1.021083687202089,
      twd: 6.214264866194302,
      awsCal: 8.516576409824925,
      awaCal: -0.6523549464913543,
      bspCal: 3.6,
    },
    {
      tws: 16.26809077320933,
      twa: 2.5298043953708684,
      twd: 1.8987823344080879,
      awsCal: 13.124706532429625,
      awaCal: 2.3494131561238514,
      bspCal: 4.1,
    },
    {
      tws: 5.490440853071661,
      twa: -2.9640780538937754,
      twd: 6.171270499502616,
      awsCal: 3.347630236914796,
      awaCal: -2.8477684362256444,
      bspCal: 2.2,
    },
    {
      tws: 0.10953690651460672,
      twa: 2.7684266088332197,
      twd: 2.720589855050025,
      awsCal: 0.4,
      awaCal: 0.1,
      bspCal: 0.5,
    },
  ];
  const boatConfig = { ...DEFAULT_BOAT_CONFIG, magVarDeg: -14.2 };

  it('matches the captured pre-change outputs exactly when the new config is unset', () => {
    fixtureInputs.forEach((inp, i) => {
      const out = computeTrueWind(baseInputs({ ...inp, boatConfig }));
      expect(out).toEqual(fixtureOutputs[i]);
      // toEqual would accept -0 vs 0 etc.; assert strict identity too.
      expect(out.tws).toBe(fixtureOutputs[i]!.tws);
      expect(out.twa).toBe(fixtureOutputs[i]!.twa);
      expect(out.twd).toBe(fixtureOutputs[i]!.twd);
      expect(out.awsCal).toBe(fixtureOutputs[i]!.awsCal);
      expect(out.awaCal).toBe(fixtureOutputs[i]!.awaCal);
      expect(out.bspCal).toBe(fixtureOutputs[i]!.bspCal);
    });
  });

  it('explicit heel:null and misalignmentCal:null are identical to omitting them', () => {
    fixtureInputs.forEach((inp) => {
      const a = computeTrueWind(baseInputs({ ...inp, boatConfig }));
      const b = computeTrueWind(
        baseInputs({ ...inp, boatConfig, heel: null, misalignmentCal: null }),
      );
      expect(b).toEqual(a);
    });
  });

  it('a heel sample without heelCorrectionEnabled changes nothing', () => {
    fixtureInputs.forEach((inp, i) => {
      const out = computeTrueWind(baseInputs({ ...inp, boatConfig, heel: 0.35 }));
      expect(out).toEqual(fixtureOutputs[i]);
    });
  });
});

describe('computeTrueWind — heel correction', () => {
  const heelConfig = { ...DEFAULT_BOAT_CONFIG, heelCorrectionEnabled: true };

  it('heel = 0 is a numerical no-op', () => {
    const off = computeTrueWind(baseInputs({ awa: 0.7, boatConfig: DEFAULT_BOAT_CONFIG }));
    const on = computeTrueWind(baseInputs({ awa: 0.7, boatConfig: heelConfig, heel: 0 }));
    expect(on.awaCal).toBeCloseTo(off.awaCal, 12);
    expect(on.awsCal).toBeCloseTo(off.awsCal, 12);
    expect(on.tws).toBeCloseTo(off.tws, 12);
    expect(on.twa).toBeCloseTo(off.twa, 12);
  });

  it('wind dead ahead (awa = 0) is unaffected by heel', () => {
    const out = computeTrueWind(baseInputs({ awa: 0, boatConfig: heelConfig, heel: 0.5 }));
    expect(out.awaCal).toBeCloseTo(0, 12);
    expect(out.awsCal).toBeCloseTo(5, 12);
  });

  it('wind on the beam (awa = π/2) at heel 60°: AWA unchanged, AWS halved', () => {
    // sin(awa)=1, cos(awa)=0 → awa_h = atan2(cos φ, 0) = π/2;
    // aws_h = aws·sqrt(0 + cos²φ) = aws·cos(60°) = aws/2.
    const out = computeTrueWind(
      baseInputs({ aws: 6, awa: Math.PI / 2, boatConfig: heelConfig, heel: Math.PI / 3 }),
    );
    expect(out.awaCal).toBeCloseTo(Math.PI / 2, 12);
    expect(out.awsCal).toBeCloseTo(3, 12);
  });

  it('awa = 45° at heel 60° matches the closed-form projection', () => {
    // awa_h = atan2(sin45°·cos60°, cos45°) = atan(0.5);
    // aws_h = aws·sqrt(cos²45° + sin²45°·cos²60°) = aws·sqrt(0.625).
    const out = computeTrueWind(
      baseInputs({ aws: 5, awa: Math.PI / 4, boatConfig: heelConfig, heel: Math.PI / 3 }),
    );
    expect(out.awaCal).toBeCloseTo(Math.atan(0.5), 12);
    expect(out.awsCal).toBeCloseTo(5 * Math.sqrt(0.625), 12);
  });

  it('preserves the sign of awa (port mirrors starboard)', () => {
    const stbd = computeTrueWind(
      baseInputs({ awa: Math.PI / 4, boatConfig: heelConfig, heel: 0.4 }),
    );
    const port = computeTrueWind(
      baseInputs({ awa: -Math.PI / 4, boatConfig: heelConfig, heel: 0.4 }),
    );
    expect(port.awaCal).toBeCloseTo(-stbd.awaCal, 12);
    expect(port.awsCal).toBeCloseTo(stbd.awsCal, 12);
  });

  it('preserves the quadrant for aft apparent wind', () => {
    // awa = 135°: cos < 0, so the corrected angle must stay in the aft quadrant.
    const out = computeTrueWind(
      baseInputs({ awa: (3 * Math.PI) / 4, boatConfig: heelConfig, heel: 0.5 }),
    );
    expect(out.awaCal).toBeGreaterThan(Math.PI / 2);
    expect(out.awaCal).toBeLessThan(Math.PI);
  });
});

describe('applyMisalignmentCal', () => {
  const cal = { awsBins: [3, 5, 8, 10], awaOffsetRad: [0.01, 0.02, 0.04, 0.05] };

  it('returns the bin value at exact bin centers', () => {
    expect(applyMisalignmentCal(3, cal)).toBe(0.01);
    expect(applyMisalignmentCal(8, cal)).toBe(0.04);
  });

  it('interpolates linearly between bins', () => {
    expect(applyMisalignmentCal(4, cal)).toBeCloseTo(0.015, 12);
    expect(applyMisalignmentCal(9, cal)).toBeCloseTo(0.045, 12);
  });

  it('clamps below the first and above the last bin', () => {
    expect(applyMisalignmentCal(0, cal)).toBe(0.01);
    expect(applyMisalignmentCal(25, cal)).toBe(0.05);
  });

  it('returns 0 for an empty or shape-mismatched cal', () => {
    expect(applyMisalignmentCal(5, { awsBins: [], awaOffsetRad: [] })).toBe(0);
    expect(applyMisalignmentCal(5, { awsBins: [3, 5], awaOffsetRad: [0.1] })).toBe(0);
  });

  it('a constant offset cal shifts awaCal by exactly that offset (both tacks)', () => {
    const constCal = { awsBins: [3, 10], awaOffsetRad: [0.05, 0.05] };
    for (const awa of [Math.PI / 4, -Math.PI / 4]) {
      const off = computeTrueWind(baseInputs({ awa }));
      const on = computeTrueWind(baseInputs({ awa, misalignmentCal: constCal }));
      expect(on.awaCal).toBeCloseTo(off.awaCal + 0.05, 12);
    }
  });
});

describe('applyCompassDeviation', () => {
  it('returns heading unchanged with identity deviation', () => {
    expect(applyCompassDeviation(1.234, DEFAULT_COMPASS_DEVIATION)).toBe(1.234);
  });

  it('adds the deviation for the corresponding 10° bin', () => {
    const cal = {
      deviation: Array.from({ length: 36 }, (_, i) => (i === 5 ? 0.1 : 0)),
    };
    // 5th bin = 50°-60° heading. 55° in radians is between 50° and 60°.
    const heading = (55 * Math.PI) / 180;
    const corrected = applyCompassDeviation(heading, cal);
    expect(corrected).toBeCloseTo(heading + 0.1, 6);
  });
});
