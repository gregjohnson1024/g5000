import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { BehaviorSubject, combineLatest, type Observable, map } from 'rxjs';
import { ulid } from 'ulid';
import {
  DEFAULT_AIS_ALARM_CONFIG,
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_BOAT_CONFIG,
  DEFAULT_BSP_CAL,
  DEFAULT_COMPASS_DEVIATION,
  DEFAULT_DAMPING_CONFIG,
  DEFAULT_POLARS,
  DEFAULT_SOURCE_PRIORITY,
  type AisAlarmConfig,
  type AwsAwaCalTable,
  type BoatConfig,
  type BoatId,
  type BspCal,
  type CompassDeviation,
  type DampingConfig,
  type PassageLog,
  type PolarMode,
  type PolarRevision,
  type PolarTable,
  type SailWardrobe,
  type SourcePriorityConfig,
} from './defaults.js';
import {
  aisAlarmConfig as aisAlarmConfigTable,
  awsAwaCal,
  bspCal,
  boatConfig as boatConfigTable,
  compassDeviation,
  dampingConfig as dampingConfigTable,
  passageLog as passageLogTable,
  polars,
  sailWardrobe,
  sourcePriorityConfig as sourcePriorityConfigTable,
} from './schema.js';
import {
  insertRevision,
  listRevisions as listRevisionsRepo,
  getRevision as getRevisionRepo,
  type ListFilter,
} from './polar-revisions.js';
import { migrateWardrobeV1ToV2 } from './migrate-wardrobe-v2.js';

const __warnedMissingRevisions = new Set<string>();

const SINGLETON = 'singleton';

/**
 * Opens (and migrates as needed) an SQLite-backed config store. Each cal
 * kind exposes a BehaviorSubject-style observable. Setters write through
 * to SQLite *and* emit on the observable, so subscribers see hot reloads
 * without polling.
 */
export class ConfigStore {
  private readonly subjects: {
    boatConfig: BehaviorSubject<BoatConfig>;
    awsAwaCal: BehaviorSubject<AwsAwaCalTable>;
    bspCal: BehaviorSubject<BspCal>;
    compassDeviation: BehaviorSubject<CompassDeviation>;
    sails: BehaviorSubject<SailWardrobe>;
    dampingConfig: BehaviorSubject<DampingConfig>;
    sourcePriority: BehaviorSubject<SourcePriorityConfig>;
    aisAlarm: BehaviorSubject<AisAlarmConfig>;
    passageLog: BehaviorSubject<PassageLog>;
    polarRevisions: BehaviorSubject<Map<string, PolarRevision>>;
  };

  private readonly __activeBoatId: BoatId;

  /** The active boat id this process is bound to (G5000_BOAT_ID env var, default 'sula'). */
  get activeBoatId(): BoatId {
    return this.__activeBoatId;
  }

  private constructor(
    private readonly raw: Database.Database,
    private readonly db: BetterSQLite3Database,
    initial: {
      boatConfig: BoatConfig;
      awsAwaCal: AwsAwaCalTable;
      bspCal: BspCal;
      compassDeviation: CompassDeviation;
      sails: SailWardrobe;
      dampingConfig: DampingConfig;
      sourcePriority: SourcePriorityConfig;
      aisAlarm: AisAlarmConfig;
      passageLog: PassageLog;
      polarRevisions: Map<string, PolarRevision>;
    },
    activeBoatId: BoatId,
  ) {
    this.__activeBoatId = activeBoatId;
    this.subjects = {
      boatConfig: new BehaviorSubject(initial.boatConfig),
      awsAwaCal: new BehaviorSubject(initial.awsAwaCal),
      bspCal: new BehaviorSubject(initial.bspCal),
      compassDeviation: new BehaviorSubject(initial.compassDeviation),
      sails: new BehaviorSubject(initial.sails),
      dampingConfig: new BehaviorSubject(initial.dampingConfig),
      sourcePriority: new BehaviorSubject(initial.sourcePriority),
      aisAlarm: new BehaviorSubject(initial.aisAlarm),
      passageLog: new BehaviorSubject(initial.passageLog),
      polarRevisions: new BehaviorSubject(initial.polarRevisions),
    };
  }

  static async open(filePath: string): Promise<ConfigStore> {
    const raw = new Database(filePath);
    const db = drizzle(raw);

    // Create tables if they don't exist. Using exec for IF NOT EXISTS DDL
    // since drizzle-kit migrations are heavier than this Phase 0 needs.
    raw.exec(`
      CREATE TABLE IF NOT EXISTS boat_config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS aws_awa_cal (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bsp_cal (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS compass_deviation (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- DEPRECATED: legacy v1 singleton polar; read by migrator, then unused. Drop after v2 migration confirmed on Pi.
      CREATE TABLE IF NOT EXISTS polars (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sail_wardrobe (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS damping_config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_priority_config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ais_alarm_config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS passage_log (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS polar_revisions (
        id TEXT PRIMARY KEY,
        boat_id TEXT NOT NULL,
        sail_config_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        parent_revision_id TEXT,
        created_at INTEGER NOT NULL,
        lineage_kind TEXT NOT NULL,
        lineage_meta TEXT,
        sigma REAL,
        value_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS polar_revisions_lookup
        ON polar_revisions(boat_id, sail_config_id, mode, created_at DESC);
      CREATE TABLE IF NOT EXISTS alarms_config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alarms_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarm_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        fired_at TEXT NOT NULL,
        cleared_at TEXT,
        acked_at TEXT,
        context TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alarms_history_fired_at ON alarms_history (fired_at DESC);
      CREATE TABLE IF NOT EXISTS ship_log_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_ms INTEGER NOT NULL,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT,
        lat REAL,
        lon REAL,
        cog_deg REAL,
        sog_kn REAL,
        hdg_deg REAL,
        tws_kn REAL,
        twd_deg REAL,
        author TEXT,
        boat_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ship_log_entries_ts
        ON ship_log_entries (boat_id, ts_ms DESC);
    `);

    const activeBoatId: string = process.env.G5000_BOAT_ID ?? 'sula';

    // Helper: load JSON value for the singleton row, or insert default.
    // Using 'any' for the table parameter due to drizzle's complex generic
    // inference on union table types — see adaptation note in task report.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loadOrInsert = <T>(table: any, defaultValue: T): T => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const rows = db.select().from(table).where(eq(table.id, SINGLETON)).all();
      const row = rows[0];
      if (row) return JSON.parse((row as { value: string }).value) as T;
      db.insert(table)
        .values({ id: SINGLETON, value: JSON.stringify(defaultValue) })
        .run();
      return defaultValue;
    };

    // Migration logic for sail wardrobe:
    // 1. Load/seed the legacy polars row (legacy ingestion path).
    // 2. Read the wardrobe row (may be missing, v1, or v2).
    // 3. If v1 (or synthesized from legacy polar), run the pure migrator and
    //    persist wardrobe + new revisions in a single SQLite transaction.
    // DEPRECATED: legacy v1 read path; only the migrator consumes this. Drop after v2 confirmed on Pi.
    const legacyPolar = loadOrInsert<PolarTable>(polars, DEFAULT_POLARS);

    const wardrobeRows = db.select().from(sailWardrobe).where(eq(sailWardrobe.id, SINGLETON)).all();
    let rawWardrobe: unknown;
    if (wardrobeRows[0]) {
      rawWardrobe = JSON.parse((wardrobeRows[0] as { value: string }).value);
    } else {
      // No wardrobe row — synthesise a v1 wardrobe from the legacy polar so the
      // migrator produces a single revision-0 + v2 wardrobe in one pass.
      rawWardrobe = {
        configs: [
          {
            id: 'default',
            name: 'Default',
            notes: 'Initial baseline polar. Replace with your boat-specific data.',
            polar: legacyPolar,
          },
        ],
        activeConfigId: 'default',
      };
    }

    const migrated = migrateWardrobeV1ToV2(
      rawWardrobe,
      activeBoatId,
      Math.floor(Date.now() / 1000),
      () => ulid().toLowerCase(),
      legacyPolar,
    );

    if (migrated.revisions.length > 0) {
      // v1→v2 migration: write revisions + wardrobe atomically.
      raw.transaction(() => {
        for (const rev of migrated.revisions) {
          insertRevision(db, rev);
        }
        db.insert(sailWardrobe)
          .values({ id: SINGLETON, value: JSON.stringify(migrated.v2) })
          .onConflictDoUpdate({
            target: sailWardrobe.id,
            set: { value: JSON.stringify(migrated.v2) },
          })
          .run();
      })();
    }

    const wardrobeValue: SailWardrobe = migrated.v2;

    // Load all revisions for the active boat into the in-memory map.
    const revisionsForBoat = listRevisionsRepo(db, { boatId: activeBoatId });
    const revisionsMap = new Map<string, PolarRevision>(revisionsForBoat.map((r) => [r.id, r]));

    // Passage log: NOT a static default — anchor is seeded with the
    // current time on the first open so "the zero point is now" happens
    // automatically when this feature first ships. Subsequent restarts
    // preserve whatever anchor the user (or earlier seed) set.
    const passageRows = db
      .select()
      .from(passageLogTable)
      .where(eq(passageLogTable.id, SINGLETON))
      .all();
    let passageLogValue: PassageLog;
    if (passageRows[0]) {
      passageLogValue = JSON.parse((passageRows[0] as { value: string }).value) as PassageLog;
    } else {
      passageLogValue = { anchorAt: Math.floor(Date.now() / 1000) };
      db.insert(passageLogTable)
        .values({ id: SINGLETON, value: JSON.stringify(passageLogValue) })
        .run();
    }

    const initial = {
      boatConfig: loadOrInsert<BoatConfig>(boatConfigTable, DEFAULT_BOAT_CONFIG),
      awsAwaCal: loadOrInsert<AwsAwaCalTable>(awsAwaCal, DEFAULT_AWS_AWA_CAL),
      bspCal: loadOrInsert<BspCal>(bspCal, DEFAULT_BSP_CAL),
      compassDeviation: loadOrInsert<CompassDeviation>(compassDeviation, DEFAULT_COMPASS_DEVIATION),
      sails: wardrobeValue,
      dampingConfig: loadOrInsert<DampingConfig>(dampingConfigTable, DEFAULT_DAMPING_CONFIG),
      sourcePriority: loadOrInsert<SourcePriorityConfig>(
        sourcePriorityConfigTable,
        DEFAULT_SOURCE_PRIORITY,
      ),
      aisAlarm: loadOrInsert<AisAlarmConfig>(aisAlarmConfigTable, DEFAULT_AIS_ALARM_CONFIG),
      passageLog: passageLogValue,
      polarRevisions: revisionsMap,
    };

    return new ConfigStore(raw, db, initial, activeBoatId);
  }

  get boatConfig$(): Observable<BoatConfig> {
    return this.subjects.boatConfig.asObservable();
  }
  get awsAwaCal$(): Observable<AwsAwaCalTable> {
    return this.subjects.awsAwaCal.asObservable();
  }
  get bspCal$(): Observable<BspCal> {
    return this.subjects.bspCal.asObservable();
  }
  get compassDeviation$(): Observable<CompassDeviation> {
    return this.subjects.compassDeviation.asObservable();
  }
  get sails$(): Observable<SailWardrobe> {
    return this.subjects.sails.asObservable();
  }
  get dampingConfig$(): Observable<DampingConfig> {
    return this.subjects.dampingConfig.asObservable();
  }
  /**
   * Synchronous read of the current damping config. Used on the SSE / H-LINK
   * hot path to look up the per-channel time constant without subscribing on
   * every sample. Returns the live map by reference — callers MUST treat it
   * as read-only.
   */
  getDampingConfig(): DampingConfig {
    return this.subjects.dampingConfig.value;
  }
  get sourcePriority$(): Observable<SourcePriorityConfig> {
    return this.subjects.sourcePriority.asObservable();
  }
  /**
   * Synchronous read of the current source-priority config. Used on the hot
   * path by `subscribeSelected` so callers don't have to subscribe to the
   * observable on every sample. Returned array MUST be treated as read-only.
   */
  getSourcePriority(): SourcePriorityConfig {
    return this.subjects.sourcePriority.value;
  }
  get aisAlarmConfig$(): Observable<AisAlarmConfig> {
    return this.subjects.aisAlarm.asObservable();
  }
  /** Synchronous read of the current AIS alarm config (BehaviorSubject.value). */
  getAisAlarmConfig(): AisAlarmConfig {
    return this.subjects.aisAlarm.value;
  }
  get passageLog$(): Observable<PassageLog> {
    return this.subjects.passageLog.asObservable();
  }
  /** Synchronous read of the current passage log anchor. */
  getPassageLog(): PassageLog {
    return this.subjects.passageLog.value;
  }
  /**
   * Direct access to the underlying Drizzle instance for modules that need
   * to query tables not exposed through ConfigStore's BehaviorSubject API
   * (e.g. alarms-config, alarms-history). Treat as a power-user escape hatch.
   */
  get drizzle(): BetterSQLite3Database {
    return this.db;
  }
  /** Derived from sails$ + polarRevisions$ — resolves the active config's
   *  active-mode revision to its `PolarTable`. Falls back to DEFAULT_POLARS
   *  if the wardrobe has no active revisionId or if the pointer is dangling. */
  get activePolar$(): Observable<PolarTable> {
    return combineLatest([this.subjects.sails, this.subjects.polarRevisions]).pipe(
      map(([wardrobe, revisionsById]) => {
        const cfg = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId);
        const ref =
          cfg?.modes[wardrobe.activeMode]?.activeRevisionId ??
          cfg?.modes.default?.activeRevisionId;
        const rev = ref ? revisionsById.get(ref) : undefined;
        if (!ref) return DEFAULT_POLARS;
        if (!rev) {
          // Dangling pointer — warn once per ref; resolver feeds a hot pipeline.
          if (!__warnedMissingRevisions.has(ref)) {
            __warnedMissingRevisions.add(ref);
            console.warn(
              `[config-store] active revision ${ref} not found; falling back to DEFAULT_POLARS`,
            );
          }
          return DEFAULT_POLARS;
        }
        return rev.table;
      }),
    );
  }
  /** Observable of the current revisions map for the active boat. */
  get polarRevisions$(): Observable<Map<string, PolarRevision>> {
    return this.subjects.polarRevisions.asObservable();
  }
  /** Legacy alias — backed by activePolar$ for backward compatibility. */
  get polars$(): Observable<PolarTable> {
    return this.activePolar$;
  }

  async setBoatConfig(value: BoatConfig): Promise<void> {
    this.upsert(boatConfigTable, value);
    this.subjects.boatConfig.next(value);
  }
  async setAwsAwaCal(value: AwsAwaCalTable): Promise<void> {
    this.upsert(awsAwaCal, value);
    this.subjects.awsAwaCal.next(value);
  }
  async setBspCal(value: BspCal): Promise<void> {
    this.upsert(bspCal, value);
    this.subjects.bspCal.next(value);
  }
  async setCompassDeviation(value: CompassDeviation): Promise<void> {
    this.upsert(compassDeviation, value);
    this.subjects.compassDeviation.next(value);
  }
  async setSails(value: SailWardrobe): Promise<void> {
    for (const cfg of value.configs) {
      if (!cfg.modes || typeof cfg.modes !== 'object') {
        throw new Error(
          `sailConfig "${cfg.id}" missing required v2 'modes' field`,
        );
      }
    }
    const slot = value.configs.find((c) => c.id === value.activeConfigId);
    if (!slot) {
      throw new Error(
        `activeConfigId "${value.activeConfigId}" does not reference any config in configs[]`,
      );
    }
    this.upsert(sailWardrobe, value);
    this.subjects.sails.next(value);
  }
  async setSourcePriority(value: SourcePriorityConfig): Promise<void> {
    // Sanitise: drop entries that don't validate (missing fields, non-finite
    // freshness, empty sources). Keep order — order is priority.
    const cleaned: SourcePriorityConfig = [];
    for (const rule of value) {
      if (!rule || typeof rule !== 'object') continue;
      if (typeof rule.channelPattern !== 'string' || rule.channelPattern.length === 0) continue;
      if (!Array.isArray(rule.sources)) continue;
      const sources = rule.sources.filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (sources.length === 0) continue;
      if (typeof rule.freshnessSeconds !== 'number' || !Number.isFinite(rule.freshnessSeconds)) continue;
      if (rule.freshnessSeconds <= 0) continue;
      const blocked = Array.isArray(rule.blocked)
        ? rule.blocked.filter((s): s is string => typeof s === 'string' && s.length > 0)
        : undefined;
      cleaned.push({
        channelPattern: rule.channelPattern,
        sources,
        freshnessSeconds: rule.freshnessSeconds,
        ...(blocked && blocked.length > 0 ? { blocked } : {}),
      });
    }
    this.upsert(sourcePriorityConfigTable, cleaned);
    this.subjects.sourcePriority.next(cleaned);
  }
  async setPassageLog(value: PassageLog): Promise<void> {
    // anchorAt may legitimately be null only via callers that explicitly
    // want to clear; the seed on open keeps it non-null in practice.
    if (value.anchorAt !== null) {
      if (!Number.isFinite(value.anchorAt) || value.anchorAt <= 0) {
        throw new Error('passageLog.anchorAt must be a positive finite UNIX seconds value or null');
      }
    }
    const cleaned: PassageLog = { anchorAt: value.anchorAt };
    this.upsert(passageLogTable, cleaned);
    this.subjects.passageLog.next(cleaned);
  }
  async setAisAlarmConfig(value: AisAlarmConfig): Promise<void> {
    // Validate: enabled boolean, thresholds finite & positive.
    if (typeof value.enabled !== 'boolean') {
      throw new Error('aisAlarmConfig.enabled must be boolean');
    }
    if (!Number.isFinite(value.cpaMeters) || value.cpaMeters <= 0) {
      throw new Error('aisAlarmConfig.cpaMeters must be a positive finite number');
    }
    if (!Number.isFinite(value.tcpaSeconds) || value.tcpaSeconds <= 0) {
      throw new Error('aisAlarmConfig.tcpaSeconds must be a positive finite number');
    }
    const cleaned: AisAlarmConfig = {
      enabled: value.enabled,
      cpaMeters: value.cpaMeters,
      tcpaSeconds: value.tcpaSeconds,
    };
    this.upsert(aisAlarmConfigTable, cleaned);
    this.subjects.aisAlarm.next(cleaned);
  }
  async setDampingConfig(value: DampingConfig): Promise<void> {
    // Drop entries with zero / negative / non-finite τ — they are passthrough
    // anyway and stripping keeps the persisted form minimal.
    const cleaned: DampingConfig = {};
    for (const [channel, tau] of Object.entries(value)) {
      if (typeof tau !== 'number' || !Number.isFinite(tau) || tau <= 0) continue;
      cleaned[channel] = tau;
    }
    this.upsert(dampingConfigTable, cleaned);
    this.subjects.dampingConfig.next(cleaned);
  }
  async setPolars(value: PolarTable): Promise<void> {
    // Legacy compatibility: create a new revision under the active slot+mode
    // with lineage 'manual_edit', then set it active.
    const wardrobe = this.subjects.sails.value;
    const slot = wardrobe.configs.find((c) => c.id === wardrobe.activeConfigId);
    if (!slot) return;
    const id = ulid().toLowerCase();
    const rev: PolarRevision = {
      id,
      boatId: this.__activeBoatId,
      sailConfigId: slot.id,
      mode: wardrobe.activeMode,
      parentRevisionId: slot.modes[wardrobe.activeMode]?.activeRevisionId ?? null,
      createdAt: Math.floor(Date.now() / 1000),
      lineage: { kind: 'manual_edit', notes: 'via legacy setPolars()' },
      table: value,
    };
    await this.createRevision(rev);
    await this.setActiveRevision(slot.id, wardrobe.activeMode, id);
  }

  async createRevision(rev: PolarRevision): Promise<void> {
    insertRevision(this.db, rev);
    const next = new Map(this.subjects.polarRevisions.value);
    next.set(rev.id, rev);
    this.subjects.polarRevisions.next(next);
  }

  async setActiveRevision(
    sailConfigId: string,
    mode: PolarMode,
    revisionId: string,
  ): Promise<void> {
    const revs = this.subjects.polarRevisions.value;
    if (!revs.has(revisionId)) {
      throw new Error(`revision ${revisionId} not found`);
    }
    const wardrobe = this.subjects.sails.value;
    const idx = wardrobe.configs.findIndex((c) => c.id === sailConfigId);
    if (idx < 0) throw new Error(`sail config ${sailConfigId} not found`);
    const newConfigs = wardrobe.configs.slice();
    const cfg = newConfigs[idx]!;
    newConfigs[idx] = {
      ...cfg,
      modes: { ...cfg.modes, [mode]: { activeRevisionId: revisionId } },
    };
    const next: SailWardrobe = { ...wardrobe, configs: newConfigs };
    this.upsert(sailWardrobe, next);
    this.subjects.sails.next(next);
  }

  listRevisions(filter: ListFilter = {}): PolarRevision[] {
    return listRevisionsRepo(this.db, { ...filter, boatId: filter.boatId ?? this.__activeBoatId });
  }

  getRevision(id: string): PolarRevision | undefined {
    return getRevisionRepo(this.db, id);
  }

  async close(): Promise<void> {
    this.raw.close();
    this.subjects.boatConfig.complete();
    this.subjects.awsAwaCal.complete();
    this.subjects.bspCal.complete();
    this.subjects.compassDeviation.complete();
    this.subjects.sails.complete();
    this.subjects.dampingConfig.complete();
    this.subjects.sourcePriority.complete();
    this.subjects.aisAlarm.complete();
    this.subjects.passageLog.complete();
    this.subjects.polarRevisions.complete();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private upsert<T>(table: any, value: T): void {
    const json = JSON.stringify(value);
    this.db
      .insert(table)
      .values({ id: SINGLETON, value: json })
      .onConflictDoUpdate({ target: table.id, set: { value: json } })
      .run();
  }
}
