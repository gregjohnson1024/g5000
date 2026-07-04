import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCurrent, parseForecast, WeatherCurrent, WeatherForecast } from './weather-dto';

const TTL_CURRENT_MS = 10 * 60 * 1000; // 10 min
const TTL_FORECAST_MS = 30 * 60 * 1000; // 30 min

type CacheType = 'current' | 'forecast';

interface MemEntry<T> {
  data: T;
  expiresAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const memCache = new Map<string, MemEntry<any>>();

export interface FetchResult<T> {
  data: T;
  stale: boolean;
}

export interface CacheOptions {
  now?: () => number;
  fetcher?: (url: string) => Promise<unknown>;
}

function cacheKey(lat: number, lon: number, type: CacheType): string {
  return `${type}_${lat.toFixed(4)}_${lon.toFixed(4)}`;
}

function diskPath(key: string): string {
  const home = process.env['HOME'] ?? '/tmp';
  return path.join(home, '.g5000-router', 'weather-cache', `${key}.json`);
}

async function readDisk<T>(key: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(diskPath(key), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeDisk<T>(key: string, data: T): Promise<void> {
  try {
    const p = diskPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(data), 'utf-8');
  } catch {
    // best-effort
  }
}

function buildUrl(lat: number, lon: number, type: CacheType): string {
  const base = 'https://api.open-meteo.com/v1/forecast';
  const common = `latitude=${lat}&longitude=${lon}&wind_speed_unit=kn&timezone=UTC`;
  if (type === 'current') {
    return (
      `${base}?${common}&current=temperature_2m,relative_humidity_2m,apparent_temperature,` +
      `precipitation,weather_code,pressure_msl,wind_speed_10m,wind_gusts_10m`
    );
  }
  return (
    `${base}?${common}` +
    `&hourly=temperature_2m,precipitation_probability,cloud_cover,wind_speed_10m,wind_gusts_10m,` +
    `wind_direction_10m,relative_humidity_2m,uv_index,pressure_msl` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max`
  );
}

export async function fetchCurrent(
  lat: number,
  lon: number,
  opts: CacheOptions = {},
): Promise<FetchResult<WeatherCurrent>> {
  const now = opts.now ?? (() => Date.now());
  const fetcher = opts.fetcher ?? ((url) => fetch(url).then((r) => r.json()));
  const key = cacheKey(lat, lon, 'current');
  const ttl = TTL_CURRENT_MS;

  // memory hit
  const mem = memCache.get(key);
  if (mem && now() < mem.expiresAt) {
    return { data: mem.data as WeatherCurrent, stale: false };
  }

  // try upstream
  try {
    const raw = await fetcher(buildUrl(lat, lon, 'current'));
    const data = parseCurrent(raw);
    memCache.set(key, { data, expiresAt: now() + ttl });
    await writeDisk(key, data);
    return { data, stale: false };
  } catch {
    // upstream failed — fall back to disk
    const disk = await readDisk<WeatherCurrent>(key);
    if (disk) return { data: disk, stale: true };
    throw new Error(`weather current fetch failed and no cached data for ${lat},${lon}`);
  }
}

export async function fetchForecast(
  lat: number,
  lon: number,
  opts: CacheOptions = {},
): Promise<FetchResult<WeatherForecast>> {
  const now = opts.now ?? (() => Date.now());
  const fetcher = opts.fetcher ?? ((url) => fetch(url).then((r) => r.json()));
  const key = cacheKey(lat, lon, 'forecast');
  const ttl = TTL_FORECAST_MS;

  // memory hit
  const mem = memCache.get(key);
  if (mem && now() < mem.expiresAt) {
    return { data: mem.data as WeatherForecast, stale: false };
  }

  // try upstream
  try {
    const raw = await fetcher(buildUrl(lat, lon, 'forecast'));
    const data = parseForecast(raw);
    memCache.set(key, { data, expiresAt: now() + ttl });
    await writeDisk(key, data);
    return { data, stale: false };
  } catch {
    const disk = await readDisk<WeatherForecast>(key);
    if (disk) return { data: disk, stale: true };
    throw new Error(`weather forecast fetch failed and no cached data for ${lat},${lon}`);
  }
}

/** Exposed for testing — clears the in-process memory cache. */
export function _clearMemCache(): void {
  memCache.clear();
}
