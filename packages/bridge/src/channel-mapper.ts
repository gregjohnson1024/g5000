import { Channels, type Sample, type ChannelValue } from '@g5000/core';
import type { DecodedPgn } from './decoder.js';

type MapperFn = (pgn: DecodedPgn) => Sample[];

const scalar = (value: number, unit?: string): ChannelValue => ({
  kind: 'scalar',
  value,
  unit,
});

const sourceTag = (pgn: DecodedPgn): string =>
  `n2k:${pgn.pgn}@0x${pgn.src.toString(16).padStart(2, '0')}`;

const mappers: Record<number, MapperFn> = {
  // PGN 130306 — wind data (apparent or true reference).
  130306: (pgn) => {
    const ref = String(pgn.fields['Reference'] ?? '');
    const speed = pgn.fields['Wind Speed'];
    const angle = pgn.fields['Wind Angle'];
    const isApparent = ref === 'Apparent';
    const speedChan = isApparent ? Channels.Wind.ApparentSpeed : Channels.Wind.TrueSpeed;
    const angleChan = isApparent ? Channels.Wind.ApparentAngle : Channels.Wind.TrueAngle;
    const out: Sample[] = [];
    if (typeof speed === 'number') {
      out.push({
        channel: speedChan,
        t_ns: pgn.rxTimestamp,
        value: scalar(speed, 'm/s'),
        source: sourceTag(pgn),
      });
    }
    if (typeof angle === 'number') {
      out.push({
        channel: angleChan,
        t_ns: pgn.rxTimestamp,
        value: scalar(angle, 'rad'),
        source: sourceTag(pgn),
      });
    }
    return out;
  },

  // PGN 128259 — boat speed through water.
  128259: (pgn) => {
    const v = pgn.fields['Speed Water Referenced'];
    if (typeof v !== 'number') return [];
    return [
      {
        channel: Channels.Boat.SpeedWater,
        t_ns: pgn.rxTimestamp,
        value: scalar(v, 'm/s'),
        source: sourceTag(pgn),
      },
    ];
  },

  // PGN 127250 — vessel heading.
  127250: (pgn) => {
    const ref = String(pgn.fields['Reference'] ?? '');
    const v = pgn.fields['Heading'];
    if (typeof v !== 'number') return [];
    const channel = ref === 'True' ? Channels.Boat.HeadingTrue : Channels.Boat.HeadingMagnetic;
    return [
      {
        channel,
        t_ns: pgn.rxTimestamp,
        value: scalar(v, 'rad'),
        source: sourceTag(pgn),
      },
    ];
  },

  // PGN 127251 — rate of turn (rad/s).
  127251: (pgn) => {
    const v = pgn.fields['Rate of Turn'];
    if (typeof v !== 'number') return [];
    return [
      {
        channel: Channels.Motion.RateOfTurn,
        t_ns: pgn.rxTimestamp,
        value: scalar(v, 'rad/s'),
        source: sourceTag(pgn),
      },
    ];
  },

  // PGN 127257 — attitude (yaw/pitch/roll, all in radians).
  // Sailing convention: roll = heel.
  127257: (pgn) => {
    const yaw = pgn.fields['Yaw'];
    const pitch = pgn.fields['Pitch'];
    const roll = pgn.fields['Roll'];
    const out: Sample[] = [];
    if (typeof yaw === 'number') {
      out.push({
        channel: Channels.Motion.Yaw,
        t_ns: pgn.rxTimestamp,
        value: scalar(yaw, 'rad'),
        source: sourceTag(pgn),
      });
    }
    if (typeof pitch === 'number') {
      out.push({
        channel: Channels.Motion.Pitch,
        t_ns: pgn.rxTimestamp,
        value: scalar(pitch, 'rad'),
        source: sourceTag(pgn),
      });
    }
    if (typeof roll === 'number') {
      out.push({
        channel: Channels.Motion.Heel,
        t_ns: pgn.rxTimestamp,
        value: scalar(roll, 'rad'),
        source: sourceTag(pgn),
      });
    }
    return out;
  },
};

export function mapPgnToSamples(pgn: DecodedPgn): Sample[] {
  const fn = mappers[pgn.pgn];
  return fn ? fn(pgn) : [];
}
