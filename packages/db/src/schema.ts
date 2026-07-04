import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * All config rows are stored as JSON-serialized blobs in a `value` column.
 * This keeps the schema simple — Drizzle's strength here is connection
 * management, transactions, and migrations, not column-level typing for
 * complex nested structures (cal grids, polar tables).
 *
 * Each table is keyed by a known string ID. Most are singletons.
 */
export const boatConfig = sqliteTable('boat_config', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded BoatConfig
});

export const awsAwaCal = sqliteTable('aws_awa_cal', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded AwsAwaCalTable
});

export const bspCal = sqliteTable('bsp_cal', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded BspCal
});

export const compassDeviation = sqliteTable('compass_deviation', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded CompassDeviation
});

export const sailWardrobe = sqliteTable('sail_wardrobe', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded SailWardrobe
});

export const dampingConfig = sqliteTable('damping_config', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded DampingConfig (Record<string, number>)
});

export const sourcePriorityConfig = sqliteTable('source_priority_config', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded SourcePriorityConfig (SourcePriorityRule[])
});

export const aisAlarmConfig = sqliteTable('ais_alarm_config', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded AisAlarmConfig
});

export const passageLog = sqliteTable('passage_log', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded PassageLog
});

export const polarRevisions = sqliteTable('polar_revisions', {
  id: text('id').primaryKey(),
  boatId: text('boat_id').notNull(),
  sailConfigId: text('sail_config_id').notNull(),
  mode: text('mode').notNull(),
  /** Nullable: root revisions have no parent. */
  parentRevisionId: text('parent_revision_id'),
  /** UNIX seconds. */
  createdAt: integer('created_at').notNull(),
  lineageKind: text('lineage_kind').notNull(),
  /** Nullable JSON: {source?, notes?}. */
  lineageMeta: text('lineage_meta'),
  /** Nullable real: m/s scalar uncertainty. */
  sigma: real('sigma'),
  /** JSON-encoded PolarTable. */
  valueJson: text('value_json').notNull(),
});

export const alarmsConfig = sqliteTable('alarms_config', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded AlarmsConfig
});

export const alarmsHistory = sqliteTable('alarms_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  alarmId: text('alarm_id').notNull(),
  severity: text('severity').notNull(),
  firedAt: text('fired_at').notNull(),
  clearedAt: text('cleared_at'),
  ackedAt: text('acked_at'),
  context: text('context'), // JSON-encoded Record<string, unknown> or null
});

/**
 * Ship's log — chronological human-readable record of the boat.
 *
 * Two `source` values:
 *  - 'manual': crew-typed entry. `text` always populated; nav snapshot
 *    columns optional (client supplies current values).
 *  - 'auto': written by the g5000 app's hourly auto-logger.
 *    `kind='position'` and nav columns populated; `text` is null or
 *    a templated summary.
 *
 * `kind` is a soft enum (no DB constraint) so future categories can be
 * added without migration.
 */
export const shipLogEntries = sqliteTable('ship_log_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Epoch ms when the entry's event happened (also when it was logged). */
  tsMs: integer('ts_ms').notNull(),
  /** 'manual' | 'auto' */
  source: text('source').notNull(),
  /** 'note' | 'position' | 'weather' | 'equipment' | 'incident' | 'crew' | 'trip' */
  kind: text('kind').notNull(),
  text: text('text'),
  lat: real('lat'),
  lon: real('lon'),
  cogDeg: real('cog_deg'),
  sogKn: real('sog_kn'),
  hdgDeg: real('hdg_deg'),
  twsKn: real('tws_kn'),
  twdDeg: real('twd_deg'),
  author: text('author'),
  boatId: text('boat_id').notNull(),
});

/**
 * Trips — auto-detected passages (dock-to-dock / anchor-to-anchor), written
 * by the g5000 app's trip engine when the trip detector closes a trip.
 * Columnar like ship_log_entries; soft enums (`mode`, `stay_kind`) carry no
 * DB constraint so new categories don't need a migration.
 */
export const trips = sqliteTable('trips', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  boatId: text('boat_id').notNull(),
  /** Epoch ms, backdated to when the boat actually started moving. */
  startMs: integer('start_ms').notNull(),
  /** Epoch ms, backdated to when the boat actually stopped. */
  endMs: integer('end_ms').notNull(),
  startLat: real('start_lat').notNull(),
  startLon: real('start_lon').notNull(),
  endLat: real('end_lat').notNull(),
  endLon: real('end_lon').notNull(),
  distanceM: real('distance_m').notNull(),
  durationS: integer('duration_s').notNull(),
  maxSogKn: real('max_sog_kn').notNull(),
  avgSogKn: real('avg_sog_kn').notNull(),
  /** 'sail' | 'motor' | 'mixed' | 'unknown' (heuristic; user-overridable). */
  mode: text('mode').notNull(),
  /** JSON Record<string, number>: seconds per point-of-sail state, or null. */
  pointOfSailJson: text('point_of_sail_json'),
  /** Classification of the stay BEGUN at trip end: 'anchor' | 'unknown'. */
  stayKind: text('stay_kind').notNull(),
  moorageStartName: text('moorage_start_name'),
  moorageEndName: text('moorage_end_name'),
  notes: text('notes'),
  createdMs: integer('created_ms').notNull(),
});

export const raceState = sqliteTable('race_state', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded RaceStateConfig
});

export const crossoverSettings = sqliteTable('crossover_settings', {
  boatId: text('boat_id').primaryKey(),
  value: text('value').notNull(),
});

export const grooveSettings = sqliteTable('groove_settings', {
  boatId: text('boat_id').primaryKey(),
  value: text('value').notNull(),
});

export const tideConfig = sqliteTable('tide_config', {
  boatId: text('boat_id').primaryKey(),
  value: text('value').notNull(),
});

export const displayConfig = sqliteTable('display_config', {
  boatId: text('boat_id').primaryKey(),
  value: text('value').notNull(),
});

export const waypoints = sqliteTable('waypoints', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded Waypoint[]
});

export const routes = sqliteTable('routes', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded Route[]
});

export const boatState = sqliteTable('boat_state', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded BoatState
});

export const mastLayout = sqliteTable('mast_layout', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded MastLayout | null
});

export const radarConfig = sqliteTable('radar_config', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded RadarConfig | null
});

export const windMisalignmentCal = sqliteTable('wind_misalignment_cal', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded WindMisalignmentCal | null
});
