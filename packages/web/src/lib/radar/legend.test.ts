import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildColorLut } from './legend';
import type { Capabilities } from './types';

const caps: Capabilities = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/capabilities.json', import.meta.url)), 'utf8'),
);

describe('buildColorLut', () => {
  it('maps byte 0 to transparent and known indices to legend colours', () => {
    const lut = buildColorLut(caps.legend);
    expect(lut.length).toBe(256 * 4);
    expect(lut[3]).toBe(0); // byte 0 alpha = transparent
    const idx = caps.legend.pixels.findIndex((p, i) => i > 0 && p.color !== '#00000000');
    expect(lut[idx * 4 + 3]).toBeGreaterThan(0); // a real return is opaque
  });

  it('defaults unmapped indices to opaque red', () => {
    const lut = buildColorLut({ pixels: [{ color: '#00000000', type: 'normal' }] });
    expect([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2], lut[255 * 4 + 3]]).toEqual([
      255, 0, 0, 255,
    ]);
  });
});
