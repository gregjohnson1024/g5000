import { eq } from 'drizzle-orm';
import type { ConfigStore } from './config-store.js';
import { alarmsConfig } from './schema.js';

export interface AnchorThreshold {
  armed: boolean;
  /** Boat position when the drop command was issued. */
  point?: { lat: number; lon: number };
  droppedAt?: string; // ISO
  radiusM: number;
  /**
   * Resolved actual anchor position — the drop position projected by
   * offsetM/offsetBearingDeg when an offset was given, else the drop position
   * itself. Consumers fall back to `point` when absent (pre-v2 configs).
   */
  anchorPoint?: { lat: number; lon: number };
  /** Distance from the drop position to the actual anchor, metres. */
  offsetM?: number;
  /** Bearing from the drop position to the actual anchor, degrees true. */
  offsetBearingDeg?: number;
  /** Watch sector width in degrees (default 360 = full circle). */
  coneDeg?: number;
  /** Sector centre bearing as seen from the anchor, degrees true. */
  coneCenterDeg?: number;
  /** Seconds an unacked WARN breach persists before escalating to sticky CRITICAL (default 30). */
  escalateAfterS?: number;
}

export interface ScalarThreshold {
  thresholdM?: number;
  thresholdKn?: number;
  thresholdV?: number;
  holdMs: number;
}

/**
 * ntfy push destination. Config wins over the legacy G5000_NTFY_TOPIC /
 * G5000_NTFY_URL env vars — env is consulted only when these are null/blank.
 */
export interface PushConfig {
  /** ntfy topic name — effectively a shared secret. Null = not configured. */
  ntfyTopic: string | null;
  /** ntfy server base URL. Null = default (https://ntfy.sh). */
  ntfyUrl: string | null;
}

export interface AlarmsConfig {
  enabled: Record<string, boolean>;
  thresholds: {
    anchor: AnchorThreshold;
    shallowWater: ScalarThreshold;
    overSpeed: ScalarThreshold;
    lowBattery: ScalarThreshold;
    highWind: ScalarThreshold;
  };
  push: PushConfig;
}

export const DEFAULT_ALARMS_CONFIG: AlarmsConfig = {
  enabled: {
    mob: true,
    'anchor-watch': true,
    'shallow-water': true,
    'over-speed': true,
    'low-battery': true,
    // CPA/TCPA collision monitor. Thresholds live in AisAlarmConfig (single
    // source of truth shared with the /ais page) — only the gate lives here.
    'ais-cpa': true,
    // Off by default: demo-mode synthetic wind would false-alarm; opt in on /alerts.
    'high-wind': false,
  },
  thresholds: {
    anchor: { armed: false, radiusM: 50 },
    shallowWater: { thresholdM: 3, holdMs: 5000 },
    overSpeed: { thresholdKn: 12, holdMs: 5000 },
    lowBattery: { thresholdV: 11.8, holdMs: 5000 },
    highWind: { thresholdKn: 30, holdMs: 60000 },
  },
  push: { ntfyTopic: null, ntfyUrl: null },
};

/** Threshold keys that a complete AlarmsConfig.thresholds block must carry. */
const REQUIRED_THRESHOLD_KEYS = [
  'anchor',
  'shallowWater',
  'overSpeed',
  'lowBattery',
  'highWind',
] as const satisfies ReadonlyArray<keyof AlarmsConfig['thresholds']>;

/** ntfy topic charset: URL-path-safe, no separators — it doubles as a secret. */
export const NTFY_TOPIC_PATTERN = /^[-_A-Za-z0-9]{1,64}$/;

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Runtime shape check for an AlarmsConfig coming off the wire (e.g. PUT
 * /api/alarms/config). The structural `as AlarmsConfig` cast at the route
 * boundary is a lie — without this guard a malformed or empty `{}` payload
 * silently replaces the live config, leaving every predicate to read
 * `cfg.enabled[ID]` as undefined => falsy => silently disabled. The failure is
 * invisible until an alarm doesn't fire when it should. Validate, reject loudly.
 *
 * Intentionally shallow: it confirms the two top-level blocks exist with the
 * right primitive shapes, not that every threshold's numbers are sane. The
 * point is to reject garbage, not to re-type the whole tree.
 */
export function isAlarmsConfig(v: unknown): v is AlarmsConfig {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Record<string, unknown>;

  // enabled: a map of id -> boolean.
  if (typeof x.enabled !== 'object' || x.enabled === null) return false;
  const enabled = x.enabled as Record<string, unknown>;
  if (!Object.values(enabled).every((b) => typeof b === 'boolean')) return false;

  // thresholds: an object carrying every required sub-block as an object.
  if (typeof x.thresholds !== 'object' || x.thresholds === null) return false;
  const thresholds = x.thresholds as Record<string, unknown>;
  if (
    !REQUIRED_THRESHOLD_KEYS.every(
      (k) => typeof thresholds[k] === 'object' && thresholds[k] !== null,
    )
  ) {
    return false;
  }

  // push: optional on the wire (pre-push configs / older clients — loadAlarmsConfig
  // backfills it), but when present its fields must be null or valid.
  if (x.push !== undefined) {
    if (typeof x.push !== 'object' || x.push === null) return false;
    const push = x.push as Record<string, unknown>;
    const topicOk =
      push.ntfyTopic === null ||
      push.ntfyTopic === undefined ||
      (typeof push.ntfyTopic === 'string' && NTFY_TOPIC_PATTERN.test(push.ntfyTopic));
    const urlOk =
      push.ntfyUrl === null ||
      push.ntfyUrl === undefined ||
      (typeof push.ntfyUrl === 'string' && isValidHttpUrl(push.ntfyUrl));
    if (!topicOk || !urlOk) return false;
  }
  return true;
}

const ID = 'singleton';

export async function loadAlarmsConfig(store: ConfigStore): Promise<AlarmsConfig> {
  const db = store.drizzle;
  const row = await db.select().from(alarmsConfig).where(eq(alarmsConfig.id, ID)).get();
  if (!row) return DEFAULT_ALARMS_CONFIG;
  try {
    const stored = JSON.parse(row.value) as AlarmsConfig;
    // Backfill every top-level block for keys added after this config was saved
    // (e.g. 'ais-cpa', thresholds.highWind, the push block) — otherwise a
    // pre-existing row reads undefined and the new alarm is silently disabled
    // (or a predicate crashes on a missing threshold). Stored values still win.
    return {
      ...stored,
      enabled: { ...DEFAULT_ALARMS_CONFIG.enabled, ...stored.enabled },
      thresholds: { ...DEFAULT_ALARMS_CONFIG.thresholds, ...stored.thresholds },
      push: { ...DEFAULT_ALARMS_CONFIG.push, ...stored.push },
    };
  } catch {
    return DEFAULT_ALARMS_CONFIG;
  }
}

export async function saveAlarmsConfig(store: ConfigStore, cfg: AlarmsConfig): Promise<void> {
  const db = store.drizzle;
  const value = JSON.stringify(cfg);
  await db
    .insert(alarmsConfig)
    .values({ id: ID, value })
    .onConflictDoUpdate({ target: alarmsConfig.id, set: { value } })
    .run();
}
