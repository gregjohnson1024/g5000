import { describe, it, expect } from 'vitest';
import { simSnapshotAt, simHistory } from './sim.js';
import { parseDevices, deriveSnapshot } from './transform.js';

describe('simSnapshotAt', () => {
  it('is deterministic — same tSec yields equal output', () => {
    const a = simSnapshotAt(1_000_000);
    const b = simSnapshotAt(1_000_000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('varies with time — different tSec yields different usages', () => {
    const a = simSnapshotAt(0);
    const b = simSnapshotAt(43_200); // 12 hours later
    // At least one usage value should differ
    const usageA = JSON.stringify(a.usages);
    const usageB = JSON.stringify(b.usages);
    expect(usageA).not.toBe(usageB);
  });

  it('parseDevices + deriveSnapshot produce non-null mainsW and ≥5 circuits', () => {
    const sim = simSnapshotAt(1);
    const devices = parseDevices(sim.devices);
    const snap = deriveSnapshot(devices, sim.usages, '1S', 1);
    expect(snap.mainsW).not.toBeNull();
    expect(typeof snap.mainsW).toBe('number');
    expect(snap.circuits.length).toBeGreaterThanOrEqual(5);
  });

  it('all circuit watts are non-null and positive', () => {
    const sim = simSnapshotAt(500);
    const devices = parseDevices(sim.devices);
    const snap = deriveSnapshot(devices, sim.usages, '1S', 500_000);
    for (const c of snap.circuits) {
      expect(c.watts).not.toBeNull();
      expect(c.watts!).toBeGreaterThan(0);
    }
  });
});

describe('simHistory', () => {
  it('returns a plausible usageList with firstUsageInstant', async () => {
    const result = await simHistory(
      1001,
      '1,2,3',
      '1MIN',
      '2026-07-01T00:00:00Z',
      '2026-07-01T01:00:00Z',
    );
    expect(typeof result.firstUsageInstant).toBe('string');
    expect(Array.isArray(result.usageList)).toBe(true);
    expect(result.usageList.length).toBeGreaterThan(0);
    // Values should be positive kWh per minute range
    for (const v of result.usageList) {
      if (v !== null) {
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic across calls with same args', async () => {
    const a = await simHistory(1001, '1', '1MIN', '2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z');
    const b = await simHistory(1001, '1', '1MIN', '2026-07-01T00:00:00Z', '2026-07-01T01:00:00Z');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
