import { describe, it, expect } from 'vitest';
import { toJsonSafe, fromJsonSafe } from './json-safe.js';
import type { Sample } from './types.js';

describe('toJsonSafe / fromJsonSafe', () => {
  const ns = 1_700_000_000_123_456_789n;

  const sample: Sample = {
    channel: 'wind.apparent.angle',
    t_ns: ns,
    value: { kind: 'scalar', value: 0.785, unit: 'rad' },
    source: 'n2k:130306@0x11',
  };

  it('round-trips a sample through JSON', () => {
    const wire = JSON.parse(JSON.stringify(toJsonSafe(sample)));
    const restored = fromJsonSafe(wire);
    expect(restored.channel).toBe(sample.channel);
    expect(restored.value).toEqual(sample.value);
    expect(restored.source).toBe(sample.source);
    // ms precision: lose the sub-millisecond ns (456789 → 0).
    const expectedNs = (sample.t_ns / 1_000_000n) * 1_000_000n;
    expect(restored.t_ns).toBe(expectedNs);
  });

  it('produces a JSON.stringify-able shape', () => {
    expect(() => JSON.stringify(toJsonSafe(sample))).not.toThrow();
    const wire = JSON.parse(JSON.stringify(toJsonSafe(sample)));
    expect(typeof wire.t_ms).toBe('number');
    expect(wire.t_ms).toBeGreaterThan(0);
  });
});
