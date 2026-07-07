import { describe, it, expect } from 'vitest';
import { groupSourcesByChannel } from './group-sources';
import type { ObservedEntry } from './sensors-types';

const e = (channel: string, source: string): ObservedEntry => ({
  channel,
  source,
  lastSeenMs: 0,
  ageMs: 0,
  lastValue: null,
});

describe('groupSourcesByChannel', () => {
  it('groups multiple sources under one channel, sorted by source tag', () => {
    const out = groupSourcesByChannel([
      e('wind.true.direction', 'n2k:130306@0x15'),
      e('wind.true.direction', 'n2k:130306@0x11'),
      e('wind.true.direction', 'computed:true_wind'),
    ]);
    expect(out.get('wind.true.direction')?.map((x) => x.source)).toEqual([
      'computed:true_wind',
      'n2k:130306@0x11',
      'n2k:130306@0x15',
    ]);
  });

  it('separates distinct channels', () => {
    const out = groupSourcesByChannel([
      e('depth', 'n2k:128267@0x20'),
      e('wind.true.direction', 'n2k:130306@0x11'),
    ]);
    expect([...out.keys()].sort()).toEqual(['depth', 'wind.true.direction']);
    expect(out.get('depth')).toHaveLength(1);
  });

  it('returns an empty map for no entries', () => {
    expect(groupSourcesByChannel([]).size).toBe(0);
  });
});
