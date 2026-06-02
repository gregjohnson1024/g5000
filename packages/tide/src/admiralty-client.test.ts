import { describe, it, expect } from 'vitest';
import { parseStations, parseTidalEvents } from './admiralty-client.js';

describe('parseStations', () => {
  it('maps GeoJSON-style stations to {id,name,lat,lon}', () => {
    const json = {
      features: [
        {
          properties: { Id: '0001', Name: 'Dover' },
          geometry: { type: 'Point', coordinates: [1.32, 51.12] }, // [lon, lat]
        },
      ],
    };
    expect(parseStations(json)).toEqual([{ id: '0001', name: 'Dover', lat: 51.12, lon: 1.32 }]);
  });
  it('skips features missing id/name/coords', () => {
    const json = { features: [{ properties: {}, geometry: null }] };
    expect(parseStations(json)).toEqual([]);
  });
});

describe('parseTidalEvents', () => {
  it('maps events to {type,timeMs,heightM} sorted ascending', () => {
    const json = [
      { EventType: 'HighWater', DateTime: '2026-06-02T12:00:00', Height: 5.1 },
      { EventType: 'LowWater', DateTime: '2026-06-02T06:00:00', Height: 1.0 },
    ];
    const out = parseTidalEvents(json);
    expect(out).toEqual([
      { type: 'LW', timeMs: Date.parse('2026-06-02T06:00:00Z'), heightM: 1.0 },
      { type: 'HW', timeMs: Date.parse('2026-06-02T12:00:00Z'), heightM: 5.1 },
    ]);
  });
});
