import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Bus, type Sample } from '@g5000/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { startTrueWindTx } from './true-wind-tx.js';
import type {
  OutgoingPgn,
  WireDriver,
  RawCanFrame,
  Raw0183Sentence,
  DriverHealth,
} from '../wire-driver.js';

class FakeDriver implements WireDriver {
  rxCan = new Subject<RawCanFrame>();
  rx0183 = new Subject<Raw0183Sentence>();
  health = new BehaviorSubject<DriverHealth>({
    connected: true,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  start = async () => {};
  stop = async () => {};
  txCan = async () => {
    throw new Error();
  };
  tx0183 = async () => {
    throw new Error();
  };
  sent: OutgoingPgn[] = [];
  txPgn = async (pgn: OutgoingPgn): Promise<void> => {
    this.sent.push(pgn);
  };
}

const sample = (channel: string, value: number, t_ns: bigint = 1n): Sample => ({
  channel,
  t_ns,
  value: { kind: 'scalar', value },
  source: 'test',
});

describe('startTrueWindTx', () => {
  let bus: Bus;
  let driver: FakeDriver;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    bus = new Bus();
    driver = new FakeDriver();
    stop = await startTrueWindTx({
      bus,
      driver,
      throttleMs: 10, // fast for tests
    });
  });

  afterEach(async () => {
    await stop();
  });

  it('emits PGN 130306 with True reference fields when both speed and angle are present', async () => {
    bus.publish(sample('wind.true.calibrated.angle', 0.785));
    bus.publish(sample('wind.true.calibrated.speed', 5.2));
    await new Promise((r) => setTimeout(r, 30));
    expect(driver.sent.length).toBeGreaterThanOrEqual(1);
    const last = driver.sent[driver.sent.length - 1]!;
    expect(last.pgn).toBe(130306);
    expect(last.fields['Wind Speed']).toBeCloseTo(5.2, 4);
    expect(last.fields['Wind Angle']).toBeCloseTo(0.785, 4);
    expect(String(last.fields['Reference'])).toMatch(/True/);
  });

  it('throttles to roughly the configured interval', async () => {
    // Publish fast — driver should NOT see one TX per publish.
    for (let i = 0; i < 50; i++) {
      bus.publish(sample('wind.true.calibrated.angle', i * 0.01));
      bus.publish(sample('wind.true.calibrated.speed', 5));
    }
    await new Promise((r) => setTimeout(r, 50));
    // 50ms wall, throttle 10ms → at most ~6 emissions
    expect(driver.sent.length).toBeLessThanOrEqual(6);
    expect(driver.sent.length).toBeGreaterThan(0);
  });

  it('does not emit if only one of speed/angle has been seen', async () => {
    bus.publish(sample('wind.true.calibrated.speed', 5));
    await new Promise((r) => setTimeout(r, 30));
    expect(driver.sent).toHaveLength(0);
  });
});

describe('startTrueWindTx — shouldTransmit gate', () => {
  let bus: Bus;
  let driver: FakeDriver;
  let stop: () => Promise<void>;

  afterEach(async () => {
    await stop();
  });

  it('skips TX when shouldTransmit() returns false', async () => {
    bus = new Bus();
    driver = new FakeDriver();
    stop = await startTrueWindTx({
      bus,
      driver,
      throttleMs: 10,
      shouldTransmit: () => false,
    });
    bus.publish(sample('wind.true.calibrated.angle', 0.785));
    bus.publish(sample('wind.true.calibrated.speed', 5.0));
    await new Promise((r) => setTimeout(r, 50));
    expect(driver.sent).toHaveLength(0);
  });
});
