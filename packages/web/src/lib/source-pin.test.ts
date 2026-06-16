import { describe, it, expect } from 'vitest';
import { pinnedSourceForChannel, setPinnedSource, PIN_FRESHNESS_SECONDS } from './source-pin';
import type { SourcePriorityRule } from '@g5000/core';

const rule = (channelPattern: string, sources: string[]): SourcePriorityRule => ({
  channelPattern,
  sources,
  freshnessSeconds: 5,
});

describe('pinnedSourceForChannel', () => {
  it('returns null (Auto) when no rule matches the channel', () => {
    expect(pinnedSourceForChannel([], 'boat.heading.magnetic')).toBeNull();
  });

  it('returns the single source of a one-entry rule', () => {
    const rules = [rule('boat.heading.magnetic', ['n2k:127250@0x80'])];
    expect(pinnedSourceForChannel(rules, 'boat.heading.magnetic')).toBe('n2k:127250@0x80');
  });

  it('reads a legacy multi-source rule as pinned-to-first', () => {
    const rules = [rule('boat.heading.magnetic', ['n2k:127250@0x80', 'n2k:127250@0x11'])];
    expect(pinnedSourceForChannel(rules, 'boat.heading.magnetic')).toBe('n2k:127250@0x80');
  });
});

describe('setPinnedSource', () => {
  it('adds a one-entry rule when pinning with no prior rule', () => {
    const next = setPinnedSource([], 'depth', 'n2k:128267@0x20');
    expect(next).toEqual([
      {
        channelPattern: 'depth',
        sources: ['n2k:128267@0x20'],
        freshnessSeconds: PIN_FRESHNESS_SECONDS,
      },
    ]);
  });

  it('replaces an existing rule when switching source', () => {
    const rules = [rule('boat.heading.magnetic', ['n2k:127250@0x80', 'n2k:127250@0x11'])];
    const next = setPinnedSource(rules, 'boat.heading.magnetic', 'n2k:127250@0x11');
    expect(next).toEqual([
      {
        channelPattern: 'boat.heading.magnetic',
        sources: ['n2k:127250@0x11'],
        freshnessSeconds: PIN_FRESHNESS_SECONDS,
      },
    ]);
  });

  it('removes the channel rule when setting Auto (null)', () => {
    const rules = [rule('boat.heading.magnetic', ['n2k:127250@0x80'])];
    expect(setPinnedSource(rules, 'boat.heading.magnetic', null)).toEqual([]);
  });

  it('leaves other channels rules untouched', () => {
    const rules = [
      rule('depth', ['n2k:128267@0x20']),
      rule('boat.heading.magnetic', ['n2k:127250@0x80']),
    ];
    const next = setPinnedSource(rules, 'boat.heading.magnetic', null);
    expect(next).toEqual([rule('depth', ['n2k:128267@0x20'])]);
  });
});
