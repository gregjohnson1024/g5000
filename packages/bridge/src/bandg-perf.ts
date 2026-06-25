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
function readUIntLE(buf: Uint8Array, off: number, len: number): number {
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
  payload: Uint8Array,
  table: Map<number, BandgKeyEntry>,
): BandgKeyValue[] {
  const out: BandgKeyValue[] = [];
  if (payload.length < 2) return out;
  // Header: manufacturer(11) + reserved(2) + industry(3). Only parse B&G frames
  // (PGN 130824 also has a Maretron variant, manufacturer 137).
  if (((payload[0]! | (payload[1]! << 8)) & 0x7ff) !== BANDG_MANUFACTURER_CODE) return out;
  let i = 2;

  while (i + 2 <= payload.length) {
    const word = payload[i]! | (payload[i + 1]! << 8);
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
      const signedRaw =
        SIGNED_KEYS.has(key) && raw >= 2 ** (8 * length - 1) ? raw - 2 ** (8 * length) : raw;
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
  53, // Optimum Wind Angle (H5000 WS confirms signed: our unsigned 305° = -55°)
  130, // Leeway Angle (lee positive / negative)
  273, // Start Line Bias (port/stbd favoured)
]);

/** Convenience: full decode of a payload using the runtime catalog. */
export function decodeBandgPerf(payload: Uint8Array): BandgKeyValue[] {
  return parseBandgKeyValues(payload, loadBandgKeyTable());
}

/**
 * Reassembles NMEA 2000 fast-packet frames (8 bytes each) into the full payload.
 * 130824 spans many frames when the H5000 broadcasts a large key set.
 *
 * Frame 0 of a sequence: byte0 = (seqId<<5)|0, byte1 = total byte count,
 * bytes 2..7 = first 6 payload bytes. Frames 1..n: byte0 = (seqId<<5)|counter,
 * bytes 1..7 = next 7 bytes. Keyed by source; a fresh frame-0 or a sequence/
 * counter mismatch resets that source (dropped/interleaved frames just yield a
 * miss, never a corrupt payload).
 */
export class FastPacketReassembler {
  private readonly inProgress = new Map<
    number,
    { seqId: number; expected: number; bytes: number[]; nextCounter: number }
  >();

  /** Feed one raw frame for `src`. Returns the complete payload, or null. */
  feed(src: number, frame: Uint8Array): Uint8Array | null {
    if (frame.length < 1) return null;
    const seqId = (frame[0]! >> 5) & 0x07;
    const counter = frame[0]! & 0x1f;

    if (counter === 0) {
      if (frame.length < 2) return null;
      const expected = frame[1]!;
      const bytes = Array.from(frame.subarray(2, 8));
      this.inProgress.set(src, { seqId, expected, bytes, nextCounter: 1 });
    } else {
      const st = this.inProgress.get(src);
      if (!st || st.seqId !== seqId || counter !== st.nextCounter) {
        this.inProgress.delete(src);
        return null;
      }
      for (let i = 1; i < frame.length && st.bytes.length < st.expected; i++)
        st.bytes.push(frame[i]!);
      st.nextCounter = counter + 1;
    }

    const st = this.inProgress.get(src)!;
    if (st.bytes.length >= st.expected) {
      this.inProgress.delete(src);
      return Uint8Array.from(st.bytes.slice(0, st.expected));
    }
    return null;
  }
}

/**
 * Curated subset of B&G keys to publish as bus channels (key → channel name).
 * Kept small so the bus stays clean during validation; expand once values are
 * confirmed against the H5000's own display. Units come from the catalog
 * (speeds m/s, angles rad, performance %).
 */
export const BANDG_PUBLISH_CHANNELS = new Map<number, string>([
  // The H5000's OWN wind solution — lets us compare directly against g5000's
  // computed wind.true.* (the original "is the H5000's TWD different?" question).
  [77, 'bandg.apparentWindSpeed'],
  [79, 'bandg.trueWindSpeed'],
  [80, 'bandg.avgTrueWindDirection'],
  [81, 'bandg.trueWindAngle'],
  [89, 'bandg.trueWindDirection'],
  [109, 'bandg.windDirection'],
  // Performance / targets.
  [125, 'bandg.targetSpeed'],
  [126, 'bandg.polarSpeed'],
  [83, 'bandg.targetTwa'],
  [124, 'bandg.polarPerformance'],
  [285, 'bandg.vmgPerformance'],
  [127, 'bandg.vmgToWind'],
  [50, 'bandg.tackingPerformance'],
  [53, 'bandg.optimumWindAngle'],
  // Leeway / current.
  [130, 'bandg.leeway'],
  [73, 'bandg.currentSet'],
  [131, 'bandg.currentDrift'],
  // Tactical / race.
  [154, 'bandg.oppositeTackHeading'],
  [256, 'bandg.laylineTime'],
  [258, 'bandg.laylineDistance'],
  [117, 'bandg.raceTimer'],
  [152, 'bandg.distanceToStartLine'],
  [272, 'bandg.startLineBearing'],
  [273, 'bandg.startLineBias'],
  [111, 'bandg.nextLegAwa'],
  [113, 'bandg.nextLegAws'],
]);
