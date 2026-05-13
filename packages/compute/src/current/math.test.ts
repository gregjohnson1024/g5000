import { describe, it, expect } from 'vitest';
import { computeSetDrift } from './math.js';

const KN = 0.514444;
const DEG = Math.PI / 180;

describe('computeSetDrift', () => {
  it('no current: boat tracking heading exactly → drift ≈ 0', () => {
    const r = computeSetDrift({ sog: 5 * KN, cog: 0, bsp: 5 * KN, hdg: 0 });
    expect(r.driftMs).toBeLessThan(1e-6);
    expect(r.setRad).toBe(0); // sentinel value when drift is below threshold
  });

  it('1 kn current pushing due east: heading N, BSP = SOG, COG offset east', () => {
    // Boat heading N at 5 kn through water. A 1-kn easterly current means
    // SOG bumps up slightly and COG rotates a few degrees east of N.
    const bsp = 5 * KN;
    const driftTrue = 1 * KN;
    const sog = Math.hypot(bsp, driftTrue);
    const cog = Math.atan2(driftTrue, bsp); // small angle east of N
    const r = computeSetDrift({ sog, cog, bsp, hdg: 0 });
    expect(r.driftMs).toBeCloseTo(driftTrue, 5);
    // Current flowing TO east → set ≈ 90°.
    expect(r.setRad).toBeCloseTo(Math.PI / 2, 5);
  });

  it('beam current pushing south: heading E, current flowing south', () => {
    const bsp = 4 * KN;
    const driftTrue = 0.8 * KN;
    // Boat aims E, water pushes S → ground velocity has E component (bsp)
    // and S component (drift).
    const groundE = bsp;
    const groundN = -driftTrue; // south = negative north
    const sog = Math.hypot(groundE, groundN);
    const cog = (Math.atan2(groundE, groundN) + 2 * Math.PI) % (2 * Math.PI);
    const r = computeSetDrift({ sog, cog, bsp, hdg: Math.PI / 2 });
    expect(r.driftMs).toBeCloseTo(driftTrue, 5);
    // Current flowing south → set = 180°.
    expect(r.setRad).toBeCloseTo(Math.PI, 5);
  });

  it('current dead astern: heading N, current flowing S, COG = N still', () => {
    // 5 kn through water heading N, 1 kn current pushing south →
    // ground speed = 4 kn, COG = N (just slower).
    const bsp = 5 * KN;
    const driftTrue = 1 * KN;
    const sog = bsp - driftTrue;
    const cog = 0;
    const r = computeSetDrift({ sog, cog, bsp, hdg: 0 });
    expect(r.driftMs).toBeCloseTo(driftTrue, 5);
    expect(r.setRad).toBeCloseTo(Math.PI, 5); // flowing S
  });

  it('anchored in 1 kn flood: SOG=0, BSP=0 if paddle wheel stalled → reports zero', () => {
    // This is the degenerate paddle-wheel-stalled case. The function can't
    // know there's a current if neither sensor reports motion. Documents that
    // behavior so it's not a surprise.
    const r = computeSetDrift({ sog: 0, cog: 0, bsp: 0, hdg: 0 });
    expect(r.driftMs).toBe(0);
    expect(r.setRad).toBe(0);
  });

  it('strong cross-current example: 6 kn boat heading 045°T, 1.5 kn current setting 135°', () => {
    const bsp = 6 * KN;
    const hdg = 45 * DEG;
    const driftTrue = 1.5 * KN;
    const setTrue = 135 * DEG;
    // Build a SOG/COG that's consistent with this scenario.
    const waterE = bsp * Math.sin(hdg);
    const waterN = bsp * Math.cos(hdg);
    const curE = driftTrue * Math.sin(setTrue);
    const curN = driftTrue * Math.cos(setTrue);
    const groundE = waterE + curE;
    const groundN = waterN + curN;
    const sog = Math.hypot(groundE, groundN);
    const cog = (Math.atan2(groundE, groundN) + 2 * Math.PI) % (2 * Math.PI);
    const r = computeSetDrift({ sog, cog, bsp, hdg });
    expect(r.driftMs).toBeCloseTo(driftTrue, 5);
    expect(r.setRad).toBeCloseTo(setTrue, 5);
  });
});
