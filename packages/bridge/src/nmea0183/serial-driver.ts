import { Subject, type Observable, EMPTY } from 'rxjs';
import type {
  RawCanFrame,
  Raw0183Sentence,
  WireDriver,
  DriverHealth,
  OutgoingPgn,
} from '../wire-driver.js';
import { createHealthSubject } from '../driver-common.js';

/**
 * The minimal shape of a serial source: any object that emits `Buffer`
 * chunks via 'data' events. The Node.js SerialPort matches; tests pass a
 * MemorySource.
 */
export interface Sentence0183Source {
  on(event: 'data', cb: (chunk: Buffer) => void): this;
  off(event: 'data', cb: (chunk: Buffer) => void): this;
}

export interface SerialPort0183DriverOptions {
  source: Sentence0183Source;
  /** Logical port number — used to disambiguate when a process owns >1. */
  port: number;
}

export class SerialPort0183Driver implements WireDriver {
  readonly rxCan: Observable<RawCanFrame> = EMPTY;
  readonly rx0183: Observable<Raw0183Sentence>;
  readonly health: Observable<DriverHealth>;

  private readonly rxSubject = new Subject<Raw0183Sentence>();
  private readonly healthSubject = createHealthSubject();
  private readonly source: Sentence0183Source;
  private readonly port: number;
  private buffer = '';
  private dataHandler = this.onData.bind(this);

  constructor(opts: SerialPort0183DriverOptions) {
    this.source = opts.source;
    this.port = opts.port;
    this.rx0183 = this.rxSubject.asObservable();
    this.health = this.healthSubject.asObservable();
  }

  async start(): Promise<void> {
    this.source.on('data', this.dataHandler);
    this.healthSubject.next({
      ...this.healthSubject.value,
      connected: true,
    });
  }

  async stop(): Promise<void> {
    this.source.off('data', this.dataHandler);
    this.healthSubject.next({
      ...this.healthSubject.value,
      connected: false,
    });
  }

  async txCan(_frame: RawCanFrame): Promise<void> {
    throw new Error('SerialPort0183Driver.txCan not implemented (0183 driver carries no CAN)');
  }

  async tx0183(_port: number, _text: string): Promise<void> {
    throw new Error('SerialPort0183Driver.tx0183 not implemented in Phase 0a');
  }

  async txPgn(_pgn: OutgoingPgn): Promise<void> {
    throw new Error('SerialPort0183Driver.txPgn not supported');
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const raw = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const text = raw.replace(/\r$/, '');
      if (text.length === 0) continue;
      this.rxSubject.next({
        text,
        port: this.port,
        rxTimestamp: BigInt(Date.now()) * 1_000_000n,
      });
    }
  }
}
