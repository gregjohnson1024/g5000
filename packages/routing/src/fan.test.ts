import { describe, it, expect } from 'vitest';
import { generateHeadingFan } from './fan.js';

const DEG = Math.PI / 180;

describe('generateHeadingFan', () => {
  it('returns ±90° at 5° resolution → 37 headings symmetric around center', () => {
    const headings = generateHeadingFan(0, 90 * DEG, 5 * DEG);
    expect(headings.length).toBe(37);
    expect(headings[0]).toBeCloseTo(-90 * DEG, 6);
    expect(headings[18]).toBeCloseTo(0, 6);
    expect(headings[36]).toBeCloseTo(90 * DEG, 6);
  });

  it('shifts the fan around an arbitrary center', () => {
    const headings = generateHeadingFan(Math.PI / 2, 45 * DEG, 15 * DEG);
    expect(headings.length).toBe(7);
    expect(headings[0]).toBeCloseTo(Math.PI / 2 - 45 * DEG, 6);
    expect(headings[6]).toBeCloseTo(Math.PI / 2 + 45 * DEG, 6);
  });

  it('handles wrap around 2π', () => {
    const headings = generateHeadingFan(0, 180 * DEG, 90 * DEG);
    // values: -π, -π/2, 0, π/2, π — normalized to [0, 2π) they're π, 3π/2, 0, π/2, π
    expect(headings.length).toBe(5);
  });
});
