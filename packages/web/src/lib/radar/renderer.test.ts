import { describe, it, expect } from 'vitest';
import { RadarCanvas } from './renderer.js';
import type { Capabilities, DecodedSpoke } from './types.js';

function fakeCtx(size: number) {
  const fills: Array<{ x: number; y: number; style: string }> = [];
  return {
    canvas: { width: size, height: size },
    fillStyle: '' as string,
    set _s(v: string) { /* noop */ },
    clearRect() {},
    fillRect(x: number, y: number) { fills.push({ x, y, style: (this as any).fillStyle }); },
    _fills: fills,
  } as unknown as CanvasRenderingContext2D & { _fills: typeof fills };
}

const caps: Capabilities = {
  spokesPerRevolution: 2048, maxSpokeLength: 4, maxRange: 1000, minRange: 50,
  supportedRanges: [1000],
  legend: { pixels: [
    { color: '#00000000', type: 'normal' }, // 0 transparent
    { color: '#0000ffff', type: 'normal' }, // 1 blue
    { color: '#00ff00ff', type: 'normal' }, // 2 green
    { color: '#ff0000ff', type: 'normal' }, // 3 red
  ] },
};

describe('RadarCanvas', () => {
  it('draws a fill for each non-zero cell and skips byte 0', () => {
    const ctx = fakeCtx(256) as any;
    const rc = new RadarCanvas(ctx, caps, 256);
    const spoke: DecodedSpoke = { angle: 0, range: 1000, data: new Uint8Array([0, 1, 2, 3]) };
    rc.drawSpokes([spoke]);
    expect(ctx._fills.length).toBe(3); // byte 0 skipped, 3 painted
    expect(ctx._fills.every((f: any) => f.style.startsWith('rgba'))).toBe(true);
  });
});
