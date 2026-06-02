import { describe, it, expect } from 'vitest';
import { Bus, Channels } from '@g5000/core';
import type { Sample } from '@g5000/core';
import type { TidalEvent } from '@g5000/tide';
import { publishTideSnapshot } from './tide-subsystem.js';

const min = 60_000;
const events: TidalEvent[] = [
  { type: 'LW', timeMs: 0, heightM: 1.0 },
  { type: 'HW', timeMs: 6 * 60 * min, heightM: 5.0 },
  { type: 'LW', timeMs: 12 * 60 * min, heightM: 1.2 },
];

describe('publishTideSnapshot', () => {
  it('publishes decomposed tide.* channels from events + nowMs', () => {
    const bus = new Bus();
    const seen = new Map<string, Sample>();
    bus.subscribe('tide.**', (s) => seen.set(s.channel, s));

    publishTideSnapshot(bus, 'Dover', events, 3 * 60 * min);

    expect(seen.get(Channels.Tide.Station)?.value).toEqual({ kind: 'enum', value: 'Dover' });
    const h = seen.get(Channels.Tide.HeightNow)?.value;
    if (h?.kind === 'scalar') expect(h.value).toBeCloseTo(3.0, 6);
    expect(seen.get(Channels.Tide.State)?.value).toEqual({ kind: 'enum', value: 'rising' });
    expect(seen.get(Channels.Tide.NextEventType)?.value).toEqual({ kind: 'enum', value: 'HW' });
    const insec = seen.get(Channels.Tide.NextEventInSec)?.value;
    if (insec?.kind === 'scalar') expect(insec.value).toBeCloseTo(3 * 60 * 60, 0);
  });

  it('suppresses heightNow/state when there is no bracketing pair', () => {
    const bus = new Bus();
    const seen = new Map<string, Sample>();
    bus.subscribe('tide.**', (s) => seen.set(s.channel, s));
    publishTideSnapshot(bus, 'Dover', events, 13 * 60 * min);
    expect(seen.has(Channels.Tide.HeightNow)).toBe(false);
    expect(seen.has(Channels.Tide.State)).toBe(false);
    expect(seen.get(Channels.Tide.Station)?.value).toEqual({ kind: 'enum', value: 'Dover' });
  });
});
