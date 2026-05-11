import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Bus } from '@g5000/core';
import {
  setSourceModeController,
  getSourceModeController,
  type SourceModeController,
  type SourceModeStatus,
  type BaseSourceHandle,
} from '@g5000/core';
import { ReplayDriver, runBridge } from '@g5000/bridge';

export interface CreateOptions {
  bus: Bus;
  sessionsDir: string;
}

export function createSourceModeController(opts: CreateOptions): SourceModeController {
  const existing = getSourceModeController();
  if (existing) return existing;

  let baseMode: 'live' | 'demo' = 'live';
  let status: SourceModeStatus = { mode: 'live' };
  let baseHandle: BaseSourceHandle | null = null;
  let stashedRestart: (() => Promise<BaseSourceHandle>) | undefined;
  let activeReplayTeardown: (() => Promise<void>) | null = null;

  const controller: SourceModeController = {
    getStatus: () => ({ ...status }),
    setLiveOrDemo: (mode) => {
      baseMode = mode;
      if (status.mode !== 'replay') {
        status = { mode };
      }
    },
    setBaseSource: (handle) => {
      baseHandle = handle;
    },
    async startReplay({ sessionId, paceMode }) {
      if (status.mode === 'replay') {
        throw new Error(`replay already running for "${status.sessionId}"`);
      }
      const filePath = path.join(opts.sessionsDir, `${sessionId}.jsonl.gz`);
      if (!existsSync(filePath)) {
        throw new Error(`session "${sessionId}" not found in ${opts.sessionsDir}`);
      }

      if (baseHandle) {
        const prev = baseHandle;
        baseHandle = null;
        stashedRestart = prev.restart;
        await prev.teardown();
      } else {
        stashedRestart = undefined;
      }

      const driver = new ReplayDriver({ filePath, mode: paceMode });
      const stopBridge = await runBridge({ bus: opts.bus, drivers: [driver] });
      await driver.start();
      activeReplayTeardown = async () => {
        await driver.stop();
        await stopBridge();
      };
      status = {
        mode: 'replay',
        sessionId,
        paceMode,
        phase: 'running',
        startedAt: new Date().toISOString(),
      };
    },
    async stopReplay() {
      if (activeReplayTeardown) {
        const t = activeReplayTeardown;
        activeReplayTeardown = null;
        try {
          await t();
        } catch (err) {
          status = {
            mode: baseMode,
            errorMessage: err instanceof Error ? err.message : String(err),
          };
          return;
        }
      }
      if (stashedRestart) {
        try {
          baseHandle = await stashedRestart();
        } catch (err) {
          stashedRestart = undefined;
          status = {
            mode: baseMode,
            errorMessage: `base restart failed: ${err instanceof Error ? err.message : String(err)}`,
          };
          return;
        }
      }
      stashedRestart = undefined;
      status = { mode: baseMode };
    },
  };

  setSourceModeController(controller);
  return controller;
}
