import { buildColorLut } from './legend.js';
import { spokeToCanvas } from './geometry.js';
import type { Capabilities, DecodedSpoke } from './types.js';

type Ctx = Pick<CanvasRenderingContext2D, 'clearRect' | 'fillRect' | 'canvas'> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
};

export class RadarCanvas {
  private readonly lut: Uint8ClampedArray;
  private readonly spokesPerRev: number;
  /** width in px of one painted cell, ~ so adjacent spokes don't gap at the rim. */
  private readonly cell: number;

  constructor(
    private readonly ctx: Ctx,
    caps: Capabilities,
    private readonly size: number,
  ) {
    this.lut = buildColorLut(caps.legend);
    this.spokesPerRev = caps.spokesPerRevolution;
    this.cell = Math.max(2, Math.ceil((Math.PI * size) / caps.spokesPerRevolution));
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.size, this.size);
  }

  drawSpokes(spokes: DecodedSpoke[]): void {
    for (const s of spokes) {
      const dir = s.bearing ?? s.angle; // true-north when present, else from bow
      const n = s.data.length;
      for (let i = 0; i < n; i++) {
        const v = s.data[i]!;
        if (v === 0) continue; // transparent
        const r = v * 4;
        this.ctx.fillStyle = `rgba(${this.lut[r]},${this.lut[r + 1]},${this.lut[r + 2]},${this.lut[r + 3]! / 255})`;
        const { x, y } = spokeToCanvas(dir, this.spokesPerRev, i, n, s.range, this.size);
        this.ctx.fillRect(x - this.cell / 2, y - this.cell / 2, this.cell, this.cell);
      }
    }
  }
}
