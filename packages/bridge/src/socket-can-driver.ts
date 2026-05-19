import { Subject, BehaviorSubject, EMPTY, type Observable } from 'rxjs';
import type {
  RawCanFrame,
  Raw0183Sentence,
  WireDriver,
  DriverHealth,
  OutgoingPgn,
} from './wire-driver.js';
import { encodePgnToCanFrames } from './tx/fast-packet.js';

/**
 * Minimal shape we need from a SocketCAN raw channel. Production: the
 * channel returned by `require('socketcan').createRawChannel(iface, true)`.
 * Tests pass an EventEmitter-shaped fake. Keeping the driver injection-based
 * mirrors `YdwgRawTcpDriver`'s `socketFactory` pattern, so tests don't have
 * to touch the kernel.
 */
export interface SocketCanRawChannel {
  start(): void;
  stop(): void;
  send(msg: { id: number; ext: boolean; data: Buffer }): void;
  addListener(
    event: 'onMessage',
    cb: (msg: { id: number; ext: boolean; data: Buffer }) => void,
  ): void;
  removeListener?(event: 'onMessage', cb: (msg: unknown) => void): void;
}

export interface SocketCanDriverOptions {
  /**
   * Returns a fresh raw channel each time `start()` is called. Production
   * factory: {@link createSocketCanRawChannelFactory}. Tests inject a fake.
   */
  channelFactory: () => SocketCanRawChannel;
  /** Health-tick interval (ms). Default 1000. */
  healthIntervalMs?: number;
}

/**
 * Production factory — dynamically loads the `socketcan` npm package and
 * opens a raw CAN channel on `iface`. The dynamic require keeps Mac dev
 * working (no socketcan binary on macOS) and makes the failure mode crisp:
 * if the module isn't installed, the driver fails to start with a clear
 * message and the bridge boot logs it like an offline NGT-1 / YDWG.
 *
 * On the Pi: `npm install socketcan` inside apps/autopilot-server (or pin
 * it via optionalDependencies in package.json). Requires SPI + the
 * mcp2515-can0 dt-overlay loaded, and `ip link set can0 up type can
 * bitrate 250000` already done — see CLAUDE.md "PiCAN-M" section.
 */
export function createSocketCanRawChannelFactory(iface: string): () => SocketCanRawChannel {
  return () => {
    // The `createRequire`-style dynamic load is intentional: this module
    // must import cleanly on Mac (where `socketcan` isn't installable) so
    // the rest of @g5000/bridge can typecheck and test. The require only
    // runs when SOMETHING calls the factory — typically the autopilot-
    // server boot, on Linux.
    type SocketCanModule = {
      createRawChannel(iface: string, sendOwnFrames: boolean): SocketCanRawChannel;
    };
    let socketcan: SocketCanModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      socketcan = require('socketcan') as SocketCanModule;
    } catch (err) {
      throw new Error(
        `socketcan module not available: ${err instanceof Error ? err.message : String(err)} — install with 'npm install socketcan' on the Pi (Linux only; package has a native addon).`,
      );
    }
    return socketcan.createRawChannel(iface, true);
  };
}

/**
 * Reads raw extended-frame CAN messages from a SocketCAN interface and
 * exposes them as a stream of {@link RawCanFrame}. Fast-packet reassembly,
 * decoding, and PGN dispatch all happen above the driver layer — this
 * driver's job is the kernel ↔ Subject hop.
 *
 * TX path goes through `encodePgnToCanFrames` (canboatjs), same as the
 * other drivers. Source address is fixed at 254 (spoofed) for now; once
 * we implement ISO Address Claim (PGN 60928), the driver can claim a real
 * source and the H5000 will start accepting our commands.
 */
export class SocketCanDriver implements WireDriver {
  private channel: SocketCanRawChannel | null = null;
  private readonly opts: SocketCanDriverOptions;
  private readonly rxCanSubject = new Subject<RawCanFrame>();
  private readonly healthSubject = new BehaviorSubject<DriverHealth>({
    connected: false,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  private frames = 0;
  private bytes = 0;
  private errors = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  private readonly onMessage = (msg: { id: number; ext: boolean; data: Buffer }): void => {
    // SocketCAN gives us standard-frame messages too if the bus has any;
    // N2K is strictly 29-bit extended, so drop anything else as noise.
    if (!msg.ext) return;
    this.frames += 1;
    this.bytes += msg.data.length;
    this.rxCanSubject.next({
      id: msg.id,
      ext: true,
      data: new Uint8Array(msg.data),
      // Capture timestamp at the driver boundary — close enough to bus
      // arrival for the planner and stats workers. The socketcan binding
      // exposes hardware timestamps via msg.ts.{sec,usec} but they're not
      // wired through this minimal driver yet.
      rxTimestamp: BigInt(Date.now()) * 1_000_000n,
    });
  };

  constructor(opts: SocketCanDriverOptions) {
    this.opts = opts;
  }

  get rxCan(): Observable<RawCanFrame> {
    return this.rxCanSubject;
  }
  get rx0183(): Observable<Raw0183Sentence> {
    return EMPTY;
  }
  get health(): Observable<DriverHealth> {
    return this.healthSubject;
  }

  async start(): Promise<void> {
    if (this.channel) return;
    this.channel = this.opts.channelFactory();
    this.channel.addListener('onMessage', this.onMessage);
    this.channel.start();
    this.healthSubject.next({
      connected: true,
      bytesPerSecond: 0,
      framesPerSecond: 0,
      errorCount: 0,
    });
    const intervalMs = this.opts.healthIntervalMs ?? 1000;
    this.healthTimer = setInterval(() => {
      this.healthSubject.next({
        connected: true,
        bytesPerSecond: this.bytes,
        framesPerSecond: this.frames,
        errorCount: this.errors,
      });
      this.frames = 0;
      this.bytes = 0;
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.channel) {
      try {
        this.channel.stop();
      } catch {
        // Channel may already be torn down (kernel module unloaded, etc).
        this.errors += 1;
      }
      try {
        this.channel.removeListener?.(
          'onMessage',
          this.onMessage as unknown as (msg: unknown) => void,
        );
      } catch {
        /* fake channels may omit removeListener */
      }
      this.channel = null;
    }
    this.healthSubject.next({
      connected: false,
      bytesPerSecond: 0,
      framesPerSecond: 0,
      errorCount: this.errors,
    });
  }

  async txCan(frame: RawCanFrame): Promise<void> {
    if (!this.channel) throw new Error('SocketCanDriver: not started');
    this.channel.send({
      id: frame.id,
      ext: true,
      data: Buffer.from(frame.data),
    });
  }

  async tx0183(): Promise<void> {
    throw new Error('SocketCanDriver does not carry NMEA 0183');
  }

  async txPgn(pgn: OutgoingPgn): Promise<void> {
    const frames = encodePgnToCanFrames(pgn);
    for (const f of frames) {
      await this.txCan(f);
    }
  }
}
