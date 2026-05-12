import { CACHED_POLAR } from './paths';
import { writeJson, readJson } from './persistence';

const HOST = process.env.G5000_HOST ?? 'http://g5000.local:3000';

export async function fetchActivePolar(): Promise<unknown | null> {
  try {
    const res = await fetch(`${HOST}/api/wardrobe/active`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return readJson(CACHED_POLAR);
    const polar = await res.json();
    await writeJson(CACHED_POLAR, polar);
    return polar;
  } catch {
    return readJson(CACHED_POLAR);
  }
}

export function liveModeAvailable(): Promise<boolean> {
  return fetch(`${HOST}/api/wardrobe/active`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
}

export function positionStreamUrl(): string {
  return `${HOST}/api/position`;
}
