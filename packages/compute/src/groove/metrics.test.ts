import { describe, it, expect } from 'vitest';
import { targetTwaErrorRad, isInGroove, vmgEfficiencyPct, vmgMs } from './metrics.js';

const DEG = Math.PI / 180;

describe('targetTwaErrorRad', () => {
  it('is positive when footing (sailing wider than optimal)', () => {
    expect(targetTwaErrorRad(50 * DEG, 42 * DEG)).toBeCloseTo(8 * DEG, 9);
  });
  it('is negative when pinching', () => {
    expect(targetTwaErrorRad(38 * DEG, 42 * DEG)).toBeCloseTo(-4 * DEG, 9);
  });
});

describe('isInGroove', () => {
  const s = { toleranceRad: 5 * DEG, speedFraction: 0.95 };
  it('upwind: requires angle band AND speed', () => {
    expect(
      isInGroove({
        pointOfSail: 'upwind',
        twaAbsRad: 44 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 6,
        targetSpeedMs: 6,
        ...s,
      }),
    ).toBe(true);
    expect(
      isInGroove({
        pointOfSail: 'upwind',
        twaAbsRad: 50 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 6,
        targetSpeedMs: 6,
        ...s,
      }),
    ).toBe(false);
    expect(
      isInGroove({
        pointOfSail: 'upwind',
        twaAbsRad: 44 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 5,
        targetSpeedMs: 6,
        ...s,
      }),
    ).toBe(false);
  });
  it('reaching: speed only (angle is set by course)', () => {
    expect(
      isInGroove({
        pointOfSail: 'reaching',
        twaAbsRad: 90 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 6,
        targetSpeedMs: 6,
        ...s,
      }),
    ).toBe(true);
  });
  it('not-sailing: null', () => {
    expect(
      isInGroove({
        pointOfSail: 'not-sailing',
        twaAbsRad: 90 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 6,
        targetSpeedMs: 6,
        ...s,
      }),
    ).toBeNull();
  });
});

describe('vmgEfficiencyPct', () => {
  it('upwind: ratio of actual VMG to target VMG', () => {
    expect(
      vmgEfficiencyPct({
        pointOfSail: 'upwind',
        twaRad: 42 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 6,
        targetSpeedMs: 6,
      }),
    ).toBeCloseTo(100, 4);
  });
  it('downwind: valid (both cos terms negative)', () => {
    const v = vmgEfficiencyPct({
      pointOfSail: 'downwind',
      twaRad: 150 * DEG,
      targetTwaRad: 150 * DEG,
      bspMs: 7,
      targetSpeedMs: 7,
    });
    expect(v).toBeCloseTo(100, 4);
  });
  it('reaching: plain speed ratio', () => {
    expect(
      vmgEfficiencyPct({
        pointOfSail: 'reaching',
        twaRad: 90 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 6,
        targetSpeedMs: 8,
      }),
    ).toBeCloseTo(75, 4);
  });
  it('clamps to [0,120]', () => {
    expect(
      vmgEfficiencyPct({
        pointOfSail: 'reaching',
        twaRad: 90 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 100,
        targetSpeedMs: 6,
      }),
    ).toBe(120);
  });
  it('null when target speed is non-positive', () => {
    expect(
      vmgEfficiencyPct({
        pointOfSail: 'upwind',
        twaRad: 42 * DEG,
        targetTwaRad: 42 * DEG,
        bspMs: 6,
        targetSpeedMs: 0,
      }),
    ).toBeNull();
  });
});

describe('vmgMs', () => {
  it('is bsp·cos(twa)', () => {
    expect(vmgMs(6, 0)).toBeCloseTo(6, 9);
    expect(vmgMs(6, Math.PI)).toBeCloseTo(-6, 9);
  });
});
