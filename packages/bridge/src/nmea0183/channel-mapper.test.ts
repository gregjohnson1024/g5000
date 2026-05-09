import { describe, it, expect } from 'vitest';
import { Channels } from '@h6000/core';
import { mapSentenceToSamples } from './channel-mapper.js';
import type { Raw0183Sentence } from '../wire-driver.js';

const at = (text: string): Raw0183Sentence => ({
  text,
  port: 0,
  rxTimestamp: 1_700_000_000_000_000_000n,
});

describe('mapSentenceToSamples — MWV', () => {
  it('apparent wind to wind.apparent.angle and speed in m/s', () => {
    const samples = mapSentenceToSamples(at('$WIMWV,212.6,R,5.8,N,A*29'));
    const channels = samples.map((s) => s.channel);
    expect(channels).toContain(Channels.Wind.ApparentAngle);
    expect(channels).toContain(Channels.Wind.ApparentSpeed);
    const speed = samples.find((s) => s.channel === Channels.Wind.ApparentSpeed)?.value;
    expect(speed).toEqual({
      kind: 'scalar',
      value: 5.8 * 0.514444,
      unit: 'm/s',
    });
  });

  it('true wind reference goes to true.angle/speed', () => {
    const samples = mapSentenceToSamples(at('$WIMWV,212.6,T,5.8,N,A*2F'));
    const channels = samples.map((s) => s.channel);
    expect(channels).toContain(Channels.Wind.TrueAngle);
    expect(channels).toContain(Channels.Wind.TrueSpeed);
  });

  it('drops samples when status flag is V (invalid)', () => {
    const samples = mapSentenceToSamples(at('$WIMWV,212.6,R,5.8,N,V*3E'));
    expect(samples).toEqual([]);
  });
});

describe('mapSentenceToSamples — VHW', () => {
  it('extracts boat speed in m/s', () => {
    const samples = mapSentenceToSamples(at('$VWVHW,,T,,M,5.2,N,9.6,K*5C'));
    const ch = samples.map((s) => s.channel);
    expect(ch).toContain(Channels.Boat.SpeedWater);
    const v = samples.find((s) => s.channel === Channels.Boat.SpeedWater)?.value;
    expect(v).toEqual({
      kind: 'scalar',
      value: 5.2 * 0.514444,
      unit: 'm/s',
    });
  });
});

describe('mapSentenceToSamples — HDG', () => {
  it('extracts magnetic heading in radians', () => {
    const samples = mapSentenceToSamples(at('$HCHDG,98.3,1.2,W,5.6,E*62'));
    const ch = samples.map((s) => s.channel);
    expect(ch).toContain(Channels.Boat.HeadingMagnetic);
    const v = samples.find((s) => s.channel === Channels.Boat.HeadingMagnetic)?.value;
    expect(v).toEqual({
      kind: 'scalar',
      value: (98.3 * Math.PI) / 180,
      unit: 'rad',
    });
  });
});

describe('mapSentenceToSamples — VTG', () => {
  it('extracts cog (true) and sog', () => {
    const samples = mapSentenceToSamples(at('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48'));
    const ch = samples.map((s) => s.channel);
    expect(ch).toContain(Channels.Nav.Cog);
    expect(ch).toContain(Channels.Nav.Sog);
  });
});

describe('mapSentenceToSamples — unknown sentence types', () => {
  it('returns [] for an unmapped type', () => {
    const samples = mapSentenceToSamples(at('$GPGGA,,,,,,0,,,,,,,,*66'));
    expect(samples).toEqual([]);
  });

  it('returns [] when the sentence fails to parse', () => {
    const samples = mapSentenceToSamples(at('not a sentence'));
    expect(samples).toEqual([]);
  });
});

describe('mapSentenceToSamples — source tagging', () => {
  it('tags samples with port-aware source', () => {
    const samples = mapSentenceToSamples({
      text: '$WIMWV,212.6,R,5.8,N,A*29',
      port: 2,
      rxTimestamp: 1_700_000_000_000_000_000n,
    });
    expect(samples[0]?.source).toBe('0183:port2:WIMWV');
  });
});
