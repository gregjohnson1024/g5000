import { describe, it, expect, beforeEach } from 'vitest';
import {
  migrateLegacyStorage,
  storageGet,
  storageSet,
  storageGetJson,
  storageSetJson,
  storageRemove,
  LEGACY_KEY_MAP,
} from './storage';

// ---------------------------------------------------------------------------
// localStorage stub
// ---------------------------------------------------------------------------
// vitest/node has no localStorage — install a Map-backed shim on globalThis.

function makeStore(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key(index: number): string | null {
      return [...data.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    clear(): void {
      data.clear();
    },
  };
}

// Attach the stub before each test so every test starts with an empty store.
beforeEach(() => {
  const stub = makeStore();
  // storage.ts reads window.localStorage via typeof window check.
  // In vitest/node, window may or may not exist; we set it explicitly.
  (globalThis as Record<string, unknown>).window = { localStorage: stub };
});

// Helpers to reach the raw stub directly.
function rawStore(): Storage {
  return (globalThis as Record<string, Storage & { localStorage: Storage }>).window.localStorage;
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

describe('storageGet / storageSet / storageRemove', () => {
  it('stores and retrieves a string under the g5000: namespace', () => {
    storageSet('myKey', 'hello');
    expect(storageGet('myKey')).toBe('hello');
    // The raw key in the store must carry the prefix.
    expect(rawStore().getItem('g5000:myKey')).toBe('hello');
  });

  it('returns null for absent key', () => {
    expect(storageGet('absent')).toBeNull();
  });

  it('removes the namespaced key', () => {
    storageSet('myKey', 'bye');
    storageRemove('myKey');
    expect(storageGet('myKey')).toBeNull();
  });
});

describe('storageGetJson / storageSetJson', () => {
  it('round-trips a JSON value', () => {
    storageSetJson('cam', { lat: 41.76, lon: -71.13, zoom: 12 });
    const val = storageGetJson<{ lat: number; lon: number; zoom: number }>('cam');
    expect(val).toEqual({ lat: 41.76, lon: -71.13, zoom: 12 });
  });

  it('returns null for absent key', () => {
    expect(storageGetJson('nothing')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    rawStore().setItem('g5000:bad', '{{invalid}}');
    expect(storageGetJson('bad')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// migrateLegacyStorage
// ---------------------------------------------------------------------------

describe('migrateLegacyStorage', () => {
  it('copies legacy values into namespaced keys', () => {
    // Seed a couple of legacy keys.
    rawStore().setItem('chart:camera', '{"lat":32,"lon":-64,"zoom":9}');
    rawStore().setItem('ais:rangeNm', '5');

    migrateLegacyStorage();

    expect(rawStore().getItem('g5000:chart:camera')).toBe('{"lat":32,"lon":-64,"zoom":9}');
    expect(rawStore().getItem('g5000:ais:rangeNm')).toBe('5');
  });

  it('leaves legacy keys untouched', () => {
    rawStore().setItem('chart:camera', 'original');

    migrateLegacyStorage();

    // Legacy key still present after migration.
    expect(rawStore().getItem('chart:camera')).toBe('original');
  });

  it('does NOT overwrite a pre-existing namespaced value', () => {
    // Namespaced key has a user-written value already.
    rawStore().setItem('g5000:chart:camera', 'already-there');
    rawStore().setItem('chart:camera', 'legacy-value');

    migrateLegacyStorage();

    // Namespaced value must not be clobbered.
    expect(rawStore().getItem('g5000:chart:camera')).toBe('already-there');
  });

  it('is idempotent — second run is a no-op', () => {
    rawStore().setItem('chart:layers', '{"osm":true}');

    migrateLegacyStorage();
    // Simulate a change to the namespaced key after first migration.
    rawStore().setItem('g5000:chart:layers', '{"osm":false}');
    // Second call must NOT re-copy the legacy value over the updated namespaced value.
    migrateLegacyStorage();

    expect(rawStore().getItem('g5000:chart:layers')).toBe('{"osm":false}');
  });

  it('writes the migration sentinel after completion', () => {
    migrateLegacyStorage();
    expect(rawStore().getItem('g5000:__migrated_v1')).toBe('1');
  });

  it('sentinel presence short-circuits subsequent calls', () => {
    // Pre-set the sentinel so the migration has "already run".
    rawStore().setItem('g5000:__migrated_v1', '1');
    // Add a legacy key AFTER the "first run" — it should NOT be migrated.
    rawStore().setItem('chart:follow', 'true');

    migrateLegacyStorage();

    expect(rawStore().getItem('g5000:chart:follow')).toBeNull();
  });

  it('covers all keys in LEGACY_KEY_MAP', () => {
    // Seed every legacy key with a recognisable value.
    for (const [legacyKey] of LEGACY_KEY_MAP) {
      rawStore().setItem(legacyKey, `val:${legacyKey}`);
    }

    migrateLegacyStorage();

    // Every namespaced key must now exist.
    for (const [legacyKey, nsKey] of LEGACY_KEY_MAP) {
      expect(rawStore().getItem(nsKey)).toBe(`val:${legacyKey}`);
    }
  });
});
