import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { BehaviorSubject, combineLatest, type Observable, map } from 'rxjs';
import {
  DEFAULT_AIS_ALARM_CONFIG,
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_BOAT_CONFIG,
  DEFAULT_BSP_CAL,
  DEFAULT_COMPASS_DEVIATION,
  DEFAULT_CROSSOVER_SETTINGS,
  DEFAULT_DAMPING_CONFIG,
  DEFAULT_POLARS,
  DEFAULT_SOURCE_PRIORITY,
  DEFAULT_WARDROBE,
  SAIL_CATEGORIES,
  type AisAlarmConfig,
  type AwsAwaCalTable,
  type BoatConfig,
  type BoatId,
  type BspCal,
  type CompassDeviation,
  type CrossoverSettings,
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
  crossoverSettings as crossoverSettingsTable,
  dampingConfig as dampingConfigTable,
  passageLog as passageLogTable,
  sailWardrobe,
  sourcePriorityConfig as sourcePriorityConfigTable,
  waypoints as waypointsTable,
  routes as routesTable,
  boatState as boatStateTable,
} from './schema.js';
import type { Waypoint, Route } from './waypoints-routes-types.js';
import { type BoatState, DEFAULT_BOAT_STATE } from './boat-state.js';
import {
  insertRevision,
  listRevisions as listRevisionsRepo,
  getRevision as getRevisionRepo,
  type ListFilter,
} from './polar-revisions.js';
import { migrateWardrobeV2toV3, type V2Wardrobe } from './migrate-wardrobe-v3.js';

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
    crossoverSettings: BehaviorSubject<CrossoverSettings>;
    waypoints: BehaviorSubject<Waypoint[]>;
    routes: BehaviorSubject<Route[]>;
    boatState: BehaviorSubject<BoatState>;
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
      crossoverSettings: CrossoverSettings;
      waypoints: Waypoint[];
      routes: Route[];
      boatState: BoatState;
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
      crossoverSettings: new BehaviorSubject(initial.crossoverSettings),
      waypoints: new BehaviorSubject(initial.waypoints),
      routes: new BehaviorSubject(initial.routes),
      boatState: new BehaviorSubject(initial.boatState),
    };
  }

  static async open(filePath: string): Promise<ConfigStore> {
    const raw = new Database(filePath);
    const db = drizzle(raw);

    // Create tables if they don't exist. Using exec for IF NOT EXISTS DDL
    // since drizzle-kit migrations are heavier than this Phase 0 needs.
    //
    // NOTE: `crossover_map` is created here (if missing) only so the v2→v3
    // migrator can read any legacy row. It's dropped at the end of open()
    // once the migration has resolved.
    raw.exec(`
      CREATE TABLE IF NOT EXISTS boat_config (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS aws_awa_cal (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bsp_cal (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS compass_deviation (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- DEPRECATED: legacy v1 singleton polar. No longer read; left in schema so legacy DBs don't error.
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
      CREATE TABLE IF NOT EXISTS race_state (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS crossover_map (
        boat_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (boat_id, mode)
      );
      CREATE TABLE IF NOT EXISTS crossover_settings (
        boat_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS waypoints (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS routes (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS boat_state (id TEXT PRIMARY KEY, value TEXT NOT NULL);
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

    // Wardrobe load / migrate:
    //   - If no sail_wardrobe row → seed DEFAULT_WARDROBE (already v3) and skip
    //     the migrator. Fresh installs start at v3.
    //   - If row exists and is already v3 → migrator returns it unchanged.
    //   - If row exists and is v2 → run v2→v3 migrator with the legacy
    //     crossover_map row (if any) for region remapping, then persist v3.
    //
    // Legacy v1 wardrobes (with embedded `polar` per config and no `modes`)
    // are no longer supported. All known production installs (the Pi) have
    // been on v2 for >1 deploy cycle, so the v1 path was dropped along with
    // migrate-wardrobe-v2.ts.
    const wardrobeRows = db.select().from(sailWardrobe).where(eq(sailWardrobe.id, SINGLETON)).all();
    let wardrobeValue: SailWardrobe;
    if (!wardrobeRows[0]) {
      wardrobeValue = { ...DEFAULT_WARDROBE, boatId: activeBoatId };
      db.insert(sailWardrobe)
        .values({ id: SINGLETON, value: JSON.stringify(wardrobeValue) })
        .run();
    } else {
      const rawWardrobe: unknown = JSON.parse((wardrobeRows[0] as { value: string }).value);

      // Read legacy crossover_map row for the active (boat, mode) so the v2→v3
      // migrator can remap painted cells. Use a raw prepared statement so we
      // don't need to keep the drizzle table import around just for this read.
      let v2MapForMigrator: {
        boatId: BoatId;
        mode: PolarMode;
        cells: Record<string, string>;
        updatedAt: number;
      } | null = null;
      const activeMode: PolarMode =
        (rawWardrobe as { activeMode?: PolarMode })?.activeMode ?? 'default';
      try {
        const row = raw
          .prepare('SELECT value FROM crossover_map WHERE boat_id = ? AND mode = ?')
          .get(activeBoatId, activeMode) as { value: string } | undefined;
        if (row) {
          const parsed = JSON.parse(row.value) as Partial<{
            cells: Record<string, string>;
            updatedAt: number;
          }>;
          v2MapForMigrator = {
            boatId: activeBoatId,
            mode: activeMode,
            cells: parsed.cells ?? {},
            updatedAt: parsed.updatedAt ?? 0,
          };
        }
      } catch {
        // crossover_map table may not exist on very old DBs; treat as no row.
      }

      // Pick the most-recent polar revision for (activeBoatId, activeMode) as
      // the table the migrator uses to translate (twsIdx, twaIdx) polar cells
      // into fixed-grid cells. Falls back to DEFAULT_POLARS if no revision yet.
      const activePolarForMigrator: PolarTable = (() => {
        const revs = listRevisionsRepo(db, { boatId: activeBoatId, mode: activeMode });
        return revs[0]?.table ?? DEFAULT_POLARS;
      })();

      wardrobeValue = migrateWardrobeV2toV3(
        rawWardrobe as V2Wardrobe | SailWardrobe,
        v2MapForMigrator,
        activePolarForMigrator,
      );

      // Persist v3 back so subsequent boots short-circuit (idempotent).
      if (wardrobeValue !== rawWardrobe) {
        db.insert(sailWardrobe)
          .values({ id: SINGLETON, value: JSON.stringify(wardrobeValue) })
          .onConflictDoUpdate({
            target: sailWardrobe.id,
            set: { value: JSON.stringify(wardrobeValue) },
          })
          .run();
      }
    }

    // Drop the legacy crossover_map table; it's no longer needed once the
    // migrator above has consumed it. Subsequent reopens will recreate-as-empty
    // via the CREATE TABLE IF NOT EXISTS above, and the SELECT will return no
    // rows, so the migrator is a no-op for already-v3 wardrobes.
    raw.exec('DROP TABLE IF EXISTS crossover_map;');

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

    // Load the crossover_settings row for the active boat. Single-row table
    // keyed by boatId — no mode component. Stored value is merged with
    // DEFAULT_CROSSOVER_SETTINGS so partial writes get sensible fallbacks.
    const xsRows = db
      .select()
      .from(crossoverSettingsTable)
      .where(eq(crossoverSettingsTable.boatId, activeBoatId))
      .all() as Array<{ boatId: string; value: string }>;
    const crossoverSettingsValue: CrossoverSettings = xsRows[0]
      ? {
          ...DEFAULT_CROSSOVER_SETTINGS,
          ...(JSON.parse(xsRows[0].value) as Partial<CrossoverSettings>),
        }
      : DEFAULT_CROSSOVER_SETTINGS;

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
      crossoverSettings: crossoverSettingsValue,
      waypoints: loadOrInsert<Waypoint[]>(waypointsTable, []),
      routes: loadOrInsert<Route[]>(routesTable, []),
      boatState: loadOrInsert<BoatState>(boatStateTable, DEFAULT_BOAT_STATE),
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
  /**
   * Derived from sails$ + polarRevisions$ — resolves the wardrobe's active
   * (boatId, activeMode) to its most-recent `PolarRevision.table`. Falls back
   * to DEFAULT_POLARS if no matching revision exists yet.
   *
   * In v3 the wardrobe no longer stores per-config polar pointers; the active
   * polar is simply the newest revision for the boat+mode pair.
   */
  get activePolar$(): Observable<PolarTable> {
    return combineLatest([this.subjects.sails, this.subjects.polarRevisions]).pipe(
      map(([wardrobe, revisionsById]) => {
        const mode = wardrobe.activeMode;
        const candidates: PolarRevision[] = [];
        for (const rev of revisionsById.values()) {
          if (rev.boatId === wardrobe.boatId && rev.mode === mode) candidates.push(rev);
        }
        if (candidates.length === 0) return DEFAULT_POLARS;
        candidates.sort((a, b) => b.createdAt - a.createdAt);
        return candidates[0]!.table;
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
  /**
   * Crossover settings (recommendation hysteresis, forecast cadence) for the
   * active boat. Seeded at open() from the crossover_settings row for
   * `activeBoatId`, merged over DEFAULT_CROSSOVER_SETTINGS so missing keys
   * fall back. Single-row table keyed on `boatId` — no per-mode component.
   */
  get crossoverSettings$(): Observable<CrossoverSettings> {
    return this.subjects.crossoverSettings.asObservable();
  }

  async setCrossoverSettings(value: CrossoverSettings): Promise<void> {
    this.raw
      .prepare(
        'INSERT INTO crossover_settings (boat_id, value) VALUES (?, ?) ON CONFLICT (boat_id) DO UPDATE SET value = excluded.value',
      )
      .run(this.__activeBoatId, JSON.stringify(value));
    this.subjects.crossoverSettings.next(value);
  }

  get waypoints$(): Observable<Waypoint[]> {
    return this.subjects.waypoints.asObservable();
  }
  getWaypoints(): Waypoint[] {
    return this.subjects.waypoints.value;
  }
  async setWaypoints(value: Waypoint[]): Promise<void> {
    this.upsert(waypointsTable, value);
    this.subjects.waypoints.next(value);
  }

  get routes$(): Observable<Route[]> {
    return this.subjects.routes.asObservable();
  }
  getRoutes(): Route[] {
    return this.subjects.routes.value;
  }
  async setRoutes(value: Route[]): Promise<void> {
    this.upsert(routesTable, value);
    this.subjects.routes.next(value);
  }

  get boatState$(): Observable<BoatState> {
    return this.subjects.boatState.asObservable();
  }
  getBoatState(): BoatState {
    return this.subjects.boatState.value;
  }
  async setBoatState(value: BoatState): Promise<void> {
    this.upsert(boatStateTable, value);
    this.subjects.boatState.next(value);
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
    if (value.schemaVersion !== 3) {
      throw new Error(
        `setSails: expected schemaVersion 3, got ${(value as { schemaVersion?: number }).schemaVersion}`,
      );
    }
    const ids = new Set<string>();
    for (const sail of value.sails) {
      if (ids.has(sail.id)) {
        throw new Error(`setSails: duplicate sail id "${sail.id}"`);
      }
      ids.add(sail.id);
      if (!SAIL_CATEGORIES.includes(sail.category)) {
        throw new Error(`setSails: sail "${sail.id}" has unknown category "${sail.category}"`);
      }
    }
    // Active references must point at a sail in the matching category; any
    // stale reference (deleted sail or wrong category) is silently cleared.
    const cleaned: SailWardrobe['active'] = {};
    for (const cat of SAIL_CATEGORIES) {
      const ref = value.active[cat];
      if (!ref) continue;
      const sail = value.sails.find((s) => s.id === ref);
      if (sail && sail.category === cat) cleaned[cat] = ref;
    }
    const stored: SailWardrobe = { ...value, active: cleaned };
    this.upsert(sailWardrobe, stored);
    this.subjects.sails.next(stored);
  }
  async setSourcePriority(value: SourcePriorityConfig): Promise<void> {
    // Sanitise: drop entries that don't validate (missing fields, non-finite
    // freshness, empty sources). Keep order — order is priority.
    const cleaned: SourcePriorityConfig = [];
    for (const rule of value) {
      if (!rule || typeof rule !== 'object') continue;
      if (typeof rule.channelPattern !== 'string' || rule.channelPattern.length === 0) continue;
      if (!Array.isArray(rule.sources)) continue;
      const sources = rule.sources.filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      );
      if (sources.length === 0) continue;
      if (typeof rule.freshnessSeconds !== 'number' || !Number.isFinite(rule.freshnessSeconds))
        continue;
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
  /**
   * @deprecated In v3 the wardrobe no longer carries per-config polar
   * pointers. The web routes that called this need to be rewritten to
   * `createRevision()` directly; the active polar is just the most-recent
   * revision for `(boatId, activeMode)`. Kept as a throwing stub so the
   * intent of any remaining caller is obvious at runtime.
   */
  async setPolars(_value: PolarTable): Promise<void> {
    throw new Error(
      'setPolars() is deprecated in v3 — use createRevision() directly; activePolar$ resolves to the newest revision for (boatId, activeMode)',
    );
  }

  async createRevision(rev: PolarRevision): Promise<void> {
    insertRevision(this.db, rev);
    const next = new Map(this.subjects.polarRevisions.value);
    next.set(rev.id, rev);
    this.subjects.polarRevisions.next(next);
  }

  /**
   * @deprecated In v3 there is no explicit "active revision" pointer — the
   * active polar is the newest revision for `(boatId, activeMode)`. To make
   * an older revision active again, the caller should write a new revision
   * (copying the older table) so it becomes the newest. Kept as a throwing
   * stub for now; the web route `/api/polar/active` needs to be rewritten
   * in a later task.
   */
  async setActiveRevision(
    _sailConfigId: string,
    _mode: PolarMode,
    _revisionId: string,
  ): Promise<void> {
    throw new Error(
      'setActiveRevision() is deprecated in v3 — write a new revision (copying the desired table) to make it the newest for (boatId, mode)',
    );
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
    this.subjects.crossoverSettings.complete();
    this.subjects.waypoints.complete();
    this.subjects.routes.complete();
    this.subjects.boatState.complete();
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
