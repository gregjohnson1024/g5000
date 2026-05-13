import { describe, it, expect, beforeEach } from 'vitest';
import { mapPgnToSamples } from './channel-mapper.js';
import type { DecodedPgn } from './decoder.js';
import { Channels, _resetAisTargetsForTests, getSharedAisTargets } from '@g5000/core';
import { handleAisPgn, isAisPgn } from './ais/ais-handler.js';
import { createAisTargetsRegistry } from './ais/targets-registry.js';

const make = (pgn: number, fields: Record<string, unknown>): DecodedPgn => ({
  pgn,
  prio: 2,
  src: 17,
  dst: 255,
  fields,
  rxTimestamp: 1_700_000_000_000_000_000n,
});

describe('mapPgnToSamples', () => {
  it('maps PGN 130306 wind fields to apparent angle and speed', () => {
    const decoded = make(130306, {
      'Wind Speed': 5.2,
      'Wind Angle': 0.785, // radians (~45°)
      Reference: 'Apparent',
    });
    const samples = mapPgnToSamples(decoded);
    const channels = samples.map((s) => s.channel);
    expect(channels).toContain(Channels.Wind.ApparentSpeed);
    expect(channels).toContain(Channels.Wind.ApparentAngle);
    const angle = samples.find((s) => s.channel === Channels.Wind.ApparentAngle);
    expect(angle?.value).toEqual({
      kind: 'scalar',
      value: 0.785,
      unit: 'rad',
    });
  });

  it('maps PGN 130306 wind with True reference to true.angle/speed', () => {
    const decoded = make(130306, {
      'Wind Speed': 7.5,
      'Wind Angle': 1.05,
      Reference: 'True (boat referenced)',
    });
    const samples = mapPgnToSamples(decoded);
    const channels = samples.map((s) => s.channel);
    expect(channels).toContain(Channels.Wind.TrueAngle);
    expect(channels).toContain(Channels.Wind.TrueSpeed);
  });

  it('maps PGN 128259 to boat.speed.water', () => {
    const decoded = make(128259, { 'Speed Water Referenced': 3.4 });
    const samples = mapPgnToSamples(decoded);
    expect(samples.map((s) => s.channel)).toEqual([Channels.Boat.SpeedWater]);
    expect(samples[0]?.value).toEqual({
      kind: 'scalar',
      value: 3.4,
      unit: 'm/s',
    });
  });

  it('maps PGN 127250 magnetic heading to boat.heading.magnetic', () => {
    const decoded = make(127250, {
      Heading: 1.234,
      Reference: 'Magnetic',
    });
    const samples = mapPgnToSamples(decoded);
    expect(samples.map((s) => s.channel)).toEqual([Channels.Boat.HeadingMagnetic]);
  });

  it('returns empty array for unknown PGN', () => {
    const decoded = make(999999, { irrelevant: 1 });
    expect(mapPgnToSamples(decoded)).toEqual([]);
  });

  it('tags samples with a source identifying the PGN and source addr', () => {
    const decoded = make(128259, { 'Speed Water Referenced': 3.4 });
    const samples = mapPgnToSamples(decoded);
    expect(samples[0]?.source).toBe('n2k:128259@0x11');
  });

  it('maps PGN 127251 rate-of-turn to motion.rateOfTurn', () => {
    const decoded = make(127251, { 'Rate of Turn': 0.0123 });
    const samples = mapPgnToSamples(decoded);
    expect(samples.map((s) => s.channel)).toEqual([Channels.Motion.RateOfTurn]);
    expect(samples[0]?.value).toEqual({
      kind: 'scalar',
      value: 0.0123,
      unit: 'rad/s',
    });
  });

  it('maps PGN 129025 lat/lon to nav.gps.position as a geo value', () => {
    const decoded = make(129025, { Latitude: 32.7833, Longitude: -64.8333 });
    const samples = mapPgnToSamples(decoded);
    expect(samples.map((s) => s.channel)).toEqual([Channels.Nav.Position]);
    expect(samples[0]?.value).toEqual({
      kind: 'geo',
      value: { lat: 32.7833, lon: -64.8333 },
    });
  });

  it('skips PGN 129025 when lat or lon is missing/non-numeric', () => {
    expect(mapPgnToSamples(make(129025, { Latitude: 'n/a', Longitude: -64.8 }))).toEqual([]);
    expect(mapPgnToSamples(make(129025, { Latitude: 32.7 }))).toEqual([]);
  });

  it('maps PGN 129026 to nav.gps.cog and nav.gps.sog', () => {
    const decoded = make(129026, { 'COG Reference': 'True', COG: 5.27, SOG: 3.6 });
    const samples = mapPgnToSamples(decoded);
    const channels = samples.map((s) => s.channel).sort();
    expect(channels).toEqual([Channels.Nav.Cog, Channels.Nav.Sog].sort());
    expect(samples.find((s) => s.channel === Channels.Nav.Cog)?.value).toEqual({
      kind: 'scalar',
      value: 5.27,
      unit: 'rad',
    });
    expect(samples.find((s) => s.channel === Channels.Nav.Sog)?.value).toEqual({
      kind: 'scalar',
      value: 3.6,
      unit: 'm/s',
    });
  });

  it('maps PGN 127257 attitude to heel, pitch, yaw', () => {
    const decoded = make(127257, {
      Yaw: 1.23,
      Pitch: -0.05,
      Roll: 0.18,
    });
    const samples = mapPgnToSamples(decoded);
    const channels = samples.map((s) => s.channel).sort();
    expect(channels).toEqual(
      [Channels.Motion.Heel, Channels.Motion.Pitch, Channels.Motion.Yaw].sort(),
    );
    const heel = samples.find((s) => s.channel === Channels.Motion.Heel);
    expect(heel?.value).toEqual({ kind: 'scalar', value: 0.18, unit: 'rad' });
  });

  it('maps PGN 127237 steering mode to autopilot.mode', () => {
    const decoded = make(127237, {
      'Steering Mode': 'Heading Control',
      'Heading-To-Steer (Course)': 1.234,
      'Commanded Rudder Angle': -0.05,
      'Vessel Heading': 1.22,
    });
    const samples = mapPgnToSamples(decoded);
    const byCh = new Map(samples.map((s) => [s.channel, s]));
    expect(byCh.get(Channels.Autopilot.Mode)?.value).toEqual({
      kind: 'enum',
      value: 'Heading Control',
    });
    expect(byCh.get(Channels.Autopilot.TargetHeading)?.value).toEqual({
      kind: 'scalar',
      value: 1.234,
      unit: 'rad',
    });
    expect(byCh.get(Channels.Autopilot.CommandedRudder)?.value).toEqual({
      kind: 'scalar',
      value: -0.05,
      unit: 'rad',
    });
    expect(byCh.get(Channels.Autopilot.ActualHeading)?.value).toEqual({
      kind: 'scalar',
      value: 1.22,
      unit: 'rad',
    });
  });

  it('maps PGN 127237 with track field to autopilot.target.track', () => {
    const decoded = make(127237, {
      'Steering Mode': 'Track Control',
      Track: 0.5,
    });
    const samples = mapPgnToSamples(decoded);
    const byCh = new Map(samples.map((s) => [s.channel, s]));
    expect(byCh.get(Channels.Autopilot.TargetTrack)?.value).toEqual({
      kind: 'scalar',
      value: 0.5,
      unit: 'rad',
    });
  });

  it('omits missing fields gracefully', () => {
    const decoded = make(127237, {
      // Only mode present
      'Steering Mode': 'Standby',
    });
    const samples = mapPgnToSamples(decoded);
    const channels = new Set(samples.map((s) => s.channel));
    expect(channels.has(Channels.Autopilot.Mode)).toBe(true);
    expect(channels.has(Channels.Autopilot.TargetHeading)).toBe(false);
  });

  it('does NOT publish samples for AIS PGNs (they feed the registry instead)', () => {
    // AIS PGNs deliberately have no mapper entry — they go through the
    // separate ais-handler pipeline so we don't proliferate per-MMSI channels
    // on the bus.
    const decoded = make(129038, { 'User ID': 12345, Latitude: 40, Longitude: -74 });
    expect(mapPgnToSamples(decoded)).toEqual([]);
  });
});

describe('AIS PGN handler', () => {
  beforeEach(() => _resetAisTargetsForTests());

  it('isAisPgn() recognises the v1 AIS PGN set', () => {
    expect(isAisPgn(129038)).toBe(true);
    expect(isAisPgn(129039)).toBe(true);
    expect(isAisPgn(129040)).toBe(true);
    expect(isAisPgn(129794)).toBe(true);
    expect(isAisPgn(129809)).toBe(true);
    expect(isAisPgn(129810)).toBe(true);
    expect(isAisPgn(127250)).toBe(false);
    expect(isAisPgn(130306)).toBe(false);
  });

  it('decodes a 129038 Class A position into the registry', () => {
    createAisTargetsRegistry();
    handleAisPgn(129038, {
      'User ID': 538003154,
      Longitude: -74.123,
      Latitude: 40.456,
      COG: 1.23,
      SOG: 5.5,
      Heading: 1.22,
      'Rate of Turn': 0.001,
    });
    const r = getSharedAisTargets()!;
    const t = r.get(538003154)!;
    expect(t.vesselClass).toBe('A');
    expect(t.lat).toBeCloseTo(40.456);
    expect(t.lon).toBeCloseTo(-74.123);
    expect(t.sog).toBe(5.5);
    expect(t.cog).toBe(1.23);
    expect(t.heading).toBe(1.22);
    expect(t.rateOfTurn).toBe(0.001);
  });

  it('handles 129040 Class B extended (True Heading + Type of ship)', () => {
    createAisTargetsRegistry();
    handleAisPgn(129040, {
      'User ID': 367123456,
      Latitude: 40,
      Longitude: -74,
      COG: 0.5,
      SOG: 3,
      'True Heading': 0.6,
      'Type of ship': 36,
      Length: 80,
      Beam: 15,
      Name: 'PASSENGER VESSEL',
    });
    const t = getSharedAisTargets()!.get(367123456)!;
    expect(t.vesselClass).toBe('B');
    expect(t.heading).toBe(0.6);
    expect(t.vesselType).toBe(36);
    expect(t.length).toBe(80);
    expect(t.beam).toBe(15);
    expect(t.name).toBe('PASSENGER VESSEL');
  });

  it('ignores PGNs without a valid MMSI', () => {
    createAisTargetsRegistry();
    expect(handleAisPgn(129038, { 'User ID': 0, Latitude: 1, Longitude: 2 })).toBe(false);
    expect(handleAisPgn(129038, { Latitude: 1, Longitude: 2 })).toBe(false);
    expect(handleAisPgn(129038, { 'User ID': 'not-a-number', Latitude: 1 })).toBe(false);
    expect(getSharedAisTargets()!.all()).toEqual([]);
  });

  it('ignores non-AIS PGNs', () => {
    createAisTargetsRegistry();
    expect(handleAisPgn(127250, { 'User ID': 123, Heading: 1.5 })).toBe(false);
    expect(getSharedAisTargets()!.all()).toEqual([]);
  });

  it('merges static-data PGN (129809) into existing target', () => {
    const r = createAisTargetsRegistry();
    handleAisPgn(129039, { 'User ID': 99, Latitude: 10, Longitude: 20, SOG: 4 });
    handleAisPgn(129809, { 'User ID': 99, Name: 'TEST VESSEL' });
    const t = r.get(99)!;
    expect(t.name).toBe('TEST VESSEL');
    expect(t.lat).toBe(10);
    expect(t.lon).toBe(20);
    expect(t.sog).toBe(4);
  });

  it('merges 129810 Part B static data (vesselType/length/beam)', () => {
    const r = createAisTargetsRegistry();
    handleAisPgn(129809, { 'User ID': 200, Name: 'SAILBOAT' });
    handleAisPgn(129810, {
      'User ID': 200,
      'Type of ship': 36,
      Length: 12,
      Beam: 4,
    });
    const t = r.get(200)!;
    expect(t.name).toBe('SAILBOAT');
    expect(t.vesselType).toBe(36);
    expect(t.length).toBe(12);
    expect(t.beam).toBe(4);
  });

  it('lazily creates the registry if no one called createAisTargetsRegistry() first', () => {
    expect(getSharedAisTargets()).toBeUndefined();
    handleAisPgn(129038, { 'User ID': 555, Latitude: 1, Longitude: 1 });
    expect(getSharedAisTargets()).toBeDefined();
    expect(getSharedAisTargets()!.get(555)).toBeDefined();
  });

  it('accepts camelCase field names as fallback (canboatjs version drift safety)', () => {
    createAisTargetsRegistry();
    handleAisPgn(129038, {
      userId: 1001,
      latitude: 40,
      longitude: -74,
      cog: 1,
      sog: 2,
    });
    const t = getSharedAisTargets()!.get(1001)!;
    expect(t.lat).toBe(40);
    expect(t.lon).toBe(-74);
    expect(t.cog).toBe(1);
    expect(t.sog).toBe(2);
  });
});
