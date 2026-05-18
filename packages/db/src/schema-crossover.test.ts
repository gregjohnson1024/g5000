import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  crossoverMap as crossoverMapTable,
  crossoverSettings as crossoverSettingsTable,
} from './schema.js';

describe('schema: crossover tables', () => {
  it('crossover_map is keyed by (boatId, mode) with a JSON value', () => {
    const raw = new Database(':memory:');
    const db = drizzle(raw);
    // Mirror the migration we add inline so the test is self-contained
    raw.exec(`
      CREATE TABLE crossover_map (
        boat_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (boat_id, mode)
      );
      CREATE TABLE crossover_settings (
        boat_id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.insert(crossoverMapTable)
      .values({ boatId: 'sula', mode: 'default', value: JSON.stringify({ cells: {} }) })
      .run();
    db.insert(crossoverSettingsTable)
      .values({ boatId: 'sula', value: JSON.stringify({ recommendationStableSeconds: 30 }) })
      .run();
    const m = raw.prepare('SELECT * FROM crossover_map').all() as Array<{
      boat_id: string;
      mode: string;
      value: string;
    }>;
    expect(m).toHaveLength(1);
    expect(m[0]?.boat_id).toBe('sula');
    expect(m[0]?.mode).toBe('default');
    const s = raw.prepare('SELECT * FROM crossover_settings').all() as Array<{
      boat_id: string;
      value: string;
    }>;
    expect(s).toHaveLength(1);
    expect(s[0]?.boat_id).toBe('sula');
    raw.close();
  });
});
