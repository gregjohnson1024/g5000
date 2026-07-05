import { describe, it, expect } from 'vitest';
import { Bus, Channels, type Sample } from '@g5000/core';
import { publishVictronToBus } from './publisher.js';

describe('publishVictronToBus', () => {
  it('publishes headline scalars, skipping null fields', () => {
    const bus = new Bus();
    const seen = new Map<string, Sample>();
    bus.subscribe('electrical.**', (sample) => seen.set(sample.channel, sample));
    publishVictronToBus(bus, {
      connected: true,
      updatedAt: 1_000,
      battery: {
        soc: 68,
        voltage: 26.7,
        current: 5,
        power: 133,
        temperatureC: null,
        timeToGoS: null,
      },
      solar: { totalPower: 1946, chargers: [] },
      dc: { power: null },
      ac: { inputPower: null, outputPower: 1000, consumptionPower: 1000 },
      tanks: [],
      temperatures: [],
      generator: { state: null, runtimeH: null },
    });

    const scalarVal = (ch: string): number | undefined => {
      const s = seen.get(ch);
      return s?.value.kind === 'scalar'
        ? (s.value as { kind: 'scalar'; value: number }).value
        : undefined;
    };

    expect(scalarVal(Channels.Electrical.BatterySoc)).toBe(68);
    expect(scalarVal(Channels.Electrical.SolarPower)).toBe(1946);
    expect(scalarVal(Channels.Electrical.AcOutputPower)).toBe(1000);
    expect(seen.has(Channels.Electrical.DcPower)).toBe(false); // null → skipped
    expect(seen.has(Channels.Electrical.AcInputPower)).toBe(false); // null → skipped
  });

  it('uses updatedAt as t_ns (converted from ms)', () => {
    const bus = new Bus();
    const seen = new Map<string, Sample>();
    bus.subscribe('electrical.**', (sample) => seen.set(sample.channel, sample));
    publishVictronToBus(bus, {
      connected: true,
      updatedAt: 1_234_000,
      battery: {
        soc: 50,
        voltage: null,
        current: null,
        power: null,
        temperatureC: null,
        timeToGoS: null,
      },
      solar: { totalPower: null, chargers: [] },
      dc: { power: null },
      ac: { inputPower: null, outputPower: null, consumptionPower: null },
      tanks: [],
      temperatures: [],
      generator: { state: null, runtimeH: null },
    });

    const s = seen.get(Channels.Electrical.BatterySoc);
    expect(s?.t_ns).toBe(BigInt(1_234_000) * 1_000_000n);
    expect(s?.source).toBe('victron');
  });
});
