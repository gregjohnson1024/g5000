import { describe, it, expect } from 'vitest';
import { mapPgnToSamples } from './channel-mapper.js';
import type { DecodedPgn } from './decoder.js';
import { Channels } from '@g5000/core';

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
});
