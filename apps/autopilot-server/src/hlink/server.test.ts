import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { Bus } from '@g5000/core';
import { startHlinkServer, type HlinkServerHandle } from './server.js';
import { hlinkChecksum } from './protocol.js';

/**
 * Tiny TCP-client helper for integration tests. Buffers received text,
 * lets the test await arbitrary substrings or counts of V<...> frames.
 */
function makeClient(port: number): Promise<TcpClient> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let buf = '';
    let resolveNext: (() => void) | null = null;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r();
      }
    });
    socket.on('connect', () => {
      resolve({
        send: (s: string) => {
          socket.write(s);
        },
        close: () =>
          new Promise<void>((res) => {
            socket.end(() => res());
          }),
        // wait for `predicate(buf)` to be true; returns buf at that point
        waitFor: async (
          predicate: (buf: string) => boolean,
          timeoutMs = 2000,
        ): Promise<string> => {
          const start = Date.now();
          while (!predicate(buf)) {
            if (Date.now() - start > timeoutMs) {
              throw new Error(
                `timeout waiting; buf so far = ${JSON.stringify(buf)}`,
              );
            }
            await new Promise<void>((res) => {
              resolveNext = res;
              // also wake up periodically in case data already arrived
              setTimeout(res, 20);
            });
          }
          return buf;
        },
        getBuf: () => buf,
      });
    });
    socket.on('error', reject);
  });
}

interface TcpClient {
  send: (s: string) => void;
  close: () => Promise<void>;
  waitFor: (predicate: (buf: string) => boolean, timeoutMs?: number) => Promise<string>;
  getBuf: () => string;
}

/** Append the real checksum + \r\n to a payload string. */
function withCsum(payload: string): string {
  return `${payload}*${hlinkChecksum(payload)}\r\n`;
}

describe('startHlinkServer — integration', () => {
  let bus: Bus;
  let handle: HlinkServerHandle;
  let port: number;

  beforeEach(async () => {
    bus = new Bus();
    handle = startHlinkServer({ bus, port: 0, host: '127.0.0.1' });
    await handle.listening;
    port = handle.getAddress().port;
  });

  afterEach(async () => {
    await handle.teardown();
  });

  it('listens on an ephemeral port', () => {
    expect(port).toBeGreaterThan(0);
  });

  it('replies to #OV one-shot once data is cached', async () => {
    // Publish a sample first so the server has something cached.
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: 0n,
      value: { kind: 'scalar', value: 5.144, unit: 'm/s' },
      source: 'test',
    });
    // Give the bus subscription a tick to run.
    await new Promise((r) => setTimeout(r, 20));

    const client = await makeClient(port);
    client.send(withCsum('#OV,,1,65'));

    const buf = await client.waitFor((b) => b.includes('V001,001,065,'));
    // 5.144 m/s → 10.00 kn.
    expect(buf).toMatch(/V001,001,065,10\.00\*[0-9A-F]{2}\r\n/);
    await client.close();
  });

  it('replies to #OV one-shot for unmapped fn with empty value', async () => {
    const client = await makeClient(port);
    client.send(withCsum('#OV,,1,999'));
    const buf = await client.waitFor((b) => b.includes('V001,001,999,'));
    expect(buf).toMatch(/V001,001,999,\*[0-9A-F]{2}\r\n/);
    await client.close();
  });

  it('streams enabled functions only after #OS,1', async () => {
    const client = await makeClient(port);
    client.send(withCsum('#OV,1,1,65,1')); // enable fn 65
    // No #OS,1 yet — publish should not stream.
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: 0n,
      value: { kind: 'scalar', value: 2, unit: 'm/s' },
      source: 'test',
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(client.getBuf()).toBe('');

    // Now start streaming. Give the server a tick to actually parse the
    // #OS,1 line before publishing the next sample, otherwise there's a
    // race between the bus event loop and the TCP-receive path.
    client.send(withCsum('#OS,1'));
    await new Promise((r) => setTimeout(r, 50));
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: 0n,
      value: { kind: 'scalar', value: 2, unit: 'm/s' },
      source: 'test',
    });
    const buf = await client.waitFor((b) => b.includes('V001,001,065,'));
    expect(buf).toMatch(/V001,001,065,3\.89\*[0-9A-F]{2}\r\n/);

    // #OS,0 should pause: publish more, no new line within 300 ms.
    client.send(withCsum('#OS,0'));
    await new Promise((r) => setTimeout(r, 30));
    const lenBefore = client.getBuf().length;
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: 0n,
      value: { kind: 'scalar', value: 4, unit: 'm/s' },
      source: 'test',
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(client.getBuf().length).toBe(lenBefore);

    await client.close();
  });

  it('throttles streaming to no more than 5 Hz per function', async () => {
    const client = await makeClient(port);
    client.send(withCsum('#OV,1,1,65,1'));
    client.send(withCsum('#OS,1'));
    await new Promise((r) => setTimeout(r, 30));

    // Burst 20 samples in quick succession.
    for (let i = 0; i < 20; i++) {
      bus.publish({
        channel: 'boat.speed.water',
        t_ns: 0n,
        value: { kind: 'scalar', value: 1 + i * 0.1, unit: 'm/s' },
        source: 'test',
      });
    }
    await new Promise((r) => setTimeout(r, 100));

    // Throttle window is 200 ms. A burst of 20 publishes inside one
    // event-loop tick should produce exactly 1 emission (the first
    // gets through; the rest are within the 200 ms window).
    const count = (client.getBuf().match(/V001,001,065,/g) ?? []).length;
    expect(count).toBe(1);

    await client.close();
  });

  it('emits position with P001 envelope on nav.gps.position', async () => {
    const client = await makeClient(port);
    client.send(withCsum('#OL,1'));
    client.send(withCsum('#OS,1'));
    await new Promise((r) => setTimeout(r, 30));

    bus.publish({
      channel: 'nav.gps.position',
      t_ns: 0n,
      value: { kind: 'geo', value: { lat: 48.123456, lon: -123.987654 } },
      source: 'test',
    });

    const buf = await client.waitFor((b) => b.includes('P001,'));
    expect(buf).toMatch(/P001,48\.123456,-123\.987654\*[0-9A-F]{2}\r\n/);
    await client.close();
  });

  it('silently ignores bad-checksum lines without disconnecting', async () => {
    const client = await makeClient(port);
    client.send('#OV,,1,65*00\r\n'); // wrong checksum
    await new Promise((r) => setTimeout(r, 50));
    expect(client.getBuf()).toBe('');

    // Server should still respond to a good line afterwards.
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: 0n,
      value: { kind: 'scalar', value: 1, unit: 'm/s' },
      source: 'test',
    });
    await new Promise((r) => setTimeout(r, 20));
    client.send(withCsum('#OV,,1,65'));
    await client.waitFor((b) => b.includes('V001,001,065,'));
    await client.close();
  });

  it('cleans up state when a client disconnects', async () => {
    const client = await makeClient(port);
    client.send(withCsum('#OV,1,1,65,1'));
    client.send(withCsum('#OS,1'));
    await new Promise((r) => setTimeout(r, 30));
    await client.close();
    // Publishing after disconnect should not throw or hang.
    bus.publish({
      channel: 'boat.speed.water',
      t_ns: 0n,
      value: { kind: 'scalar', value: 3, unit: 'm/s' },
      source: 'test',
    });
    await new Promise((r) => setTimeout(r, 30));
  });
});
