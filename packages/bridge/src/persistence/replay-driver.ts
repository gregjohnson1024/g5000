import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Subject, BehaviorSubject, type Observable } from 'rxjs';
import type {
  RawCanFrame,
  Raw0183Sentence,
  WireDriver,
  DriverHealth,
} from '../wire-driver.js';

export interface ReplayDriverOptions {
  filePath: string;
  /**
   * - `asap`: emit events as fast as the file can be read (no pacing).
   * - `realtime`: pace by original `t_ns` deltas; preserves recorded timing.
   */
  mode: 'asap' | 'realtime';
}

interface CanLine {
  kind: 'can';
  t_ns: string;
  id: number;
  data: string;
}

interface Ot0183Line {
  kind: '0183';
  t_ns: string;
  port: number;
  text: string;
}

interface HeaderLine {
  kind: 'header';
  format: string;
  sessionId: string;
  startedAt: string;
}

type LogLine = CanLine | Ot0183Line | HeaderLine;

export class ReplayDriver implements WireDriver {
  readonly rxCan: Observable<RawCanFrame>;
  readonly rx0183: Observable<Raw0183Sentence>;
  readonly health: Observable<DriverHealth>;

  private readonly canSubject = new Subject<RawCanFrame>();
  private readonly otSubject = new Subject<Raw0183Sentence>();
  private readonly healthSubject = new BehaviorSubject<DriverHealth>({
    connected: false,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });

  private aborted = false;

  constructor(private readonly opts: ReplayDriverOptions) {
    this.rxCan = this.canSubject.asObservable();
    this.rx0183 = this.otSubject.asObservable();
    this.health = this.healthSubject.asObservable();
  }

  async start(): Promise<void> {
    this.healthSubject.next({ ...this.healthSubject.value, connected: true });
    void this.run();
  }

  async stop(): Promise<void> {
    this.aborted = true;
    this.healthSubject.next({ ...this.healthSubject.value, connected: false });
  }

  async txCan(): Promise<void> {
    throw new Error('ReplayDriver.txCan not supported');
  }

  async tx0183(): Promise<void> {
    throw new Error('ReplayDriver.tx0183 not supported');
  }

  private async run(): Promise<void> {
    const file = createReadStream(this.opts.filePath);
    const gunzip = createGunzip();
    const lines = createInterface({ input: file.pipe(gunzip) });

    let firstEventNs: bigint | null = null;
    const wallStart = Date.now();

    for await (const raw of lines) {
      if (this.aborted) break;
      if (raw.length === 0) continue;
      let parsed: LogLine;
      try {
        parsed = JSON.parse(raw) as LogLine;
      } catch {
        continue;
      }
      if (parsed.kind === 'header') continue;

      const tNs = BigInt(parsed.t_ns);
      if (this.opts.mode === 'realtime') {
        if (firstEventNs === null) firstEventNs = tNs;
        const elapsedRecMs = Number((tNs - firstEventNs) / 1_000_000n);
        const elapsedWallMs = Date.now() - wallStart;
        const delay = elapsedRecMs - elapsedWallMs;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      }

      if (parsed.kind === 'can') {
        const data = hexToBytes(parsed.data);
        this.canSubject.next({
          id: parsed.id,
          ext: true,
          data,
          rxTimestamp: tNs,
        });
      } else if (parsed.kind === '0183') {
        this.otSubject.next({
          text: parsed.text,
          port: parsed.port,
          rxTimestamp: tNs,
        });
      }
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
