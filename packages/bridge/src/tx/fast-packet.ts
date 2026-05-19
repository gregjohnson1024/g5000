import canboat from '@canboat/canboatjs';
import type { OutgoingPgn, RawCanFrame } from '../wire-driver.js';

const { pgnToYdgwRawFormat } = canboat as unknown as {
  pgnToYdgwRawFormat: (pgn: {
    pgn: number;
    prio?: number;
    dst?: number;
    src?: number;
    fields: Record<string, unknown>;
  }) => string[];
};

/**
 * Encode an OutgoingPgn into the ordered CAN frames that should be
 * transmitted on the bus. Single-frame PGNs return one frame; Fast
 * Packet PGNs return N frames with the NMEA-2000 order byte (top 3
 * bits = sequence number, bottom 5 = frame index) already set by
 * canboatjs.
 *
 * `src` defaults to 254 (J1939 "null address") — the g5000 has not
 * claimed an N2K address; diagnostic / proprietary traffic accepts this.
 * `dst` defaults to 255 (broadcast), `prio` defaults to 6 (low).
 *
 * The returned RawCanFrames have `rxTimestamp: 0n` since they have not
 * been received — the field is misnamed for the TX direction and the
 * value is unread by the wire driver's txCan path.
 *
 * Asserts frame# is strictly ascending starting at 0 for multi-frame
 * output — defends against canboatjs ever changing ordering.
 */
export function encodePgnToCanFrames(pgn: OutgoingPgn): RawCanFrame[] {
  const lines = pgnToYdgwRawFormat({
    pgn: pgn.pgn,
    prio: pgn.prio ?? 6,
    dst: pgn.dst ?? 255,
    src: 254,
    fields: pgn.fields,
  });
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error(`encodePgnToCanFrames: canboatjs returned no frames for PGN ${pgn.pgn}`);
  }
  const frames: RawCanFrame[] = lines.map((line, i) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 2) {
      throw new Error(`encodePgnToCanFrames: malformed line ${i}: ${line}`);
    }
    const id = parseInt(tokens[0]!, 16);
    if (!Number.isFinite(id)) {
      throw new Error(`encodePgnToCanFrames: malformed CAN ID in line ${i}: ${tokens[0]}`);
    }
    const data = new Uint8Array(tokens.length - 1);
    for (let j = 0; j < data.length; j++) {
      const tok = tokens[j + 1]!;
      const byte = parseInt(tok, 16);
      if (!Number.isFinite(byte) || byte < 0 || byte > 0xff) {
        throw new Error(`encodePgnToCanFrames: malformed byte in line ${i}: ${tok}`);
      }
      data[j] = byte;
    }
    return { id, ext: true, data, rxTimestamp: 0n };
  });
  if (frames.length > 1) {
    frames.forEach((f, i) => {
      const frameNum = f.data[0]! & 0x1f;
      if (frameNum !== i) {
        throw new Error(`encodePgnToCanFrames: frame ${i} has frame# ${frameNum}, expected ${i}`);
      }
    });
  }
  return frames;
}
