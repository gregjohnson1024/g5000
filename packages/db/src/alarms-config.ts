import { eq } from 'drizzle-orm';
import type { ConfigStore } from './config-store.js';
import { alarmsConfig } from './schema.js';

export interface AnchorThreshold {
  armed: boolean;
  point?: { lat: number; lon: number };
  droppedAt?: string; // ISO
  radiusM: number;
}

export interface ScalarThreshold {
  thresholdM?: number;
  thresholdKn?: number;
  thresholdV?: number;
  holdMs: number;
}

export interface AlarmsConfig {
  enabled: Record<string, boolean>;
  thresholds: {
    anchor: AnchorThreshold;
    shallowWater: ScalarThreshold;
    overSpeed: ScalarThreshold;
    lowBattery: ScalarThreshold;
  };
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
  },
  thresholds: {
    anchor: { armed: false, radiusM: 50 },
    shallowWater: { thresholdM: 3, holdMs: 5000 },
    overSpeed: { thresholdKn: 12, holdMs: 5000 },
    lowBattery: { thresholdV: 11.8, holdMs: 5000 },
  },
};

/** Threshold keys that a complete AlarmsConfig.thresholds block must carry. */
const REQUIRED_THRESHOLD_KEYS = [
  'anchor',
  'shallowWater',
  'overSpeed',
  'lowBattery',
] as const satisfies ReadonlyArray<keyof AlarmsConfig['thresholds']>;

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
  return REQUIRED_THRESHOLD_KEYS.every(
    (k) => typeof thresholds[k] === 'object' && thresholds[k] !== null,
  );
}

const ID = 'singleton';

export async function loadAlarmsConfig(store: ConfigStore): Promise<AlarmsConfig> {
  const db = store.drizzle;
  const row = await db.select().from(alarmsConfig).where(eq(alarmsConfig.id, ID)).get();
  if (!row) return DEFAULT_ALARMS_CONFIG;
  try {
    const stored = JSON.parse(row.value) as AlarmsConfig;
    // Backfill enabled flags for alarm ids added after this config was saved
    // (e.g. 'ais-cpa') — otherwise a pre-existing row reads undefined => falsy
    // and the new alarm is silently disabled. Stored values still win.
    return { ...stored, enabled: { ...DEFAULT_ALARMS_CONFIG.enabled, ...stored.enabled } };
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
