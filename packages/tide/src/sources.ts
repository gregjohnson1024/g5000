import type { Station, TidalEvent } from './types.js';
import { listStations as admiraltyListStations, getTidalEvents as admiraltyGetTidalEvents } from './admiralty-client.js';
import { chsListStations, chsGetTidalEvents } from './chs-client.js';

export type TideSourceId = 'admiralty' | 'chs';

export interface TideSource {
  id: TideSourceId;
  coversPosition(lat: number, lon: number): boolean;
  available(): boolean;
  listStations(): Promise<Station[]>;
  getTidalEvents(stationId: string, days: number): Promise<TidalEvent[]>;
}

const inBbox = (
  lat: number, lon: number, latMin: number, latMax: number, lonMin: number, lonMax: number,
): boolean => lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;

/** Build the tide sources. The ADMIRALTY key is injected (getter) so this
 *  package never reads process.env. Both the service and the API routes build
 *  sources through this one factory. Coverage bboxes are coarse rectangles
 *  (heuristic; UK and Canada do not overlap). */
export function createTideSources(opts: { getAdmiraltyKey: () => string | undefined }): TideSource[] {
  return [
    {
      id: 'admiralty',
      coversPosition: (lat, lon) => inBbox(lat, lon, 48, 62, -14, 3),
      available: () => opts.getAdmiraltyKey() != null,
      listStations: () => admiraltyListStations(opts.getAdmiraltyKey()!),
      getTidalEvents: (id, days) => admiraltyGetTidalEvents(opts.getAdmiraltyKey()!, id, days),
    },
    {
      id: 'chs',
      coversPosition: (lat, lon) => inBbox(lat, lon, 41, 84, -141, -52),
      available: () => true,
      listStations: () => chsListStations(),
      getTidalEvents: (id, days) => chsGetTidalEvents(id, days),
    },
  ];
}

export function getTideSource(sources: ReadonlyArray<TideSource>, id: string): TideSource | undefined {
  return sources.find((s) => s.id === id);
}

/** Resolve the active source: explicit override (if available), else the first
 *  available source whose bbox contains `pos`. Null when none. */
export function selectSource(
  sources: ReadonlyArray<TideSource>,
  cfg: { tideSource: 'auto' | TideSourceId },
  pos: { lat: number; lon: number } | null,
): TideSource | null {
  if (cfg.tideSource !== 'auto') {
    const s = getTideSource(sources, cfg.tideSource);
    return s && s.available() ? s : null;
  }
  if (!pos) return null;
  for (const s of sources) {
    if (s.coversPosition(pos.lat, pos.lon) && s.available()) return s;
  }
  return null;
}
