import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { Subscription } from 'rxjs';
import type { WireDriver } from '../wire-driver.js';

export interface StartSessionLoggerOptions {
  drivers: WireDriver[];
  dir: string;
  sessionId: string;
}

export interface SessionLogger {
  /** Stop subscribing and flush pending writes to disk. Idempotent. */
  close(): Promise<void>;
}

/**
 * Subscribe to every driver's CAN and 0183 streams, serializing each event
 * as a single-line JSON record to `<dir>/<sessionId>.jsonl.gz`. The file
 * starts with a header line carrying schema metadata.
 *
 * BigInt timestamps are stringified — JSON.stringify cannot serialize bigint
 * directly; the replay reader rebuilds them via `BigInt(line.t_ns)`.
 */
export async function startSessionLogger(opts: StartSessionLoggerOptions): Promise<SessionLogger> {
  await mkdir(opts.dir, { recursive: true });
  const filePath = path.join(opts.dir, `${opts.sessionId}.jsonl.gz`);
  const fileStream = createWriteStream(filePath);
  const gzip = createGzip();
  gzip.pipe(fileStream);

  const subs: Subscription[] = [];
  let closed = false;

  const writeLine = (obj: unknown): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const line = JSON.stringify(obj) + '\n';
      gzip.write(line, 'utf8', (err) => (err ? reject(err) : resolve()));
    });

  // Header
  await writeLine({
    kind: 'header',
    format: 'g5000-session-v1',
    sessionId: opts.sessionId,
    startedAt: new Date().toISOString(),
  });

  for (const driver of opts.drivers) {
    subs.push(
      driver.rxCan.subscribe((frame) => {
        if (closed) return;
        const data = Array.from(frame.data, (b) => b.toString(16).padStart(2, '0')).join('');
        void writeLine({
          kind: 'can',
          t_ns: frame.rxTimestamp.toString(),
          id: frame.id,
          data,
        });
      }),
    );
    subs.push(
      driver.rx0183.subscribe((s) => {
        if (closed) return;
        void writeLine({
          kind: '0183',
          t_ns: s.rxTimestamp.toString(),
          port: s.port,
          text: s.text,
        });
      }),
    );
  }

  return {
    async close() {
      if (closed) return;
      closed = true;
      for (const s of subs) s.unsubscribe();
      await new Promise<void>((resolve, reject) => {
        gzip.end((err?: NodeJS.ErrnoException | null) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve) => {
        if (fileStream.closed) resolve();
        else fileStream.once('close', () => resolve());
      });
    },
  };
}
