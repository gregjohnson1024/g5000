import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Subject, BehaviorSubject } from 'rxjs';
import { startSessionLogger } from './session-logger.js';
import { ReplayDriver } from './replay-driver.js';
import type { RawCanFrame, Raw0183Sentence, WireDriver, DriverHealth } from '../wire-driver.js';

class FakeDriver implements WireDriver {
  rxCan = new Subject<RawCanFrame>();
  rx0183 = new Subject<Raw0183Sentence>();
  health = new BehaviorSubject<DriverHealth>({
    connected: true,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  start = async () => {};
  stop = async () => {};
  txCan = async () => {
    throw new Error();
  };
  tx0183 = async () => {
    throw new Error();
  };
}

describe('ReplayDriver', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'h6000-replay-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a recorded session through the replay driver', async () => {
    // 1. Record a fake session.
    const fake = new FakeDriver();
    const logger = await startSessionLogger({
      drivers: [fake],
      dir,
      sessionId: 'rt',
    });
    const ts = (n: number) => BigInt(1_700_000_000_000n) * 1_000_000n + BigInt(n) * 1_000_000n;
    fake.rxCan.next({
      id: 0x09fd0211,
      ext: true,
      data: new Uint8Array([0xa0, 0x16, 0x02, 0xfe, 0x7f, 0xff, 0xfa, 0xfa]),
      rxTimestamp: ts(0),
    });
    fake.rx0183.next({
      text: '$WIMWV,212.6,R,5.8,N,A*29',
      port: 1,
      rxTimestamp: ts(50),
    });
    await new Promise((r) => setTimeout(r, 10));
    await logger.close();

    // 2. Replay it.
    const driver = new ReplayDriver({
      filePath: path.join(dir, 'rt.jsonl.gz'),
      mode: 'asap',
    });
    const canFrames: RawCanFrame[] = [];
    const sentences: Raw0183Sentence[] = [];
    const canSub = driver.rxCan.subscribe((f) => canFrames.push(f));
    const otSub = driver.rx0183.subscribe((s) => sentences.push(s));
    await driver.start();

    // Wait until both events have been emitted (or timeout).
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const id = setInterval(() => {
        if (canFrames.length === 1 && sentences.length === 1) {
          clearInterval(id);
          resolve();
        } else if (Date.now() - startedAt > 2000) {
          clearInterval(id);
          reject(new Error(`timeout: got ${canFrames.length} CAN, ${sentences.length} 0183`));
        }
      }, 5);
    });
    await driver.stop();
    canSub.unsubscribe();
    otSub.unsubscribe();

    expect(canFrames).toHaveLength(1);
    expect(canFrames[0]!.id).toBe(0x09fd0211);
    expect(canFrames[0]!.data).toEqual(
      new Uint8Array([0xa0, 0x16, 0x02, 0xfe, 0x7f, 0xff, 0xfa, 0xfa]),
    );
    expect(canFrames[0]!.rxTimestamp).toBe(ts(0));

    expect(sentences).toHaveLength(1);
    expect(sentences[0]!.text).toBe('$WIMWV,212.6,R,5.8,N,A*29');
    expect(sentences[0]!.port).toBe(1);
    expect(sentences[0]!.rxTimestamp).toBe(ts(50));
  });
});
