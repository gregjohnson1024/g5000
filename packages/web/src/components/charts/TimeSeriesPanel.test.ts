import { describe, it, expect } from 'vitest';
import { computeYDomain, yTicks, yCoord, fmtTick } from './plot-scale';

// ---------------------------------------------------------------------------
// Fixed domain — kills the ±0.1°-renders-as-drama bug
// ---------------------------------------------------------------------------

describe('computeYDomain — fixed domain', () => {
  it('uses fixed domain verbatim regardless of data values', () => {
    // Series with ±0.1 noise — with domain [-5, 5] it should stay flat
    const values = [-0.1, -0.05, 0, 0.05, 0.1];
    const domain = computeYDomain(values, [-5, 5]);
    expect(domain.min).toBe(-5);
    expect(domain.max).toBe(5);
  });

  it('domain fixed to [-5, 5]: data at ±0.1 renders as flatline not full-height', () => {
    const domain = { min: -5, max: 5 };
    const plotH = 100;
    const plotTop = 0;

    // v=0 should be at plotH/2 = 50
    expect(yCoord(0, domain, plotTop, plotH)).toBe(50);

    // v=0.1 in a [-5,5] domain: relative position = (0.1-(-5))/(10) = 0.51
    // yCoord = (1 - 0.51) * 100 = 49
    const y01 = yCoord(0.1, domain, plotTop, plotH);
    const y_01 = yCoord(-0.1, domain, plotTop, plotH);
    // Should differ by only 1 pixel (2% of 100px height), not full height
    const pixelDiff = Math.abs(y01 - y_01);
    expect(pixelDiff).toBeLessThan(5);
  });
});

describe('computeYDomain — auto-fit', () => {
  it('auto-fit: ±0.1 data gets minimum span of 1 (not full-height drama without fixed domain)', () => {
    // With the MIN_SPAN guard, ±0.1 noise is padded to at least 1 unit of span.
    // This is the bug-fix: without fixed domain, noise still gets a sensible floor —
    // the old code would auto-fit to 0.2-span making ±0.1 look like a ±5° swings.
    const values = [-0.1, 0, 0.1];
    const domain = computeYDomain(values);
    // MIN_SPAN guard applies: span should be exactly 1 (centre ±0.5)
    expect(domain.max - domain.min).toBeGreaterThanOrEqual(1);
    // Domain should be centred around the data (roughly 0 ± 0.5)
    const mid = (domain.min + domain.max) / 2;
    expect(mid).toBeCloseTo(0, 1);
  });

  it('auto-fit enforces minimum span of 1', () => {
    // All same value — span would be 0 without the MIN_SPAN guard
    const values = [5, 5, 5];
    const domain = computeYDomain(values);
    expect(domain.max - domain.min).toBeGreaterThanOrEqual(1);
  });

  it('empty values returns 0,1 domain', () => {
    const domain = computeYDomain([]);
    expect(domain.min).toBe(0);
    expect(domain.max).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// yTicks — exactly 3 ticks
// ---------------------------------------------------------------------------

describe('yTicks', () => {
  it('returns exactly 3 ticks', () => {
    const domain = { min: 0, max: 100 };
    const ticks = yTicks(domain);
    expect(ticks.length).toBe(3);
  });

  it('first tick is domain min', () => {
    const domain = { min: 10, max: 90 };
    const [t0] = yTicks(domain);
    expect(t0).toBe(10);
  });

  it('third tick is domain max', () => {
    const domain = { min: 10, max: 90 };
    const ticks = yTicks(domain);
    expect(ticks[2]).toBe(90);
  });

  it('second tick is midpoint', () => {
    const domain = { min: 0, max: 100 };
    const ticks = yTicks(domain);
    expect(ticks[1]).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// fmtTick
// ---------------------------------------------------------------------------

describe('fmtTick', () => {
  it('integer stays integer', () => {
    expect(fmtTick(5)).toBe('5');
  });

  it('large values formatted as integer', () => {
    expect(fmtTick(123)).toBe('123');
  });

  it('small decimal formatted to 1 dp', () => {
    expect(fmtTick(3.7)).toBe('3.7');
  });

  it('zero is integer', () => {
    expect(fmtTick(0)).toBe('0');
  });
});
