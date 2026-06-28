import { describe, it, expect } from 'vitest';
import { RadarCanvas } from './renderer';
import type { Capabilities, DecodedSpoke } from './types';

function fakeCtx(size: number) {
  const fills: Array<{ x: number; y: number; style: string }> = [];
  const clears: Array<{ x: number; y: number }> = [];
  return {
    canvas: { width: size, height: size },
    fillStyle: '' as string,
    set _s(v: string) {
      /* noop */
    },
    clearRect(x: number, y: number) {
      clears.push({ x, y });
    },
    fillRect(x: number, y: number) {
      fills.push({ x, y, style: (this as any).fillStyle });
    },
    _fills: fills,
    _clears: clears,
  } as unknown as CanvasRenderingContext2D & { _fills: typeof fills; _clears: typeof clears };
}

const caps: Capabilities = {
  spokesPerRevolution: 2048,
  maxSpokeLength: 4,
  maxRange: 1000,
  minRange: 50,
  supportedRanges: [1000],
  legend: {
    pixels: [
      { color: '#00000000', type: 'normal' }, // 0 transparent
      { color: '#0000ffff', type: 'normal' }, // 1 blue
      { color: '#00ff00ff', type: 'normal' }, // 2 green
      { color: '#ff0000ff', type: 'normal' }, // 3 red
    ],
  },
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

  it('clears EVERY cell before painting (incl. empty ones) so stale echoes do not accumulate', () => {
    const ctx = fakeCtx(256) as any;
    const rc = new RadarCanvas(ctx, caps, 256);
    // byte 0 (empty) must still be cleared, otherwise a now-empty cell keeps last
    // sweep's echo and the PPI smears.
    const spoke: DecodedSpoke = { angle: 0, range: 1000, data: new Uint8Array([0, 1, 0, 2]) };
    rc.drawSpokes([spoke]);
    expect(ctx._clears.length).toBe(4); // all 4 cells cleared
    expect(ctx._fills.length).toBe(2); // only the 2 non-zero cells painted
    // every painted cell sits exactly on top of a cleared cell
    for (const f of ctx._fills) {
      expect(ctx._clears.some((c: any) => c.x === f.x && c.y === f.y)).toBe(true);
    }
  });
});
