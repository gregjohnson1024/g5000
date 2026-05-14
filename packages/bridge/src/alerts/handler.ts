import type { AlertType, AlertState, AlertSnapshot } from '@g5000/core';
import type { DecodedPgn } from '../decoder.js';
import { createAlertsRegistry, alertKey } from './registry.js';

/**
 * Standard SIMNET_AP_EVENTS lookup values from canboatjs's pgns.json.
 * Any Event ID OUTSIDE this set on PGN 130850 we treat as an
 * undocumented Navico alarm event — the H5000/Zeus chain repeats
 * these at ~2 Hz while an alarm is active, and the canonical
 * 126983/126985 path isn't used at all by B&G gear.
 *
 * The actual alarm cause ("rudder data missing", "low battery", etc.)
 * isn't in the Event ID alone — it's encoded in the surrounding
 * 130824 / 130842 / 130845 key-value frames. For now we surface the
 * raw event so the helmsman at least sees "Navico AP event N" in the
 * UI and can correlate with whatever the MFD is beeping about.
 * Future work: extend by capturing each known event for its cause.
 */
const STANDARD_AP_EVENTS = new Set<number>([
  6, 9, 10, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24, 26, 61, 112, 113,
]);

/**
 * Decodes PGN 126983 (Alert), 126985 (Alert Text Description) and the
 * Navico-proprietary PGN 130850 "Simnet: Event Command: AP command"
 * into the shared alerts registry. Wire this into the bridge alongside
 * the AIS handler — both are stateful registries (vs. the
 * channel-mapper which produces bus samples).
 */
export function handleAlertPgn(pgn: DecodedPgn): void {
  if (pgn.pgn === 130850) {
    handleNavicoApEvent(pgn);
    return;
  }
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

/**
 * Handle PGN 130850 "Simnet: Event Command: AP command". canboatjs decodes
 * the Event field; values OUTSIDE the standard SIMNET_AP_EVENTS lookup
 * (commands like Standby/Auto/Wind/turns) are interpreted as alarm
 * indicators since the H5000/Zeus chain emits them only while the
 * MFD's audible alarm is active.
 *
 * The "alert" is synthesized — we have no real PGN 126983 from this
 * gear, so the snapshot's Alert ID is the canboatjs Event number,
 * giving each distinct alarm code its own registry entry. The "Clear"
 * button does NOT send a 126984 response (the issuer doesn't speak
 * that protocol); pressing it removes the local snapshot so the UI
 * panel clears, but the MFD will keep beeping until you silence it
 * there. The snapshot will re-appear within ~500 ms if the underlying
 * condition is still firing.
 */
function handleNavicoApEvent(pgn: DecodedPgn): void {
  const event = pgn.fields['Event'];
  if (typeof event !== 'number') return;
  if (STANDARD_AP_EVENTS.has(event)) return; // a normal command, not an alarm

  const registry = createAlertsRegistry();
  // One key per (src, event) — keep distinct event codes as separate
  // registry rows even when they fire from the same MFD.
  const key = alertKey({
    src: pgn.src,
    system: 130850,
    subSystem: 0,
    alertId: event,
    occurrenceNumber: 0,
  });
  registry.upsert({
    key,
    src: pgn.src,
    type: 'Warning',
    system: 130850,
    subSystem: 0,
    alertId: event,
    occurrenceNumber: 0,
    state: 'Active',
    acknowledgeSupport: false, // Navico doesn't speak Alert Response — see comment above
    text: `Navico AP event ${event} (undocumented Simnet alarm code)`,
    lastSeenMs: Date.now(),
  });
}
