import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildStops,
  colourAtPosition,
  normalisedPosition,
  colourForValue,
  type RampStop,
} from './ramp';

// ---------------------------------------------------------------------------
// Canonical-ramp law: RampLegend stops === HeatmapGrid render stops
// ---------------------------------------------------------------------------

// Helper: build stops once; both RampLegend and HeatmapGrid share this reference.
// The test verifies that a value mapped by colourForValue matches a manually
// iterated stop lookup — proving the legend cannot drift from the grid.

describe('buildStops — sequential', () => {
  it('returns 6 stops', () => {
    const stops = buildStops('sequential');
    expect(stops.length).toBe(6);
  });

  it('positions span 0 to 1', () => {
    const stops = buildStops('sequential');
    expect(stops[0]![0]).toBe(0);
    expect(stops[stops.length - 1]![0]).toBe(1);
  });

  it('positions are monotonically increasing', () => {
    const stops = buildStops('sequential');
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]![0]).toBeGreaterThan(stops[i - 1]![0]);
    }
  });
});

describe('buildStops — diverging', () => {
  it('returns 7 stops', () => {
    const stops = buildStops('diverging');
    expect(stops.length).toBe(7);
  });

  it('has centre stop at position 0.5', () => {
    const stops = buildStops('diverging');
    const midStop = stops.find(([p]) => p === 0.5);
    expect(midStop).toBeDefined();
  });

  it('positions span 0 to 1', () => {
    const stops = buildStops('diverging');
    expect(stops[0]![0]).toBe(0);
    expect(stops[stops.length - 1]![0]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RampLegend stops === HeatmapGrid render stops (the law)
// ---------------------------------------------------------------------------

describe('canonical-ramp law: legend and grid use same stops', () => {
  it('colourAtPosition is identical to what HeatmapGrid uses via colourForValue', () => {
    const stops = buildStops('sequential');
    const domain = { mode: 'sequential' as const, min: 0, max: 100 };

    // Test several positions
    const testValues = [0, 25, 50, 75, 100];
    for (const v of testValues) {
      const t = normalisedPosition(v, domain);
      // Grid path: colourForValue calls colourAtPosition internally
      const gridColour = colourForValue(v, stops, domain);
      // Legend path: directly call colourAtPosition with the same t
      const legendColour = colourAtPosition(t, stops);
      expect(gridColour).toBe(legendColour);
    }
  });

  it('sequential and diverging stops are distinct (ramps are different)', () => {
    const seqStops = buildStops('sequential');
    const divStops = buildStops('diverging');
    expect(seqStops.length).not.toBe(divStops.length);
  });
});

// ---------------------------------------------------------------------------
// normalisedPosition
// ---------------------------------------------------------------------------

describe('normalisedPosition — sequential', () => {
  const domain = { mode: 'sequential' as const, min: 10, max: 30 };

  it('maps min → 0', () => {
    expect(normalisedPosition(10, domain)).toBe(0);
  });

  it('maps max → 1', () => {
    expect(normalisedPosition(30, domain)).toBe(1);
  });

  it('maps midpoint → 0.5', () => {
    expect(normalisedPosition(20, domain)).toBe(0.5);
  });

  it('clamps below min to 0', () => {
    expect(normalisedPosition(0, domain)).toBe(0);
  });

  it('clamps above max to 1', () => {
    expect(normalisedPosition(50, domain)).toBe(1);
  });
});

describe('normalisedPosition — diverging', () => {
  const domain = { mode: 'diverging' as const, maxAbs: 10 };

  it('maps 0 → 0.5 (centre)', () => {
    expect(normalisedPosition(0, domain)).toBe(0.5);
  });

  it('maps +maxAbs → 1', () => {
    expect(normalisedPosition(10, domain)).toBe(1);
  });

  it('maps -maxAbs → 0', () => {
    expect(normalisedPosition(-10, domain)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// colourAtPosition — step interpolation
// ---------------------------------------------------------------------------

describe('colourAtPosition', () => {
  const stops: RampStop[] = [
    [0.0, '#aaa'],
    [0.5, '#bbb'],
    [1.0, '#ccc'],
  ];

  it('returns first stop colour at position 0', () => {
    expect(colourAtPosition(0, stops)).toBe('#aaa');
  });

  it('returns last stop colour at position 1', () => {
    expect(colourAtPosition(1, stops)).toBe('#ccc');
  });

  it('step-wise: position 0.3 returns first stop (nearest ≤)', () => {
    expect(colourAtPosition(0.3, stops)).toBe('#aaa');
  });

  it('step-wise: position 0.5 returns second stop', () => {
    expect(colourAtPosition(0.5, stops)).toBe('#bbb');
  });

  it('step-wise: position 0.7 returns second stop (nearest ≤)', () => {
    expect(colourAtPosition(0.7, stops)).toBe('#bbb');
  });

  it('returns transparent for empty stops', () => {
    expect(colourAtPosition(0.5, [])).toBe('transparent');
  });
});
