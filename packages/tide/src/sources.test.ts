import { describe, it, expect } from 'vitest';
import { createTideSources, getTideSource, selectSource } from './sources.js';

const withKey = createTideSources({ getAdmiraltyKey: () => 'KEY' });
const noKey = createTideSources({ getAdmiraltyKey: () => undefined });

const ukPos = { lat: 55, lon: -2 };
const caPos = { lat: 44.659, lon: -63.58 };
const midAtlantic = { lat: 40, lon: -30 };

describe('coversPosition', () => {
  it('admiralty covers UK, not Canada', () => {
    const a = getTideSource(withKey, 'admiralty')!;
    expect(a.coversPosition(ukPos.lat, ukPos.lon)).toBe(true);
    expect(a.coversPosition(caPos.lat, caPos.lon)).toBe(false);
  });
  it('chs covers Canada, not UK', () => {
    const c = getTideSource(withKey, 'chs')!;
    expect(c.coversPosition(caPos.lat, caPos.lon)).toBe(true);
    expect(c.coversPosition(ukPos.lat, ukPos.lon)).toBe(false);
  });
});

describe('available', () => {
  it('admiralty needs a key; chs always available', () => {
    expect(getTideSource(withKey, 'admiralty')!.available()).toBe(true);
    expect(getTideSource(noKey, 'admiralty')!.available()).toBe(false);
    expect(getTideSource(noKey, 'chs')!.available()).toBe(true);
  });
});

describe('selectSource', () => {
  it('auto picks the covering available source', () => {
    expect(selectSource(withKey, { tideSource: 'auto' }, ukPos)?.id).toBe('admiralty');
    expect(selectSource(withKey, { tideSource: 'auto' }, caPos)?.id).toBe('chs');
  });
  it('auto → null when no source covers, no GPS, or covering source unavailable', () => {
    expect(selectSource(withKey, { tideSource: 'auto' }, midAtlantic)).toBeNull();
    expect(selectSource(withKey, { tideSource: 'auto' }, null)).toBeNull();
    expect(selectSource(noKey, { tideSource: 'auto' }, ukPos)).toBeNull();
  });
  it('explicit override forces the source if available', () => {
    expect(selectSource(withKey, { tideSource: 'chs' }, ukPos)?.id).toBe('chs');
    expect(selectSource(noKey, { tideSource: 'admiralty' }, caPos)).toBeNull();
  });
});
