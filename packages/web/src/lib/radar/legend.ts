import type { Legend } from './types.js';

/** Parse "#rrggbbaa" | "#rrggbb" | "#rgb[a]" into [r,g,b,a] (0-255). */
export function hexToRgba(hex: string): [number, number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const bytes: number[] = [];
  for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
  while (bytes.length < 3) bytes.push(0);
  while (bytes.length < 4) bytes.push(255);
  return [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!];
}

/** 256-entry RGBA lookup; unmapped indices default to opaque red. */
export function buildColorLut(legend: Legend): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    lut[i * 4] = 255;
    lut[i * 4 + 1] = 0;
    lut[i * 4 + 2] = 0;
    lut[i * 4 + 3] = 255;
  }
  legend.pixels.slice(0, 256).forEach((p, i) => {
    const [r, g, b, a] = hexToRgba(p.color);
    lut[i * 4] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = b;
    lut[i * 4 + 3] = a;
  });
  return lut;
}
