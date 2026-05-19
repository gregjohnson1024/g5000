import { describe, it, expect } from 'vitest';
import { createWindShiftDetector } from './wind-shift.js';

const DEG = Math.PI / 180;

describe('windShiftDetector', () => {
  it('publishes shift of 0 when current matches baseline', () => {
    const d = createWindShiftDetector({
      baselineWindowMs: 300_000,
      currentWindowMs: 30_000,
      getThresholdRad: () => 7 * DEG,
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
      getThresholdRad: () => 7 * DEG,
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
      getThresholdRad: () => 7 * DEG,
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
      getThresholdRad: () => 7 * DEG,
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

  it('threshold change applies on the next update without recreating the detector', () => {
    // Mutable threshold the getter closes over — simulates RaceState.subscribe
    // updating a settings value live. Use a 20-min baseline window so the
    // baseline median stays anchored at 180° throughout the test (a 5-min
    // baseline would flip to 195° around the same time persistence fires).
    let thresholdDeg = 20; // Initially too high for a 15° shift to fire.
    const d = createWindShiftDetector({
      baselineWindowMs: 1_200_000,
      currentWindowMs: 30_000,
      getThresholdRad: () => thresholdDeg * DEG,
      persistenceMs: 60_000,
    });
    // 300 baseline samples at 180°.
    for (let i = 0; i < 300; i++) d.update(180 * DEG, i * 1000);
    // 90 seconds of 15° shift. With threshold=20°, the 15° bias never
    // exceeds threshold, so no event fires.
    let event: ReturnType<typeof d.update>['event'] = null;
    for (let i = 300; i < 390; i++) {
      const r = d.update(195 * DEG, i * 1000);
      if (r.event) event = r.event;
    }
    expect(event).toBeNull();
    // Now lower the threshold to 7° via the getter — without recreating
    // the detector. The very next update should observe that 15° > 7°
    // and start counting persistence. After 60s of continued shift the
    // event fires; the baseline window is intact (samples were never
    // reset by a detector swap).
    thresholdDeg = 7;
    let postLowerEvent: ReturnType<typeof d.update>['event'] = null;
    for (let i = 390; i < 390 + 65; i++) {
      const r = d.update(195 * DEG, i * 1000);
      if (r.event) postLowerEvent = r.event;
    }
    expect(postLowerEvent).not.toBeNull();
  });
});
