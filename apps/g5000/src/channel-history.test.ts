import { afterEach, describe, expect, it } from 'vitest';
import { Bus, Channels, _resetChannelHistoryForTests, type Sample } from '@g5000/core';
import { installChannelHistoryTracker } from './channel-history.js';

/** Build a scalar sample on a channel/source at a given ms timestamp. */
const sample = (channel: string, source: string, v: number, tMs = Date.now()): Sample => ({
  channel,
  t_ns: BigInt(tMs) * 1_000_000n,
  value: { kind: 'scalar', value: v },
  source,
});

afterEach(() => {
  _resetChannelHistoryForTests();
});

describe('installChannelHistoryTracker', () => {
  it('records points per (channel, source) for multiple sources on one channel', () => {
    const bus = new Bus();
    const { tracker, teardown } = installChannelHistoryTracker(bus);

    bus.publish(sample(Channels.Boat.HeadingMagnetic, 'n2k:127250@0x11', 1.0));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 'n2k:127250@0x80', 2.1));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 'n2k:127250@0x11', 1.1));

    const snap = tracker.snapshot();
    const heading = snap.series.filter((s) => s.channel === Channels.Boat.HeadingMagnetic);
    expect(heading.map((s) => s.source)).toEqual(['n2k:127250@0x11', 'n2k:127250@0x80']);
    expect(heading[0]?.points.map((p) => p.v)).toEqual([1.0, 1.1]);
    expect(heading[1]?.points.map((p) => p.v)).toEqual([2.1]);

    teardown();
  });

  it('captures all seven default channels', () => {
    const bus = new Bus();
    const { tracker, teardown } = installChannelHistoryTracker(bus);
    const channels = [
      Channels.Wind.ApparentSpeed,
      Channels.Wind.ApparentAngle,
      Channels.Wind.TrueSpeed,
      Channels.Wind.TrueAngle,
      Channels.Wind.TrueDirection,
      Channels.Boat.HeadingMagnetic,
      Channels.Boat.SpeedWater,
    ];
    for (const ch of channels) bus.publish(sample(ch, 'src', 0.5));

    const snap = tracker.snapshot();
    expect(new Set(snap.series.map((s) => s.channel))).toEqual(new Set(channels));

    teardown();
  });

  it('evicts points older than windowMs relative to the newest', () => {
    const bus = new Bus();
    const { tracker, teardown } = installChannelHistoryTracker(bus, { windowMs: 10_000 });

    const now = Date.now();
    // Old point at now-30s, fresh points at now-5s and now.
    bus.publish(sample(Channels.Boat.SpeedWater, 'src', 1, now - 30_000));
    bus.publish(sample(Channels.Boat.SpeedWater, 'src', 2, now - 5_000));
    bus.publish(sample(Channels.Boat.SpeedWater, 'src', 3, now));

    // Use a generous snapshot window so eviction (not the read filter) is the
    // thing under test.
    const snap = tracker.snapshot(60_000);
    const speed = snap.series.find((s) => s.channel === Channels.Boat.SpeedWater);
    expect(speed?.points.map((p) => p.v)).toEqual([2, 3]);

    teardown();
  });

  it('caps each series at maxPointsPerSeries (drops oldest)', () => {
    const bus = new Bus();
    const { tracker, teardown } = installChannelHistoryTracker(bus, {
      maxPointsPerSeries: 3,
      windowMs: 600_000,
    });

    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      bus.publish(sample(Channels.Wind.TrueAngle, 'computed:true_wind', i, now + i));
    }

    const snap = tracker.snapshot(600_000);
    const series = snap.series.find((s) => s.channel === Channels.Wind.TrueAngle);
    expect(series?.points.map((p) => p.v)).toEqual([2, 3, 4]);

    teardown();
  });

  it('ignores non-scalar values', () => {
    const bus = new Bus();
    const { tracker, teardown } = installChannelHistoryTracker(bus);

    bus.publish({
      channel: Channels.Boat.HeadingMagnetic,
      t_ns: BigInt(Date.now()) * 1_000_000n,
      value: { kind: 'enum', value: 'nope' },
      source: 'src',
    });
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 'src', 1.23));

    const snap = tracker.snapshot();
    const series = snap.series.find((s) => s.channel === Channels.Boat.HeadingMagnetic);
    expect(series?.points.map((p) => p.v)).toEqual([1.23]);

    teardown();
  });

  it('snapshot filters to requested channels and sorts by channel then source', () => {
    const bus = new Bus();
    const { tracker, teardown } = installChannelHistoryTracker(bus);

    bus.publish(sample(Channels.Wind.TrueAngle, 'computed:true_wind', 0.1));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 'n2k:127250@0x80', 2.0));
    bus.publish(sample(Channels.Boat.HeadingMagnetic, 'n2k:127250@0x11', 1.0));

    // Filtered snapshot: only heading channel returned.
    const filtered = tracker.snapshot(undefined, [Channels.Boat.HeadingMagnetic]);
    expect(filtered.series.map((s) => s.channel)).toEqual([
      Channels.Boat.HeadingMagnetic,
      Channels.Boat.HeadingMagnetic,
    ]);
    expect(filtered.series.map((s) => s.source)).toEqual(['n2k:127250@0x11', 'n2k:127250@0x80']);

    // Default snapshot: stable sort by channel asc (boat.* < wind.*).
    const all = tracker.snapshot();
    expect(all.series.map((s) => s.channel)).toEqual([
      Channels.Boat.HeadingMagnetic,
      Channels.Boat.HeadingMagnetic,
      Channels.Wind.TrueAngle,
    ]);

    teardown();
  });

  it('returns replayed (historical-timestamp) samples — window anchors to newest, not now', () => {
    const bus = new Bus();
    const { tracker, teardown } = installChannelHistoryTracker(bus);

    // Replay re-emits samples with their ORIGINAL recorded t_ns (far in the
    // past), not now. The snapshot must anchor its read window to the newest
    // sample rather than Date.now(), or every replayed point is filtered out.
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    bus.publish(sample(Channels.Wind.TrueDirection, 'computed:true_wind', 3.0, oneYearAgo));
    bus.publish(sample(Channels.Wind.TrueDirection, 'computed:true_wind', 3.1, oneYearAgo + 1_000));
    bus.publish(sample(Channels.Wind.TrueDirection, 'computed:true_wind', 3.2, oneYearAgo + 2_000));

    const snap = tracker.snapshot();
    const twd = snap.series.find((s) => s.channel === Channels.Wind.TrueDirection);
    expect(twd?.points.map((p) => p.v)).toEqual([3.0, 3.1, 3.2]);

    teardown();
  });

  it('teardown unsubscribes and clears', () => {
    const bus = new Bus();
    const { tracker, teardown } = installChannelHistoryTracker(bus);
    bus.publish(sample(Channels.Boat.SpeedWater, 'src', 1));
    teardown();
    bus.publish(sample(Channels.Boat.SpeedWater, 'src', 2));
    expect(tracker.snapshot().series).toEqual([]);
  });
});
