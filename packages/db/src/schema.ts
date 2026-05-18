import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

/**
 * @deprecated Legacy v1 singleton polar. Read once on first boot by the v1→v2
 * migrator (see `migrate-wardrobe-v2.ts`) and then untouched. Drop in a
 * follow-up migration after all Pi installs have confirmed they're running
 * v2 wardrobes.
 */
export const polars = sqliteTable('polars', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded PolarTable
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
 *  - 'auto': written by the autopilot-server's hourly auto-logger.
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
  /** 'note' | 'position' | 'weather' | 'equipment' | 'incident' | 'crew' */
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

export const raceState = sqliteTable('race_state', {
  id: text('id').primaryKey(),
  value: text('value').notNull(), // JSON-encoded RaceStateConfig
});

export const crossoverMap = sqliteTable(
  'crossover_map',
  {
    boatId: text('boat_id').notNull(),
    mode: text('mode').notNull(),
    value: text('value').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.boatId, t.mode] }),
  }),
);

export const crossoverSettings = sqliteTable('crossover_settings', {
  boatId: text('boat_id').primaryKey(),
  value: text('value').notNull(),
});
