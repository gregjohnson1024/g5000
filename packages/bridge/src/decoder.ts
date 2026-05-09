import { Observable, type OperatorFunction } from 'rxjs';
import canboat from '@canboat/canboatjs';
import type { RawCanFrame } from './wire-driver.js';

const { FromPgn } = canboat as unknown as {
  FromPgn: new () => {
    on(event: 'pgn', cb: (pgn: CanboatPgn) => void): void;
    parseString(line: string): void;
  };
};

interface CanboatPgn {
  pgn: number;
  prio: number;
  src: number;
  dst: number;
  timestamp?: string;
  fields: Record<string, unknown>;
}

export interface DecodedPgn {
  pgn: number;
  prio: number;
  src: number;
  dst: number;
  fields: Record<string, unknown>;
  /** Receive timestamp from the upstream RawCanFrame. */
  rxTimestamp: bigint;
}

/**
 * Decode an Observable of RawCanFrames into DecodedPgns by feeding canboatjs.
 *
 * Implementation note: canboatjs's parser is line-oriented (Actisense ASCII).
 * We re-emit each frame as a synthetic ASCII line so canboatjs can do its
 * fast-packet reassembly and field extraction in one place. This means we
 * pay a string round-trip per frame, but at <1000 frames/sec on a CM5 this
 * is in the noise.
 */
export function decodeFrames(
  frames$: Observable<RawCanFrame>,
): Observable<DecodedPgn> {
  return new Observable<DecodedPgn>((subscriber) => {
    const parser = new FromPgn();
    const pendingTimestamps = new Map<number, bigint>(); // pgn → most-recent rxTimestamp
    parser.on('pgn', (pgn) => {
      const ts = pendingTimestamps.get(pgn.pgn) ?? 0n;
      subscriber.next({
        pgn: pgn.pgn,
        prio: pgn.prio,
        src: pgn.src,
        dst: pgn.dst,
        fields: pgn.fields,
        rxTimestamp: ts,
      });
    });
    const sub = frames$.subscribe({
      next: (frame) => {
        const pgn = pgnFromCanId(frame.id);
        const src = frame.id & 0xff;
        const prio = (frame.id >> 26) & 0x7;
        pendingTimestamps.set(pgn, frame.rxTimestamp);
        const hex = Array.from(frame.data, (b) =>
          b.toString(16).padStart(2, '0'),
        );
        const line = `${new Date().toISOString()},${prio},${pgn},${src},255,${frame.data.length},${hex.join(',')}`;
        parser.parseString(line);
      },
      error: (e) => subscriber.error(e),
      complete: () => subscriber.complete(),
    });
    return () => sub.unsubscribe();
  });
}

export const decode = (): OperatorFunction<RawCanFrame, DecodedPgn> => {
  return (frames$) => decodeFrames(frames$);
};

/**
 * Extract the PGN from a 29-bit J1939 identifier. Mirror of encodeJ1939Id
 * in ngt-driver.ts.
 *
 * J1939 CAN ID layout (29 bits):
 *   bits 28-26: Priority
 *   bit  25:    Reserved
 *   bit  24:    Data Page (DP)
 *   bits 23-16: PF (PDU Format)
 *   bits 15-8:  PS (PDU Specific — destination for PDU1, group ext for PDU2)
 *   bits  7-0:  Source Address
 *
 * The DP bit is encoded at bit 24, so the full 18-bit PGN field is bits 8-25
 * (dp_pgn = (id >> 8) & 0x3ffff). For PDU1 (PF < 240), the canonical PGN
 * has PS zeroed out; for PDU2 (PF >= 240), PS is part of the PGN.
 */
function pgnFromCanId(id: number): number {
  const pf = (id >> 16) & 0xff;
  // Extract 18-bit dp_pgn: includes DP bit (bit 24), PF (bits 23-16), PS (bits 15-8)
  const dp_pgn = (id >> 8) & 0x3ffff;
  if (pf < 240) {
    // PDU1: PS is the destination address — zero it out to get the canonical PGN.
    return dp_pgn & 0x3ff00;
  }
  // PDU2: PS is the group extension (part of the PGN).
  return dp_pgn;
}
