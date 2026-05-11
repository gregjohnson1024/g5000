import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { Ngt1Driver, parseActisenseLine, type Ngt1Source } from './ngt-driver.js';
import { encodeN2KActisense } from '@canboat/canboatjs/lib/n2k-actisense.js';

/**
 * Hand-crafted PGN 130306 wind payload (8 bytes). The exact bytes don't
 * matter for these tests — we're asserting that the driver decodes the
 * framing correctly and produces a RawCanFrame, not that the payload
 * itself round-trips through canboat's PGN database.
 */
const WIND_PAYLOAD = Buffer.from([0xa0, 0x16, 0x02, 0x02, 0x7f, 0xff, 0xfa, 0xfa]);
const SPEED_PAYLOAD = Buffer.from([0xa0, 0x01, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff]);
const HEADING_PAYLOAD = Buffer.from([0xa0, 0x01, 0xd0, 0x07, 0xff, 0xff, 0xfc, 0xff]);

const windFrame = encodeN2KActisense({
  pgn: 130306,
  data: WIND_PAYLOAD,
  prio: 2,
  src: 17,
  dst: 255,
});
const speedFrame = encodeN2KActisense({
  pgn: 128259,
  data: SPEED_PAYLOAD,
  prio: 2,
  src: 17,
  dst: 255,
});
const headingFrame = encodeN2KActisense({
  pgn: 127250,
  data: HEADING_PAYLOAD,
  prio: 3,
  src: 17,
  dst: 255,
});

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
  emit(buf: Buffer): void {
    this.listener?.(buf);
  }
}

describe('Ngt1Driver — Actisense binary input', () => {
  let source: MemorySource;
  let driver: Ngt1Driver;

  beforeEach(async () => {
    source = new MemorySource();
    driver = new Ngt1Driver({ source });
    await driver.start();
  });

  it('decodes one binary Actisense frame into a RawCanFrame', async () => {
    const promised = firstValueFrom(driver.rxCan);
    source.emit(windFrame);
    const frame = await promised;
    expect(frame.ext).toBe(true);
    expect(frame.data).toBeInstanceOf(Uint8Array);
    expect(frame.data.length).toBe(WIND_PAYLOAD.length);
    expect(frame.id).toBeGreaterThan(0);
    expect(frame.rxTimestamp).toBeTypeOf('bigint');
    // The encoded source address survives the round-trip.
    expect(frame.id & 0xff).toBe(17);
  });

  it('emits one frame per binary packet, multiple packets in one chunk', async () => {
    const collected = firstValueFrom(driver.rxCan.pipe(take(3), toArray()));
    const combined = Buffer.concat([windFrame, speedFrame, headingFrame]);
    source.emit(combined);
    const frames = await collected;
    expect(frames).toHaveLength(3);
  });

  it('handles a packet split across two chunks', async () => {
    // Cut the wind frame at an arbitrary midpoint.
    const halfway = Math.floor(windFrame.length / 2);
    const chunk1 = windFrame.subarray(0, halfway);
    const chunk2 = windFrame.subarray(halfway);
    const promised = firstValueFrom(driver.rxCan);
    source.emit(chunk1);
    // No frame should have arrived yet (only partial).
    source.emit(chunk2);
    const frame = await promised;
    expect(frame.data.length).toBe(WIND_PAYLOAD.length);
  });
});

describe('parseActisenseLine — still useful as a fixture helper', () => {
  it('parses one canboat-format ASCII line into a RawCanFrame', () => {
    const f = parseActisenseLine(
      '2024-01-01-12:00:00.000,2,130306,17,255,8,a0,16,02,02,7f,ff,fa,fa',
    );
    expect(f?.ext).toBe(true);
    expect(f?.data.length).toBe(8);
  });
});

describe('Ngt1Driver.txPgn', () => {
  it('encodes a PGN 130306 wind frame and writes the line to the serial sink', async () => {
    const writes: Buffer[] = [];
    const sinkSource = {
      on(_event: 'data', _cb: (chunk: Buffer) => void) {
        return this;
      },
      off() {
        return this;
      },
      write(buf: Buffer | string, cb?: () => void): boolean {
        writes.push(typeof buf === 'string' ? Buffer.from(buf) : buf);
        cb?.();
        return true;
      },
    };
    const driver = new Ngt1Driver({ source: sinkSource as unknown as Ngt1Source });
    await driver.start();
    await driver.txPgn({
      pgn: 130306,
      prio: 2,
      dst: 255,
      fields: {
        'Wind Speed': 5.34,
        'Wind Angle': 1.0,
        Reference: 'Apparent',
      },
    });
    expect(writes.length).toBeGreaterThan(0);
    const text = Buffer.concat(writes).toString('utf8');
    expect(text).toMatch(/130306/);
    expect(text.endsWith('\n')).toBe(true);
  });
});
