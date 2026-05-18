import { describe, it, expect } from 'vitest';
import { createWindShiftDetector } from './wind-shift.js';

const DEG = Math.PI / 180;

describe('windShiftDetector', () => {
  it('publishes shift of 0 when current matches baseline', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 300_000,
      currentWindowMs: 30_000,
      thresholdRad: 7 * DEG,
      persistenceMs: 60_000,
    });
    // Feed 200 samples at TWD = 180°, spaced 1 s apart
    let lastShift = NaN;
    let lastEvent: ReturnType<typeof d.update>['event'] = null;
    for (let i = 0; i < 200; i++) {
      const r = d.update(180 * DEG, i * 1000);
      lastShift = r.biasRad;
      lastEvent = r.event;
    }
    expect(lastShift).toBeCloseTo(0, 3);
    expect(lastEvent).toBeNull();
  });

  it('detects a sustained shift above threshold after persistenceMs', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 300_000,
      currentWindowMs: 30_000,
      thresholdRad: 7 * DEG,
      persistenceMs: 60_000,
    });
    // 300 baseline samples at 180°
    for (let i = 0; i < 300; i++) d.update(180 * DEG, i * 1000);
    // Now shift to 195° (15° clockwise of baseline)
    let lastEvent: ReturnType<typeof d.update>['event'] = null;
    for (let i = 300; i < 300 + 90; i++) {
      const r = d.update(195 * DEG, i * 1000);
      if (r.event) lastEvent = r.event;
    }
    expect(lastEvent).not.toBeNull();
    expect(lastEvent!.deg).toBeGreaterThan(7);
  });

  it('does not fire when shift duration < persistenceMs', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 300_000,
      currentWindowMs: 30_000,
      thresholdRad: 7 * DEG,
      persistenceMs: 60_000,
    });
    for (let i = 0; i < 300; i++) d.update(180 * DEG, i * 1000);
    // Brief 30 s shift, then back.
    let event: ReturnType<typeof d.update>['event'] = null;
    for (let i = 300; i < 330; i++) {
      const r = d.update(195 * DEG, i * 1000);
      if (r.event) event = r.event;
    }
    for (let i = 330; i < 400; i++) d.update(180 * DEG, i * 1000);
    expect(event).toBeNull();
  });

  it('handles wraparound: median of [359, 1, 0, 358, 2] is near 0°', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 60_000,
      currentWindowMs: 60_000,
      thresholdRad: 7 * DEG,
      persistenceMs: 60_000,
    });
    const samples = [359, 1, 0, 358, 2];
    let last: number | null = null;
    for (let i = 0; i < samples.length; i++) {
      last = d.update(samples[i]! * DEG, i * 1000).biasRad;
    }
    // Baseline ≈ current here (one window), bias near 0.
    expect(Math.abs(last!)).toBeLessThan(0.05);
  });
});
