import { describe, it, expect } from 'vitest';
import { PLANNING_DEFAULTS, resolvePlanOptions } from './planning-settings.js';

const KN = 0.514444;

it('returns engine defaults when settings and overrides are empty', () => {
  const o = resolvePlanOptions(undefined, undefined);
  expect(o.stepMinutes).toBe(PLANNING_DEFAULTS.stepMinutes);
  expect(o.avoidLand).toBe(true);
  expect(o.captureIsochrones).toBe(false);
  // Default minSailKt=0 → autoMotor resolves to undefined (never motor)
  expect(o.autoMotor).toBeUndefined();
});

it('settings override defaults, request overrides settings', () => {
  const settings = {
    pruneBucketDeg: 5,
    avoidLand: true,
    autoMotor: { minSailKt: 3, motorKt: 6 },
  };
  const o = resolvePlanOptions(settings, { avoidLand: false, maxHours: 48 });
  expect(o.pruneBucketDeg).toBe(5); // from settings
  expect(o.avoidLand).toBe(false); // request wins
  expect(o.maxHours).toBe(48); // request
});

it('converts auto-motor knots to m/s; minSailKt=0 yields undefined', () => {
  const on = resolvePlanOptions({ autoMotor: { minSailKt: 3, motorKt: 5 } }, undefined);
  expect(on.autoMotor!.minSail).toBeCloseTo(3 * KN, 5);
  expect(on.autoMotor!.motor).toBeCloseTo(5 * KN, 5);

  const off = resolvePlanOptions({ autoMotor: { minSailKt: 0, motorKt: 5 } }, undefined);
  expect(off.autoMotor).toBeUndefined();
});

it('a present request autoMotor overrides settings', () => {
  const o = resolvePlanOptions(
    { autoMotor: { minSailKt: 3, motorKt: 5 } },
    { autoMotor: { minSail: 2 * KN, motor: 4 * KN } },
  );
  expect(o.autoMotor!.minSail).toBeCloseTo(2 * KN, 5);
  expect(o.autoMotor!.motor).toBeCloseTo(4 * KN, 5);
});
