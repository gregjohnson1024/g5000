import {
  setSharedAlerts,
  getSharedAlerts,
  type AlertSnapshot,
  type AlertsRegistry,
  type AlertAcknowledgeRequest,
} from '@g5000/core';
import type { OutgoingPgn } from '../wire-driver.js';

/**
 * Singleton alerts registry. Same idempotent pattern as the AIS registry —
 * the bridge decoder writes, web routes read; the registered TX callback
 * (set later via `setAlertTxer`) sends Alert Response (PGN 126984) when
 * the UI clicks Acknowledge.
 */
export function createAlertsRegistry(): AlertsRegistry & {
  setTxer: (fn: ((pgn: OutgoingPgn) => Promise<void>) | null) => void;
} {
  const existing = getSharedAlerts() as
    | (AlertsRegistry & { setTxer: (fn: ((pgn: OutgoingPgn) => Promise<void>) | null) => void })
    | undefined;
  if (existing && typeof existing.setTxer === 'function') return existing;

  const byKey = new Map<string, AlertSnapshot>();
  let txer: ((pgn: OutgoingPgn) => Promise<void>) | null = null;

  const registry: AlertsRegistry & {
    setTxer: (fn: ((pgn: OutgoingPgn) => Promise<void>) | null) => void;
  } = {
    all: () => Array.from(byKey.values()).sort((a, b) => b.lastSeenMs - a.lastSeenMs),
    get: (key) => byKey.get(key),
    upsert: (u) => {
      const prev = byKey.get(u.key);
      const merged: AlertSnapshot = {
        ...(prev ?? {
          key: u.key,
          src: u.src,
          type: 'unknown',
          system: 0,
          subSystem: 0,
          alertId: 0,
          occurrenceNumber: 0,
          state: 'unknown',
          lastSeenMs: 0,
        }),
        ...u,
      };
      byKey.set(u.key, merged);
    },
    evictStale: (maxAgeMs) => {
      const cutoff = Date.now() - maxAgeMs;
      let dropped = 0;
      for (const [k, a] of byKey) {
        if (a.lastSeenMs < cutoff) {
          byKey.delete(k);
          dropped += 1;
        }
      }
      return dropped;
    },
    clear: () => byKey.clear(),
    acknowledge: async (req: AlertAcknowledgeRequest) => {
      const snap = byKey.get(req.key);
      if (!snap) return { ok: false, error: 'unknown alert key' };
      if (!txer) return { ok: false, error: 'no alert transmitter registered (live N2K not online?)' };
      try {
        // PGN 126984 — Alert Response. Echo the identifying fields from
        // the active alert; the issuer matches by these tuples and
        // updates its internal state, then re-emits 126983 with the new
        // Acknowledge Status. We don't optimistically update local
        // state — let the issuer's re-emission flow through the decoder.
        await txer({
          pgn: 126984,
          prio: 2,
          dst: snap.src,
          fields: {
            'Alert Type': snap.type,
            'Alert Category': snap.category ?? 'Navigational',
            'Alert System': snap.system,
            'Alert Sub-System': snap.subSystem,
            'Alert ID': snap.alertId,
            'Data Source Network ID NAME': snap.dataSourceNetworkIdName ?? 0,
            'Data Source Instance': snap.dataSourceInstance ?? 0,
            'Data Source Index-Source': snap.dataSourceIndexSource ?? 0,
            'Alert Occurrence Number': snap.occurrenceNumber,
            'Acknowledge Source Network ID NAME': snap.ackSourceNetworkIdName ?? 0,
            'Response Command': req.command,
          },
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    setTxer: (fn) => {
      txer = fn;
    },
  };
  setSharedAlerts(registry);
  return registry;
}

export function alertKey(parts: {
  src: number;
  system: number;
  subSystem: number;
  alertId: number;
  occurrenceNumber: number;
}): string {
  return `${parts.src}|${parts.system}|${parts.subSystem}|${parts.alertId}|${parts.occurrenceNumber}`;
}
