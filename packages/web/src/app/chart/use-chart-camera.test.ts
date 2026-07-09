import { describe, it, expect } from 'vitest';
import {
  applyZoomPivot,
  cycleOrientation,
  wrapBearingDelta,
  readFollowFromStorage,
  readOrientationFromStorage,
} from './use-chart-camera';

describe('applyZoomPivot', () => {
  /** Mimics MapLibre's ScrollZoomHandler: enable() is a NO-OP while already
   *  enabled — the exact trap that made the first version of this feature
   *  silently do nothing. Starts enabled, like a real map. */
  function stubHandler() {
    const calls: Array<string> = [];
    let enabled = true;
    let aroundCenter = false;
    return {
      calls,
      get aroundCenter() {
        return aroundCenter;
      },
      enable(opts?: { around?: string }) {
        calls.push(`enable(${opts?.around ?? ''})`);
        if (enabled) return; // ScrollZoomHandler's isEnabled() guard
        enabled = true;
        aroundCenter = opts?.around === 'center';
      },
      disable() {
        calls.push('disable()');
        enabled = false;
      },
      isEnabled: () => enabled,
      isActive: () => false,
    };
  }

  it('makes around:center stick on an already-enabled handler (disable first)', () => {
    const scrollZoom = stubHandler();
    const touchZoomRotate = stubHandler();
    applyZoomPivot(
      { scrollZoom, touchZoomRotate } as unknown as Parameters<typeof applyZoomPivot>[0],
      true,
    );
    expect(scrollZoom.aroundCenter).toBe(true);
    expect(touchZoomRotate.aroundCenter).toBe(true);
    expect(scrollZoom.calls).toEqual(['disable()', 'enable(center)']);
  });

  it('restores default cursor-pivot zoom when follow is off', () => {
    const scrollZoom = stubHandler();
    const touchZoomRotate = stubHandler();
    const m = { scrollZoom, touchZoomRotate } as unknown as Parameters<typeof applyZoomPivot>[0];
    applyZoomPivot(m, true);
    applyZoomPivot(m, false);
    expect(scrollZoom.aroundCenter).toBe(false);
    expect(touchZoomRotate.aroundCenter).toBe(false);
  });
});

describe('cycleOrientation', () => {
  it('walks north → course → heading → north', () => {
    expect(cycleOrientation('north')).toBe('course');
    expect(cycleOrientation('course')).toBe('heading');
    expect(cycleOrientation('heading')).toBe('north');
  });
});

describe('wrapBearingDelta', () => {
  it('handles unwrapped deltas', () => {
    expect(wrapBearingDelta(10, 20)).toBe(10);
    expect(wrapBearingDelta(170, 175)).toBe(5);
  });
  it('handles wrap across 0/360', () => {
    expect(wrapBearingDelta(350, 10)).toBe(20);
    expect(wrapBearingDelta(10, 350)).toBe(20);
    expect(wrapBearingDelta(0, 359)).toBe(1);
  });
  it('is symmetric and non-negative', () => {
    expect(wrapBearingDelta(180, 0)).toBe(180);
    expect(wrapBearingDelta(0, 180)).toBe(180);
  });
});

describe('readFollowFromStorage', () => {
  it('defaults to true on missing storage', () => {
    expect(readFollowFromStorage(null)).toBe(true);
  });
  it('parses stored true / false', () => {
    expect(readFollowFromStorage('true')).toBe(true);
    expect(readFollowFromStorage('false')).toBe(false);
  });
  it('falls back to true on bad JSON', () => {
    expect(readFollowFromStorage('not json')).toBe(true);
    expect(readFollowFromStorage('null')).toBe(true);
  });
});

describe('readOrientationFromStorage', () => {
  it('defaults to north on missing storage', () => {
    expect(readOrientationFromStorage(null)).toBe('north');
  });
  it('accepts known values', () => {
    expect(readOrientationFromStorage('north')).toBe('north');
    expect(readOrientationFromStorage('course')).toBe('course');
    expect(readOrientationFromStorage('heading')).toBe('heading');
  });
  it('falls back to north on garbage', () => {
    expect(readOrientationFromStorage('something else')).toBe('north');
    expect(readOrientationFromStorage('')).toBe('north');
  });
});
