import {
  setSharedAutopilotTx,
  type AutopilotTx,
  type AutopilotCommandRequest,
  type AutopilotCommandResult,
} from '@g5000/core';
import type { WireDriver } from './wire-driver.js';
import { resolveCommand, type CaptureCodes } from './autopilot-commands.js';
import { readCaptureCodes as defaultReadCaptureCodes } from './capture-codes.js';

export interface CreateAutopilotTxOpts {
  driver: WireDriver;
  /** Override for tests — defaults to reading the file on each sendCommand. */
  readCaptureCodes?: () => Promise<CaptureCodes>;
}

/**
 * Constructs an AutopilotTx that sends PGN 130850 frames via the given
 * WireDriver. Reads the capture-codes file on every call (cheap; small JSON).
 * Single-in-flight serialization prevents interleaved Fast Packet sequences.
 */
export function createAutopilotTx(opts: CreateAutopilotTxOpts): AutopilotTx {
  const read = opts.readCaptureCodes ?? (() => defaultReadCaptureCodes());
  let inflight: Promise<unknown> = Promise.resolve();

  async function send(req: AutopilotCommandRequest): Promise<AutopilotCommandResult> {
    const captureCodes = await read();
    const resolved = resolveCommand(req.event, captureCodes);
    if (!resolved.ok) {
      return {
        ok: false,
        error: {
          kind: resolved.kind,
          message: resolved.message,
        },
      };
    }
    const t0 = Date.now();
    try {
      await opts.driver.txPgn({
        pgn: 130850,
        prio: 3,
        dst: 255,
        fields: resolved.fields,
      });
      return { ok: true, txMs: Date.now() - t0 };
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: 'tx_error',
          message: (e as Error).message,
        },
      };
    }
  }

  return {
    sendCommand: (req) => {
      const next = inflight.then(() => send(req));
      // Keep the chain alive but don't propagate rejection — each call returns its own result.
      inflight = next.catch(() => undefined);
      return next;
    },
  };
}

/**
 * Boot-time helper. Registers the AutopilotTx singleton only when the
 * G5000_ENABLE_AP_TX env var is set to the literal string "1". On the Pi
 * the variable is unset; the singleton stays undefined and every API
 * route call returns 503.
 */
export function registerAutopilotTxIfEnabled(driver: WireDriver): void {
  if (process.env.G5000_ENABLE_AP_TX !== '1') {
    console.log('[autopilot-tx] disabled (G5000_ENABLE_AP_TX != "1")');
    return;
  }
  setSharedAutopilotTx(createAutopilotTx({ driver }));
  console.log('[autopilot-tx] enabled — AP commands ARE transmitted to the live bus');
}
