import { describe, it, expect } from 'vitest';
import { stateAtTime, type PlaybackRoute } from './route-playback.js';

const route: PlaybackRoute = {
  start: 1000,
  end: 1000 + 3600,
  legs: [
    { t: 1000, lat: 40, lon: -60, heading: 0, cog: 0, twa: 0.7, tws: 5, bsp: 2, sogGround: 2 },
    { t: 2800, lat: 41, lon: -60, heading: 0, cog: 0.1, twa: 0.8, tws: 6, bsp: 3, sogGround: 3 },
    { t: 4600, lat: 42, lon: -60, heading: 0, cog: 0.2, twa: 0.9, tws: 7, bsp: 4, sogGround: 4 },
  ],
};

it('interpolates position proportionally between two legs', () => {
  const s = stateAtTime(route, 1900); // halfway through leg 0→1
  expect(s.lat).toBeCloseTo(40.5, 3);
  expect(s.lon).toBeCloseTo(-60, 6);
});

it('clamps to start before route.start', () => {
  const s = stateAtTime(route, 0);
  expect(s.lat).toBeCloseTo(40, 6);
  expect(s.atEnd).toBe(false);
  expect(s.beforeStart).toBe(true);
});

it('clamps to destination after route.end', () => {
  const s = stateAtTime(route, 9999);
  expect(s.lat).toBeCloseTo(42, 6);
  expect(s.atEnd).toBe(true);
});

it('reports the active leg state (sog/cog/hdg/bsp)', () => {
  const s = stateAtTime(route, 1900);
  expect(s.sog).toBe(2);
  expect(s.bsp).toBe(2);
  expect(s.hdg).toBe(0);
  expect(s.cog).toBe(0); // active leg is leg index 0
  expect(s.tws).toBe(5);
  expect(s.twa).toBe(0.7);
});
