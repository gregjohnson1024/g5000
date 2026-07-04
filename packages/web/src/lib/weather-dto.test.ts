import { describe, expect, it } from 'vitest';
import { parseCurrent, parseForecast, wmoLabel } from './weather-dto';

// Trimmed Open-Meteo fixture (real response, 2026-07-04, lat=25.49 lon=-76.64)
// wind_speed_unit=kn → wind + gusts are KNOTS; temp in °C; pressure in hPa
const FIXTURE_CURRENT = {
  current_units: {
    temperature_2m: '°C',
    wind_speed_10m: 'kn',
    wind_gusts_10m: 'kn',
  },
  current: {
    time: '2026-07-04T15:30',
    interval: 900,
    temperature_2m: 32.5,
    relative_humidity_2m: 62,
    apparent_temperature: 39.1,
    precipitation: 0.0,
    weather_code: 1,
    pressure_msl: 1017.9,
    wind_speed_10m: 5.2,
    wind_gusts_10m: 5.6,
  },
};

const FIXTURE_FORECAST = {
  hourly_units: {
    temperature_2m: '°C',
    wind_speed_10m: 'kn',
    wind_gusts_10m: 'kn',
  },
  hourly: {
    time: ['2026-07-04T00:00', '2026-07-04T01:00', '2026-07-04T02:00'],
    temperature_2m: [28.6, 28.1, 27.7],
    precipitation_probability: [10, 7, 0],
    cloud_cover: [1, 0, 0],
    wind_speed_10m: [4.7, 3.4, 1.8],
    wind_gusts_10m: [6.2, 5.4, 5.1],
    wind_direction_10m: [85, 100, 122],
    relative_humidity_2m: [80, 81, 82],
    uv_index: [0.3, 0.0, 0.0],
    pressure_msl: [1018.6, 1018.7, 1018.9],
  },
  daily_units: {
    wind_speed_10m_max: 'kn',
  },
  daily: {
    time: ['2026-07-04', '2026-07-05'],
    weather_code: [3, 82],
    temperature_2m_max: [32.4, 29.6],
    temperature_2m_min: [25.9, 23.5],
    precipitation_probability_max: [15, 27],
    wind_speed_10m_max: [8.0, 14.7],
  },
};

describe('wmoLabel', () => {
  it('maps known codes', () => {
    expect(wmoLabel(0)).toBe('Clear');
    expect(wmoLabel(1)).toBe('Mostly clear');
    expect(wmoLabel(3)).toBe('Overcast');
    expect(wmoLabel(82)).toBe('Rain showers');
    expect(wmoLabel(95)).toBe('Thunderstorm');
  });

  it('returns Unknown for unrecognised codes', () => {
    expect(wmoLabel(999)).toBe('Unknown');
  });
});

describe('parseCurrent', () => {
  it('maps all fields correctly', () => {
    const result = parseCurrent(FIXTURE_CURRENT);
    expect(result.tempC).toBe(32.5);
    expect(result.apparentC).toBe(39.1);
    expect(result.condition).toBe('Mostly clear'); // code 1
    expect(result.windKn).toBe(5.2); // knots, not m/s
    expect(result.gustKn).toBe(5.6);
    expect(result.humidity).toBe(62);
    expect(result.pressure).toBe(1017.9);
    expect(result.uv).toBe(0); // not in current block
    expect(result.precipProb).toBe(0); // not in current block
    expect(result.updatedAt).toBe(new Date('2026-07-04T15:30Z').getTime());
  });

  it('updatedAt is a millisecond timestamp', () => {
    const result = parseCurrent(FIXTURE_CURRENT);
    expect(result.updatedAt).toBeGreaterThan(1_000_000_000_000);
  });
});

describe('parseForecast', () => {
  it('returns 3 hourly points', () => {
    const result = parseForecast(FIXTURE_FORECAST);
    expect(result.hourly).toHaveLength(3);
  });

  it('maps hourly HourPoint fields', () => {
    const result = parseForecast(FIXTURE_FORECAST);
    const h = result.hourly[0]!;
    expect(h.timeMs).toBe(new Date('2026-07-04T00:00Z').getTime());
    expect(h.tempC).toBe(28.6);
    expect(h.windKn).toBe(4.7);
    expect(h.gustKn).toBe(6.2);
    expect(h.dirDeg).toBe(85);
    expect(h.cloudPct).toBe(1);
    expect(h.precipProbPct).toBe(10);
    expect(h.humidityPct).toBe(80);
    expect(h.uv).toBe(0.3);
    expect(h.pressure).toBe(1018.6);
  });

  it('returns 2 daily points', () => {
    const result = parseForecast(FIXTURE_FORECAST);
    expect(result.daily).toHaveLength(2);
  });

  it('maps daily DayPoint fields', () => {
    const result = parseForecast(FIXTURE_FORECAST);
    const d = result.daily[1]!;
    expect(d.dateMs).toBe(new Date('2026-07-05T00:00:00Z').getTime());
    expect(d.code).toBe(82);
    expect(d.tMaxC).toBe(29.6);
    expect(d.tMinC).toBe(23.5);
    expect(d.precipProbMaxPct).toBe(27);
    expect(d.windKnMax).toBe(14.7);
  });

  it('fetchedAt is a recent timestamp', () => {
    const before = Date.now();
    const result = parseForecast(FIXTURE_FORECAST);
    expect(result.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(result.fetchedAt).toBeLessThanOrEqual(Date.now());
  });
});
