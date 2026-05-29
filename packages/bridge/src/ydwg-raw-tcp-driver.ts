import { Subject, EMPTY, type Observable } from 'rxjs';
import * as net from 'node:net';
import type {
  RawCanFrame,
  Raw0183Sentence,
  WireDriver,
  DriverHealth,
  OutgoingPgn,
} from './wire-driver.js';
import { createHealthSubject, txPgnViaFrames } from './driver-common.js';

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
  on(event: 'timeout', cb: () => void): this;
  removeAllListeners(event?: string): this;
  write(data: string | Buffer, cb?: (err?: Error | null) => void): boolean;
  destroy(err?: Error): this;
  /** OS-level TCP keep-alive. Optional so test fakes don't have to implement it. */
  setKeepAlive?(enable: boolean, initialDelayMs?: number): unknown;
  /** Node app-level inactivity timer; fires a 'timeout' event after `ms` of socket silence. */
  setTimeout?(ms: number): unknown;
}

export interface YdwgRawTcpDriverOptions {
  /**
   * Creates a fresh socket each time the driver (re)connects. Production:
   * `createYdwgTcpSocketFactory(host, port)`. Tests: a fake socket factory.
   */
  socketFactory: () => YdwgSocket;
  /** Reconnect backoff config. Default { initialMs: 1000, maxMs: 30000 }. */
  backoffMs?: { initialMs: number; maxMs: number };
  /**
   * Liveness config — protects against half-open sockets where the peer has
   * gone away but TCP has no FIN/RST to confirm it (NAT drop, peer crash,
   * network partition mid-session). Two independent layers:
   *   - `keepAliveDelayMs`: OS-level keep-alive probes after this much idle.
   *   - `idleTimeoutMs`: Node 'timeout' event after no socket data; the
   *     driver responds by destroying the socket so the reconnect path runs.
   * Defaults: keepAliveDelayMs=10000, idleTimeoutMs=30000. The bus is
   * normally chatty (>50 Hz) so 30s of complete silence is a strong signal
   * that the connection is dead even if TCP doesn't yet know.
   */
  liveness?: { keepAliveDelayMs?: number; idleTimeoutMs?: number };
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
 * TX: `txCan` writes a single CAN frame. `txPgn` encodes the typed PGN
 * via `encodePgnToCanFrames` (which uses canboatjs' YDGW-raw encoder
 * under the hood) and emits each resulting frame in order via `txCan`,
 * so Fast Packet PGNs are split correctly with the NMEA-2000 order byte.
 *
 * Reconnect: exponential backoff on socket drop or error, capped at
 * `maxMs`. The backoff resets after a successful `connect` event.
 */
export class YdwgRawTcpDriver implements WireDriver {
  readonly rxCan: Observable<RawCanFrame>;
  readonly rx0183: Observable<Raw0183Sentence> = EMPTY;
  readonly health: Observable<DriverHealth>;

  private readonly rxSubject = new Subject<RawCanFrame>();
  private readonly healthSubject = createHealthSubject();
  private readonly socketFactory: () => YdwgSocket;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly keepAliveDelayMs: number;
  private readonly idleTimeoutMs: number;

  private socket: YdwgSocket | null = null;
  private active = false;
  private currentBackoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lineBuffer = '';

  constructor(opts: YdwgRawTcpDriverOptions) {
    this.socketFactory = opts.socketFactory;
    this.initialBackoffMs = opts.backoffMs?.initialMs ?? 1000;
    this.maxBackoffMs = opts.backoffMs?.maxMs ?? 30000;
    this.keepAliveDelayMs = opts.liveness?.keepAliveDelayMs ?? 10_000;
    this.idleTimeoutMs = opts.liveness?.idleTimeoutMs ?? 30_000;
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
    // Encode the PGN into ordered CAN frames (single for short PGNs, multiple
    // with the Fast Packet order byte already set for long ones). Each frame
    // goes out via the existing txCan path so all socket-format logic stays
    // in one place.
    await txPgnViaFrames((frame) => this.txCan(frame), pgn);
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
    // Enable liveness probes BEFORE the socket connects so they take effect
    // as soon as it does. Both calls are best-effort: test fakes may omit
    // the methods.
    if (this.keepAliveDelayMs > 0) {
      socket.setKeepAlive?.(true, this.keepAliveDelayMs);
    }
    if (this.idleTimeoutMs > 0) {
      socket.setTimeout?.(this.idleTimeoutMs);
    }
    socket.on('connect', () => {
      this.currentBackoffMs = this.initialBackoffMs;
      this.healthSubject.next({ ...this.healthSubject.value, connected: true });
    });
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => {
      const h = this.healthSubject.value;
      this.healthSubject.next({ ...h, errorCount: h.errorCount + 1 });
    });
    socket.on('timeout', () => {
      // No socket data for idleTimeoutMs — assume the connection is dead
      // (half-open, NAT drop, peer crash). Destroy it; the resulting
      // 'close' event routes through onClose() → reconnect.
      const h = this.healthSubject.value;
      this.healthSubject.next({ ...h, errorCount: h.errorCount + 1 });
      socket.destroy();
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
