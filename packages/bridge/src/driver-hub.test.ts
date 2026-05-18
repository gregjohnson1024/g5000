import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Subject, EMPTY, BehaviorSubject } from 'rxjs';
import { createDriverHub } from './driver-hub.js';
import type {
  RawCanFrame,
  Raw0183Sentence,
  WireDriver,
  DriverHealth,
} from './wire-driver.js';
import { _resetSharedBusForTests, getSharedBus } from '@g5000/core';

function fakeDriver(): WireDriver & {
  rxCanSubject: Subject<RawCanFrame>;
  startCount: number;
  stopCount: number;
} {
  const rxCanSubject = new Subject<RawCanFrame>();
  let startCount = 0;
  let stopCount = 0;
  return {
    rxCanSubject,
    get startCount() {
      return startCount;
    },
    get stopCount() {
      return stopCount;
    },
    rxCan: rxCanSubject,
    rx0183: EMPTY as unknown as Subject<Raw0183Sentence>,
    health: new BehaviorSubject<DriverHealth>({
      connected: false,
      bytesPerSecond: 0,
      framesPerSecond: 0,
      errorCount: 0,
    }),
    async start() {
      startCount += 1;
    },
    async stop() {
      stopCount += 1;
    },
    async txCan() {},
    async tx0183() {},
    async txPgn() {},
  } as never;
}

describe('DriverHub', () => {
  beforeEach(() => {
    _resetSharedBusForTests();
  });

  it('addDriver starts the driver and registers it under the given label', async () => {
    const hub = createDriverHub(getSharedBus());
    const d = fakeDriver();
    await hub.addDriver('ydwg', d);
    expect(d.startCount).toBe(1);
    expect(hub.hasDriver('ydwg')).toBe(true);
    expect(hub.listDrivers()).toEqual(['ydwg']);
  });

  it('removeDriver stops the driver and unregisters the label', async () => {
    const hub = createDriverHub(getSharedBus());
    const d = fakeDriver();
    await hub.addDriver('ydwg', d);
    await hub.removeDriver('ydwg');
    expect(d.stopCount).toBe(1);
    expect(hub.hasDriver('ydwg')).toBe(false);
    expect(hub.listDrivers()).toEqual([]);
  });

  it('removeDriver is a no-op for an unknown label — safe to call blindly', async () => {
    const hub = createDriverHub(getSharedBus());
    await expect(hub.removeDriver('does-not-exist')).resolves.toBeUndefined();
  });

  it('addDriver rejects a duplicate label', async () => {
    const hub = createDriverHub(getSharedBus());
    await hub.addDriver('ydwg', fakeDriver());
    await expect(hub.addDriver('ydwg', fakeDriver())).rejects.toThrow(/already registered/);
  });

  it('frames from removed drivers no longer reach the bus (subscriptions torn down)', async () => {
    const hub = createDriverHub(getSharedBus());
    const d = fakeDriver();
    await hub.addDriver('ydwg', d);

    const bus = getSharedBus();
    const seen: unknown[] = [];
    const unsubscribe = bus.subscribe('**', (s) => seen.push(s));

    await hub.removeDriver('ydwg');

    // Emit a frame on the (now detached) Subject — it should reach
    // zero subscribers because removeDriver unsubscribed all pipelines.
    d.rxCanSubject.next({
      id: 0x18ff0001,
      ext: true,
      data: new Uint8Array(8),
      rxTimestamp: 0n,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([]);
    unsubscribe();
  });

  it('teardown stops all drivers and clears the registry', async () => {
    const hub = createDriverHub(getSharedBus());
    const a = fakeDriver();
    const b = fakeDriver();
    await hub.addDriver('ydwg', a);
    await hub.addDriver('socketcan', b);
    await hub.teardown();
    expect(a.stopCount).toBe(1);
    expect(b.stopCount).toBe(1);
    expect(hub.listDrivers()).toEqual([]);
  });

  it('teardown is idempotent — second call is a no-op', async () => {
    const hub = createDriverHub(getSharedBus());
    const d = fakeDriver();
    await hub.addDriver('ydwg', d);
    await hub.teardown();
    await hub.teardown();
    expect(d.stopCount).toBe(1);
  });

  it('add → remove → add of the same label works (re-registration cycle)', async () => {
    const hub = createDriverHub(getSharedBus());
    const first = fakeDriver();
    const second = fakeDriver();
    await hub.addDriver('socketcan', first);
    await hub.removeDriver('socketcan');
    await hub.addDriver('socketcan', second);
    expect(first.stopCount).toBe(1);
    expect(second.startCount).toBe(1);
    expect(hub.hasDriver('socketcan')).toBe(true);
  });
});
