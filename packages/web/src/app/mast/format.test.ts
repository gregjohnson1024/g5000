import { describe, it, expect } from 'vitest';
import { formatTile } from './format.js';
import type { JsonSafeSample } from '@g5000/core';
import type { MastTile } from '@g5000/mast';

const scalar = (value: number, t_ms: number): JsonSafeSample => ({
  channel: 'x',
  t_ms,
  value: { kind: 'scalar', value },
  source: 'test',
});

const enumSample = (value: string, t_ms: number): JsonSafeSample => ({
  channel: 'x',
  t_ms,
  value: { kind: 'enum', value },
  source: 'test',
});

const tile = (over: Partial<MastTile> = {}): MastTile => ({
  field: 'boat.speed.water',
  label: 'BSP',
  units: 'kn',
  decimals: 2,
  ...over,
});

describe('formatTile', () => {
  it('shows a dash when no sample exists', () => {
    expect(formatTile(tile(), undefined, 1000).text).toBe('—');
  });
  it('converts m/s to knots', () => {
    // 5.144 m/s ≈ 10.00 kn
    expect(formatTile(tile(), scalar(5.144444, 1000), 1000).text).toBe('10.00');
  });
  it('converts radians to degrees', () => {
    const r = formatTile(tile({ units: 'deg', decimals: 0 }), scalar(Math.PI / 4, 1000), 1000);
    expect(r.text).toBe('45');
  });
  it('flags staleness past the threshold', () => {
    const fresh = formatTile(tile(), scalar(5.144444, 1000), 1500);
    const stale = formatTile(tile(), scalar(5.144444, 1000), 1000 + 11_000);
    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
  });
  it('applies a matching threshold color', () => {
    const t = tile({ units: 'pct', decimals: 0, thresholds: [{ gte: 100, color: 'green' }] });
    // pct passes through raw; value 105 ≥ 100 → green
    expect(formatTile(t, scalar(105, 1000), 1000).color).toBe('green');
  });
  it('renders enum channels as their string value', () => {
    const t = tile({ units: 'raw', decimals: 0 });
    const r = formatTile(t, enumSample('upwind', 1000), 1000);
    expect(r.text).toBe('upwind');
    expect(r.color).toBe('default');
    expect(r.stale).toBe(false);
  });

  // tide.* channel coverage
  it('renders tide.state enum (rising) as text', () => {
    const t = tile({ field: 'tide.state', units: 'raw', decimals: 0 });
    const r = formatTile(t, enumSample('rising', 1000), 1000);
    expect(r.text).toBe('rising');
    expect(r.color).toBe('default');
    expect(r.stale).toBe(false);
  });
  it('renders tide.source enum (chs) as text', () => {
    const t = tile({ field: 'tide.source', units: 'raw', decimals: 0 });
    const r = formatTile(t, enumSample('chs', 1000), 1000);
    expect(r.text).toBe('chs');
    expect(r.color).toBe('default');
    expect(r.stale).toBe(false);
  });
  it('renders tide.heightNow scalar with units m to one decimal', () => {
    const t = tile({ field: 'tide.heightNow', units: 'm', decimals: 1 });
    const r = formatTile(t, scalar(3.2, 1000), 1000);
    expect(r.text).toBe('3.2');
  });
});
