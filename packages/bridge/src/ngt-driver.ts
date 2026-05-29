import { Subject, type Observable, EMPTY } from 'rxjs';
import canboat from '@canboat/canboatjs';
import { readN2KActisense } from '@canboat/canboatjs/lib/n2k-actisense.js';
import type {
  RawCanFrame,
  Raw0183Sentence,
  WireDriver,
  DriverHealth,
  OutgoingPgn,
} from './wire-driver.js';
import { createHealthSubject } from './driver-common.js';

const { pgnToActisenseSerialFormat } = canboat as unknown as {
  pgnToActisenseSerialFormat: (pgn: {
    pgn: number;
    prio?: number;
    dst?: number;
    src?: number;
    fields: Record<string, unknown>;
  }) => string;
};

/**
 * Anything that emits 'data' Buffer events. The serialport SerialPort class
 * matches this shape; a test harness can substitute a fake.
 */
export interface Ngt1Source {
  on(event: 'data', cb: (chunk: Buffer) => void): this;
  off(event: 'data', cb: (chunk: Buffer) => void): this;
}

/**
 * The write-side of the serial port. The NGT-1 source also doubles as a sink
 * for TX: Node.js SerialPort implements both Readable (events) and Writable
 * (.write()). A test harness can implement just this shape.
 */
export interface Ngt1Sink {
  write(buf: Buffer | string, cb?: (err?: Error | null) => void): boolean;
}

export interface Ngt1DriverOptions {
  source: Ngt1Source;
}

/**
 * Actisense binary framing constants (per canboatjs/lib/n2k-actisense.js).
 *
 *   0x10 0x02 0xd0 LL LL <payload (LL bytes)> 0x10 0x03
 *
 * The payload's last two bytes are the ETX marker (0x10 0x03). Total bytes
 * consumed per packet = 5 (header + length) + LL (payload incl. ETX).
 */
const STX_0 = 0x10;
const STX_1 = 0x02;
const STX_2 = 0xd0;
const HEADER_LEN = 5; // STX(3) + length(2)

/**
 * NGT-1 driver. Reads Actisense binary frames from the serial source,
 * decodes them via canboatjs's readN2KActisense, and emits a RawCanFrame
 * per received PGN. ASCII text framing is NOT used at the wire level —
 * the parseActisenseLine helper remains exported for test-fixture use.
 */
export class Ngt1Driver implements WireDriver {
  readonly rxCan: Observable<RawCanFrame>;
  readonly rx0183: Observable<Raw0183Sentence> = EMPTY;
  readonly health: Observable<DriverHealth>;

  private readonly rxSubject = new Subject<RawCanFrame>();
  private readonly healthSubject = createHealthSubject();
  private readonly source: Ngt1Source;
  private buffer: Buffer = Buffer.alloc(0);
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
    throw new Error('Ngt1Driver.txCan not implemented (use txPgn)');
  }

  async tx0183(_port: number, _text: string): Promise<void> {
    throw new Error('Ngt1Driver.tx0183 not implemented (NGT-1 has no 0183)');
  }

  async txPgn(pgn: OutgoingPgn): Promise<void> {
    const line = pgnToActisenseSerialFormat({
      pgn: pgn.pgn,
      prio: pgn.prio ?? 6,
      dst: pgn.dst ?? 255,
      fields: pgn.fields,
    });
    if (!line || line.length === 0) {
      throw new Error(`canboatjs returned empty encoding for PGN ${pgn.pgn}`);
    }
    const sink = this.source as unknown as Ngt1Sink;
    if (typeof sink.write !== 'function') {
      throw new Error('Ngt1Driver.txPgn: source has no .write() method');
    }
    await new Promise<void>((resolve, reject) => {
      sink.write(line + '\n', (err) => (err ? reject(err) : resolve()));
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (true) {
      // Find the next start-of-frame marker.
      const start = this.findStart(this.buffer);
      if (start < 0) {
        // No header in buffer — keep at most the last 2 bytes (a partial header could span).
        if (this.buffer.length > 2) this.buffer = this.buffer.subarray(-2);
        return;
      }
      // Drop any pre-header garbage.
      if (start > 0) this.buffer = this.buffer.subarray(start);
      if (this.buffer.length < HEADER_LEN) return; // need the length field
      const payloadLen = this.buffer.readUInt16LE(3);
      const totalLen = HEADER_LEN + payloadLen;
      if (this.buffer.length < totalLen) return; // incomplete packet
      const packet = this.buffer.subarray(0, totalLen);
      this.buffer = this.buffer.subarray(totalLen);
      try {
        readN2KActisense(packet, false, {}, (result) => {
          this.emitFrame(result);
        });
      } catch (_err) {
        const h = this.healthSubject.value;
        this.healthSubject.next({ ...h, errorCount: h.errorCount + 1 });
      }
    }
  }

  private findStart(buf: Buffer): number {
    for (let i = 0; i + 2 < buf.length; i++) {
      if (buf[i] === STX_0 && buf[i + 1] === STX_1 && buf[i + 2] === STX_2) {
        return i;
      }
    }
    return -1;
  }

  private emitFrame(result: {
    pgn: { pgn: number; src: number; dst: number; prio: number };
    data: Buffer;
  }): void {
    const id = encodeJ1939Id(result.pgn.prio, result.pgn.pgn, result.pgn.src);
    this.rxSubject.next({
      id,
      ext: true,
      data: new Uint8Array(result.data),
      rxTimestamp: BigInt(Date.now()) * 1_000_000n,
    });
  }
}

/**
 * Parse one canboat-style Actisense ASCII line.
 *
 * Format: <iso-ish timestamp>,<prio>,<pgn>,<src>,<dst>,<len>,<hex>,<hex>,...
 *
 * We construct the 29-bit CAN ID per J1939: bits 26-28 are priority,
 * bits 8-25 hold the PGN with PF/PS handling, bits 0-7 hold source address.
 *
 * Still exported as a test-fixture helper for decoder.test.ts and
 * channel-mapper.test.ts, which construct synthetic frames from ASCII.
 * This function is NOT in the live RX path — onData() uses binary framing.
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
