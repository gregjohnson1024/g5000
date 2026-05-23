import { readFile, rename } from 'node:fs/promises';
import type { ConfigStore, Waypoint } from '@g5000/db';

/**
 * One-time import of the legacy waypoints.json into ConfigStore. Idempotent:
 * runs only when the store is empty AND the file exists. Renames the file to
 * `.migrated` afterwards so a re-run is a no-op.
 */
export async function migrateWaypointsJson(store: ConfigStore, file: string): Promise<void> {
  if (store.getWaypoints().length > 0) return;
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  const valid = parsed.filter(
    (w): w is Waypoint =>
      typeof w === 'object' && w !== null &&
      typeof (w as Waypoint).id === 'string' &&
      typeof (w as Waypoint).lat === 'number' &&
      typeof (w as Waypoint).lon === 'number',
  );
  if (valid.length > 0) await store.setWaypoints(valid);
  await rename(file, file + '.migrated');
}
