import type { Station, TidalEvent } from './types.js';
import { TideApiError } from './admiralty-client.js';

const CHS_BASE = 'https://api-sine.dfo-mpo.gc.ca/api/v1';

/** Parse /stations into prediction-capable Station[]. Pure.
 *  Keeps only stations whose timeSeries includes 'wlp-hilo'. */
export function parseChsStations(json: unknown): Station[] {
  if (!Array.isArray(json)) return [];
  const out: Station[] = [];
  for (const s of json as Array<{
    id?: unknown; officialName?: unknown; latitude?: unknown; longitude?: unknown;
    timeSeries?: Array<{ code?: unknown }>;
  }>) {
    const series = Array.isArray(s.timeSeries) ? s.timeSeries : [];
    const hasHilo = series.some((t) => t?.code === 'wlp-hilo');
    if (
      hasHilo &&
      typeof s.id === 'string' &&
      typeof s.officialName === 'string' &&
      typeof s.latitude === 'number' &&
      typeof s.longitude === 'number'
    ) {
      out.push({ id: s.id, name: s.officialName, lat: s.latitude, lon: s.longitude });
    }
  }
  return out;
}

/** Parse wlp-hilo extrema into TidalEvent[] sorted ascending, deriving HW/LW by
 *  alternation (no label in the API): event i is HW iff its value exceeds the
 *  adjacent extremum. Pure. */
export function parseChsEvents(json: unknown): TidalEvent[] {
  if (!Array.isArray(json)) return [];
  const pts: Array<{ timeMs: number; heightM: number }> = [];
  for (const e of json as Array<{ eventDate?: unknown; value?: unknown }>) {
    if (typeof e.eventDate === 'string' && typeof e.value === 'number') {
      const t = Date.parse(e.eventDate);
      if (!Number.isNaN(t)) pts.push({ timeMs: t, heightM: e.value });
    }
  }
  pts.sort((a, b) => a.timeMs - b.timeMs);
  return pts.map((p, i, arr) => {
    let type: 'HW' | 'LW';
    if (arr.length === 1) type = 'HW';
    else if (i === 0) type = p.heightM > arr[1]!.heightM ? 'HW' : 'LW';
    else type = p.heightM > arr[i - 1]!.heightM ? 'HW' : 'LW';
    return { type, timeMs: p.timeMs, heightM: p.heightM };
  });
}

async function chsGet(path: string): Promise<unknown> {
  const res = await fetch(`${CHS_BASE}${path}`);
  if (!res.ok) throw new TideApiError(`CHS ${path} → ${res.status}`, res.status);
  return res.json();
}

export async function chsListStations(): Promise<Station[]> {
  return parseChsStations(await chsGet('/stations'));
}

export async function chsGetTidalEvents(stationId: string, days: number): Promise<TidalEvent[]> {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + days * 86_400_000).toISOString();
  const path = `/stations/${encodeURIComponent(stationId)}/data?time-series-code=wlp-hilo&from=${from}&to=${to}`;
  return parseChsEvents(await chsGet(path));
}
