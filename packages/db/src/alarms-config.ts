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
  },
  thresholds: {
    anchor: { armed: false, radiusM: 50 },
    shallowWater: { thresholdM: 3, holdMs: 5000 },
    overSpeed: { thresholdKn: 12, holdMs: 5000 },
    lowBattery: { thresholdV: 11.8, holdMs: 5000 },
  },
};

const ID = 'singleton';

export async function loadAlarmsConfig(store: ConfigStore): Promise<AlarmsConfig> {
  const db = store.drizzle;
  const row = await db.select().from(alarmsConfig).where(eq(alarmsConfig.id, ID)).get();
  if (!row) return DEFAULT_ALARMS_CONFIG;
  try {
    return JSON.parse(row.value) as AlarmsConfig;
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
