import { describe, expect, it } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { Bus } from '@g5000/core';
import type { Sample } from '@g5000/core';
import type { CrossoverSettings, SailWardrobe } from '@g5000/db';
import { startSailCrossoverPipeline } from './pipeline.js';

const SETTINGS: CrossoverSettings = {
  recommendationStableSeconds: 5,
  forecastIntervalMinutes: 30,
  forecastDurationHours: 12,
};

const WARDROBE: SailWardrobe = {
  schemaVersion: 3,
  boatId: 'sula',
  sails: [
    { id: 'j0', name: 'J0', category: 'headsail', areaSqM: 79, region: { cells: ['10,9'] } },
    { id: 'reef1', name: 'Reef 1', category: 'main', areaSqM: 58, region: { cells: ['10,9'] } },
  ],
  active: { headsail: 'j0', main: 'reef1' },
  activeMode: 'default',
};

function makeWindSamples(twsMs: number, twaRad: number, t_ns: bigint): [Sample, Sample] {
  return [
    { channel: 'wind.true.speed', t_ns, value: { kind: 'scalar', value: twsMs }, source: 'test' },
    { channel: 'wind.true.angle', t_ns, value: { kind: 'scalar', value: twaRad }, source: 'test' },
  ];
}

describe('sail-crossover pipeline', () => {
  it('emits valid sails per category at current cell', async () => {
    const b = new Bus();
    const sails$ = new BehaviorSubject<SailWardrobe>(WARDROBE);
    const settings$ = new BehaviorSubject<CrossoverSettings>(SETTINGS);
    const sub = startSailCrossoverPipeline({
      bus: b,
      sails$,
      settings$,
      now: () => 1000,
    });
    const seen: any[] = [];
    b.subscribe('sail.recommendation', (s) => seen.push(s.value));

    // 10 kn (5.144 m/s) at 45° (π/4 rad) → fixed-grid cell (10, 9).
    const [sp, an] = makeWindSamples(10 * 0.514444, Math.PI / 4, 1_000_000_000n);
    b.publish(sp);
    b.publish(an);
    await new Promise((r) => setTimeout(r, 5));

    expect(seen.length).toBeGreaterThan(0);
    const last = seen.at(-1);
    expect(last.kind).toBe('sail_recommendation');
    expect(last.valid.headsail).toEqual(['j0']);
    expect(last.valid.main).toEqual(['reef1']);
    expect(last.changeNeeded).toEqual({ headsail: false, main: false, downwind: false });
    sub.unsubscribe();
  });

  it('fires changeNeeded after stableSeconds when active falls out of valid set', async () => {
    const b = new Bus();
    const sails$ = new BehaviorSubject<SailWardrobe>(WARDROBE);
    const settings$ = new BehaviorSubject<CrossoverSettings>(SETTINGS);
    let now = 1000;
    const sub = startSailCrossoverPipeline({
      bus: b,
      sails$,
      settings$,
      now: () => now,
    });
    const seen: any[] = [];
    b.subscribe('sail.recommendation', (s) => seen.push(s.value));

    // 20 kn at 90° → cell (20, 18). Neither active sail is valid here.
    const [sp1, an1] = makeWindSamples(20 * 0.514444, Math.PI / 2, 1_000_000_000n);
    b.publish(sp1);
    b.publish(an1);
    await new Promise((r) => setTimeout(r, 5));

    expect(seen.at(-1)!.changeNeeded.headsail).toBe(false); // not yet stable

    // Advance 6 seconds, send another sample at the same cell
    now += 6;
    const [sp2, an2] = makeWindSamples(20 * 0.514444, Math.PI / 2, 2_000_000_000n);
    b.publish(sp2);
    b.publish(an2);
    await new Promise((r) => setTimeout(r, 5));

    expect(seen.at(-1)!.changeNeeded.headsail).toBe(true);
    expect(seen.at(-1)!.changeNeeded.main).toBe(true);
    sub.unsubscribe();
  });
});
