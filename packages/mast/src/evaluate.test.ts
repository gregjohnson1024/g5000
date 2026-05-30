import { describe, it, expect } from 'vitest';
import { evaluateMode, selectActivePage } from './evaluate.js';
import { DEFAULT_MAST_LAYOUT } from './default-layout.js';

const DEG = Math.PI / 180;

describe('evaluateMode', () => {
  it('returns delivery when an engine is running', () => {
    expect(evaluateMode({ twaRad: 45 * DEG, sogMs: 3, engineRunning: true })).toBe('delivery');
  });
  it('returns stationary below the SOG threshold', () => {
    expect(evaluateMode({ twaRad: 45 * DEG, sogMs: 0.1, engineRunning: false })).toBe('stationary');
    expect(evaluateMode({ twaRad: null, sogMs: null, engineRunning: false })).toBe('stationary');
  });
  it('classifies upwind / downwind / reach by |TWA|', () => {
    expect(evaluateMode({ twaRad: 40 * DEG, sogMs: 3, engineRunning: false })).toBe('upwind');
    expect(evaluateMode({ twaRad: -40 * DEG, sogMs: 3, engineRunning: false })).toBe('upwind');
    expect(evaluateMode({ twaRad: 150 * DEG, sogMs: 3, engineRunning: false })).toBe('downwind');
    expect(evaluateMode({ twaRad: 90 * DEG, sogMs: 3, engineRunning: false })).toBe('reach');
  });
});

describe('selectActivePage', () => {
  it('honours a valid override above mode', () => {
    expect(selectActivePage(DEFAULT_MAST_LAYOUT, 'upwind', 'depth')).toBe('depth');
  });
  it('ignores an override that names no page', () => {
    expect(selectActivePage(DEFAULT_MAST_LAYOUT, 'upwind', 'ghost')).toBe('upwind');
  });
  it('matches a page by mode', () => {
    expect(selectActivePage(DEFAULT_MAST_LAYOUT, 'stationary', null)).toBe('depth');
  });
  it('falls back to the always page when no mode matches', () => {
    expect(selectActivePage(DEFAULT_MAST_LAYOUT, 'reach', null)).toBe('sailing');
  });
});
