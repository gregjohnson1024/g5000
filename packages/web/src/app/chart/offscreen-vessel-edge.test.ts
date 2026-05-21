import { describe, it, expect } from 'vitest';
import { computeOffscreenAnchor } from './offscreen-vessel-edge';

const viewport = { width: 800, height: 600 };
const PAD = 24;

describe('computeOffscreenAnchor', () => {
  it('returns null when the boat is inside the viewport', () => {
    expect(
      computeOffscreenAnchor({ projected: { x: 400, y: 300 }, viewport, pad: PAD }),
    ).toBeNull();
  });

  it('clamps a boat off the right to the right edge', () => {
    const a = computeOffscreenAnchor({ projected: { x: 1200, y: 300 }, viewport, pad: PAD });
    expect(a).not.toBeNull();
    expect(a!.x).toBe(800 - PAD);
    expect(a!.y).toBe(300);
  });

  it('clamps a boat off the left to the left edge', () => {
    const a = computeOffscreenAnchor({ projected: { x: -100, y: 300 }, viewport, pad: PAD });
    expect(a!.x).toBe(PAD);
    expect(a!.y).toBe(300);
  });

  it('clamps a boat off the top to the top edge', () => {
    const a = computeOffscreenAnchor({ projected: { x: 400, y: -50 }, viewport, pad: PAD });
    expect(a!.x).toBe(400);
    expect(a!.y).toBe(PAD);
  });

  it('clamps a boat off the bottom to the bottom edge', () => {
    const a = computeOffscreenAnchor({ projected: { x: 400, y: 700 }, viewport, pad: PAD });
    expect(a!.x).toBe(400);
    expect(a!.y).toBe(600 - PAD);
  });

  it('clamps a corner case (off both axes) into the corner', () => {
    const a = computeOffscreenAnchor({ projected: { x: 1200, y: 700 }, viewport, pad: PAD });
    expect(a!.x).toBe(800 - PAD);
    expect(a!.y).toBe(600 - PAD);
  });

  it("reports the boat's screen-space bearing in degrees, clockwise from up", () => {
    // boat off to the right at same y as center: bearing should be 90°
    const a = computeOffscreenAnchor({
      projected: { x: 1200, y: 300 },
      viewport,
      pad: PAD,
    });
    expect(a!.bearingDeg).toBeCloseTo(90, 0);

    // boat directly above center: bearing should be 0°
    const b = computeOffscreenAnchor({
      projected: { x: 400, y: -50 },
      viewport,
      pad: PAD,
    });
    expect(b!.bearingDeg).toBeCloseTo(0, 0);
  });
});
