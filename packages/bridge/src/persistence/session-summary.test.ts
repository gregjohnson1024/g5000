import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Subject, BehaviorSubject } from 'rxjs';
import { startSessionLogger } from './session-logger.js';
import { listSessions, summarizeSession } from './session-summary.js';
import type { RawCanFrame, Raw0183Sentence, WireDriver } from '../wire-driver.js';

function fakeDriver(): {
  driver: WireDriver;
  pushCan: (f: RawCanFrame) => void;
  pushOt: (s: Raw0183Sentence) => void;
} {
  const can = new Subject<RawCanFrame>();
  const ot = new Subject<Raw0183Sentence>();
  const health = new BehaviorSubject({
    connected: true,
    bytesPerSecond: 0,
    framesPerSecond: 0,
    errorCount: 0,
  });
  return {
    driver: {
      rxCan: can.asObservable(),
      rx0183: ot.asObservable(),
      health: health.asObservable(),
      txCan: async () => {},
      tx0183: async () => {},
    } as unknown as WireDriver,
    pushCan: (f) => can.next(f),
    pushOt: (s) => ot.next(s),
  };
}

describe('session-summary', () => {
  it('lists sessions with id, size, mtime, and parsed header startedAt', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-sess-'));
    try {
      const { driver, pushCan } = fakeDriver();
      const logger = await startSessionLogger({
        drivers: [driver],
        dir,
        sessionId: '2026-05-11T12-00-00',
      });
      pushCan({ id: 0x18eeff01, ext: true, data: new Uint8Array([1, 2, 3]), rxTimestamp: 1n });
      await new Promise((r) => setTimeout(r, 5));
      await logger.close();

      const list = await listSessions(dir);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe('2026-05-11T12-00-00');
      expect(list[0]!.sizeBytes).toBeGreaterThan(0);
      expect(list[0]!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('summarizes a session: counts by kind, duration, first/last timestamps', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-sess-'));
    try {
      const { driver, pushCan, pushOt } = fakeDriver();
      const logger = await startSessionLogger({
        drivers: [driver],
        dir,
        sessionId: 'fixture',
      });
      pushCan({ id: 0x18eeff01, ext: true, data: new Uint8Array([1]), rxTimestamp: 1_000_000n });
      pushCan({ id: 0x18eeff01, ext: true, data: new Uint8Array([2]), rxTimestamp: 2_000_000n });
      pushOt({ text: '$GPGGA,...', port: 1, rxTimestamp: 3_500_000n });
      await new Promise((r) => setTimeout(r, 5));
      await logger.close();

      const summary = await summarizeSession(path.join(dir, 'fixture.jsonl.gz'));
      expect(summary.id).toBe('fixture');
      expect(summary.canLines).toBe(2);
      expect(summary.otLines).toBe(1);
      expect(summary.firstEventNs).toBe('1000000');
      expect(summary.lastEventNs).toBe('3500000');
      expect(summary.durationMs).toBe(Math.round((3_500_000 - 1_000_000) / 1_000_000));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('listSessions returns empty array for nonexistent dir', async () => {
    const list = await listSessions('/tmp/definitely-not-a-real-dir-' + Date.now());
    expect(list).toEqual([]);
  });
});
