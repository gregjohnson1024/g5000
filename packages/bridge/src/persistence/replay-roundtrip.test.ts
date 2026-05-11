import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeN2KActisense } from '@canboat/canboatjs/lib/n2k-actisense.js';
import { Bus, Channels, type Sample } from '@g5000/core';
import { Ngt1Driver, type Ngt1Source } from '../ngt-driver.js';
import { runBridge } from '../bridge.js';
import { startSessionLogger } from './session-logger.js';
import { ReplayDriver } from './replay-driver.js';
import { _resetSharedDeviceRegistryForTests } from '../index.js';

class MemorySource implements Ngt1Source {
  private listener: ((c: Buffer) => void) | null = null;
  on(event: 'data', cb: (c: Buffer) => void) {
    if (event === 'data') this.listener = cb;
    return this;
  }
  off() {
    this.listener = null;
    return this;
  }
  emit(buf: Buffer) {
    this.listener?.(buf);
  }
}

describe('session-record → replay round-trip with a real PGN 130306', () => {
  it('records real CAN frames and replays them into the same channels', async () => {
    _resetSharedDeviceRegistryForTests();

    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-roundtrip-'));
    try {
      // Record
      const bus1 = new Bus();
      const source = new MemorySource();
      const driver = new Ngt1Driver({ source });
      const stopBridge1 = await runBridge({ bus: bus1, drivers: [driver] });
      const logger = await startSessionLogger({
        drivers: [driver],
        dir,
        sessionId: 'roundtrip',
      });

      const windPayload = Buffer.from([0xa0, 0x16, 0x02, 0xfe, 0x7f, 0x02, 0xfa, 0xfa]);
      const frame = encodeN2KActisense({
        pgn: 130306,
        data: windPayload,
        prio: 2,
        src: 17,
        dst: 255,
      });
      source.emit(frame);
      await new Promise((r) => setTimeout(r, 30));
      await logger.close();
      await stopBridge1();

      // Replay
      _resetSharedDeviceRegistryForTests();
      const bus2 = new Bus();
      const filePath = path.join(dir, 'roundtrip.jsonl.gz');
      const replayDriver = new ReplayDriver({ filePath, mode: 'asap' });
      const stopBridge2 = await runBridge({ bus: bus2, drivers: [replayDriver] });
      const received: Sample[] = [];
      bus2.subscribe('wind.**', (s) => received.push(s));
      await replayDriver.start();
      await new Promise((r) => setTimeout(r, 100));

      const channels = new Set(received.map((s) => s.channel));
      expect(channels.has(Channels.Wind.ApparentAngle)).toBe(true);
      expect(channels.has(Channels.Wind.ApparentSpeed)).toBe(true);

      await replayDriver.stop();
      await stopBridge2();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
