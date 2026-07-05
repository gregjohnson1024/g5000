import { describe, it, expect } from 'vitest';
import {
  parseChsCurrentStations,
  parseChsCurrentSeries,
  parseChsCurrentEvents,
} from './chs-currents.js';

describe('parseChsCurrentStations', () => {
  it('keeps stations with both wcsp1 and wcdp1', () => {
    const json = [
      {
        id: 'a',
        officialName: 'Big Bras dOr',
        latitude: 46.28,
        longitude: -60.42,
        timeSeries: [{ code: 'wcsp1' }, { code: 'wcdp1' }, { code: 'wcp1-events' }],
      },
      {
        id: 'b',
        officialName: 'SpeedOnly',
        latitude: 50,
        longitude: -60,
        timeSeries: [{ code: 'wcsp1' }],
      },
      {
        id: 'c',
        officialName: 'Tide',
        latitude: 50,
        longitude: -60,
        timeSeries: [{ code: 'wlp-hilo' }],
      },
    ];
    expect(parseChsCurrentStations(json)).toEqual([
      { id: 'a', name: 'Big Bras dOr', lat: 46.28, lon: -60.42 },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(parseChsCurrentStations(null)).toEqual([]);
  });
});

describe('parseChsCurrentSeries', () => {
  it('inner-joins speed and direction by eventDate, sorted', () => {
    const speed = [
      { eventDate: '2026-06-03T19:00:00Z', value: 3.0 },
      { eventDate: '2026-06-03T18:45:00Z', value: 2.0 },
      { eventDate: '2026-06-03T19:15:00Z', value: 1.0 },
    ];
    const dir = [
      { eventDate: '2026-06-03T18:45:00Z', value: 50 },
      { eventDate: '2026-06-03T19:00:00Z', value: 60 },
    ];
    expect(parseChsCurrentSeries(speed, dir)).toEqual([
      { timeMs: Date.parse('2026-06-03T18:45:00Z'), speedKn: 2.0, dirDeg: 50 },
      { timeMs: Date.parse('2026-06-03T19:00:00Z'), speedKn: 3.0, dirDeg: 60 },
    ]);
  });
  it('returns [] when either input is non-array', () => {
    expect(parseChsCurrentSeries(null, [])).toEqual([]);
  });
});

describe('parseChsCurrentEvents', () => {
  it('maps qualifiers to kinds, sorted, skips unknown', () => {
    const json = [
      { eventDate: '2026-06-04T03:37:00Z', value: 2.3, qualifier: 'EXTREMA_FLOOD' },
      { eventDate: '2026-06-03T20:49:00Z', value: 3.5, qualifier: 'EXTREMA_EBB' },
      { eventDate: '2026-06-04T00:49:00Z', value: 0.0, qualifier: 'SLACK' },
      { eventDate: '2026-06-04T09:00:00Z', value: 1.0, qualifier: 'WHATEVER' },
    ];
    expect(parseChsCurrentEvents(json)).toEqual([
      { timeMs: Date.parse('2026-06-03T20:49:00Z'), speedKn: 3.5, kind: 'ebb' },
      { timeMs: Date.parse('2026-06-04T00:49:00Z'), speedKn: 0.0, kind: 'slack' },
      { timeMs: Date.parse('2026-06-04T03:37:00Z'), speedKn: 2.3, kind: 'flood' },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(parseChsCurrentEvents(undefined)).toEqual([]);
  });
});
