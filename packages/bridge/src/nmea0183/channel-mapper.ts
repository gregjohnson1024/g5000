import { Channels, type Sample, type ChannelValue } from '@g5000/core';
import { parseSentence, type ParsedSentence } from './sentence-parser.js';
import type { Raw0183Sentence } from '../wire-driver.js';

const KNOTS_TO_MS = 0.514444;
const DEG_TO_RAD = Math.PI / 180;

const scalar = (value: number, unit?: string): ChannelValue => ({
  kind: 'scalar',
  value,
  unit,
});

const sourceTag = (raw: Raw0183Sentence, addr: string): string => `0183:port${raw.port}:${addr}`;

type Mapper = (parsed: ParsedSentence, raw: Raw0183Sentence) => Sample[];

const mappers: Record<string, Mapper> = {
  // MWV: Wind angle and speed (apparent or true reference).
  // Fields: [ angle_deg, R|T, speed, K|M|N, status_A|V ]
  MWV: (s, raw) => {
    const status = s.fields[4] ?? '';
    if (status !== 'A') return [];
    const angleDeg = Number(s.fields[0]);
    const ref = s.fields[1] ?? '';
    const speedRaw = Number(s.fields[2]);
    const unit = s.fields[3] ?? '';
    if (!Number.isFinite(angleDeg) || !Number.isFinite(speedRaw)) return [];
    const speed = unit === 'N' ? speedRaw * KNOTS_TO_MS : unit === 'K' ? speedRaw / 3.6 : speedRaw;
    const isApparent = ref === 'R';
    const out: Sample[] = [];
    out.push({
      channel: isApparent ? Channels.Wind.ApparentAngle : Channels.Wind.TrueAngle,
      t_ns: raw.rxTimestamp,
      value: scalar(angleDeg * DEG_TO_RAD, 'rad'),
      source: sourceTag(raw, `${s.talker}${s.type}`),
    });
    out.push({
      channel: isApparent ? Channels.Wind.ApparentSpeed : Channels.Wind.TrueSpeed,
      t_ns: raw.rxTimestamp,
      value: scalar(speed, 'm/s'),
      source: sourceTag(raw, `${s.talker}${s.type}`),
    });
    return out;
  },

  // VHW: Water speed and heading.
  // Fields: [ heading_T, T, heading_M, M, speed_kn, N, speed_km, K ]
  VHW: (s, raw) => {
    const speedKn = Number(s.fields[4]);
    if (!Number.isFinite(speedKn)) return [];
    return [
      {
        channel: Channels.Boat.SpeedWater,
        t_ns: raw.rxTimestamp,
        value: scalar(speedKn * KNOTS_TO_MS, 'm/s'),
        source: sourceTag(raw, `${s.talker}${s.type}`),
      },
    ];
  },

  // HDG: Heading, deviation and variation.
  // Fields: [ heading_deg, deviation, dev_dir(E|W), variation, var_dir(E|W) ]
  HDG: (s, raw) => {
    const headingDeg = Number(s.fields[0]);
    if (!Number.isFinite(headingDeg)) return [];
    return [
      {
        channel: Channels.Boat.HeadingMagnetic,
        t_ns: raw.rxTimestamp,
        value: scalar(headingDeg * DEG_TO_RAD, 'rad'),
        source: sourceTag(raw, `${s.talker}${s.type}`),
      },
    ];
  },

  // VTG: Course and speed over ground.
  // Fields: [ cog_T, T, cog_M, M, sog_kn, N, sog_km, K ]
  VTG: (s, raw) => {
    const cogTrueDeg = Number(s.fields[0]);
    const sogKn = Number(s.fields[4]);
    const out: Sample[] = [];
    if (Number.isFinite(cogTrueDeg)) {
      out.push({
        channel: Channels.Nav.Cog,
        t_ns: raw.rxTimestamp,
        value: scalar(cogTrueDeg * DEG_TO_RAD, 'rad'),
        source: sourceTag(raw, `${s.talker}${s.type}`),
      });
    }
    if (Number.isFinite(sogKn)) {
      out.push({
        channel: Channels.Nav.Sog,
        t_ns: raw.rxTimestamp,
        value: scalar(sogKn * KNOTS_TO_MS, 'm/s'),
        source: sourceTag(raw, `${s.talker}${s.type}`),
      });
    }
    return out;
  },
};

export function mapSentenceToSamples(raw: Raw0183Sentence): Sample[] {
  const parsed = parseSentence(raw.text);
  if (!parsed.ok) return [];
  const fn = mappers[parsed.sentence.type];
  return fn ? fn(parsed.sentence, raw) : [];
}
