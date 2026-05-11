import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Subject, BehaviorSubject } from 'rxjs';
import { Bus, _resetSourceModeControllerForTests } from '@g5000/core';
import { startSessionLogger } from '@g5000/bridge';
import type { RawCanFrame, Raw0183Sentence, WireDriver } from '@g5000/bridge';
import { createSourceModeController } from './source-mode-controller.js';

function fakeDriver(): WireDriver {
  return {
    rxCan: new Subject<RawCanFrame>().asObservable(),
    rx0183: new Subject<Raw0183Sentence>().asObservable(),
    health: new BehaviorSubject({
      connected: true,
      bytesPerSecond: 0,
      framesPerSecond: 0,
      errorCount: 0,
    }).asObservable(),
    txCan: async () => {},
    tx0183: async () => {},
  } as unknown as WireDriver;
}

describe('SourceModeController', () => {
  beforeEach(() => _resetSourceModeControllerForTests());

  it('defaults to live mode', () => {
    const c = createSourceModeController({ bus: new Bus(), sessionsDir: '/tmp' });
    expect(c.getStatus().mode).toBe('live');
  });

  it('reports demo mode when setLiveOrDemo("demo") is called', () => {
    const c = createSourceModeController({ bus: new Bus(), sessionsDir: '/tmp' });
    c.setLiveOrDemo('demo');
    expect(c.getStatus().mode).toBe('demo');
  });

  it('startReplay tears down base source then starts replay; stopReplay restarts it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-srcmode-'));
    try {
      const driver = fakeDriver();
      const logger = await startSessionLogger({ drivers: [driver], dir, sessionId: 'fixture' });
      await logger.close();

      let baseRunning = false;
      const makeBaseHandle = () => {
        baseRunning = true;
        return {
          teardown: async () => { baseRunning = false; },
          restart: async () => makeBaseHandle(),
        };
      };
      const c = createSourceModeController({ bus: new Bus(), sessionsDir: dir });
      c.setLiveOrDemo('demo');
      c.setBaseSource(makeBaseHandle());
      expect(baseRunning).toBe(true);

      await c.startReplay({ sessionId: 'fixture', paceMode: 'asap' });
      expect(c.getStatus().mode).toBe('replay');
      expect(c.getStatus().sessionId).toBe('fixture');
      expect(baseRunning).toBe(false);

      await c.stopReplay();
      expect(c.getStatus().mode).toBe('demo');
      expect(baseRunning).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stopReplay without a restart-capable base leaves base down', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-srcmode-'));
    try {
      const driver = fakeDriver();
      const logger = await startSessionLogger({ drivers: [driver], dir, sessionId: 'fixture' });
      await logger.close();

      let baseRunning = true;
      const c = createSourceModeController({ bus: new Bus(), sessionsDir: dir });
      c.setLiveOrDemo('live');
      c.setBaseSource({
        teardown: async () => { baseRunning = false; },
      });

      await c.startReplay({ sessionId: 'fixture', paceMode: 'asap' });
      expect(baseRunning).toBe(false);
      await c.stopReplay();
      expect(c.getStatus().mode).toBe('live');
      expect(baseRunning).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('startReplay refuses a missing session', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-srcmode-'));
    try {
      const c = createSourceModeController({ bus: new Bus(), sessionsDir: dir });
      await expect(c.startReplay({ sessionId: 'nope', paceMode: 'asap' })).rejects.toThrow(
        /not found/i,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a second startReplay while one is running', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'g5000-srcmode-'));
    try {
      const driver = fakeDriver();
      for (const sessionId of ['f1', 'f2']) {
        const logger = await startSessionLogger({ drivers: [driver], dir, sessionId });
        await logger.close();
      }
      const c = createSourceModeController({ bus: new Bus(), sessionsDir: dir });
      await c.startReplay({ sessionId: 'f1', paceMode: 'asap' });
      await expect(c.startReplay({ sessionId: 'f2', paceMode: 'asap' })).rejects.toThrow(
        /already/i,
      );
      await c.stopReplay();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
