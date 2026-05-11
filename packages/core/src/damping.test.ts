import { describe, expect, it } from 'vitest';
import { createDamper, ANGLE_CHANNELS } from './damping.js';
import type { Sample } from './types.js';

/**
 * Synthetic Sample helper. Caller supplies `t_s` in seconds for legibility;
 * we convert to t_ns (bigint).
 */
function sample(channel: string, value: number, t_s: number): Sample {
  return {
    channel,
    t_ns: BigInt(Math.round(t_s * 1e9)),
    value: { kind: 'scalar', value },
    source: 'test',
  };
}

function geoSample(channel: string, lat: number, lon: number, t_s: number): Sample {
  return {
    channel,
    t_ns: BigInt(Math.round(t_s * 1e9)),
    value: { kind: 'geo', value: { lat, lon } },
    source: 'test',
  };
}

function scalarOf(s: Sample): number {
  if (s.value.kind !== 'scalar') throw new Error('expected scalar');
  return s.value.value;
}

describe('createDamper — passthrough', () => {
  it('returns the raw sample unchanged when tau is 0', () => {
    const damp = createDamper(() => ({}));
    const s = sample('boat.speed.water', 5.0, 1.0);
    const out = damp(s, 0);
    expect(out).toBe(s); // identity — no allocation when no work needed
  });

  it('returns the raw sample unchanged when tau is undefined (no entry in config)', () => {
    const damp = createDamper(() => ({}));
    const s = sample('boat.speed.water', 5.0, 1.0);
    const out = damp(s, undefined);
    expect(out).toBe(s);
  });

  it('returns non-scalar samples unchanged even when tau > 0', () => {
    const damp = createDamper(() => ({}));
    const s = geoSample('nav.gps.position', 45.0, -75.0, 1.0);
    const out = damp(s, 2.0);
    expect(out).toBe(s);
  });
});

describe('createDamper — scalar EMA', () => {
  it('returns the raw value on the first sample for a channel (no prior state)', () => {
    const damp = createDamper(() => ({}));
    const s = sample('boat.speed.water', 5.0, 1.0);
    const out = damp(s, 2.0);
    expect(scalarOf(out)).toBeCloseTo(5.0, 10);
  });

  it('decays toward a step input with the expected exponential coefficient', () => {
    // tau = 1s, Δt = 1s → α = e^(-1) ≈ 0.3679
    // Step from 0 → 10 at t=0, then 10 at t=1.
    // damped[0] = 0 (initialize)
    // damped[1] = α*0 + (1-α)*10 = (1 - 0.3679)*10 ≈ 6.321
    const damp = createDamper(() => ({}));
    damp(sample('boat.speed.water', 0, 0), 1.0);
    const after = damp(sample('boat.speed.water', 10, 1), 1.0);
    expect(scalarOf(after)).toBeCloseTo(10 * (1 - Math.exp(-1)), 4);
  });

  it('eventually converges to the steady-state value', () => {
    const damp = createDamper(() => ({}));
    // Many samples of the same value at tau=2, dt=0.1
    let last = 0;
    for (let i = 0; i < 200; i++) {
      const out = damp(sample('boat.speed.water', 7.5, i * 0.1), 2.0);
      last = scalarOf(out);
    }
    expect(last).toBeCloseTo(7.5, 3);
  });

  it('preserves channel, source, and t_ns on the damped sample', () => {
    const damp = createDamper(() => ({}));
    damp(sample('boat.speed.water', 0, 0), 1.0);
    const s = sample('boat.speed.water', 10, 1);
    const out = damp(s, 1.0);
    expect(out.channel).toBe(s.channel);
    expect(out.source).toBe(s.source);
    expect(out.t_ns).toBe(s.t_ns);
    expect(out.value.kind).toBe('scalar');
  });

  it('keeps separate state per channel', () => {
    const damp = createDamper(() => ({}));
    damp(sample('a', 100, 0), 1.0);
    damp(sample('b', 0, 0), 1.0);
    // After dt=1s, both should follow EMA from their own start.
    const a = damp(sample('a', 100, 1), 1.0);
    const b = damp(sample('b', 0, 1), 1.0);
    expect(scalarOf(a)).toBeCloseTo(100, 6);
    expect(scalarOf(b)).toBeCloseTo(0, 6);
  });
});

describe('createDamper — stale-sample reset', () => {
  it('resets state when Δt > 10·τ (treats as fresh)', () => {
    const damp = createDamper(() => ({}));
    damp(sample('boat.speed.water', 5, 0), 1.0);
    // Δt = 20s, τ = 1s → 20 > 10·τ → reset
    const out = damp(sample('boat.speed.water', 50, 20), 1.0);
    expect(scalarOf(out)).toBeCloseTo(50, 10); // raw, not smoothed
  });

  it('does NOT reset when Δt is exactly 10·τ (just under threshold)', () => {
    const damp = createDamper(() => ({}));
    damp(sample('boat.speed.water', 5, 0), 1.0);
    // Δt = 9s, τ = 1s → α = e^(-9) ≈ 0.0001234
    // damped = α*5 + (1-α)*50 ≈ 49.994
    const out = damp(sample('boat.speed.water', 50, 9), 1.0);
    const alpha = Math.exp(-9);
    expect(scalarOf(out)).toBeCloseTo(alpha * 5 + (1 - alpha) * 50, 4);
  });
});

describe('createDamper — angle channels', () => {
  // wind.apparent.angle is in ANGLE_CHANNELS — sanity check
  it('lists key angle channels', () => {
    expect(ANGLE_CHANNELS.has('wind.apparent.angle')).toBe(true);
    expect(ANGLE_CHANNELS.has('wind.true.angle')).toBe(true);
    expect(ANGLE_CHANNELS.has('wind.true.direction')).toBe(true);
    expect(ANGLE_CHANNELS.has('nav.gps.cog')).toBe(true);
    expect(ANGLE_CHANNELS.has('boat.heading.magnetic')).toBe(true);
    expect(ANGLE_CHANNELS.has('motion.heel')).toBe(true);
  });

  it('handles ±π wraparound — feeding samples alternating just below/above ±π stays near π', () => {
    const damp = createDamper(() => ({}));
    // Samples oscillating between π-0.01 and -(π-0.01).
    // Naive scalar EMA would average toward 0; correct atan2 EMA stays near ±π.
    const ch = 'wind.true.direction';
    const tau = 1.0;
    damp(sample(ch, Math.PI - 0.01, 0), tau);
    let last = 0;
    for (let i = 1; i < 50; i++) {
      const v = i % 2 === 0 ? Math.PI - 0.01 : -(Math.PI - 0.01);
      const dt = 0.1; // tau >> dt → α near 1 → smooth heavily
      const out = damp(sample(ch, v, i * dt), tau);
      last = scalarOf(out);
    }
    // The atan2 averaging should give us something close to ±π, NOT 0.
    expect(Math.abs(last)).toBeGreaterThan(Math.PI - 0.05);
  });

  it('handles small angle changes near 0 correctly (no spurious wrap)', () => {
    const damp = createDamper(() => ({}));
    const ch = 'wind.apparent.angle';
    const tau = 1.0;
    damp(sample(ch, 0.1, 0), tau);
    const out = damp(sample(ch, 0.1, 1), tau);
    // Steady value — output should be close to input.
    expect(scalarOf(out)).toBeCloseTo(0.1, 3);
  });

  it('damps angle changes — step from 0 to π/2 over multiple samples shows smoothing', () => {
    const damp = createDamper(() => ({}));
    const ch = 'wind.apparent.angle';
    const tau = 2.0;
    damp(sample(ch, 0, 0), tau);
    const out = damp(sample(ch, Math.PI / 2, 1), tau);
    // After 1 s at tau=2, should be partway between 0 and π/2.
    const v = scalarOf(out);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(Math.PI / 2);
  });

  it('passes through unchanged when tau is 0 (even for angle channels)', () => {
    const damp = createDamper(() => ({}));
    const ch = 'wind.apparent.angle';
    const s = sample(ch, 1.23, 0);
    const out = damp(s, 0);
    expect(out).toBe(s);
  });

  it('resets angle state when Δt > 10·τ', () => {
    const damp = createDamper(() => ({}));
    const ch = 'wind.apparent.angle';
    damp(sample(ch, 0.1, 0), 1.0);
    const out = damp(sample(ch, 1.5, 20), 1.0); // 20 > 10·1 → reset
    expect(scalarOf(out)).toBeCloseTo(1.5, 6); // raw
  });
});
