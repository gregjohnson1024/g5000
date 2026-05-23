import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Bus } from '@g5000/core';
import {
  setSourceModeController,
  getSourceModeController,
  type SourceModeController,
  type SourceModeStatus,
  type BaseSourceHandle,
  type BaseSourceFactories,
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
  let factories: BaseSourceFactories | null = null;
  // Serialize concurrent setLiveOrDemo calls — if two POSTs land within
  // a teardown window the second waits for the first to finish before
  // running. Without this, the second call could race on baseHandle and
  // either leak a source or double-tear-down.
  let setLiveOrDemoQueue: Promise<void> = Promise.resolve();

  const doSetLiveOrDemo = async (mode: 'live' | 'demo'): Promise<void> => {
    if (status.mode === 'replay') {
      throw new Error('cannot swap base mode while replay is active — stop the replay first');
    }
    if (baseMode === mode && status.mode === mode && !status.errorMessage && baseHandle !== null) {
      // No-op: already in the target mode with a running base source
      // and no error to clear. We still must proceed when baseHandle is
      // null (initial cold-boot into the default mode) so the factory
      // actually runs.
      return;
    }
    // Tear down current handle (if any).
    if (baseHandle) {
      const prev = baseHandle;
      baseHandle = null;
      try {
        await prev.teardown();
      } catch (err) {
        // Log but proceed — we still need to swap to the new mode.
        // eslint-disable-next-line no-console
        console.warn(
          `[source-mode] teardown of ${baseMode} base failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    baseMode = mode;
    // Start the new handle via factory (if registered).
    if (factories) {
      try {
        baseHandle = await factories[mode]();
        status = { mode };
      } catch (err) {
        status = {
          mode,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      // No factories registered: still report the new mode.
      status = { mode };
    }
  };

  const controller: SourceModeController = {
    getStatus: () => ({ ...status }),
    setLiveOrDemo: (mode) => {
      // Chain onto the existing queue so calls run sequentially. We
      // capture the resulting promise back into the queue so the next
      // call waits for *this* call to finish — but we ignore rejections
      // when chaining (otherwise one error would poison the queue).
      const next = setLiveOrDemoQueue.catch(() => {}).then(() => doSetLiveOrDemo(mode));
      setLiveOrDemoQueue = next.then(
        () => {},
        () => {},
      );
      return next;
    },
    setBaseSourceFactories: (f) => {
      factories = f;
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
