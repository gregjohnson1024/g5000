import { describe, it, expect } from 'vitest';
import { parseChsStations, parseChsEvents } from './chs-client.js';

describe('parseChsStations', () => {
  it('maps prediction-capable stations and skips others', () => {
    const json = [
      { id: '5cebf1df3d0f4a073c4bbcbb', code: '00490', officialName: 'Halifax', latitude: 44.65914, longitude: -63.583386,
        timeSeries: [{ code: 'wlp' }, { code: 'wlp-hilo' }] },
      { id: 'x', code: '0', officialName: 'NoPredict', latitude: 50, longitude: -60, timeSeries: [{ code: 'wlo' }] },
      { id: 'y', officialName: 'BadCoords', timeSeries: [{ code: 'wlp-hilo' }] },
    ];
    expect(parseChsStations(json)).toEqual([
      { id: '5cebf1df3d0f4a073c4bbcbb', name: 'Halifax', lat: 44.65914, lon: -63.583386 },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(parseChsStations(null)).toEqual([]);
  });
});

describe('parseChsEvents', () => {
  it('derives HW/LW from the value alternation, sorted ascending', () => {
    const json = [
      { eventDate: '2026-06-04T01:55:00Z', value: 1.706 },
      { eventDate: '2026-06-03T19:59:00Z', value: 0.74 },
      { eventDate: '2026-06-04T08:31:00Z', value: 0.425 },
    ];
    expect(parseChsEvents(json)).toEqual([
      { type: 'LW', timeMs: Date.parse('2026-06-03T19:59:00Z'), heightM: 0.74 },
      { type: 'HW', timeMs: Date.parse('2026-06-04T01:55:00Z'), heightM: 1.706 },
      { type: 'LW', timeMs: Date.parse('2026-06-04T08:31:00Z'), heightM: 0.425 },
    ]);
  });
  it('types a lone extremum as HW', () => {
    expect(parseChsEvents([{ eventDate: '2026-06-03T19:59:00Z', value: 1.0 }])).toEqual([
      { type: 'HW', timeMs: Date.parse('2026-06-03T19:59:00Z'), heightM: 1.0 },
    ]);
  });
  it('returns [] for non-array', () => {
    expect(parseChsEvents(undefined)).toEqual([]);
  });
});
