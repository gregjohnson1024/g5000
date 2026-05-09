import { Subject, type Observable, BehaviorSubject, EMPTY } from 'rxjs';
import type { RawCanFrame, Raw0183Sentence, WireDriver, DriverHealth } from './wire-driver.js';

/**
 * Anything that emits 'data' Buffer events. The serialport SerialPort class
 * matches this shape; a test harness can substitute a fake.
 */
export interface Ngt1Source {
  on(event: 'data', cb: (chunk: Buffer) => void): this;
  off(event: 'data', cb: (chunk: Buffer) => void): this;
}

export interface Ngt1DriverOptions {
  source: Ngt1Source;
}

/**
 * Reads canboat-style Actisense ASCII lines from the underlying source and
 * emits one RawCanFrame per parsed line.
 *
 * Why ASCII not binary: the canboatjs binary parser path requires more
 * setup (escape-byte unwrapping, message framing) and the NGT-1 firmware
 * supports an "ASCII out" mode via the canboat actisense-serial preamble.
 * We can swap to binary later if we drop canboat-actisense in favour of
 * raw NGT-1 framing — wire-driver.ts is the seam.
 */
export class Ngt1Driver implements WireDriver {
  readonly rxCan: Observable<RawCanFrame>;
  readonly rx0183: Observable<Raw0183Sentence> = EMPTY;
  readonly health: Observable<DriverHealth>;

  private readonly rxSubject = new Subject<RawCanFrame>();
  private readonly healthSubject = new BehaviorSubject<DriverHealth>({
    connected: false,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  private readonly source: Ngt1Source;
  private buffer = '';
  private dataHandler = this.onData.bind(this);

  constructor(opts: Ngt1DriverOptions) {
    this.source = opts.source;
    this.rxCan = this.rxSubject.asObservable();
    this.health = this.healthSubject.asObservable();
  }

  async start(): Promise<void> {
    this.source.on('data', this.dataHandler);
    this.healthSubject.next({ ...this.healthSubject.value, connected: true });
  }

  async stop(): Promise<void> {
    this.source.off('data', this.dataHandler);
    this.healthSubject.next({ ...this.healthSubject.value, connected: false });
  }

  async txCan(_frame: RawCanFrame): Promise<void> {
    // TX support arrives in a later plan (Phase 0a milestone is read-only).
    throw new Error('Ngt1Driver.txCan not implemented in Phase 0a');
  }

  async tx0183(_port: number, _text: string): Promise<void> {
    throw new Error('Ngt1Driver.tx0183 not implemented (NGT-1 has no 0183)');
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        const frame = parseActisenseLine(line);
        if (frame) this.rxSubject.next(frame);
      } catch (err) {
        const h = this.healthSubject.value;
        this.healthSubject.next({ ...h, errorCount: h.errorCount + 1 });
      }
    }
  }
}

/**
 * Parse one canboat-style Actisense ASCII line.
 *
 * Format: <iso-ish timestamp>,<prio>,<pgn>,<src>,<dst>,<len>,<hex>,<hex>,...
 *
 * We construct the 29-bit CAN ID per J1939: bits 26-28 are priority,
 * bits 8-25 hold the PGN with PF/PS handling, bits 0-7 hold source address.
 */
export function parseActisenseLine(line: string): RawCanFrame | null {
  const parts = line.split(',');
  if (parts.length < 7) return null;
  const [, prioStr, pgnStr, srcStr, , lenStr, ...hex] = parts;
  if (!prioStr || !pgnStr || !srcStr || !lenStr) return null;
  const prio = Number(prioStr);
  const pgn = Number(pgnStr);
  const src = Number(srcStr);
  const len = Number(lenStr);
  if (!Number.isFinite(prio) || !Number.isFinite(pgn) || !Number.isFinite(src)) {
    return null;
  }
  const data = new Uint8Array(len);
  for (let i = 0; i < len && i < hex.length; i++) {
    const byte = hex[i];
    if (byte === undefined) continue;
    data[i] = parseInt(byte, 16);
  }
  const id = encodeJ1939Id(prio, pgn, src);
  return {
    id,
    ext: true,
    data,
    rxTimestamp: BigInt(Date.now()) * 1_000_000n,
  };
}

/**
 * Pack priority (3 bits) + PGN (J1939 PDU1/PDU2 rules) + source address
 * (8 bits) into a 29-bit CAN identifier.
 *
 * For PDU1 messages (PF < 240), the destination address sits in the PS
 * (bits 8-15) and is replaced by 255 in the canonical PGN. For PDU2 (PF >= 240)
 * the PS is the group extension and is part of the PGN.
 *
 * For our purposes (read-only at this layer; broadcast-style PGNs only),
 * encoding with destination = 255 is sufficient.
 */
function encodeJ1939Id(prio: number, pgn: number, src: number): number {
  const pf = (pgn >> 8) & 0xff;
  const dp_pgn =
    pf < 240
      ? // PDU1: PS field carries destination addr; we use 255 (broadcast).
        ((pgn & 0x3ff00) | 0xff) & 0x3ffff
      : // PDU2: PS is part of the canonical PGN.
        pgn & 0x3ffff;
  return ((prio & 0x7) << 26) | (dp_pgn << 8) | (src & 0xff);
}
