import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
