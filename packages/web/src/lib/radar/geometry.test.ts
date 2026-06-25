import { describe, it, expect } from 'vitest';
import { spokeToCanvas } from './geometry.js';

describe('spokeToCanvas', () => {
  const N = 2048,
    SIZE = 512;
  it('angle 0 (north/up) at full range points straight up', () => {
    const { x, y } = spokeToCanvas(0, N, 1023, 1024, 1000, SIZE);
    expect(x).toBeCloseTo(SIZE / 2, 0);
    expect(y).toBeCloseTo(0, 0); // top edge
  });
  it('quarter turn points to the right (east)', () => {
    const { x, y } = spokeToCanvas(N / 4, N, 1023, 1024, 1000, SIZE);
    expect(x).toBeCloseTo(SIZE, 0);
    expect(y).toBeCloseTo(SIZE / 2, 0);
  });
  it('cell at half index sits at half radius', () => {
    const { y } = spokeToCanvas(0, N, 511, 1024, 1000, SIZE);
    // dir=0 → straight up; cell 511/1023 ≈ half radius → ~SIZE/4 above centre.
    expect(y).toBeCloseTo(SIZE / 2 - SIZE / 4, 0);
  });
});
