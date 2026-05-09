import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { BehaviorSubject, type Observable } from 'rxjs';
import {
  DEFAULT_AWS_AWA_CAL,
  DEFAULT_BOAT_CONFIG,
  DEFAULT_BSP_CAL,
  DEFAULT_COMPASS_DEVIATION,
  type AwsAwaCalTable,
  type BoatConfig,
  type BspCal,
  type CompassDeviation,
} from './defaults.js';
import { awsAwaCal, bspCal, boatConfig as boatConfigTable, compassDeviation } from './schema.js';

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
  };

  private constructor(
    private readonly raw: Database.Database,
    private readonly db: BetterSQLite3Database,
    initial: {
      boatConfig: BoatConfig;
      awsAwaCal: AwsAwaCalTable;
      bspCal: BspCal;
      compassDeviation: CompassDeviation;
    },
  ) {
    this.subjects = {
      boatConfig: new BehaviorSubject(initial.boatConfig),
      awsAwaCal: new BehaviorSubject(initial.awsAwaCal),
      bspCal: new BehaviorSubject(initial.bspCal),
      compassDeviation: new BehaviorSubject(initial.compassDeviation),
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
    `);

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

    const initial = {
      boatConfig: loadOrInsert<BoatConfig>(boatConfigTable, DEFAULT_BOAT_CONFIG),
      awsAwaCal: loadOrInsert<AwsAwaCalTable>(awsAwaCal, DEFAULT_AWS_AWA_CAL),
      bspCal: loadOrInsert<BspCal>(bspCal, DEFAULT_BSP_CAL),
      compassDeviation: loadOrInsert<CompassDeviation>(compassDeviation, DEFAULT_COMPASS_DEVIATION),
    };

    return new ConfigStore(raw, db, initial);
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

  async close(): Promise<void> {
    this.raw.close();
    this.subjects.boatConfig.complete();
    this.subjects.awsAwaCal.complete();
    this.subjects.bspCal.complete();
    this.subjects.compassDeviation.complete();
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
