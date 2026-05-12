import { describe, it, expect, beforeEach } from 'vitest';
import { _resetAisTargetsForTests } from '@g5000/core';
import { createAisTargetsRegistry } from './targets-registry.js';

describe('AisTargetsRegistry', () => {
  beforeEach(() => _resetAisTargetsForTests());

  it('upsert creates a new target', () => {
    const r = createAisTargetsRegistry();
    r.upsert({ mmsi: 123, vesselClass: 'A', lat: 45, lon: -75 });
    const t = r.get(123);
    expect(t?.mmsi).toBe(123);
    expect(t?.lat).toBe(45);
    expect(t?.lon).toBe(-75);
    expect(t?.vesselClass).toBe('A');
    expect(t?.lastSeenMs).toBeGreaterThan(0);
  });

  it('upsert merges partial updates without clobbering prior fields', () => {
    const r = createAisTargetsRegistry();
    r.upsert({ mmsi: 5, vesselClass: 'A', lat: 1, lon: 2 });
    r.upsert({ mmsi: 5, sog: 4.5 });
    const t = r.get(5);
    expect(t?.lat).toBe(1); // preserved
    expect(t?.lon).toBe(2); // preserved
    expect(t?.sog).toBe(4.5); // merged in
    expect(t?.vesselClass).toBe('A'); // preserved
  });

  it('upsert refreshes lastSeenMs', () => {
    const r = createAisTargetsRegistry();
    r.upsert({ mmsi: 7, vesselClass: 'B' });
    const t1 = r.get(7)!;
    const seen1 = t1.lastSeenMs;
    // Mutate the row backwards so we can detect a fresh upsert moving it forward.
    t1.lastSeenMs = seen1 - 60_000;
    r.upsert({ mmsi: 7, sog: 1 });
    expect(r.get(7)!.lastSeenMs).toBeGreaterThan(t1.lastSeenMs);
  });

  it('evictStale drops old targets and reports count', () => {
    const r = createAisTargetsRegistry();
    r.upsert({ mmsi: 1, vesselClass: 'A' });
    r.upsert({ mmsi: 2, vesselClass: 'A' });
    // Make #1 look old.
    const t = r.get(1)!;
    t.lastSeenMs = Date.now() - 600_000; // 10 min ago
    const dropped = r.evictStale(300_000); // 5 min cutoff
    expect(dropped).toBe(1);
    expect(r.get(1)).toBeUndefined();
    expect(r.get(2)).toBeDefined();
  });

  it('all() lists every tracked target', () => {
    const r = createAisTargetsRegistry();
    r.upsert({ mmsi: 1, vesselClass: 'A' });
    r.upsert({ mmsi: 2, vesselClass: 'B' });
    r.upsert({ mmsi: 3, vesselClass: 'unknown' });
    const list = r.all();
    expect(list.map((t) => t.mmsi).sort()).toEqual([1, 2, 3]);
  });

  it('singleton survives multiple createAisTargetsRegistry() calls', () => {
    const r1 = createAisTargetsRegistry();
    r1.upsert({ mmsi: 99, vesselClass: 'A' });
    const r2 = createAisTargetsRegistry();
    expect(r2).toBe(r1);
    expect(r2.get(99)).toBeDefined();
  });

  it('clear() drops every target', () => {
    const r = createAisTargetsRegistry();
    r.upsert({ mmsi: 11, vesselClass: 'A' });
    r.upsert({ mmsi: 12, vesselClass: 'B' });
    r.clear();
    expect(r.all()).toEqual([]);
  });
});
