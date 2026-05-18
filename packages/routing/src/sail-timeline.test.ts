import { describe, expect, it } from 'vitest';
import { computeSailTimeline } from './sail-timeline.js';
import type { RouteLeg } from './types.js';

function leg(t: number, configId: string): RouteLeg {
  return {
    t,
    lat: 30,
    lon: -70,
    heading: 0,
    twa: 0,
    tws: 0,
    bsp: 5,
    sogGround: 5,
    configId,
  };
}

describe('computeSailTimeline', () => {
  it('returns one segment when all legs share a config', () => {
    const legs = [leg(0, 'a'), leg(3600, 'a'), leg(7200, 'a')];
    const timeline = computeSailTimeline(legs);
    expect(timeline.length).toBe(1);
    expect(timeline[0]!.configId).toBe('a');
  });

  it('merges adjacent same-config legs and emits one segment per run', () => {
    const legs = [
      leg(0, 'a'),
      leg(3600, 'a'),
      leg(7200, 'b'),
      leg(10800, 'b'),
      leg(14400, 'a'),
    ];
    const timeline = computeSailTimeline(legs);
    expect(timeline.map((s) => s.configId)).toEqual(['a', 'b', 'a']);
  });

  it('absorbs runs shorter than 15 minutes into the surrounding segment', () => {
    const legs = [
      leg(0, 'a'),
      leg(60 * 60, 'a'), // 'a' from 0-60min
      leg(60 * 65, 'b'), // 'b' for 5 min (absorbed)
      leg(60 * 70, 'a'), // 'a' continues
      leg(60 * 130, 'a'),
    ];
    const timeline = computeSailTimeline(legs);
    expect(timeline.map((s) => s.configId)).toEqual(['a']);
  });

  it('returns empty array when no leg has a configId', () => {
    const legs: RouteLeg[] = [
      { t: 0, lat: 0, lon: 0, heading: 0, twa: 0, tws: 0, bsp: 5, sogGround: 5 },
    ];
    expect(computeSailTimeline(legs)).toEqual([]);
  });
});
