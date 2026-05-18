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
