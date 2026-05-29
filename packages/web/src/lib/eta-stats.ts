import { activeTrack } from './tracks';
import { computeDistanceStats } from './distance-stats';
import { haversineM, bearingDeg } from './geo';

const M_TO_NM = 1 / 1852;
const MS_TO_KN = 1 / 0.514444;
const ETA_3H_SEC = 3 * 3600;

export interface EtaSnapshot {
  destinationLat: number;
  destinationLon: number;
  destinationLabel: string;
  /** Great-circle distance from current position to destination, nautical miles. */
  distanceNm: number;
  /** Bearing from current position to destination, degrees true (0–360). */
  bearingDeg: number;
  /** Average speed over last 3 h (distance/time), knots. null if no movement. */
  avgSpeedKn3h: number | null;
  /** Estimated UNIX seconds at destination. null if avgSpeedKn3h is null or zero. */
  etaUnixSec: number | null;
  /** Seconds remaining at current avg speed. null if avgSpeedKn3h is null or zero. */
  etaSecRemaining: number | null;
  /** Current position used for the calculation. */
  currentLat: number;
  currentLon: number;
  currentAtUnixSec: number;
}

/**
 * Compute ETA from the latest track point to `(destLat, destLon)`.
 * Effective speed is derived from distance traveled over the last 3 h
 * divided by 3 h — more authoritative than instantaneous SOG.
 * Returns null if there is no active track with any points.
 */
export async function computeEta(
  destLat: number,
  destLon: number,
  destinationLabel: string,
): Promise<EtaSnapshot | null> {
  const track = await activeTrack();
  if (!track || track.points.length === 0) return null;
  const last = track.points[track.points.length - 1]!;

  const dist = await computeDistanceStats();
  const d3hM = dist.d3hM ?? 0;

  const avgSpeedMs = d3hM > 0 ? d3hM / ETA_3H_SEC : 0;
  const avgSpeedKn3h = avgSpeedMs > 0 ? avgSpeedMs * MS_TO_KN : null;

  const distanceNm = haversineM(last.lat, last.lon, destLat, destLon) * M_TO_NM;
  const distanceM = distanceNm / M_TO_NM;

  const etaSecRemaining = avgSpeedMs > 0 ? Math.floor(distanceM / avgSpeedMs) : null;
  const etaUnixSec = etaSecRemaining !== null ? Math.floor(last.t + etaSecRemaining) : null;

  return {
    destinationLat: destLat,
    destinationLon: destLon,
    destinationLabel,
    distanceNm,
    bearingDeg: bearingDeg({ lat: last.lat, lon: last.lon }, { lat: destLat, lon: destLon }),
    avgSpeedKn3h,
    etaUnixSec,
    etaSecRemaining,
    currentLat: last.lat,
    currentLon: last.lon,
    currentAtUnixSec: last.t,
  };
}
