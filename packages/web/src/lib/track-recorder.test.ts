import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setSourceModeController,
  _resetSourceModeControllerForTests,
  type SourceMode,
  type SourceModeController,
} from '@g5000/core';

vi.mock('./tracks', () => ({
  activeTrack: vi.fn(async () => ({ id: 't1', points: [] })),
  createTrack: vi.fn(),
  appendPoint: vi.fn(async () => ({ id: 't1', points: [] })),
}));

import { appendPoint } from './tracks';
import { maybeAppend, type Recorder } from './track-recorder';

function installController(mode: SourceMode): void {
  const fake = {
    getStatus: () => ({ mode }),
    setLiveOrDemo: async () => {},
    setBaseSourceFactories: () => {},
    setBaseSource: () => {},
    startReplay: async () => {},
    stopReplay: async () => {},
  } satisfies SourceModeController;
  setSourceModeController(fake);
}

function freshRecorder(): Recorder {
  return {
    status: 'running',
    activeTrackId: 't1',
    lastPoint: null,
    lastAppendedAt: 0,
    pointsAppended: 0,
    stop: async () => {},
  };
}

describe('maybeAppend source-mode gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSourceModeControllerForTests();
  });

  it('appends a fix in live mode', async () => {
    installController('live');
    await maybeAppend(freshRecorder(), { t: 1, lat: 45, lon: -75 });
    expect(appendPoint).toHaveBeenCalledTimes(1);
  });

  it('does not append in demo mode', async () => {
    installController('demo');
    await maybeAppend(freshRecorder(), { t: 1, lat: 45, lon: -75 });
    expect(appendPoint).not.toHaveBeenCalled();
  });

  it('does not append in replay mode', async () => {
    installController('replay');
    await maybeAppend(freshRecorder(), { t: 1, lat: 45, lon: -75 });
    expect(appendPoint).not.toHaveBeenCalled();
  });
});
