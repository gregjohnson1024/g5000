/**
 * Shared interface + globalThis-backed singleton for transmitting
 * autopilot commands onto the N2K bus. Same pattern as alerts.ts:
 * the bridge writes (registers the impl at boot), web routes read.
 *
 * Only registered when process.env.G5000_ENABLE_AP_TX === '1', which
 * is the Mac dev environment. The Pi's g5000-autopilot.service must
 * never set this var.
 */

export type AutopilotCommandName =
  | 'standby'
  | 'auto'
  | 'nav'
  | 'wind'
  | 'no_drift'
  | 'course_+1'
  | 'course_-1'
  | 'course_+10'
  | 'course_-10';

export interface AutopilotCommandRequest {
  event: AutopilotCommandName;
}

export interface AutopilotCommandResult {
  ok: boolean;
  /** Wall-clock ms taken for the txPgn call to resolve. */
  txMs?: number;
  /** Set when ok=false. */
  error?: { kind: 'missing_capture' | 'tx_error' | 'unknown_event'; message: string };
}

export interface AutopilotTx {
  sendCommand(req: AutopilotCommandRequest): Promise<AutopilotCommandResult>;
}

declare const globalThis: { __g5000_autopilot_tx__?: AutopilotTx };

export function getSharedAutopilotTx(): AutopilotTx | undefined {
  return globalThis.__g5000_autopilot_tx__;
}

export function setSharedAutopilotTx(tx: AutopilotTx): void {
  globalThis.__g5000_autopilot_tx__ = tx;
}

export function _resetAutopilotTxForTests(): void {
  globalThis.__g5000_autopilot_tx__ = undefined;
}
