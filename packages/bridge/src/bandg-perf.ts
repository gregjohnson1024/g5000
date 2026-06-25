import { getFieldTypeEnumeration } from '@canboat/ts-pgns';

/**
 * Decoder for B&G PGN 130824 ("B&G: key-value data"), the proprietary
 * performance container the H5000 broadcasts (Target Boat Speed, Target TWA,
 * Polar Speed, VMG Performance, laylines, start-line geometry, …).
 *
 * canboatjs decodes the KEY and LENGTH of each entry but NOT the value: its
 * generic `DYNAMIC_FIELD_VALUE` codec never consumes the value bytes, so it
 * both drops the value and de-syncs the rest of the list. We sidestep that and
 * parse the payload ourselves, reusing canboat's own `BANDG_KEY_VALUE` field-
 * type catalog (155 keys, each with a name + resolution + unit) for scaling.
 *
 * Wire format (after the 2-byte manufacturer/industry header), repeated:
 *   - one little-endian u16 = (length << 12) | key   (12-bit key, 4-bit length)
 *   - `length` value bytes, little-endian
 * Everything is byte-aligned (key+length is exactly 2 bytes).
 */

const BANDG_MANUFACTURER_CODE = 381; // "B & G"

export interface BandgKeyEntry {
  name: string;
  /** Scale factor; raw * resolution = engineering value. 1 if absent. */
  resolution?: number;
  unit?: string;
  /** Nominal width from the catalog (16 or 32); the wire `length` is authoritative. */
  bits: number;
}

export interface BandgKeyValue {
  key: number;
  name: string;
  /** Raw little-endian integer read off the wire. */
  raw: number;
  /** raw * resolution, or null if the field carried the N/A sentinel. */
  value: number | null;
  unit?: string;
}

/**
 * Load the BANDG_KEY_VALUE catalog from @canboat/ts-pgns at runtime so it stays
 * in sync with the installed canboat data. Returns key-number → entry.
 * Returns an empty map (not a throw) if the data can't be located — the decoder
 * then passes raw values through so a missing catalog never crashes the bridge.
 */
export function loadBandgKeyTable(): Map<number, BandgKeyEntry> {
  const table = new Map<number, BandgKeyEntry>();
  try {
    const enumDef = getFieldTypeEnumeration('BANDG_KEY_VALUE') as
      | {
          EnumFieldTypeValues?: Array<{
            name: string;
            value: number;
            Resolution?: number;
            Unit?: string;
            Bits?: string | number;
          }>;
        }
      | undefined;
    for (const v of enumDef?.EnumFieldTypeValues ?? []) {
      table.set(v.value, {
        name: v.name,
        resolution: typeof v.Resolution === 'number' ? v.Resolution : undefined,
        unit: v.Unit,
        bits: Number(v.Bits ?? 0) || 0,
      });
    }
  } catch {
    // No catalog → empty map; parse still works, values stay raw + unnamed.
  }
  return table;
}

/** Read `len` bytes little-endian from `buf` at `off` as an unsigned integer. */
function readUIntLE(buf: Buffer, off: number, len: number): number {
  let v = 0;
  for (let b = 0; b < len; b++) v += buf[off + b]! * 2 ** (8 * b);
  return v;
}

/**
 * Parse a reassembled 130824 payload into key-value entries. Unknown keys pass
 * through with a synthetic `key<n>` name and the raw value (no scaling).
 *
 * NOTE: signedness is not in the canboat catalog, so values are read unsigned
 * and scaled. The N/A sentinel (all-ones for the field width) maps to null.
 * Genuinely-signed keys (leeway, VMG%) may need per-key sign handling — verify
 * against the H5000's own display and refine `SIGNED_KEYS` below.
 */
export function parseBandgKeyValues(
  payload: Buffer,
  table: Map<number, BandgKeyEntry>,
): BandgKeyValue[] {
  const out: BandgKeyValue[] = [];
  if (payload.length < 2) return out;
  // Header: manufacturer(11) + reserved(2) + industry(3). Only parse B&G frames
  // (PGN 130824 also has a Maretron variant, manufacturer 137).
  if ((payload.readUInt16LE(0) & 0x7ff) !== BANDG_MANUFACTURER_CODE) return out;
  let i = 2;

  while (i + 2 <= payload.length) {
    const word = payload.readUInt16LE(i);
    const key = word & 0x0fff;
    const length = (word >> 12) & 0x0f;
    i += 2;
    if (key === 0 && length === 0) break; // padding / end of list
    if (length === 0) continue; // keyed but no value carried this frame
    if (i + length > payload.length) break; // truncated

    const raw = readUIntLE(payload, i, length);
    i += length;

    const entry = table.get(key);
    const naSentinel = 2 ** (8 * length) - 1;
    let value: number | null;
    if (raw === naSentinel) {
      value = null;
    } else if (entry) {
      const signedRaw = SIGNED_KEYS.has(key) && raw >= 2 ** (8 * length - 1) ? raw - 2 ** (8 * length) : raw;
      value = signedRaw * (entry.resolution ?? 1);
    } else {
      value = raw;
    }

    out.push({ key, name: entry?.name ?? `key${key}`, raw, value, unit: entry?.unit });
  }
  return out;
}

/**
 * Keys whose value is signed (two's complement). Seed list — extend after
 * validating against the H5000 display. Leeway and the performance deltas can
 * legitimately be negative.
 */
const SIGNED_KEYS = new Set<number>([
  130, // Leeway Angle
]);

/** Convenience: full decode of a payload using the runtime catalog. */
export function decodeBandgPerf(payload: Buffer): BandgKeyValue[] {
  return parseBandgKeyValues(payload, loadBandgKeyTable());
}
