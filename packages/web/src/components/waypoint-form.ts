import { parseLatLon } from '../lib/coords';

export interface WaypointFormInput {
  name: string;
  positionRaw: string;
  notes: string;
}

export interface WaypointPatch {
  name: string;
  lat: number;
  lon: number;
  notes?: string;
}

export type ParseResult = { ok: true; patch: WaypointPatch } | { ok: false; error: string };

/**
 * Normalize a compact DMM string like `41 29.2n 71 19.5w` so that
 * `parseLatLon` splits it correctly. Inserts a comma after the latitude
 * hemisphere letter (N/S) when it is immediately followed by whitespace
 * and the start of the longitude component.
 */
function normalizePosition(raw: string): string {
  // Insert a comma after a N/S hemisphere letter that is followed by whitespace
  // before the longitude component (which starts with a digit or minus sign).
  return raw.replace(/([NS])\s+(?=\d|-)/i, '$1, ');
}

/** Validate + parse the edit form into a PUT body, or return a user error. */
export function parseWaypointForm(input: WaypointFormInput): ParseResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required' };
  let lat: number;
  let lon: number;
  try {
    ({ lat, lon } = parseLatLon(normalizePosition(input.positionRaw)));
  } catch {
    return { ok: false, error: 'Position must be a valid coordinate (e.g. 41 29.2n 71 19.5w)' };
  }
  const notes = input.notes.trim();
  return { ok: true, patch: { name, lat, lon, ...(notes ? { notes } : {}) } };
}
