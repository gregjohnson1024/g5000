import { SAIL_GRID_TWS_BINS, SAIL_GRID_TWA_BINS, snapToFixedGrid, cellKey } from '@g5000/core';
import type { PolarMode, BoatId, PolarTable } from './defaults.js';
import type { Sail, SailWardrobe } from './defaults.js';

/** v2 SailWardrobe shape, frozen here for the migrator. */
export interface V2SailConfig {
  id: string;
  name: string;
  mainState?: string;
  headsail?: string;
  downwindSail?: string;
  modes?: Partial<Record<PolarMode, { activeRevisionId: string }>>;
}

export interface V2Wardrobe {
  boatId: BoatId;
  configs: V2SailConfig[];
  activeConfigId: string;
  activeMode: PolarMode;
}

interface V2CrossoverMap {
  boatId: BoatId;
  mode: PolarMode;
  cells: Record<string, string>;
  updatedAt: number;
}

function isV3(input: unknown): input is SailWardrobe {
  return (
    !!input &&
    typeof input === 'object' &&
    (input as { schemaVersion?: number }).schemaVersion === 3
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "Full" / "Full main" → 'full-main'; "Reef1" → 'reef1'; "Reef 2" → 'reef2' */
function mainStateToSail(state: string): { id: string; name: string } {
  const normalized = state.trim();
  const lower = normalized.toLowerCase();
  if (lower === 'full' || lower === 'full main' || lower === 'fullmain') {
    return { id: 'full-main', name: 'Full Main' };
  }
  return { id: slug(normalized), name: normalized };
}

export function migrateWardrobeV2toV3(
  input: V2Wardrobe | SailWardrobe,
  map: V2CrossoverMap | null,
  activePolar: PolarTable,
): SailWardrobe {
  if (isV3(input)) return input;

  const v2 = input as V2Wardrobe;
  const configToSails = new Map<string, string[]>();
  const byId = new Map<string, Sail>();

  for (const cfg of v2.configs) {
    const sailIds: string[] = [];
    if (cfg.headsail) {
      const id = slug(cfg.headsail);
      if (!byId.has(id)) {
        byId.set(id, { id, name: cfg.headsail, category: 'headsail', region: { cells: [] } });
      }
      sailIds.push(id);
    }
    if (cfg.mainState) {
      const { id, name } = mainStateToSail(cfg.mainState);
      if (!byId.has(id)) {
        byId.set(id, { id, name, category: 'main', region: { cells: [] } });
      }
      sailIds.push(id);
    }
    if (cfg.downwindSail) {
      const id = slug(cfg.downwindSail);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: cfg.downwindSail,
          category: 'downwind',
          region: { cells: [] },
        });
      }
      sailIds.push(id);
    }
    configToSails.set(cfg.id, sailIds);
  }

  // Remap painted cells: polar (twsIdx, twaIdx) → fixed-grid cell
  if (map) {
    for (const [polarKey, configId] of Object.entries(map.cells)) {
      const [pTwsStr, pTwaStr] = polarKey.split(',');
      const pTws = Number(pTwsStr);
      const pTwa = Number(pTwaStr);
      const twsMs = activePolar.twsBins[pTws];
      const twaRad = activePolar.twaBins[pTwa];
      if (twsMs === undefined || twaRad === undefined) continue;
      const fixed = snapToFixedGrid({ twsMs, twaRad });
      const key = cellKey(fixed);
      const sailIds = configToSails.get(configId) ?? [];
      for (const sailId of sailIds) {
        const sail = byId.get(sailId);
        if (!sail) continue;
        if (!sail.region.cells.includes(key)) sail.region.cells.push(key);
      }
    }
  }

  // Sort cells lexically per sail for deterministic output
  for (const sail of byId.values()) {
    sail.region.cells.sort();
  }

  const activeCfg = v2.configs.find((c) => c.id === v2.activeConfigId);
  const active: SailWardrobe['active'] = {};
  if (activeCfg) {
    if (activeCfg.headsail) active.headsail = slug(activeCfg.headsail);
    if (activeCfg.mainState) active.main = mainStateToSail(activeCfg.mainState).id;
    if (activeCfg.downwindSail) active.downwind = slug(activeCfg.downwindSail);
  }

  return {
    schemaVersion: 3,
    boatId: v2.boatId,
    sails: Array.from(byId.values()),
    active,
    activeMode: v2.activeMode,
  };
}

/** Recognises legacy SAIL_GRID bounds for guards elsewhere. */
export const FIXED_GRID_BOUNDS = {
  twsBins: SAIL_GRID_TWS_BINS,
  twaBins: SAIL_GRID_TWA_BINS,
};
