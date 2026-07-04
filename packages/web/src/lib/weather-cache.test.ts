import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _clearMemCache, fetchCurrent, fetchForecast } from './weather-cache';

// Minimal fake payloads parseCurrent / parseForecast can consume
const FAKE_CURRENT_RAW = {
  current: {
    time: '2026-07-04T12:00',
    temperature_2m: 28,
    apparent_temperature: 32,
    weather_code: 0,
    pressure_msl: 1015,
    wind_speed_10m: 10,
    wind_gusts_10m: 14,
    relative_humidity_2m: 70,
    precipitation: 0,
  },
};

const FAKE_FORECAST_RAW = {
  hourly: {
    time: ['2026-07-04T00:00'],
    temperature_2m: [28],
    precipitation_probability: [5],
    cloud_cover: [10],
    wind_speed_10m: [10],
    wind_gusts_10m: [14],
    wind_direction_10m: [90],
    relative_humidity_2m: [70],
    uv_index: [0],
    pressure_msl: [1015],
  },
  daily: {
    time: ['2026-07-04'],
    weather_code: [0],
    temperature_2m_max: [32],
    temperature_2m_min: [24],
    precipitation_probability_max: [5],
    wind_speed_10m_max: [14],
  },
};

const LAT = 25.49;
const LON = -76.64;
const T0 = 1_000_000_000_000; // arbitrary start epoch

describe('fetchCurrent', () => {
  beforeEach(() => {
    _clearMemCache();
  });

  it('TTL-hit: fetcher called only once within TTL', async () => {
    let t = T0;
    const now = () => t;
    const fetcher = vi.fn().mockResolvedValue(FAKE_CURRENT_RAW);

    await fetchCurrent(LAT, LON, { now, fetcher });
    t += 1_000; // advance 1 s — still within 10-min TTL
    const r2 = await fetchCurrent(LAT, LON, { now, fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r2.stale).toBe(false);
    expect(r2.data.tempC).toBe(28);
  });

  it('TTL-miss: fetcher called twice after TTL expires', async () => {
    let t = T0;
    const now = () => t;
    const fetcher = vi.fn().mockResolvedValue(FAKE_CURRENT_RAW);

    await fetchCurrent(LAT, LON, { now, fetcher });
    t += 11 * 60 * 1000; // advance 11 min — past 10-min TTL
    await fetchCurrent(LAT, LON, { now, fetcher });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('upstream-fail → last-good with stale:true', async () => {
    let t = T0;
    const now = () => t;

    // First call succeeds — populates memory cache
    const goodFetcher = vi.fn().mockResolvedValue(FAKE_CURRENT_RAW);
    await fetchCurrent(LAT, LON, { now, fetcher: goodFetcher });

    // Advance past TTL so memory cache expires
    t += 11 * 60 * 1000;

    // Second call throws
    const badFetcher = vi.fn().mockRejectedValue(new Error('network error'));

    // disk cache won't have data in test env, but memory was populated;
    // after expiry the cache falls through to fetcher then disk.
    // We pre-seed the disk by writing first entry; in this unit test we
    // verify the stale path via a two-phase: first expire, then fail,
    // BUT since disk I/O may not find the file, we seed it manually by
    // running a successful fetch, clearing mem, then failing.
    _clearMemCache();

    // Seed disk by calling with good fetcher while mem is clear
    await fetchCurrent(LAT, LON, { now, fetcher: goodFetcher });

    // Clear mem again, advance time, use bad fetcher
    _clearMemCache();
    t += 11 * 60 * 1000;

    const result = await fetchCurrent(LAT, LON, { now, fetcher: badFetcher });

    expect(result.stale).toBe(true);
    expect(result.data.tempC).toBe(28);
  });
});

describe('fetchForecast', () => {
  beforeEach(() => {
    _clearMemCache();
  });

  it('TTL-hit: fetcher called only once within TTL', async () => {
    let t = T0;
    const now = () => t;
    const fetcher = vi.fn().mockResolvedValue(FAKE_FORECAST_RAW);

    await fetchForecast(LAT, LON, { now, fetcher });
    t += 5 * 60 * 1000; // 5 min — within 30-min TTL
    const r2 = await fetchForecast(LAT, LON, { now, fetcher });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r2.stale).toBe(false);
    expect(r2.data.hourly).toHaveLength(1);
  });

  it('TTL-miss: fetcher called twice after TTL expires', async () => {
    let t = T0;
    const now = () => t;
    const fetcher = vi.fn().mockResolvedValue(FAKE_FORECAST_RAW);

    await fetchForecast(LAT, LON, { now, fetcher });
    t += 31 * 60 * 1000; // 31 min — past 30-min TTL
    await fetchForecast(LAT, LON, { now, fetcher });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('upstream-fail → last-good with stale:true', async () => {
    let t = T0;
    const now = () => t;
    const goodFetcher = vi.fn().mockResolvedValue(FAKE_FORECAST_RAW);
    const badFetcher = vi.fn().mockRejectedValue(new Error('network error'));

    // Seed disk
    await fetchForecast(LAT, LON, { now, fetcher: goodFetcher });
    _clearMemCache();
    t += 31 * 60 * 1000;

    const result = await fetchForecast(LAT, LON, { now, fetcher: badFetcher });

    expect(result.stale).toBe(true);
    expect(result.data.daily).toHaveLength(1);
  });
});
