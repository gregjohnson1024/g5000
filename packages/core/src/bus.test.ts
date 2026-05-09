import { describe, it, expect } from 'vitest';
import { Bus } from './bus.js';
import type { Sample } from './types.js';

const sample = (channel: string, n: number): Sample => ({
  channel,
  t_ns: BigInt(Date.now()) * 1_000_000n,
  value: { kind: 'scalar', value: n },
  source: 'test',
});

describe('Bus', () => {
  it('delivers samples to exact-channel subscribers', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    bus.subscribe('wind.apparent.angle', (s) => received.push(s));
    bus.publish(sample('wind.apparent.angle', 42));
    expect(received).toHaveLength(1);
    expect(received[0]?.value).toEqual({ kind: 'scalar', value: 42 });
  });

  it('does not deliver samples on other channels', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    bus.subscribe('wind.apparent.angle', (s) => received.push(s));
    bus.publish(sample('boat.speed.water', 7));
    expect(received).toHaveLength(0);
  });

  it('supports wildcard subscriptions with **', () => {
    const bus = new Bus();
    const received: string[] = [];
    bus.subscribe('wind.**', (s) => received.push(s.channel));
    bus.publish(sample('wind.apparent.angle', 1));
    bus.publish(sample('wind.true.speed', 2));
    bus.publish(sample('boat.speed.water', 3));
    expect(received).toEqual(['wind.apparent.angle', 'wind.true.speed']);
  });

  it('supports single-level wildcard with *', () => {
    const bus = new Bus();
    const received: string[] = [];
    bus.subscribe('wind.*.angle', (s) => received.push(s.channel));
    bus.publish(sample('wind.apparent.angle', 1));
    bus.publish(sample('wind.true.angle', 2));
    bus.publish(sample('wind.apparent.speed', 3));
    expect(received).toEqual(['wind.apparent.angle', 'wind.true.angle']);
  });

  it('returns an unsubscribe function', () => {
    const bus = new Bus();
    const received: Sample[] = [];
    const unsub = bus.subscribe('wind.**', (s) => received.push(s));
    bus.publish(sample('wind.apparent.angle', 1));
    unsub();
    bus.publish(sample('wind.apparent.angle', 2));
    expect(received).toHaveLength(1);
  });
});
