import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Subject, BehaviorSubject } from 'rxjs';
import { startSessionLogger, type SessionLogger } from './session-logger.js';
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
    throw new Error('not impl');
  };
  tx0183 = async () => {
    throw new Error('not impl');
  };
}

describe('startSessionLogger', () => {
  let dir: string;
  let logger: SessionLogger | null = null;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'g5000-log-'));
  });

  afterEach(async () => {
    if (logger) await logger.close();
    logger = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a header line + one event per CAN frame to a .jsonl.gz file', async () => {
    const driver = new FakeDriver();
    logger = await startSessionLogger({
      drivers: [driver],
      dir,
      sessionId: 'abc',
    });

    driver.rxCan.next({
      id: 0x09fd0211,
      ext: true,
      data: new Uint8Array([0xa0, 0x16, 0x02, 0xfe, 0x7f, 0xff, 0xfa, 0xfa]),
      rxTimestamp: 1_700_000_000_000_000_000n,
    });
    driver.rx0183.next({
      text: '$WIMWV,212.6,R,5.8,N,A*29',
      port: 1,
      rxTimestamp: 1_700_000_000_050_000_000n,
    });

    await new Promise((r) => setTimeout(r, 20));
    await logger.close();
    logger = null;

    const filePath = path.join(dir, 'abc.jsonl.gz');
    expect(existsSync(filePath)).toBe(true);
    const text = gunzipSync(readFileSync(filePath)).toString('utf8');
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Header line
    const header = JSON.parse(lines[0]!);
    expect(header.kind).toBe('header');
    expect(typeof header.startedAt).toBe('string');
    expect(header.sessionId).toBe('abc');
    expect(header.format).toBe('g5000-session-v1');

    // CAN line
    const canLine = JSON.parse(lines[1]!);
    expect(canLine.kind).toBe('can');
    expect(canLine.t_ns).toBe('1700000000000000000');
    expect(canLine.id).toBe(0x09fd0211);
    expect(canLine.data).toBe('a01602fe7ffffafa');

    // 0183 line
    const otLine = JSON.parse(lines[2]!);
    expect(otLine.kind).toBe('0183');
    expect(otLine.port).toBe(1);
    expect(otLine.text).toBe('$WIMWV,212.6,R,5.8,N,A*29');
  });

  it('flushes pending writes on close()', async () => {
    const driver = new FakeDriver();
    logger = await startSessionLogger({
      drivers: [driver],
      dir,
      sessionId: 'flush',
    });

    for (let i = 0; i < 50; i++) {
      driver.rx0183.next({
        text: `$XXMSG,${i}*00`,
        port: 0,
        rxTimestamp: BigInt(i) * 1_000_000n,
      });
    }
    await logger.close();
    logger = null;

    const filePath = path.join(dir, 'flush.jsonl.gz');
    const lines = gunzipSync(readFileSync(filePath)).toString('utf8').trim().split('\n');
    // 1 header + 50 events
    expect(lines.length).toBe(51);
  });
});
