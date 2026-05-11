import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceRegistry, type DeviceInfo } from './device-registry.js';
import type { DecodedPgn } from '../decoder.js';
import type { OutgoingPgn } from '../wire-driver.js';

const at = (pgn: number, src: number, fields: Record<string, unknown>): DecodedPgn => ({
  pgn,
  prio: 6,
  src,
  dst: 255,
  fields,
  rxTimestamp: BigInt(Date.now()) * 1_000_000n,
});

describe('DeviceRegistry', () => {
  let registry: DeviceRegistry;

  beforeEach(() => {
    registry = new DeviceRegistry();
  });

  it('returns an empty snapshot before any PGNs arrive', () => {
    expect(Array.from(registry.snapshot().values())).toEqual([]);
  });

  it('populates manufacturer from a PGN 60928 Address Claim', () => {
    registry.observe(
      at(60928, 0x10, {
        'Unique Number': 12345,
        'Manufacturer Code': 1857, // Navico / B&G
        'Device Function': 140, // Heading sensor (example)
        'Device Class': 60,
        'Industry Group': 'Marine',
      }),
    );
    const info = registry.snapshot().get(0x10);
    expect(info).toBeDefined();
    expect(info!.manufacturerCode).toBe(1857);
    // Name lookup may resolve "Navico" or "Simrad" depending on canboatjs's table.
    // Just assert it's a non-empty string.
    expect(typeof info!.manufacturerName).toBe('string');
    expect(info!.manufacturerName!.length).toBeGreaterThan(0);
    expect(info!.deviceFunction).toBe(140);
    expect(info!.deviceClass).toBe(60);
  });

  it('populates model info from a PGN 126996 Product Information', () => {
    registry.observe(
      at(126996, 0x10, {
        'NMEA 2000 Version': 2100,
        'Product Code': 26200,
        'Model ID': 'H5000 CPU',
        'Software Version Code': '1.2.3',
        'Model Version': 'A',
        'Model Serial Code': 'ABC123',
        'Certification Level': 1,
        'Load Equivalency': 2,
      }),
    );
    const info = registry.snapshot().get(0x10);
    expect(info).toBeDefined();
    expect(info!.modelId).toBe('H5000 CPU');
    expect(info!.modelSerialCode).toBe('ABC123');
    expect(info!.softwareVersionCode).toBe('1.2.3');
    expect(info!.loadEquivalency).toBe(2);
  });

  it('merges address-claim and product-info into one record', () => {
    registry.observe(
      at(60928, 0x10, {
        'Manufacturer Code': 1857,
        'Device Function': 140,
        'Device Class': 60,
      }),
    );
    registry.observe(
      at(126996, 0x10, {
        'Model ID': 'H5000 CPU',
        'Model Serial Code': 'ABC123',
      }),
    );
    const info = registry.snapshot().get(0x10);
    expect(info!.manufacturerCode).toBe(1857);
    expect(info!.modelId).toBe('H5000 CPU');
  });

  it('updates lastSeenMs on every observed PGN regardless of type', () => {
    const t0 = Date.now();
    registry.observe(at(127250, 0x10, { Heading: 1.234 }));
    const info = registry.snapshot().get(0x10);
    expect(info).toBeDefined();
    expect(info!.lastSeenMs).toBeGreaterThanOrEqual(t0);
    expect(info!.lastSeenMs).toBeLessThanOrEqual(Date.now());
  });

  it('keeps each source address as a separate device', () => {
    registry.observe(at(60928, 0x10, { 'Manufacturer Code': 1857 }));
    registry.observe(at(60928, 0x12, { 'Manufacturer Code': 137 }));
    const snap = registry.snapshot();
    expect(snap.size).toBe(2);
    expect(snap.get(0x10)!.manufacturerCode).toBe(1857);
    expect(snap.get(0x12)!.manufacturerCode).toBe(137);
  });

  it('refresh() with no target broadcasts PGN 59904 for 60928', async () => {
    const sent: OutgoingPgn[] = [];
    registry.registerTxer(async (pgn) => {
      sent.push(pgn);
    });
    await registry.refresh();
    expect(sent.length).toBeGreaterThan(0);
    const first = sent[0]!;
    expect(first.pgn).toBe(59904);
    expect(first.dst).toBe(255); // broadcast
    expect(first.fields['PGN']).toBe(60928);
  });

  it('refresh(target) sends a unicast PGN 59904 for 60928 and 126996', async () => {
    const sent: OutgoingPgn[] = [];
    registry.registerTxer(async (pgn) => {
      sent.push(pgn);
    });
    await registry.refresh(0x10);
    expect(sent.length).toBe(2);
    expect(sent[0]!.dst).toBe(0x10);
    expect(sent[1]!.dst).toBe(0x10);
    const requestedPgns = sent.map((s) => s.fields['PGN']);
    expect(requestedPgns).toContain(60928);
    expect(requestedPgns).toContain(126996);
  });

  it('refresh() throws if no txer is registered', async () => {
    await expect(registry.refresh()).rejects.toThrow();
  });
});
