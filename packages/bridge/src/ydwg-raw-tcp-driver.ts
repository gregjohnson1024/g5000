import { Subject, BehaviorSubject, EMPTY, type Observable } from 'rxjs';
import * as net from 'node:net';
import canboat from '@canboat/canboatjs';
import type {
  RawCanFrame,
  Raw0183Sentence,
  WireDriver,
  DriverHealth,
  OutgoingPgn,
} from './wire-driver.js';
import { parseActisenseLine } from './ngt-driver.js';

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
 * Minimal shape we need from a socket. Production: `net.Socket`. Tests pass
 * an EventEmitter-shaped fake. The driver owns the lifecycle (connect /
 * reconnect / destroy) via a factory so callers don't have to manage the
 * underlying TCP socket themselves.
 */
export interface YdwgSocket {
  on(event: 'data', cb: (chunk: Buffer) => void): this;
  on(event: 'close', cb: () => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  on(event: 'connect', cb: () => void): this;
  removeAllListeners(event?: string): this;
  write(data: string | Buffer, cb?: (err?: Error | null) => void): boolean;
  destroy(err?: Error): this;
}

export interface YdwgRawTcpDriverOptions {
  /**
   * Creates a fresh socket each time the driver (re)connects. Production:
   * `createYdwgTcpSocketFactory(host, port)`. Tests: a fake socket factory.
   */
  socketFactory: () => YdwgSocket;
  /** Reconnect backoff config. Default { initialMs: 1000, maxMs: 30000 }. */
  backoffMs?: { initialMs: number; maxMs: number };
}

/** Build a socket factory wired to net.createConnection for production use. */
export function createYdwgTcpSocketFactory(host: string, port: number): () => YdwgSocket {
  return () => net.createConnection({ host, port });
}

/**
 * Yacht Devices YDWG-02 driver, RAW TCP mode (default port 1457).
 *
 * RX: parses YD RAW text lines (`HH:MM:SS.mmm R 19FA041F 23 80 0C FF FF FF 7F 02`)
 * into `RawCanFrame` events. Direction='T' echoes are skipped.
 *
 * TX: only single-frame `txCan` is supported. `txPgn` throws — PGN→CAN
 * encoding with Fast Packet split lives outside this driver; route
 * tx-by-PGN through the NGT-1 driver until that helper exists.
 *
 * Reconnect: exponential backoff on socket drop or error, capped at
 * `maxMs`. The backoff resets after a successful `connect` event.
 */
export class YdwgRawTcpDriver implements WireDriver {
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
  private readonly socketFactory: () => YdwgSocket;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  private socket: YdwgSocket | null = null;
  private active = false;
  private currentBackoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lineBuffer = '';

  constructor(opts: YdwgRawTcpDriverOptions) {
    this.socketFactory = opts.socketFactory;
    this.initialBackoffMs = opts.backoffMs?.initialMs ?? 1000;
    this.maxBackoffMs = opts.backoffMs?.maxMs ?? 30000;
    this.currentBackoffMs = this.initialBackoffMs;
    this.rxCan = this.rxSubject.asObservable();
    this.health = this.healthSubject.asObservable();
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.lineBuffer = '';
    this.healthSubject.next({ ...this.healthSubject.value, connected: false });
  }

  async txCan(frame: RawCanFrame): Promise<void> {
    const socket = this.socket;
    if (!socket || !this.healthSubject.value.connected) {
      throw new Error('YdwgRawTcpDriver.txCan: not connected');
    }
    const idHex = (frame.id >>> 0).toString(16).toUpperCase().padStart(8, '0');
    const bytes = Array.from(frame.data)
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ');
    const line = bytes.length > 0 ? `${idHex} ${bytes}\r\n` : `${idHex}\r\n`;
    await new Promise<void>((resolve, reject) => {
      socket.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  async tx0183(_port: number, _text: string): Promise<void> {
    throw new Error('YdwgRawTcpDriver.tx0183 not supported (RAW mode is N2K only)');
  }

  async txPgn(pgn: OutgoingPgn): Promise<void> {
    // Encode the typed PGN to canboat ASCII via canboatjs, then parse it back
    // into a RawCanFrame so we can send it through txCan. This round-trip
    // sidesteps writing our own PGN field-packer. Fast Packet PGNs encode as
    // multiple newline-separated lines — we'd need to TX each as its own CAN
    // frame plus the TP-Connection-Management envelope, which isn't done yet,
    // so we explicitly reject multi-line output.
    //
    // `src` defaults to 254 (J1939 "null address") since the g5000 has not
    // claimed an N2K address. Diagnostic / ISO-Request traffic accepts this.
    const encoded = pgnToActisenseSerialFormat({
      pgn: pgn.pgn,
      prio: pgn.prio ?? 6,
      dst: pgn.dst ?? 255,
      src: 254,
      fields: pgn.fields,
    });
    if (!encoded) {
      throw new Error(`YdwgRawTcpDriver.txPgn: canboatjs returned empty encoding for PGN ${pgn.pgn}`);
    }
    const lines = encoded.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    if (lines.length !== 1) {
      throw new Error(
        `YdwgRawTcpDriver.txPgn: Fast Packet split not implemented (PGN ${pgn.pgn} encoded to ${lines.length} frames)`,
      );
    }
    const frame = parseActisenseLine(lines[0]!);
    if (!frame) {
      throw new Error(`YdwgRawTcpDriver.txPgn: failed to parse canboatjs output for PGN ${pgn.pgn}`);
    }
    if (frame.data.length > 8) {
      // canboatjs collapsed a multi-frame PGN into one trace line. We can't
      // send >8 bytes as a single CAN frame; Fast Packet split would need to
      // emit TP-Connection-Management envelope + sequenced data frames.
      throw new Error(
        `YdwgRawTcpDriver.txPgn: Fast Packet split not implemented (PGN ${pgn.pgn}, ${frame.data.length} bytes)`,
      );
    }
    await this.txCan(frame);
  }

  private connect(): void {
    if (!this.active) return;
    let socket: YdwgSocket;
    try {
      socket = this.socketFactory();
    } catch (_err) {
      const h = this.healthSubject.value;
      this.healthSubject.next({ ...h, errorCount: h.errorCount + 1 });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.on('connect', () => {
      this.currentBackoffMs = this.initialBackoffMs;
      this.healthSubject.next({ ...this.healthSubject.value, connected: true });
    });
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => {
      const h = this.healthSubject.value;
      this.healthSubject.next({ ...h, errorCount: h.errorCount + 1 });
    });
    socket.on('close', () => this.onClose());
  }

  private onClose(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
    this.lineBuffer = '';
    this.healthSubject.next({ ...this.healthSubject.value, connected: false });
    if (!this.active) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.currentBackoffMs;
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private onData(chunk: Buffer): void {
    this.lineBuffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.lineBuffer.indexOf('\n')) >= 0) {
      const raw = this.lineBuffer.slice(0, nl);
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      const line = raw.replace(/\r$/, '').trim();
      if (line.length === 0) continue;
      const parsed = parseYdRawLine(line);
      if (parsed === null) {
        const h = this.healthSubject.value;
        this.healthSubject.next({ ...h, errorCount: h.errorCount + 1 });
        continue;
      }
      if (parsed.direction === 'T') continue;
      this.rxSubject.next({
        id: parsed.id,
        ext: true,
        data: parsed.data,
        rxTimestamp: BigInt(Date.now()) * 1_000_000n,
      });
    }
  }
}

export interface ParsedYdRawLine {
  /** `R` = received-from-bus, `T` = transmitted-by-YDWG, null = absent. */
  direction: 'R' | 'T' | null;
  /** 29-bit extended CAN identifier. */
  id: number;
  /** 0–8 data bytes. */
  data: Uint8Array;
}

/**
 * Parse one YD RAW line: `[HH:MM:SS.mmm] [R|T] <CAN-ID-hex> [<byte-hex>]...`
 *
 * Returns the parsed fields on a valid line, or null on malformed input.
 * Caller decides what to do with each direction.
 */
export function parseYdRawLine(line: string): ParsedYdRawLine | null {
  const tokens = line.split(/\s+/).filter((s) => s.length > 0);
  if (tokens.length === 0) return null;
  let i = 0;
  if (/^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(tokens[i] ?? '')) i++;
  let direction: 'R' | 'T' | null = null;
  if (tokens[i] === 'R' || tokens[i] === 'T') {
    direction = tokens[i] as 'R' | 'T';
    i++;
  }
  const idTok = tokens[i++];
  if (!idTok || !/^[0-9A-Fa-f]{1,8}$/.test(idTok)) return null;
  const id = parseInt(idTok, 16);
  if (!Number.isFinite(id)) return null;
  const byteCount = Math.min(tokens.length - i, 8);
  const data = new Uint8Array(byteCount);
  for (let j = 0; j < byteCount; j++) {
    const tok = tokens[i + j];
    if (!tok || !/^[0-9A-Fa-f]{1,2}$/.test(tok)) return null;
    data[j] = parseInt(tok, 16);
  }
  return { direction, id, data };
}
