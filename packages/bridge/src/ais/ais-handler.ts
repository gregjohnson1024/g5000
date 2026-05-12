import { getSharedAisTargets, type VesselClass } from '@g5000/core';
import { createAisTargetsRegistry } from './targets-registry.js';

/**
 * AIS PGNs we extract into the registry. Everything else passes through
 * unchanged.
 *
 * | PGN    | Purpose                              |
 * |--------|--------------------------------------|
 * | 129038 | AIS Class A position report          |
 * | 129039 | AIS Class B position report          |
 * | 129040 | AIS Class B extended position report |
 * | 129794 | AIS Class A static + voyage data     |
 * | 129809 | AIS Class B static "Part A" (name)   |
 * | 129810 | AIS Class B static "Part B"          |
 */
export const AIS_PGNS: ReadonlySet<number> = new Set([
  129038, 129039, 129040, 129794, 129809, 129810,
]);

/** Returns true iff `pgn` is one of the AIS PGNs we handle. */
export function isAisPgn(pgn: number): boolean {
  return AIS_PGNS.has(pgn);
}

/** Cheap number-coercion that treats NaN/non-finite as "absent". */
function num(v: unknown): number | undefined {
  if (typeof v !== 'number') {
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }
  return Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Map a PGN number to its vessel class. */
function classFor(pgn: number): VesselClass {
  if (pgn === 129038 || pgn === 129794) return 'A';
  if (pgn === 129039 || pgn === 129040 || pgn === 129809 || pgn === 129810) return 'B';
  return 'unknown';
}

/**
 * Decode an AIS PGN's fields into a registry upsert. Idempotent — the registry
 * merges partials. We accept the canboatjs field-name convention ("User ID",
 * "COG", "Type of ship", …) and a camelCase fallback in case the upstream
 * library changes its emit shape later.
 *
 * Returns `true` if the registry was updated, `false` if the PGN was ignored
 * (unknown PGN, missing MMSI, or invalid MMSI).
 */
export function handleAisPgn(pgn: number, fields: Record<string, unknown>): boolean {
  if (!AIS_PGNS.has(pgn)) return false;
  const registry = getSharedAisTargets() ?? createAisTargetsRegistry();

  const mmsi = num(fields['User ID'] ?? fields['userId'] ?? fields['MMSI']);
  if (mmsi === undefined || mmsi <= 0) return false;

  const update: Parameters<typeof registry.upsert>[0] = {
    mmsi,
    vesselClass: classFor(pgn),
  };

  const lat = num(fields['Latitude'] ?? fields['latitude']);
  if (lat !== undefined) update.lat = lat;
  const lon = num(fields['Longitude'] ?? fields['longitude']);
  if (lon !== undefined) update.lon = lon;
  const cog = num(fields['COG'] ?? fields['cog']);
  if (cog !== undefined) update.cog = cog;
  const sog = num(fields['SOG'] ?? fields['sog']);
  if (sog !== undefined) update.sog = sog;

  // PGN 129040 uses 'True Heading' instead of 'Heading'. Accept both.
  const heading = num(
    fields['Heading'] ?? fields['True Heading'] ?? fields['heading'] ?? fields['trueHeading'],
  );
  if (heading !== undefined) update.heading = heading;

  const rot = num(fields['Rate of Turn'] ?? fields['rateOfTurn']);
  if (rot !== undefined) update.rateOfTurn = rot;

  // canboatjs uses 'Type of ship' (lower-case `s`).
  const vesselType = num(fields['Type of ship'] ?? fields['Type of Ship'] ?? fields['typeOfShip']);
  if (vesselType !== undefined) update.vesselType = vesselType;

  const length = num(fields['Length'] ?? fields['length']);
  if (length !== undefined) update.length = length;
  const beam = num(fields['Beam'] ?? fields['beam']);
  if (beam !== undefined) update.beam = beam;

  const name = str(fields['Name'] ?? fields['name']);
  if (name !== undefined) update.name = name;

  registry.upsert(update);
  return true;
}
