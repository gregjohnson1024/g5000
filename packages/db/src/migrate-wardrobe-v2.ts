import {
  DEFAULT_POLARS,
  type BoatId,
  type PolarRevision,
  type PolarTable,
  type SailConfig,
  type SailWardrobe,
} from './defaults.js';

/**
 * Heuristic: a wardrobe is "v1" if any config has an embedded `polar` field
 * OR lacks a `modes` field. A pure v2 wardrobe has `modes` populated on every
 * config and no `polar` on any of them.
 */
export function isV1Wardrobe(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const w = raw as { configs?: Array<Record<string, unknown>> };
  if (!Array.isArray(w.configs)) return false;
  for (const cfg of w.configs) {
    if (!cfg || typeof cfg !== 'object') continue;
    if ('polar' in cfg && cfg.polar !== undefined) return true;
    if (!('modes' in cfg) || cfg.modes === undefined) return true;
  }
  return false;
}

export interface MigrateOutput {
  v2: SailWardrobe;
  revisions: PolarRevision[];
}

/**
 * Pure transform from a v1 (or already-v2) wardrobe to a v2 wardrobe plus
 * any new revision rows to insert. Deterministic given `idGen` and `now`.
 *
 * Callers are responsible for persisting the result inside a SQLite
 * transaction so an interrupted migration doesn't leave half-written state.
 */
export function migrateWardrobeV1ToV2(
  raw: unknown,
  boatId: BoatId,
  now: number,
  idGen: () => string,
  fallbackPolar: PolarTable = DEFAULT_POLARS,
): MigrateOutput {
  // Already v2? Return as-is. We trust the caller's earlier shape check, but
  // also coerce defensively so old v1 reads can't poison the resolver.
  if (!isV1Wardrobe(raw)) {
    return { v2: raw as SailWardrobe, revisions: [] };
  }

  const v1 = raw as {
    configs: Array<Partial<SailConfig> & { polar?: PolarTable }>;
    activeConfigId?: string;
  };

  const revisions: PolarRevision[] = [];
  const v2Configs: SailConfig[] = v1.configs.map((cfg) => {
    const table = cfg.polar ?? fallbackPolar;
    const revId = idGen();
    const sailConfigId = cfg.id ?? 'default';
    revisions.push({
      id: revId,
      boatId,
      sailConfigId,
      mode: 'default',
      parentRevisionId: null,
      createdAt: now,
      lineage: { kind: 'migrated', notes: 'auto-migrated from v1 wardrobe' },
      table,
    });
    // Strip embedded `polar`; keep all other fields.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { polar: _ignored, ...rest } = cfg;
    return {
      ...(rest as SailConfig),
      id: sailConfigId,
      name: cfg.name ?? sailConfigId,
      modes: { default: { activeRevisionId: revId } },
    };
  });

  const activeConfigId = v1.activeConfigId ?? v2Configs[0]?.id ?? 'default';

  const v2: SailWardrobe = {
    boatId,
    configs: v2Configs,
    activeConfigId,
    activeMode: 'default',
  };

  return { v2, revisions };
}
