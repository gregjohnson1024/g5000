/**
 * Coordinate string parsing. Accepts any of:
 *   - DMS:        `41°45'53.9"N`, `71°07'42.6"W` (with or without spaces, ° or d)
 *   - DM.M:       `41° 45.898' N`, `71 45.9 W`
 *   - Decimal:    `41.76497 N`, `-71.12850`, `41.76497, -71.12850`
 *   - Signed decimal: `41.76497`, `-71.12850`
 *
 * `parseCoordinate` parses a single lat OR lon value. The optional `axis`
 * hint disambiguates a hemisphere-less signed decimal (latitudes < 90,
 * longitudes can be > 90), and is informational only.
 *
 * `parseLatLon` accepts a single string with two coordinates separated by
 * a comma, semicolon, slash, or whitespace.
 *
 * All parsers return signed decimal degrees. Latitudes are positive North,
 * longitudes positive East (standard nautical sign convention).
 */

/** Result of parsing one coordinate token. Signed decimal degrees. */
export type ParsedCoord = number;

const HEMI_RE = /[NSEW]/i;

function hemiSign(h: string | undefined, axis: 'lat' | 'lon' | undefined): 1 | -1 | 0 {
  if (!h) return 0;
  const u = h.toUpperCase();
  if (u === 'N') return 1;
  if (u === 'S') return -1;
  if (u === 'E') return 1;
  if (u === 'W') return -1;
  void axis;
  return 0;
}

/**
 * Parse a single coordinate string. Throws Error on invalid input.
 *
 * @param raw   the input string
 * @param axis  optional hint: 'lat' or 'lon' (used only for clamping errors)
 */
export function parseCoordinate(raw: string, axis?: 'lat' | 'lon'): ParsedCoord {
  if (typeof raw !== 'string') throw new Error('coordinate must be a string');
  const s = raw.trim();
  if (s.length === 0) throw new Error('coordinate is empty');

  // Extract hemisphere letter if present (anywhere in the string).
  const hemiMatch = s.match(HEMI_RE);
  const hemi = hemiMatch ? hemiMatch[0] : undefined;
  const stripped = s.replace(HEMI_RE, '').trim();

  // Pull out all numeric tokens. We accept multiple separators.
  const numTokens = stripped
    .replace(/[°d'′"″]/g, ' ')
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
  if (numTokens.length === 0) throw new Error(`no numeric content in "${raw}"`);

  const parsedNums = numTokens.map((t) => {
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error(`unparseable number "${t}" in "${raw}"`);
    return n;
  });

  let magnitude: number;
  if (parsedNums.length === 1) {
    magnitude = Math.abs(parsedNums[0]!);
  } else if (parsedNums.length === 2) {
    // DM.M: degrees + minutes
    magnitude = Math.abs(parsedNums[0]!) + Math.abs(parsedNums[1]!) / 60;
  } else if (parsedNums.length === 3) {
    // DMS: degrees + minutes + seconds
    magnitude =
      Math.abs(parsedNums[0]!) + Math.abs(parsedNums[1]!) / 60 + Math.abs(parsedNums[2]!) / 3600;
  } else {
    throw new Error(`expected 1–3 numeric tokens, got ${parsedNums.length} in "${raw}"`);
  }

  let sign: 1 | -1;
  if (hemi) {
    const h = hemiSign(hemi, axis);
    if (h === 0) throw new Error(`bad hemisphere "${hemi}" in "${raw}"`);
    sign = h;
  } else {
    // Signed decimal: respect the first numeric token's sign.
    sign = parsedNums[0]! < 0 ? -1 : 1;
  }

  const value = sign * magnitude;
  if (axis === 'lat' && Math.abs(value) > 90) {
    throw new Error(`latitude out of range: ${value}`);
  }
  if (axis === 'lon' && Math.abs(value) > 180) {
    throw new Error(`longitude out of range: ${value}`);
  }
  return value;
}

/**
 * Parse a single string holding both lat and lon. Accepts comma, semicolon,
 * slash, or whitespace as the separator between them. The first coord must
 * be the latitude.
 */
export function parseLatLon(raw: string): { lat: number; lon: number } {
  if (typeof raw !== 'string') throw new Error('input must be a string');
  // Split at separator characters that can ONLY appear between coords —
  // commas/semicolons/slashes; or at whitespace if it occurs between a
  // hemisphere letter and another digit/minus.
  const trimmed = raw.trim();
  // Try common explicit separators first.
  for (const sep of [/\s*[,;\/]\s*/, /\s+(?=-?\d|[NSEW])/]) {
    const idx = trimmed.search(sep);
    if (idx > 0) {
      const m = trimmed.match(sep)!;
      const left = trimmed.slice(0, idx);
      const right = trimmed.slice(idx + m[0].length);
      // Heuristic: if right contains hemisphere E/W or its first numeric
      // token is > 90, treat left as lat and right as lon. Else split on
      // whitespace and take the natural pair.
      const lat = parseCoordinate(left, 'lat');
      const lon = parseCoordinate(right, 'lon');
      return { lat, lon };
    }
  }
  throw new Error(`could not split "${raw}" into two coordinates`);
}

export interface FormatOptions {
  /** Format mode: 'dms' = `41°45'53.9"N`, 'dmm' = `41° 45.898' N`, 'dec' = signed decimal. */
  format: 'dms' | 'dmm' | 'dec';
  /** Decimal places. Default depends on format. */
  precision?: number;
}

/** Format a signed decimal degree value to the requested string format. */
export function formatCoordinate(value: number, axis: 'lat' | 'lon', opts: FormatOptions): string {
  if (!Number.isFinite(value)) return '—';
  if (opts.format === 'dec') {
    return value.toFixed(opts.precision ?? 5);
  }
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  if (opts.format === 'dmm') {
    return `${deg}° ${minFloat.toFixed(opts.precision ?? 3)}' ${hemi}`;
  }
  // DMS
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return `${deg}°${min.toString().padStart(2, '0')}'${sec.toFixed(opts.precision ?? 1)}"${hemi}`;
}
