import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { decodeRadarMessage } from './proto';

const frame = new Uint8Array(
  readFileSync(fileURLToPath(new URL('./__fixtures__/spoke-frame.bin', import.meta.url))),
);

describe('decodeRadarMessage', () => {
  it('decodes spokes with angle/range/data', () => {
    const spokes = decodeRadarMessage(frame);
    expect(spokes.length).toBeGreaterThan(0);
    const s = spokes[0]!;
    expect(s.angle).toBeGreaterThanOrEqual(0);
    expect(s.range).toBeGreaterThan(0);
    expect(s.data.length).toBeGreaterThan(0);
  });
});
