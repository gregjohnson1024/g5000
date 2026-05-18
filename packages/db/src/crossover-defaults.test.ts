import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CROSSOVER_MAP,
  DEFAULT_CROSSOVER_SETTINGS,
  type CrossoverMap,
  type CrossoverSettings,
} from './defaults.js';

describe('CrossoverMap defaults', () => {
  it('starts empty and scoped to sula/default', () => {
    expect(DEFAULT_CROSSOVER_MAP.boatId).toBe('sula');
    expect(DEFAULT_CROSSOVER_MAP.mode).toBe('default');
    expect(DEFAULT_CROSSOVER_MAP.cells).toEqual({});
    expect(DEFAULT_CROSSOVER_MAP.updatedAt).toBe(0);
  });

  it('cells are keyed by "twsIdx,twaIdx" strings', () => {
    const m: CrossoverMap = {
      boatId: 'sula',
      mode: 'default',
      cells: { '0,5': 'full-j1', '3,2': 'reef1-j2' },
      updatedAt: 1700000000,
    };
    expect(Object.keys(m.cells)).toHaveLength(2);
  });
});

describe('CrossoverSettings defaults', () => {
  it('uses time-based hysteresis, not speed-based', () => {
    const s: CrossoverSettings = DEFAULT_CROSSOVER_SETTINGS;
    expect(s.recommendationStableSeconds).toBe(30);
    // verify no speed-margin field exists
    expect((s as unknown as { hysteresisPercent?: number }).hysteresisPercent).toBeUndefined();
  });

  it('chart bounds are sensible knots/degrees', () => {
    const s = DEFAULT_CROSSOVER_SETTINGS;
    expect(s.chartTwsMaxKn).toBe(30);
    expect(s.chartTwaMinDeg).toBe(30);
    expect(s.chartTwaMaxDeg).toBe(180);
    expect(s.forecastIntervalMinutes).toBe(30);
    expect(s.forecastDurationHours).toBe(12);
  });
});
