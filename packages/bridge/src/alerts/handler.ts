import type { AlertType, AlertState, AlertSnapshot } from '@g5000/core';
import type { DecodedPgn } from '../decoder.js';
import { createAlertsRegistry, alertKey } from './registry.js';

/**
 * Decodes PGN 126983 (Alert) and 126985 (Alert Text Description) into the
 * shared alerts registry. Wire this into the bridge alongside the AIS
 * handler — both are stateful registries (vs. the channel-mapper which
 * produces bus samples).
 */
export function handleAlertPgn(pgn: DecodedPgn): void {
  if (pgn.pgn !== 126983 && pgn.pgn !== 126985) return;
  const f = pgn.fields;
  const num = (k: string): number | undefined => {
    const v = f[k];
    return typeof v === 'number' ? v : undefined;
  };
  const str = (k: string): string | undefined => {
    const v = f[k];
    return typeof v === 'string' ? v : undefined;
  };

  const system = num('Alert System') ?? 0;
  const subSystem = num('Alert Sub-System') ?? 0;
  const alertId = num('Alert ID') ?? 0;
  const occurrenceNumber = num('Alert Occurrence Number') ?? 0;
  const key = alertKey({ src: pgn.src, system, subSystem, alertId, occurrenceNumber });

  const registry = createAlertsRegistry();
  const now = Date.now();

  if (pgn.pgn === 126983) {
    // Full alert state update.
    registry.upsert({
      key,
      src: pgn.src,
      type: (str('Alert Type') as AlertType) ?? 'unknown',
      category: str('Alert Category'),
      system,
      subSystem,
      alertId,
      occurrenceNumber,
      dataSourceNetworkIdName: num('Data Source Network ID NAME'),
      dataSourceInstance: num('Data Source Instance'),
      dataSourceIndexSource: num('Data Source Index-Source'),
      ackSourceNetworkIdName: num('Acknowledge Source Network ID NAME'),
      state: (str('Alert State') as AlertState) ?? 'unknown',
      ackStatus: str('Acknowledge Status'),
      silenceStatus: str('Temporary Silence Status'),
      escalationStatus: str('Escalation Status'),
      acknowledgeSupport: str('Acknowledge Support') === 'Yes',
      temporarySilenceSupport: str('Temporary Silence Support') === 'Yes',
      escalationSupport: str('Escalation Support') === 'Yes',
      triggerCondition: str('Trigger Condition'),
      thresholdStatus: str('Threshold Status'),
      priority: num('Alert Priority'),
      lastSeenMs: now,
    } satisfies Partial<AlertSnapshot> & { key: string; src: number; lastSeenMs: number });
  } else {
    // 126985 — text description. Match on the same composite key.
    registry.upsert({
      key,
      src: pgn.src,
      system,
      subSystem,
      alertId,
      occurrenceNumber,
      text: str('Alert Text Description'),
      location: str('Alert Location Text Description'),
      lastSeenMs: now,
    } satisfies Partial<AlertSnapshot> & { key: string; src: number; lastSeenMs: number });
  }
}
