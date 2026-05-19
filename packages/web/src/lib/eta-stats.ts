import { activeTrack } from './tracks';
import { computeDistanceStats } from './distance-stats';

const M_TO_NM = 1 / 1852;
const MS_TO_KN = 1 / 0.514444;
const ETA_3H_SEC = 3 * 3600;
const R_M = 6371000;

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

function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const φ1 = (aLat * Math.PI) / 180;
  const φ2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.sqrt(h)) * M_TO_NM;
}

function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const φ1 = (aLat * Math.PI) / 180;
  const φ2 = (bLat * Math.PI) / 180;
  const Δλ = ((bLon - aLon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
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

  const distanceNm = haversineNm(last.lat, last.lon, destLat, destLon);
  const distanceM = distanceNm / M_TO_NM;

  const etaSecRemaining = avgSpeedMs > 0 ? Math.floor(distanceM / avgSpeedMs) : null;
  const etaUnixSec = etaSecRemaining !== null ? Math.floor(last.t + etaSecRemaining) : null;

  return {
    destinationLat: destLat,
    destinationLon: destLon,
    destinationLabel,
    distanceNm,
    bearingDeg: bearingDeg(last.lat, last.lon, destLat, destLon),
    avgSpeedKn3h,
    etaUnixSec,
    etaSecRemaining,
    currentLat: last.lat,
    currentLon: last.lon,
    currentAtUnixSec: last.t,
  };
}
