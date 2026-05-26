import { describe, it, expect } from 'vitest';
import { PLANNING_DEFAULTS, resolvePlanOptions } from './planning-settings.js';

const KN = 0.514444;

it('returns engine defaults when settings and overrides are empty', () => {
  const o = resolvePlanOptions(undefined, undefined);
  expect(o.stepMinutes).toBe(PLANNING_DEFAULTS.stepMinutes);
  expect(o.avoidLand).toBe(true);
  expect(o.captureIsochrones).toBe(false);
  expect(o.autoMotor).toBeUndefined();
});

it('settings override defaults, request overrides settings', () => {
  const settings = {
    pruneBucketDeg: 5,
    avoidLand: true,
    autoMotor: { enabled: true, minSailKt: 3, motorKt: 6 },
  };
  const o = resolvePlanOptions(settings, { avoidLand: false, maxHours: 48 });
  expect(o.pruneBucketDeg).toBe(5); // from settings
  expect(o.avoidLand).toBe(false); // request wins
  expect(o.maxHours).toBe(48); // request
});

it('converts auto-motor knots to m/s and only when enabled', () => {
  const on = resolvePlanOptions(
    { autoMotor: { enabled: true, minSailKt: 3, motorKt: 5 } },
    undefined,
  );
  expect(on.autoMotor!.minSail).toBeCloseTo(3 * KN, 5);
  expect(on.autoMotor!.motor).toBeCloseTo(5 * KN, 5);
  const off = resolvePlanOptions(
    { autoMotor: { enabled: false, minSailKt: 3, motorKt: 5 } },
    undefined,
  );
  expect(off.autoMotor).toBeUndefined();
});
