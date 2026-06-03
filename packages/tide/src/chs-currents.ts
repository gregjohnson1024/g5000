import type { Station } from './types.js';
import { chsGet } from './chs-client.js';
import type { CurrentPrediction, CurrentEvent, CurrentEventKind } from './current-prediction.js';

/** Stations with BOTH current-speed (wcsp1) and current-direction (wcdp1) predictions. Pure. */
export function parseChsCurrentStations(json: unknown): Station[] {
  if (!Array.isArray(json)) return [];
  const out: Station[] = [];
  for (const s of json as Array<{
    id?: unknown; officialName?: unknown; latitude?: unknown; longitude?: unknown;
    timeSeries?: Array<{ code?: unknown }>;
  }>) {
    const codes = Array.isArray(s.timeSeries) ? s.timeSeries.map((t) => t?.code) : [];
    if (
      codes.includes('wcsp1') &&
      codes.includes('wcdp1') &&
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

/** Inner-join the speed (wcsp1) and direction (wcdp1) series by eventDate.
 *  Keeps only timestamps present in BOTH. Sorted ascending. Pure. */
export function parseChsCurrentSeries(speedJson: unknown, dirJson: unknown): CurrentPrediction[] {
  if (!Array.isArray(speedJson) || !Array.isArray(dirJson)) return [];
  const dirByDate = new Map<string, number>();
  for (const e of dirJson as Array<{ eventDate?: unknown; value?: unknown }>) {
    if (typeof e.eventDate === 'string' && typeof e.value === 'number') dirByDate.set(e.eventDate, e.value);
  }
  const out: CurrentPrediction[] = [];
  for (const e of speedJson as Array<{ eventDate?: unknown; value?: unknown }>) {
    if (typeof e.eventDate === 'string' && typeof e.value === 'number' && dirByDate.has(e.eventDate)) {
      const t = Date.parse(e.eventDate);
      if (!Number.isNaN(t)) out.push({ timeMs: t, speedKn: e.value, dirDeg: dirByDate.get(e.eventDate)! });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

const QUALIFIER_KIND: Record<string, CurrentEventKind> = {
  SLACK: 'slack',
  EXTREMA_FLOOD: 'flood',
  EXTREMA_EBB: 'ebb',
};

/** Parse wcp1-events turning points. Pure. Sorted ascending; skips unknown qualifiers. */
export function parseChsCurrentEvents(json: unknown): CurrentEvent[] {
  if (!Array.isArray(json)) return [];
  const out: CurrentEvent[] = [];
  for (const e of json as Array<{ eventDate?: unknown; value?: unknown; qualifier?: unknown }>) {
    const kind = typeof e.qualifier === 'string' ? QUALIFIER_KIND[e.qualifier] : undefined;
    if (kind && typeof e.eventDate === 'string' && typeof e.value === 'number') {
      const t = Date.parse(e.eventDate);
      if (!Number.isNaN(t)) out.push({ timeMs: t, speedKn: e.value, kind });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}

const predictWindow = (hours: number): { from: string; to: string } => ({
  from: new Date().toISOString(),
  to: new Date(Date.now() + hours * 3_600_000).toISOString(),
});

export async function chsListCurrentStations(): Promise<Station[]> {
  return parseChsCurrentStations(await chsGet('/stations'));
}

export async function chsGetCurrentPredictions(stationId: string, hours = 48): Promise<CurrentPrediction[]> {
  const { from, to } = predictWindow(hours);
  const enc = encodeURIComponent(stationId);
  const [speed, dir] = await Promise.all([
    chsGet(`/stations/${enc}/data?time-series-code=wcsp1&from=${from}&to=${to}`),
    chsGet(`/stations/${enc}/data?time-series-code=wcdp1&from=${from}&to=${to}`),
  ]);
  return parseChsCurrentSeries(speed, dir);
}

export async function chsGetCurrentEvents(stationId: string, hours = 48): Promise<CurrentEvent[]> {
  const { from, to } = predictWindow(hours);
  const enc = encodeURIComponent(stationId);
  return parseChsCurrentEvents(await chsGet(`/stations/${enc}/data?time-series-code=wcp1-events&from=${from}&to=${to}`));
}
