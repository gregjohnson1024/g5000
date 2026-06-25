import { describe, it, expect } from 'vitest';
import {
  decodeBandgPerf,
  FastPacketReassembler,
  loadBandgKeyTable,
  parseBandgKeyValues,
} from './bandg-perf.js';

/** Build one key-value entry: u16 LE = (length<<12)|key, then `length` LE value bytes. */
function tlv(key: number, length: number, raw: number): Buffer {
  const b = Buffer.alloc(2 + length);
  b.writeUInt16LE(((length << 12) | key) & 0xffff, 0);
  for (let i = 0; i < length; i++) b[2 + i] = (raw >> (8 * i)) & 0xff;
  return b;
}

// 2-byte B&G/Marine header (manufacturer 381 + industry 4); the parser skips it.
const HEADER = Buffer.from([0x7d, 0x99]);

describe('bandg-perf 130824 decoder', () => {
  it('loads the BANDG_KEY_VALUE catalog from canboat', () => {
    const t = loadBandgKeyTable();
    expect(t.size).toBeGreaterThan(100);
    expect(t.get(83)?.name).toBe('Target TWA');
    expect(t.get(285)?.name).toBe('VMG Performance');
  });

  it('decodes multiple entries with correct scaling (no desync — the canboat bug)', () => {
    // Target TWA (key 83, 0.0001 rad) = 0.7854 rad; VMG Performance (key 285, 0.1 %) = 95.0 %
    const payload = Buffer.concat([HEADER, tlv(83, 2, 7854), tlv(285, 2, 950)]);
    const out = decodeBandgPerf(payload);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ key: 83, name: 'Target TWA', unit: 'rad' });
    expect(out[0]!.value).toBeCloseTo(0.7854, 4);
    expect(out[1]).toMatchObject({ key: 285, name: 'VMG Performance', unit: '%' });
    expect(out[1]!.value).toBeCloseTo(95.0, 4);
  });

  it('maps the all-ones N/A sentinel to null', () => {
    const out = decodeBandgPerf(Buffer.concat([HEADER, tlv(83, 2, 0xffff)]));
    expect(out[0]!.raw).toBe(0xffff);
    expect(out[0]!.value).toBeNull();
  });

  it('passes unknown keys through as raw with a synthetic name', () => {
    const out = decodeBandgPerf(Buffer.concat([HEADER, tlv(4091, 2, 1234)]));
    expect(out[0]).toMatchObject({ key: 4091, name: 'key4091', raw: 1234, value: 1234 });
  });

  it('handles signed keys (leeway can be negative)', () => {
    // key 130 = Leeway Angle, 0.0001 rad, signed; raw 0xFE0C = -500 → -0.05 rad
    const out = parseBandgKeyValues(
      Buffer.concat([HEADER, tlv(130, 2, 0xfe0c)]),
      loadBandgKeyTable(),
    );
    expect(out[0]!.name).toBe('Leeway Angle');
    expect(out[0]!.value).toBeCloseTo(-0.05, 4);
  });

  it('stops cleanly on padding / short tail', () => {
    const out = decodeBandgPerf(Buffer.concat([HEADER, tlv(83, 2, 100), Buffer.from([0x00])]));
    expect(out).toHaveLength(1);
  });
});

describe('FastPacketReassembler', () => {
  it('returns a single-frame payload immediately', () => {
    const r = new FastPacketReassembler();
    // frame0: counter=0, total=6, then 6 payload bytes
    const out = r.feed(16, Uint8Array.from([0x00, 6, 0x7d, 0x99, 0x53, 0x20, 0xae, 0x1e]));
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([0x7d, 0x99, 0x53, 0x20, 0xae, 0x1e]);
  });

  it('reassembles a multi-frame payload and end-to-end decodes it', () => {
    const r = new FastPacketReassembler();
    // 10-byte payload: hdr(7d 99) + Target TWA(53 20, val ae 1e=7854) + VMG Perf(1d 21, val b6 03=950)
    // frame0 carries 6 bytes, frame1 the remaining 4.
    expect(r.feed(16, Uint8Array.from([0x00, 10, 0x7d, 0x99, 0x53, 0x20, 0xae, 0x1e]))).toBeNull();
    const payload = r.feed(16, Uint8Array.from([0x01, 0x1d, 0x21, 0xb6, 0x03, 0xff, 0xff, 0xff]));
    expect(payload).not.toBeNull();
    const out = parseBandgKeyValues(payload!, loadBandgKeyTable());
    expect(out.map((v) => v.name)).toEqual(['Target TWA', 'VMG Performance']);
    expect(out[1]!.value).toBeCloseTo(95.0, 4);
  });

  it('drops a source on a counter/sequence mismatch (no corrupt payload)', () => {
    const r = new FastPacketReassembler();
    r.feed(16, Uint8Array.from([0x00, 10, 1, 2, 3, 4, 5, 6]));
    // wrong next counter (2 instead of 1) → reset, returns null
    expect(r.feed(16, Uint8Array.from([0x02, 7, 8, 9, 10, 11, 12, 13]))).toBeNull();
  });
});
