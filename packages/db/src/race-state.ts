import { eq } from 'drizzle-orm';
import { defaultRaceStateConfig, type RaceStateConfig } from '@g5000/core';
import type { ConfigStore } from './config-store.js';
import { raceState } from './schema.js';

export const DEFAULT_RACE_STATE: RaceStateConfig = defaultRaceStateConfig();

const ID = 'singleton';

function mergeDefaults(loaded: Partial<RaceStateConfig>): RaceStateConfig {
  const def = defaultRaceStateConfig();
  return {
    timer: { ...def.timer, ...(loaded.timer ?? {}) },
    line: { ...def.line, ...(loaded.line ?? {}) },
    activeMarkWaypointId: loaded.activeMarkWaypointId,
    settings: { ...def.settings, ...(loaded.settings ?? {}) },
  };
}

export async function loadRaceState(store: ConfigStore): Promise<RaceStateConfig> {
  const db = store.drizzle;
  const row = await db.select().from(raceState).where(eq(raceState.id, ID)).get();
  if (!row) return defaultRaceStateConfig();
  try {
    const parsed = JSON.parse(row.value) as Partial<RaceStateConfig>;
    return mergeDefaults(parsed);
  } catch {
    return defaultRaceStateConfig();
  }
}

export async function saveRaceState(store: ConfigStore, cfg: RaceStateConfig): Promise<void> {
  const db = store.drizzle;
  const value = JSON.stringify(cfg);
  await db
    .insert(raceState)
    .values({ id: ID, value })
    .onConflictDoUpdate({ target: raceState.id, set: { value } })
    .run();
}
