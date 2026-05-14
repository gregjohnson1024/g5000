/**
 * Shared types + globalThis-backed accessor for the N2K alarms registry.
 *
 * Tracks alerts decoded from PGN 126983 (Alert) and enriched with text
 * from PGN 126985 (Alert Text Description). Same singleton pattern as
 * Bus / ConfigStore / DeviceRegistry / AisTargets: the bridge writes,
 * web routes read.
 *
 * Acknowledgement goes the other way — the web posts to /api/alerts and
 * the bridge sends PGN 126984 (Alert Response) onto the bus.
 */

export type AlertType =
  | 'Emergency Alarm'
  | 'Alarm'
  | 'Warning'
  | 'Caution'
  | 'unknown';

export type AlertState =
  | 'Disabled'
  | 'Normal'
  | 'Active'
  | 'Silenced'
  | 'Acknowledged'
  | 'Awaiting Acknowledge'
  | 'unknown';

export interface AlertSnapshot {
  /** Composite key: `src|system|subSystem|id|occurrence`. */
  key: string;
  /** N2K source address that issued the alert. */
  src: number;
  type: AlertType;
  category?: string;
  system: number;
  subSystem: number;
  alertId: number;
  occurrenceNumber: number;
  /** Identifies the actual data source that triggered the alarm. */
  dataSourceNetworkIdName?: number;
  dataSourceInstance?: number;
  dataSourceIndexSource?: number;
  /** Optional ack-source network ID NAME from the issuer's view. */
  ackSourceNetworkIdName?: number;
  state: AlertState;
  ackStatus?: string;
  silenceStatus?: string;
  escalationStatus?: string;
  acknowledgeSupport?: boolean;
  temporarySilenceSupport?: boolean;
  escalationSupport?: boolean;
  triggerCondition?: string;
  thresholdStatus?: string;
  priority?: number;
  /** Free-form description text from PGN 126985, if received. */
  text?: string;
  /** Optional location description from PGN 126985. */
  location?: string;
  /** Wall-clock ms of the most recent 126983 or 126985 for this alert. */
  lastSeenMs: number;
}

export interface AlertAcknowledgeRequest {
  key: string;
  command: 'Acknowledge' | 'Temporary Silence' | 'Test Command Off' | 'Test Command On';
}

export interface AlertsRegistry {
  /** All currently-tracked alerts (active + recently-resolved per `evictStale`). */
  all(): AlertSnapshot[];
  /** Single alert lookup by key. */
  get(key: string): AlertSnapshot | undefined;
  /** Merge an update from a decoded 126983 / 126985 PGN. */
  upsert(update: Partial<AlertSnapshot> & { key: string; src: number; lastSeenMs: number }): void;
  /** Drop alerts whose lastSeenMs is older than `maxAgeMs`. Returns count dropped. */
  evictStale(maxAgeMs: number): number;
  /** Drop everything (for tests). */
  clear(): void;
  /** Send an Alert Response via a registered transmitter; null if none. */
  acknowledge?(req: AlertAcknowledgeRequest): Promise<{ ok: boolean; error?: string }>;
}

declare const globalThis: { __g5000_alerts__?: AlertsRegistry };

export function getSharedAlerts(): AlertsRegistry | undefined {
  return globalThis.__g5000_alerts__;
}

export function setSharedAlerts(r: AlertsRegistry): void {
  globalThis.__g5000_alerts__ = r;
}

export function _resetAlertsForTests(): void {
  globalThis.__g5000_alerts__ = undefined;
}
