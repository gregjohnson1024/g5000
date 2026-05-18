import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { SocketCanDriver, type SocketCanRawChannel } from './socket-can-driver.js';

interface FakeChannel extends SocketCanRawChannel {
  inject(msg: { id: number; ext: boolean; data: Buffer }): void;
  sent: Array<{ id: number; ext: boolean; data: Buffer }>;
  started: boolean;
  stopped: boolean;
}

function makeFakeChannel(): FakeChannel {
  let listener: ((msg: { id: number; ext: boolean; data: Buffer }) => void) | null = null;
  return {
    start: vi.fn(function (this: FakeChannel) {
      this.started = true;
    }),
    stop: vi.fn(function (this: FakeChannel) {
      this.stopped = true;
    }),
    send: vi.fn(function (this: FakeChannel, msg) {
      this.sent.push(msg);
    }),
    addListener(event, cb) {
      if (event === 'onMessage') listener = cb;
    },
    removeListener(event) {
      if (event === 'onMessage') listener = null;
    },
    inject(msg) {
      listener?.(msg);
    },
    sent: [],
    started: false,
    stopped: false,
  } as FakeChannel;
}

describe('SocketCanDriver', () => {
  let channel: FakeChannel;
  let driver: SocketCanDriver;

  beforeEach(() => {
    channel = makeFakeChannel();
    driver = new SocketCanDriver({
      channelFactory: () => channel,
      healthIntervalMs: 50,
    });
  });

  afterEach(async () => {
    await driver.stop();
  });

  it('emits a RawCanFrame when the channel delivers an extended-frame message', async () => {
    const got = firstValueFrom(driver.rxCan.pipe(take(1)));
    await driver.start();
    channel.inject({
      id: 0x18eeff01,
      ext: true,
      data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    const frame = await got;
    expect(frame.id).toBe(0x18eeff01);
    expect(frame.ext).toBe(true);
    expect(Array.from(frame.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(typeof frame.rxTimestamp).toBe('bigint');
  });

  it('drops standard-frame (non-extended) messages — N2K is 29-bit only', async () => {
    const promise = firstValueFrom(driver.rxCan.pipe(take(2), toArray()));
    await driver.start();
    channel.inject({ id: 0x123, ext: false, data: Buffer.from([0]) });
    channel.inject({ id: 0x18eeff02, ext: true, data: Buffer.from([9]) });
    channel.inject({ id: 0x18eeff03, ext: true, data: Buffer.from([10]) });
    const frames = await promise;
    expect(frames).toHaveLength(2);
    expect(frames[0]!.id).toBe(0x18eeff02);
    expect(frames[1]!.id).toBe(0x18eeff03);
  });

  it('start() opens the channel and stop() closes it', async () => {
    expect(channel.started).toBe(false);
    await driver.start();
    expect(channel.started).toBe(true);
    expect(channel.stopped).toBe(false);
    await driver.stop();
    expect(channel.stopped).toBe(true);
  });

  it('txCan forwards an extended frame through the channel.send path', async () => {
    await driver.start();
    await driver.txCan({
      id: 0x18ea0001,
      ext: true,
      data: new Uint8Array([0xab, 0xcd]),
      rxTimestamp: 0n,
    });
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]!.id).toBe(0x18ea0001);
    expect(channel.sent[0]!.ext).toBe(true);
    expect(Array.from(channel.sent[0]!.data)).toEqual([0xab, 0xcd]);
  });

  it('txCan before start() throws — fail loud, not silently drop', async () => {
    await expect(
      driver.txCan({
        id: 0x18ea0001,
        ext: true,
        data: new Uint8Array([0]),
        rxTimestamp: 0n,
      }),
    ).rejects.toThrow(/not started/i);
  });

  it('health Observable flips connected true on start, false on stop', async () => {
    const states: boolean[] = [];
    const sub = driver.health.subscribe((h) => states.push(h.connected));
    expect(states).toEqual([false]); // BehaviorSubject seeds with disconnected
    await driver.start();
    expect(states).toEqual([false, true]);
    await driver.stop();
    expect(states).toEqual([false, true, false]);
    sub.unsubscribe();
  });

  it('tx0183 rejects — SocketCAN doesn’t carry 0183', async () => {
    await expect(driver.tx0183()).rejects.toThrow(/0183/i);
  });
});
