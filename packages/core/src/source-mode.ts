export type SourceMode = 'live' | 'demo' | 'replay';
export type PaceMode = 'realtime' | 'asap';
export type ReplayPhase = 'running' | 'finished' | 'error';

export interface SourceModeStatus {
  mode: SourceMode;
  sessionId?: string;
  paceMode?: PaceMode;
  phase?: ReplayPhase;
  startedAt?: string;
  errorMessage?: string;
}

export interface BaseSourceHandle {
  /** Tear down the currently-running base source. */
  teardown: () => Promise<void>;
  /**
   * Re-arm the base source after a replay ends. Optional — when omitted,
   * stopReplay() cannot restore the previous source and the user must
   * restart the server. Recommended for demo mode; optional for live.
   */
  restart?: () => Promise<BaseSourceHandle>;
}

export interface BaseSourceFactories {
  live: () => Promise<BaseSourceHandle>;
  demo: () => Promise<BaseSourceHandle>;
}

export interface SourceModeController {
  getStatus(): SourceModeStatus;
  setLiveOrDemo(mode: 'live' | 'demo'): Promise<void>;
  setBaseSourceFactories(factories: BaseSourceFactories): void;
  setBaseSource(handle: BaseSourceHandle | null): void;
  startReplay(args: { sessionId: string; paceMode: PaceMode }): Promise<void>;
  stopReplay(): Promise<void>;
}

declare const globalThis: { __g5000_sourceMode__?: SourceModeController };

export function getSourceModeController(): SourceModeController | undefined {
  return globalThis.__g5000_sourceMode__;
}

export function setSourceModeController(c: SourceModeController): void {
  globalThis.__g5000_sourceMode__ = c;
}

export function _resetSourceModeControllerForTests(): void {
  globalThis.__g5000_sourceMode__ = undefined;
}
