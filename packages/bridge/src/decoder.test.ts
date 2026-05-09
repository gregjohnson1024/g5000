import { describe, it, expect } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { decodeFrames, type DecodedPgn } from './decoder.js';
import { parseActisenseLine } from './ngt-driver.js';

describe('decodeFrames', () => {
  it('decodes a wind PGN 130306 from a raw CAN frame', async () => {
    const line =
      '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa';
    const frame = parseActisenseLine(line);
    expect(frame).toBeTruthy();
    const decoded = await firstValueFrom(decodeFrames(of(frame!)));
    expect(decoded.pgn).toBe(130306);
    expect(decoded.src).toBe(17);
    expect(decoded.fields).toBeDefined();
    // canboat exposes wind speed and angle; field names may vary slightly,
    // but at least one of these is present:
    const fieldKeys = Object.keys(decoded.fields);
    expect(
      fieldKeys.some((k) =>
        ['Wind Speed', 'Wind Angle', 'Reference'].includes(k),
      ),
    ).toBe(true);
  });

  it('emits one DecodedPgn per single-frame input', async () => {
    const lines = [
      '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa',
      '2024-01-01-12:00:00.100,2,128259,17,255,8,a0,01,00,00,00,00,ff,ff',
    ];
    const frames = lines.map(parseActisenseLine).filter((f) => f !== null);
    const result: DecodedPgn[] = [];
    await new Promise<void>((resolve) => {
      decodeFrames(of(...frames)).subscribe({
        next: (p) => result.push(p),
        complete: resolve,
      });
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.map((r) => r.pgn).sort()).toContain(130306);
  });
});
