import { describe, it, expect } from 'vitest';
import { classifyPointOfSail, type PointOfSail } from './point-of-sail.js';

const DEG = Math.PI / 180;
const KN = 0.514444;
const base = {
  twsMs: 8 * KN,
  bspMs: 6 * KN,
  reachingLoRad: 70 * DEG,
  reachingHiRad: 110 * DEG,
  twsFloorMs: 3 * KN,
  steerageFloorMs: 1 * KN,
};

describe('classifyPointOfSail', () => {
  it('returns not-sailing below the wind floor', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 45 * DEG, twsMs: 2 * KN })).toBe<PointOfSail>('not-sailing');
  });
  it('returns not-sailing below steerage', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 45 * DEG, bspMs: 0.5 * KN })).toBe<PointOfSail>('not-sailing');
  });
  it('classifies a beat as upwind', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 45 * DEG })).toBe<PointOfSail>('upwind');
  });
  it('classifies the no-mans-land as reaching', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 90 * DEG })).toBe<PointOfSail>('reaching');
  });
  it('classifies a run as downwind', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 150 * DEG })).toBe<PointOfSail>('downwind');
  });
  it('uses the boundaries inclusively on the upwind side', () => {
    expect(classifyPointOfSail({ ...base, twaAbsRad: 70 * DEG })).toBe<PointOfSail>('reaching');
    expect(classifyPointOfSail({ ...base, twaAbsRad: 69.9 * DEG })).toBe<PointOfSail>('upwind');
  });
});
