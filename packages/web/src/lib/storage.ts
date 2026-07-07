/**
 * Namespaced localStorage helper + one-time non-destructive migration shim.
 *
 * All new code should use the helpers here rather than raw localStorage calls.
 * Existing code continues to use its raw keys (no reads are repointed in Phase 0).
 *
 * Namespace: every key stored through this module carries a `g5000:` prefix.
 * The sentinel key `g5000:__migrated_v1` is written after the first migration
 * so the shim is idempotent across page loads and Hot-Module-Replacement cycles.
 *
 * Migration rules (enforced by migrateLegacyStorage):
 *  - Only runs in a browser (typeof window !== 'undefined').
 *  - Reads each legacy key; if the namespaced counterpart does NOT already exist,
 *    copies the value in. Never overwrites an already-namespaced value.
 *  - Never deletes legacy keys (non-destructive; re-runnable).
 *  - Idempotent: guarded by the `__migrated_v1` sentinel — second call is a no-op.
 */

// ---------------------------------------------------------------------------
// Namespace prefix
// ---------------------------------------------------------------------------

const NS = 'g5000:';

/** Migration-complete sentinel. Presence means the shim has already run. */
const MIGRATED_SENTINEL = `${NS}__migrated_v1`;

// ---------------------------------------------------------------------------
// LEGACY_KEY_MAP — explicit list of every raw key → namespaced key pair.
// Add entries here when new raw keys are discovered; never remove existing ones.
// ---------------------------------------------------------------------------

/**
 * Maps a legacy (raw) localStorage key to its namespaced counterpart.
 * Values on the LEFT side are the bare keys still used by existing screen code;
 * values on the RIGHT side are `g5000:` + the same logical name.
 */
export const LEGACY_KEY_MAP: ReadonlyArray<readonly [string, string]> = [
  // chart page (colon-style)
  ['chart:camera', `${NS}chart:camera`],
  ['chart:settings', `${NS}chart:settings`],
  ['chart:layers', `${NS}chart:layers`],
  ['chart:radar', `${NS}chart:radar`],
  ['chart:routeColorMode', `${NS}chart:routeColorMode`],
  ['chart:planState', `${NS}chart:planState`],
  ['chart:trackLayers', `${NS}chart:trackLayers`],
  ['chart:follow', `${NS}chart:follow`],
  ['chart:orientation', `${NS}chart:orientation`],
  // AIS
  ['ais:rangeNm', `${NS}ais:rangeNm`],
  // anchor
  ['anchor:drawer', `${NS}anchor:drawer`],
  ['anchor:chainCounter', `${NS}anchor:chainCounter`],
  // passage
  ['passage:tz', `${NS}passage:tz`],
  // trips
  ['trips:state', `${NS}trips:state`],
  // log
  ['shipLog:author', `${NS}shipLog:author`],
  // alarms
  ['alarms:audio-enabled', `${NS}alarms:audio-enabled`],
  // helm (dot-style)
  ['g5000.helm.group', `${NS}g5000.helm.group`],
  // race
  ['g5000.race-audible.muted', `${NS}g5000.race-audible.muted`],
  // audible alarm
  ['g5000.audible-alarm.muted', `${NS}g5000.audible-alarm.muted`],
] as const;

// ---------------------------------------------------------------------------
// SSR-safe storage access
// ---------------------------------------------------------------------------

/** Returns window.localStorage when available, or null during SSR / quota error. */
function getStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** Get a raw string value from the namespaced store, or null if absent / SSR. */
export function storageGet(key: string): string | null {
  return getStore()?.getItem(`${NS}${key}`) ?? null;
}

/** Set a raw string value in the namespaced store. */
export function storageSet(key: string, value: string): void {
  try {
    getStore()?.setItem(`${NS}${key}`, value);
  } catch {
    /* quota exceeded — silently drop */
  }
}

/** Remove a key from the namespaced store. */
export function storageRemove(key: string): void {
  getStore()?.removeItem(`${NS}${key}`);
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

/**
 * Get and JSON-parse a namespaced value.
 * Returns `null` if the key is absent, SSR, or the value is not valid JSON.
 */
export function storageGetJson<T = unknown>(key: string): T | null {
  const raw = storageGet(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** JSON-stringify and store a value under a namespaced key. */
export function storageSetJson(key: string, value: unknown): void {
  storageSet(key, JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// Migration shim
// ---------------------------------------------------------------------------

/**
 * Idempotent one-time migration: copies every legacy localStorage key into its
 * namespaced counterpart, skipping any namespaced key that already has a value.
 * Legacy keys are left untouched (non-destructive).
 *
 * Guarded by `g5000:__migrated_v1` — safe to call on every page load.
 */
export function migrateLegacyStorage(): void {
  const store = getStore();
  if (!store) return; // SSR

  // Idempotency guard — skip if already migrated.
  if (store.getItem(MIGRATED_SENTINEL) !== null) return;

  for (const [legacyKey, nsKey] of LEGACY_KEY_MAP) {
    const legacyValue = store.getItem(legacyKey);
    if (legacyValue === null) continue; // legacy key absent — nothing to migrate
    if (store.getItem(nsKey) !== null) continue; // namespaced key already has a value — do not clobber
    try {
      store.setItem(nsKey, legacyValue);
    } catch {
      /* quota — skip this key */
    }
  }

  // Mark complete.
  try {
    store.setItem(MIGRATED_SENTINEL, '1');
  } catch {
    /* quota — sentinel not written; migration will re-run on next load, which is safe */
  }
}
