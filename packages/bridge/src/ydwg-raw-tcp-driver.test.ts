import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import {
  YdwgRawTcpDriver,
  parseYdRawLine,
  type YdwgSocket,
} from './ydwg-raw-tcp-driver.js';

/**
 * Fake socket — captures listeners and exposes a method to trigger each
 * event from the test. Matches the YdwgSocket shape.
 */
class FakeSocket implements YdwgSocket {
  dataCb: ((chunk: Buffer) => void) | null = null;
  closeCb: (() => void) | null = null;
  errorCb: ((err: Error) => void) | null = null;
  connectCb: (() => void) | null = null;
  timeoutCb: (() => void) | null = null;
  writes: string[] = [];
  destroyed = false;
  keepAliveCalls: Array<{ enable: boolean; initialDelayMs?: number }> = [];
  setTimeoutCalls: number[] = [];

  on(
    event: 'data' | 'close' | 'error' | 'connect' | 'timeout',
    cb: (...args: never[]) => void,
  ): this {
    if (event === 'data') this.dataCb = cb as (c: Buffer) => void;
    if (event === 'close') this.closeCb = cb as () => void;
    if (event === 'error') this.errorCb = cb as (e: Error) => void;
    if (event === 'connect') this.connectCb = cb as () => void;
    if (event === 'timeout') this.timeoutCb = cb as () => void;
    return this;
  }
  removeAllListeners(): this {
    this.dataCb = null;
    this.closeCb = null;
    this.errorCb = null;
    this.connectCb = null;
    this.timeoutCb = null;
    return this;
  }
  write(data: string | Buffer, cb?: (err?: Error | null) => void): boolean {
    this.writes.push(typeof data === 'string' ? data : data.toString('utf8'));
    cb?.(null);
    return true;
  }
  destroy(): this {
    this.destroyed = true;
    // Mimic net.Socket: destroy() leads to a 'close' event.
    queueMicrotask(() => this.closeCb?.());
    return this;
  }
  setKeepAlive(enable: boolean, initialDelayMs?: number): this {
    this.keepAliveCalls.push({ enable, initialDelayMs });
    return this;
  }
  setTimeout(ms: number): this {
    this.setTimeoutCalls.push(ms);
    return this;
  }
  // Test helpers
  emitData(buf: Buffer | string): void {
    this.dataCb?.(typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf);
  }
  fireConnect(): void {
    this.connectCb?.();
  }
  fireClose(): void {
    this.closeCb?.();
  }
  fireTimeout(): void {
    this.timeoutCb?.();
  }
}

describe('parseYdRawLine', () => {
  it('parses a full timestamped R line', () => {
    const r = parseYdRawLine('00:00:00.060 R 19F11402 30 00 00 00 00 00 00 00');
    expect(r).not.toBeNull();
    expect(r?.direction).toBe('R');
    expect(r?.id).toBe(0x19f11402);
    expect(r?.data.length).toBe(8);
    expect(r?.data[0]).toBe(0x30);
  });

  it('parses a T (transmitted) line', () => {
    const r = parseYdRawLine('00:00:00.060 T 19FA041F 23 80');
    expect(r?.direction).toBe('T');
    expect(r?.id).toBe(0x19fa041f);
    expect(r?.data.length).toBe(2);
  });

  it('parses a line without timestamp', () => {
    const r = parseYdRawLine('R 19FA041F 01 02 03');
    expect(r?.direction).toBe('R');
    expect(r?.data.length).toBe(3);
  });

  it('parses a line without direction (defaults to null)', () => {
    const r = parseYdRawLine('19FA041F 01 02');
    expect(r?.direction).toBe(null);
    expect(r?.id).toBe(0x19fa041f);
  });

  it('returns null for a line with no CAN ID', () => {
    expect(parseYdRawLine('00:00:00.060 R')).toBeNull();
  });

  it('returns null for a malformed byte', () => {
    expect(parseYdRawLine('R 19FA041F XX 02')).toBeNull();
  });

  it('returns null for non-hex CAN ID', () => {
    expect(parseYdRawLine('R ZZZZ 01')).toBeNull();
  });

  it('truncates more than 8 data bytes', () => {
    const r = parseYdRawLine('R 19FA041F 01 02 03 04 05 06 07 08 09 0A');
    expect(r?.data.length).toBe(8);
  });

  it('accepts zero data bytes', () => {
    const r = parseYdRawLine('R 19FA041F');
    expect(r?.data.length).toBe(0);
  });
});

describe('YdwgRawTcpDriver — RX', () => {
  let socket: FakeSocket;
  let driver: YdwgRawTcpDriver;

  beforeEach(async () => {
    socket = new FakeSocket();
    driver = new YdwgRawTcpDriver({
      socketFactory: () => socket,
      backoffMs: { initialMs: 1, maxMs: 1 },
    });
    await driver.start();
    socket.fireConnect();
  });

  afterEach(async () => {
    await driver.stop();
  });

  it('decodes one YD RAW line into a RawCanFrame', async () => {
    const promised = firstValueFrom(driver.rxCan);
    socket.emitData('00:00:00.060 R 19F11402 30 00 00 00 00 00 00 00\r\n');
    const frame = await promised;
    expect(frame.ext).toBe(true);
    expect(frame.id).toBe(0x19f11402);
    expect(frame.data.length).toBe(8);
    expect(frame.data[0]).toBe(0x30);
    expect(frame.rxTimestamp).toBeTypeOf('bigint');
  });

  it('emits one frame per line, multiple lines in one chunk', async () => {
    const collected = firstValueFrom(driver.rxCan.pipe(take(3), toArray()));
    socket.emitData(
      '00:00:00.060 R 19F11402 30 00 00 00 00 00 00 00\r\n' +
        '00:00:00.080 R 09F50203 AA BB CC DD\r\n' +
        '00:00:00.090 R 1DEF8002 01 02\r\n',
    );
    const frames = await collected;
    expect(frames).toHaveLength(3);
    expect(frames[0].id).toBe(0x19f11402);
    expect(frames[1].id).toBe(0x09f50203);
    expect(frames[2].id).toBe(0x1def8002);
  });

  it('handles a line split across two chunks', async () => {
    const promised = firstValueFrom(driver.rxCan);
    socket.emitData('00:00:00.060 R 19F114');
    socket.emitData('02 30 00 00 00 00 00 00 00\r\n');
    const frame = await promised;
    expect(frame.id).toBe(0x19f11402);
    expect(frame.data.length).toBe(8);
  });

  it('skips T (transmitted-by-YDWG) lines, no rxCan emission', async () => {
    let emissions = 0;
    const sub = driver.rxCan.subscribe(() => emissions++);
    socket.emitData('00:00:00.060 T 19FA041F 23 80 0C FF FF FF 7F 02\r\n');
    socket.emitData('00:00:00.070 R 09F50203 AA BB\r\n');
    expect(emissions).toBe(1);
    sub.unsubscribe();
  });

  it('skips blank lines without incrementing errorCount', async () => {
    let healthLast = await firstValueFrom(driver.health);
    const startErrors = healthLast.errorCount;
    socket.emitData('\r\n\r\n');
    socket.emitData('   \r\n');
    healthLast = await firstValueFrom(driver.health);
    expect(healthLast.errorCount).toBe(startErrors);
  });

  it('increments errorCount on malformed lines', async () => {
    const startHealth = await firstValueFrom(driver.health);
    socket.emitData('R 19FA041F XX YY\r\n');
    const after = await firstValueFrom(driver.health);
    expect(after.errorCount).toBe(startHealth.errorCount + 1);
  });

  it('sets health.connected=true on socket connect', async () => {
    const h = await firstValueFrom(driver.health);
    expect(h.connected).toBe(true);
  });
});

describe('YdwgRawTcpDriver — TX', () => {
  let socket: FakeSocket;
  let driver: YdwgRawTcpDriver;

  beforeEach(async () => {
    socket = new FakeSocket();
    driver = new YdwgRawTcpDriver({
      socketFactory: () => socket,
      backoffMs: { initialMs: 1, maxMs: 1 },
    });
    await driver.start();
    socket.fireConnect();
  });

  afterEach(async () => {
    await driver.stop();
  });

  it('txCan writes a YD RAW transmit line', async () => {
    await driver.txCan({
      id: 0x19fa041f,
      ext: true,
      data: new Uint8Array([0x23, 0x80, 0x0c, 0xff, 0xff, 0xff, 0x7f, 0x02]),
      rxTimestamp: 0n,
    });
    expect(socket.writes).toHaveLength(1);
    expect(socket.writes[0]).toBe('19FA041F 23 80 0C FF FF FF 7F 02\r\n');
  });

  it('txCan with zero-length data writes id only', async () => {
    await driver.txCan({ id: 0x19fa041f, ext: true, data: new Uint8Array(0), rxTimestamp: 0n });
    expect(socket.writes[0]).toBe('19FA041F\r\n');
  });

  it('txCan rejects when not connected', async () => {
    socket.fireClose();
    await expect(
      driver.txCan({ id: 0, ext: true, data: new Uint8Array(0), rxTimestamp: 0n }),
    ).rejects.toThrow(/not connected/);
  });

  it('tx0183 throws not-supported', async () => {
    await expect(driver.tx0183(1, '$GPGGA,...')).rejects.toThrow(/not supported/);
  });

  it('txPgn encodes an ISO Request (PGN 59904) and writes a YD RAW line', async () => {
    await driver.txPgn({ pgn: 59904, prio: 6, dst: 255, fields: { PGN: 60928 } });
    expect(socket.writes).toHaveLength(1);
    const line = socket.writes[0]!;
    expect(line).toMatch(/^[0-9A-F]{8}( [0-9A-F]{2})+\r\n$/);
    // Body should be 60928 little-endian = 00 EE 00.
    expect(line).toContain('00 EE 00');
  });

  it('txPgn throws for Fast Packet PGNs (multi-frame encoding not implemented)', async () => {
    // PGN 129029 (GNSS Position Data) is a Fast Packet PGN (43 bytes typical).
    await expect(
      driver.txPgn({
        pgn: 129029,
        fields: {
          SID: 1,
          Date: 0,
          Time: 0,
          Latitude: 32.7833,
          Longitude: -64.8333,
        },
      }),
    ).rejects.toThrow(/Fast Packet split not implemented/);
  });
});

describe('YdwgRawTcpDriver — reconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects after socket close, with backoff', async () => {
    const factoryCalls: FakeSocket[] = [];
    const driver = new YdwgRawTcpDriver({
      socketFactory: () => {
        const s = new FakeSocket();
        factoryCalls.push(s);
        return s;
      },
      backoffMs: { initialMs: 100, maxMs: 1000 },
    });
    await driver.start();
    expect(factoryCalls).toHaveLength(1);
    factoryCalls[0].fireConnect();
    // Drop the connection.
    factoryCalls[0].fireClose();
    // Reconnect is scheduled with initialMs=100. Before the timer, no new socket.
    expect(factoryCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(factoryCalls).toHaveLength(2);
    // Drop again — backoff doubles to 200.
    factoryCalls[1].fireClose();
    await vi.advanceTimersByTimeAsync(199);
    expect(factoryCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(factoryCalls).toHaveLength(3);
    await driver.stop();
  });

  it('resets backoff on a successful connect', async () => {
    const factoryCalls: FakeSocket[] = [];
    const driver = new YdwgRawTcpDriver({
      socketFactory: () => {
        const s = new FakeSocket();
        factoryCalls.push(s);
        return s;
      },
      backoffMs: { initialMs: 100, maxMs: 1000 },
    });
    await driver.start();
    // First socket connects, then drops — backoff doubles to 200.
    factoryCalls[0].fireConnect();
    factoryCalls[0].fireClose();
    await vi.advanceTimersByTimeAsync(100);
    // Second socket connects (resets backoff), then drops.
    factoryCalls[1].fireConnect();
    factoryCalls[1].fireClose();
    // Next reconnect should fire at initial=100ms, not at 200ms.
    await vi.advanceTimersByTimeAsync(100);
    expect(factoryCalls).toHaveLength(3);
    await driver.stop();
  });

  it('stop() cancels a pending reconnect', async () => {
    const factoryCalls: FakeSocket[] = [];
    const driver = new YdwgRawTcpDriver({
      socketFactory: () => {
        const s = new FakeSocket();
        factoryCalls.push(s);
        return s;
      },
      backoffMs: { initialMs: 100, maxMs: 1000 },
    });
    await driver.start();
    factoryCalls[0].fireClose();
    await driver.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(factoryCalls).toHaveLength(1);
  });

  it('configures TCP keep-alive and idle timeout on each new socket', async () => {
    const factoryCalls: FakeSocket[] = [];
    const driver = new YdwgRawTcpDriver({
      socketFactory: () => {
        const s = new FakeSocket();
        factoryCalls.push(s);
        return s;
      },
      backoffMs: { initialMs: 100, maxMs: 1000 },
      liveness: { keepAliveDelayMs: 7_000, idleTimeoutMs: 21_000 },
    });
    await driver.start();
    const first = factoryCalls[0]!;
    expect(first.keepAliveCalls).toEqual([{ enable: true, initialDelayMs: 7_000 }]);
    expect(first.setTimeoutCalls).toEqual([21_000]);

    // After a drop + reconnect, the new socket should also be configured.
    first.fireConnect();
    first.fireClose();
    await vi.advanceTimersByTimeAsync(100);
    const second = factoryCalls[1]!;
    expect(second.keepAliveCalls).toEqual([{ enable: true, initialDelayMs: 7_000 }]);
    expect(second.setTimeoutCalls).toEqual([21_000]);
    await driver.stop();
  });

  it('uses default liveness config when none supplied', async () => {
    const factoryCalls: FakeSocket[] = [];
    const driver = new YdwgRawTcpDriver({
      socketFactory: () => {
        const s = new FakeSocket();
        factoryCalls.push(s);
        return s;
      },
      backoffMs: { initialMs: 100, maxMs: 1000 },
    });
    await driver.start();
    expect(factoryCalls[0]!.keepAliveCalls).toEqual([{ enable: true, initialDelayMs: 10_000 }]);
    expect(factoryCalls[0]!.setTimeoutCalls).toEqual([30_000]);
    await driver.stop();
  });

  it('destroys and reconnects on idle-timeout event', async () => {
    const factoryCalls: FakeSocket[] = [];
    const driver = new YdwgRawTcpDriver({
      socketFactory: () => {
        const s = new FakeSocket();
        factoryCalls.push(s);
        return s;
      },
      backoffMs: { initialMs: 100, maxMs: 1000 },
      liveness: { keepAliveDelayMs: 1_000, idleTimeoutMs: 5_000 },
    });
    await driver.start();
    const first = factoryCalls[0]!;
    first.fireConnect();
    expect(first.destroyed).toBe(false);

    // Simulate Node's socket emitting 'timeout' after idle.
    first.fireTimeout();
    expect(first.destroyed).toBe(true);

    // destroy() queues a microtask to fire 'close'; flush it, then advance
    // past the reconnect backoff. The driver should open a fresh socket.
    await vi.advanceTimersByTimeAsync(100);
    expect(factoryCalls.length).toBeGreaterThanOrEqual(2);
    await driver.stop();
  });

  it('schedules reconnect when socketFactory itself throws', async () => {
    let throwOnce = true;
    const factoryCalls: FakeSocket[] = [];
    const driver = new YdwgRawTcpDriver({
      socketFactory: () => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error('boom');
        }
        const s = new FakeSocket();
        factoryCalls.push(s);
        return s;
      },
      backoffMs: { initialMs: 100, maxMs: 1000 },
    });
    await driver.start();
    expect(factoryCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(factoryCalls).toHaveLength(1);
    await driver.stop();
  });
});
