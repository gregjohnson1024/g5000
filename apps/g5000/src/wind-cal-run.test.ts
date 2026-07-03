import { describe, it, expect, afterEach } from 'vitest';
import { Bus, Channels, _resetSharedSourcePriorityForTests, type Sample } from '@g5000/core';
import {
  WindCalRunCollector,
  installWindCalRun,
  wrapToPi,
  MIN_SAMPLES_PER_BUCKET,
  DEFAULT_RUN_AWS_BINS,
} from './wind-cal-run.js';

const feed = (
  collector: WindCalRunCollector,
  tack: 'port' | 'starboard',
  aws: number,
  twd: number,
  n: number,
): void => {
  for (let i = 0; i < n; i++) collector.add(tack, aws, twd);
};

describe('wrapToPi', () => {
  it('wraps into (−π, π]', () => {
    expect(wrapToPi(0)).toBe(0);
    expect(wrapToPi(Math.PI)).toBe(Math.PI);
    expect(wrapToPi(-Math.PI)).toBe(Math.PI);
    expect(wrapToPi(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapToPi(6.22)).toBeCloseTo(6.22 - 2 * Math.PI, 12);
    expect(wrapToPi(-6.22)).toBeCloseTo(2 * Math.PI - 6.22, 12);
  });
});

describe('WindCalRunCollector', () => {
  it('computes offset = wrapped half the port/starboard TWD spread per bin', () => {
    const c = new WindCalRunCollector([3, 5, 8, 10]);
    feed(c, 'port', 5, 3.5, 40);
    feed(c, 'starboard', 5, 3.4, 40);
    const result = c.finalize(30);
    expect(result).not.toBeNull();
    expect(result!.awsBins).toEqual([5]);
    expect(result!.awaOffsetRad[0]).toBeCloseTo((3.5 - 3.4) / 2, 10);
    expect(result!.quality.bins).toEqual([{ awsBin: 5, samplesPort: 40, samplesStarboard: 40 }]);
  });

  it('uses circular means — a TWD spread straddling 0/2π wraps correctly', () => {
    const c = new WindCalRunCollector([5]);
    // Port mean ≈ 6.25 rad (just below 2π), starboard ≈ 0.05 rad.
    feed(c, 'port', 5, 6.25, 35);
    feed(c, 'starboard', 5, 0.05, 35);
    const result = c.finalize(30);
    // Naive (6.25 − 0.05)/2 = 3.1; wrapped: (6.25 − 2π − 0.05)/2 ≈ −0.0416.
    expect(result!.awaOffsetRad[0]).toBeCloseTo(wrapToPi(6.25 - 0.05) / 2, 10);
    expect(Math.abs(result!.awaOffsetRad[0]!)).toBeLessThan(0.1);
  });

  it('circular mean averages noisy samples around the true center', () => {
    const c = new WindCalRunCollector([5]);
    for (let i = 0; i < 40; i++) {
      c.add('port', 5, 1.0 + (i % 2 === 0 ? 0.05 : -0.05));
      c.add('starboard', 5, 0.9 + (i % 2 === 0 ? 0.05 : -0.05));
    }
    const result = c.finalize(30);
    expect(result!.awaOffsetRad[0]).toBeCloseTo(0.05, 6);
  });

  it('assigns samples to the nearest AWS bin', () => {
    const c = new WindCalRunCollector([3, 5, 8, 10]);
    c.add('port', 4.2, 1.0); // nearest 5
    c.add('port', 3.9, 1.0); // nearest 3 (|0.9| < |1.1|)
    c.add('port', 25, 1.0); // clamps to 10
    expect(c.counts().port).toEqual([1, 1, 0, 1]);
  });

  it('excludes bins lacking min samples on either tack; null result when none qualify', () => {
    const c = new WindCalRunCollector([3, 5]);
    feed(c, 'port', 5, 1.0, 40);
    feed(c, 'starboard', 5, 0.9, 10); // under min
    feed(c, 'port', 3, 1.0, 40); // no starboard at all
    expect(c.previewOffsets(30)).toEqual([null, null]);
    expect(c.finalize(30)).toBeNull();

    feed(c, 'starboard', 5, 0.9, 25); // now 35 ≥ 30
    const result = c.finalize(30);
    expect(result!.awsBins).toEqual([5]);
    expect(result!.awaOffsetRad[0]).toBeCloseTo(0.05, 10);
  });
});

describe('installWindCalRun (bus-facing controller)', () => {
  afterEach(() => {
    _resetSharedSourcePriorityForTests();
    (globalThis as { __g5000_windCalRun__?: unknown }).__g5000_windCalRun__ = undefined;
  });

  const sample = (channel: string, value: number): Sample => ({
    channel,
    t_ns: BigInt(Date.now()) * 1_000_000n,
    value: { kind: 'scalar', value },
    source: 'test',
  });

  const publishTack = (bus: Bus, tack: 'port' | 'starboard', aws: number, twd: number): void => {
    bus.publish(sample(Channels.Wind.ApparentAngle, tack === 'port' ? -0.5 : 0.5));
    bus.publish(sample(Channels.Wind.ApparentSpeed, aws));
    bus.publish(sample(Channels.Wind.TrueDirection, twd));
  };

  it('collects per-tack samples while running and computes a result on stop', () => {
    const bus = new Bus();
    const c = installWindCalRun(bus);

    expect(c.status().running).toBe(false);
    c.start();
    expect(c.status().running).toBe(true);
    expect(c.status().awsBins).toEqual(DEFAULT_RUN_AWS_BINS);

    for (let i = 0; i < MIN_SAMPLES_PER_BUCKET + 5; i++) {
      publishTack(bus, 'port', 5, 3.5);
      publishTack(bus, 'starboard', 5, 3.4);
    }

    const mid = c.status();
    const binIdx = DEFAULT_RUN_AWS_BINS.indexOf(5);
    expect(mid.counts.port[binIdx]).toBe(MIN_SAMPLES_PER_BUCKET + 5);
    expect(mid.counts.starboard[binIdx]).toBe(MIN_SAMPLES_PER_BUCKET + 5);
    expect(mid.previewOffsetRad[binIdx]).toBeCloseTo(0.05, 10);

    const stopped = c.stop();
    expect(stopped.running).toBe(false);
    expect(stopped.result).not.toBeNull();
    expect(stopped.result!.awsBins).toEqual([5]);
    expect(stopped.result!.awaOffsetRad[0]).toBeCloseTo(0.05, 10);
    expect(c.result()).toEqual({ awsBins: [5], awaOffsetRad: stopped.result!.awaOffsetRad });

    // Samples published after stop are ignored.
    publishTack(bus, 'port', 5, 1.0);
    expect(c.status().counts.port[binIdx]).toBe(MIN_SAMPLES_PER_BUCKET + 5);
  });

  it('does not bucket a TWD sample without a fresh apparent angle/speed', () => {
    const bus = new Bus();
    const c = installWindCalRun(bus);
    c.start();
    bus.publish(sample(Channels.Wind.TrueDirection, 3.5));
    expect(c.status().counts.port.every((n) => n === 0)).toBe(true);
    expect(c.status().counts.starboard.every((n) => n === 0)).toBe(true);
    c.abort();
  });

  it('abort discards counts and result', () => {
    const bus = new Bus();
    const c = installWindCalRun(bus);
    c.start();
    for (let i = 0; i < 40; i++) {
      publishTack(bus, 'port', 5, 3.5);
      publishTack(bus, 'starboard', 5, 3.4);
    }
    const aborted = c.abort();
    expect(aborted.running).toBe(false);
    expect(aborted.result).toBeNull();
    expect(aborted.counts.port.every((n) => n === 0)).toBe(true);
    expect(c.result()).toBeNull();
  });

  it('start clears the previous result and is a no-op while already running', () => {
    const bus = new Bus();
    const c = installWindCalRun(bus);
    c.start();
    for (let i = 0; i < 40; i++) {
      publishTack(bus, 'port', 5, 3.5);
      publishTack(bus, 'starboard', 5, 3.4);
    }
    c.stop();
    expect(c.result()).not.toBeNull();

    c.start();
    expect(c.result()).toBeNull();
    const binIdx = DEFAULT_RUN_AWS_BINS.indexOf(5);
    publishTack(bus, 'port', 5, 3.5);
    expect(c.status().counts.port[binIdx]).toBe(1);
    c.start(); // no-op — does not reset the in-progress run
    expect(c.status().counts.port[binIdx]).toBe(1);
    c.abort();
  });
});
