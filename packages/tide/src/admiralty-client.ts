import type { Station, TidalEvent } from './types.js';

const BASE = 'https://admiraltyapi.azure-api.net/uktidalapi/api/V1';

export class TideApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TideApiError';
  }
}

/** Parse the /Stations GeoJSON FeatureCollection into Station[]. Pure. */
export function parseStations(json: unknown): Station[] {
  const features = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const out: Station[] = [];
  for (const f of features) {
    const props = (f as { properties?: { Id?: unknown; Name?: unknown } }).properties;
    const coords = (f as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
    const id = props?.Id;
    const name = props?.Name;
    if (
      typeof id === 'string' &&
      typeof name === 'string' &&
      Array.isArray(coords) &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number'
    ) {
      out.push({ id, name, lat: coords[1], lon: coords[0] }); // GeoJSON is [lon, lat]
    }
  }
  return out;
}

/** Parse the /TidalEvents array into TidalEvent[], sorted ascending by time.
 *  API DateTime is UTC; treat a bare (no-offset) string as UTC by appending 'Z'. */
export function parseTidalEvents(json: unknown): TidalEvent[] {
  if (!Array.isArray(json)) return [];
  const out: TidalEvent[] = [];
  for (const e of json as Array<{ EventType?: unknown; DateTime?: unknown; Height?: unknown }>) {
    const type = e.EventType === 'HighWater' ? 'HW' : e.EventType === 'LowWater' ? 'LW' : null;
    const dt = e.DateTime;
    const h = e.Height;
    if (type && typeof dt === 'string' && typeof h === 'number') {
      const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(dt) ? dt : `${dt}Z`;
      const timeMs = Date.parse(iso);
      if (!Number.isNaN(timeMs)) out.push({ type, timeMs, heightM: h });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

async function get(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Ocp-Apim-Subscription-Key': key },
  });
  if (!res.ok) throw new TideApiError(`ADMIRALTY ${path} → ${res.status}`, res.status);
  return res.json();
}

export async function listStations(key: string): Promise<Station[]> {
  return parseStations(await get('/Stations', key));
}

export async function getTidalEvents(key: string, stationId: string, duration = 7): Promise<TidalEvent[]> {
  const d = Math.max(1, Math.min(7, duration));
  return parseTidalEvents(await get(`/Stations/${encodeURIComponent(stationId)}/TidalEvents?duration=${d}`, key));
}
