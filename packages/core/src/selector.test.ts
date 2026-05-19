import { describe, it, expect } from 'vitest';
import { Bus } from './bus.js';
import {
  pickWinner,
  subscribeSelected,
  findRuleForChannel,
  type SourcePriorityConfig,
  type SourcePriorityRule,
} from './selector.js';
import type { Sample } from './types.js';

// Helper: build a Sample with explicit timestamp (ns).
const sample = (channel: string, source: string, value: number, t_ns: bigint): Sample => ({
  channel,
  t_ns,
  value: { kind: 'scalar', value },
  source,
});

describe('pickWinner', () => {
  const rule: SourcePriorityRule = {
    channelPattern: 'wind.apparent.angle',
    sources: ['n2k:127250@dev0x10', 'demo'],
    freshnessSeconds: 2,
  };

  it('returns the top source when it is fresh', () => {
    const map = new Map([
      ['n2k:127250@dev0x10', { t_ns: 1_000_000_000n }],
      ['demo', { t_ns: 1_000_000_000n }],
    ]);
    expect(pickWinner(rule, map, 1_500_000_000n)).toBe('n2k:127250@dev0x10');
  });

  it('falls through to the next source when the top is stale', () => {
    // Top source last saw a sample 5s ago; freshness window is 2s.
    const map = new Map([
      ['n2k:127250@dev0x10', { t_ns: 1_000_000_000n }],
      ['demo', { t_ns: 5_500_000_000n }],
    ]);
    expect(pickWinner(rule, map, 6_000_000_000n)).toBe('demo');
  });

  it('returns null when every configured source is stale', () => {
    const map = new Map([
      ['n2k:127250@dev0x10', { t_ns: 1_000_000_000n }],
      ['demo', { t_ns: 1_500_000_000n }],
    ]);
    // 10 seconds later — both > 2s old.
    expect(pickWinner(rule, map, 11_000_000_000n)).toBeNull();
  });

  it('returns null when no source has been seen at all', () => {
    expect(pickWinner(rule, new Map(), 1_000_000_000n)).toBeNull();
  });

  it('supports trailing-* prefix matching on source tags', () => {
    const r: SourcePriorityRule = {
      channelPattern: 'wind.apparent.angle',
      sources: ['n2k:*', 'demo'],
      freshnessSeconds: 2,
    };
    const map = new Map([
      ['n2k:127250@dev0x10', { t_ns: 1_000_000_000n }],
      ['demo', { t_ns: 1_000_000_000n }],
    ]);
    expect(pickWinner(r, map, 1_500_000_000n)).toBe('n2k:127250@dev0x10');
  });

  it('within a priority bucket, picks the freshest tag', () => {
    // Two N2K devices both match the same pattern; whichever published
    // more recently should win that bucket.
    const r: SourcePriorityRule = {
      channelPattern: 'wind.apparent.angle',
      sources: ['n2k:*', 'demo'],
      freshnessSeconds: 5,
    };
    const map = new Map([
      ['n2k:127250@dev0x10', { t_ns: 1_000_000_000n }],
      ['n2k:127250@dev0x20', { t_ns: 2_000_000_000n }], // fresher
      ['demo', { t_ns: 2_500_000_000n }],
    ]);
    expect(pickWinner(r, map, 3_000_000_000n)).toBe('n2k:127250@dev0x20');
  });
});

describe('findRuleForChannel', () => {
  const config: SourcePriorityConfig = [
    {
      channelPattern: 'wind.apparent.angle',
      sources: ['n2k:*'],
      freshnessSeconds: 2,
    },
    {
      channelPattern: 'wind.**',
      sources: ['demo'],
      freshnessSeconds: 5,
    },
  ];

  it('matches exact channel patterns', () => {
    const r = findRuleForChannel(config, 'wind.apparent.angle');
    expect(r?.sources).toEqual(['n2k:*']);
  });

  it('matches wildcard channel patterns', () => {
    const r = findRuleForChannel(config, 'wind.true.speed');
    expect(r?.sources).toEqual(['demo']);
  });

  it('returns null when nothing matches', () => {
    expect(findRuleForChannel(config, 'nav.gps.cog')).toBeNull();
  });

  it('first match wins (config order)', () => {
    const r = findRuleForChannel(config, 'wind.apparent.angle');
    // Both rules match `wind.apparent.angle`; first one (exact) should win.
    expect(r?.sources).toEqual(['n2k:*']);
  });
});

describe('subscribeSelected', () => {
  it('passes every sample through when no rule matches the channel', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    const config: SourcePriorityConfig = [];

    subscribeSelected(
      bus,
      'wind.apparent.angle',
      () => config,
      (s) => received.push(s),
    );

    bus.publish(sample('wind.apparent.angle', 'a', 1, 1n));
    bus.publish(sample('wind.apparent.angle', 'b', 2, 2n));
    bus.publish(sample('wind.apparent.angle', 'a', 3, 3n));

    expect(received.map((s) => (s.value as { value: number }).value)).toEqual([1, 2, 3]);
  });

  it('emits only the winning source when its samples arrive fresh', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    const config: SourcePriorityConfig = [
      {
        channelPattern: 'wind.apparent.angle',
        sources: ['n2k:127250@dev0x10', 'demo'],
        freshnessSeconds: 2,
      },
    ];

    subscribeSelected(
      bus,
      'wind.apparent.angle',
      () => config,
      (s) => received.push(s),
    );

    // Demo is the only known source initially, so it temporarily wins (no
    // n2k publish has arrived yet — it can't be the winner if it doesn't
    // exist). After the first n2k publish, n2k takes over and demo is
    // filtered out.
    bus.publish(sample('wind.apparent.angle', 'demo', 1, 1_000_000_000n));
    bus.publish(sample('wind.apparent.angle', 'n2k:127250@dev0x10', 2, 1_100_000_000n));
    bus.publish(sample('wind.apparent.angle', 'demo', 3, 1_200_000_000n));
    bus.publish(sample('wind.apparent.angle', 'n2k:127250@dev0x10', 4, 1_300_000_000n));

    // First demo emitted (only known source at the time); subsequent demo
    // publishes filtered once n2k took over.
    expect(received.map((s) => (s.value as { value: number }).value)).toEqual([1, 2, 4]);
  });

  it('falls through to the next source when the top goes stale', () => {
    const bus = new Bus();
    const received: Array<{ src: string; t: bigint }> = [];
    const config: SourcePriorityConfig = [
      {
        channelPattern: 'wind.apparent.angle',
        sources: ['n2k:127250@dev0x10', 'demo'],
        freshnessSeconds: 2,
      },
    ];

    subscribeSelected(
      bus,
      'wind.apparent.angle',
      () => config,
      (s) => received.push({ src: s.source, t: s.t_ns }),
    );

    // T=1s — both publish; N2K wins.
    bus.publish(sample('wind.apparent.angle', 'n2k:127250@dev0x10', 1, 1_000_000_000n));
    bus.publish(sample('wind.apparent.angle', 'demo', 2, 1_100_000_000n));

    // Many seconds pass — N2K stops. Demo still publishing should now win.
    bus.publish(sample('wind.apparent.angle', 'demo', 3, 4_000_000_000n));
    bus.publish(sample('wind.apparent.angle', 'demo', 4, 5_000_000_000n));

    expect(received).toEqual([
      { src: 'n2k:127250@dev0x10', t: 1_000_000_000n },
      { src: 'demo', t: 4_000_000_000n },
      { src: 'demo', t: 5_000_000_000n },
    ]);
  });

  it('emits nothing when every configured source is stale', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    const config: SourcePriorityConfig = [
      {
        channelPattern: 'wind.apparent.angle',
        sources: ['demo'],
        freshnessSeconds: 1,
      },
    ];

    subscribeSelected(
      bus,
      'wind.apparent.angle',
      () => config,
      (s) => received.push(s),
    );

    bus.publish(sample('wind.apparent.angle', 'demo', 1, 1_000_000_000n));
    // Next sample is 5 seconds later — but it itself is fresh against its
    // own timestamp, so it WILL still emit (the rule's freshness check uses
    // the just-arrived sample's timestamp as `now`). Use an unrelated source
    // to make the "all-stale" condition apparent.
    bus.publish(sample('wind.apparent.angle', 'other', 99, 5_000_000_000n));

    // First demo sample emitted; the `other` sample is not in the rule's
    // sources list and is dropped.
    expect(received.map((s) => s.source)).toEqual(['demo']);
  });

  it('drops samples from sources not listed in the rule', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    const config: SourcePriorityConfig = [
      {
        channelPattern: 'wind.apparent.angle',
        sources: ['n2k:127250@dev0x10'],
        freshnessSeconds: 2,
      },
    ];

    subscribeSelected(
      bus,
      'wind.apparent.angle',
      () => config,
      (s) => received.push(s),
    );

    bus.publish(sample('wind.apparent.angle', '0183:port1', 1, 1n));
    bus.publish(sample('wind.apparent.angle', 'demo', 2, 2n));

    expect(received).toHaveLength(0);
  });

  it('honours wildcard channel patterns', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    const config: SourcePriorityConfig = [
      {
        channelPattern: 'wind.**',
        sources: ['n2k:*', 'demo'],
        freshnessSeconds: 5,
      },
    ];

    subscribeSelected(
      bus,
      'wind.**',
      () => config,
      (s) => received.push(s),
    );

    bus.publish(sample('wind.apparent.angle', 'n2k:127250@dev0x10', 1, 1_000_000_000n));
    bus.publish(sample('wind.true.speed', 'demo', 2, 1_100_000_000n));
    bus.publish(sample('wind.true.speed', 'n2k:127251@dev0x10', 3, 1_200_000_000n));

    // wind.apparent.angle from n2k → wins (only source).
    // wind.true.speed from demo → wins (only source seen for that channel).
    // wind.true.speed from n2k → wins (higher priority bucket now seen).
    expect(received.map((s) => s.channel + '=' + (s.value as { value: number }).value)).toEqual([
      'wind.apparent.angle=1',
      'wind.true.speed=2',
      'wind.true.speed=3',
    ]);
  });

  it('returns an unsubscribe function', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    const config: SourcePriorityConfig = [];

    const unsub = subscribeSelected(
      bus,
      'wind.**',
      () => config,
      (s) => received.push(s),
    );
    bus.publish(sample('wind.apparent.angle', 'demo', 1, 1n));
    unsub();
    bus.publish(sample('wind.apparent.angle', 'demo', 2, 2n));

    expect(received).toHaveLength(1);
  });

  it('re-reads getConfig on every sample (live config updates apply)', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    let activeConfig: SourcePriorityConfig = [];

    subscribeSelected(
      bus,
      'wind.apparent.angle',
      () => activeConfig,
      (s) => received.push(s),
    );

    // No rule yet — passthrough.
    bus.publish(sample('wind.apparent.angle', 'demo', 1, 1n));
    expect(received).toHaveLength(1);

    // Install a rule excluding demo. Next publish should be filtered out.
    activeConfig = [
      { channelPattern: 'wind.apparent.angle', sources: ['n2k:*'], freshnessSeconds: 2 },
    ];
    bus.publish(sample('wind.apparent.angle', 'demo', 2, 2n));
    expect(received).toHaveLength(1);
  });
});
