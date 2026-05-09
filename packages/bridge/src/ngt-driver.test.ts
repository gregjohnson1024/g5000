import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { Ngt1Driver, type Ngt1Source } from './ngt-driver.js';

/**
 * A minimal in-memory Ngt1Source: the driver accepts any object that emits
 * 'data' Buffer events. We emit pre-recorded canboat ASCII lines, which is
 * the simplest form Ngt1Driver must understand.
 */
class MemorySource implements Ngt1Source {
  private listener: ((chunk: Buffer) => void) | null = null;
  on(event: 'data', cb: (chunk: Buffer) => void): this {
    if (event === 'data') this.listener = cb;
    return this;
  }
  off(): this {
    this.listener = null;
    return this;
  }
  emit(text: string): void {
    this.listener?.(Buffer.from(text, 'utf8'));
  }
}

describe('Ngt1Driver', () => {
  let source: MemorySource;
  let driver: Ngt1Driver;

  beforeEach(async () => {
    source = new MemorySource();
    driver = new Ngt1Driver({ source });
    await driver.start();
  });

  it('parses an Actisense ASCII wind-PGN line into a RawCanFrame', async () => {
    // PGN 130306 (wind), prio 2, src 17, dst 255, 8-byte payload.
    const line =
      '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa\n';
    const framePromise = firstValueFrom(driver.rxCan);
    source.emit(line);
    const frame = await framePromise;
    expect(frame.ext).toBe(true);
    expect(frame.data).toBeInstanceOf(Uint8Array);
    expect(frame.data.length).toBe(8);
    // ID encodes prio (3 bits) + PGN (17 bits) + source (8 bits).
    // For PGN 130306 with prio 2 and src 17: see J1939 packing.
    expect(frame.id).toBeGreaterThan(0);
    expect(frame.rxTimestamp).toBeTypeOf('bigint');
  });

  it('emits one frame per line', async () => {
    const lines = [
      '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,fe,7f,ff,fa,fa\n',
      '2024-01-01-12:00:00.100,2,128259,17,255,8,a0,01,00,00,00,00,ff,ff\n',
      '2024-01-01-12:00:00.200,3,127250,17,255,8,a0,01,d0,07,ff,ff,fc,ff\n',
    ];
    const collected = firstValueFrom(driver.rxCan.pipe(take(3), toArray()));
    for (const l of lines) source.emit(l);
    const frames = await collected;
    expect(frames).toHaveLength(3);
  });
});
