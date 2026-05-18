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

  // PGN 127237 — Heading/Track Control (standard autopilot).
  // We surface a useful subset; canboatjs's decoded field names match the
  // canboat database conventions: "Steering Mode", "Heading-To-Steer (Course)",
  // "Commanded Rudder Angle", "Vessel Heading", "Track".
  127237: (pgn) => {
    const out: Sample[] = [];
    const mode = pgn.fields['Steering Mode'];
    if (typeof mode === 'string') {
      out.push({
        channel: Channels.Autopilot.Mode,
        t_ns: pgn.rxTimestamp,
        value: { kind: 'enum', value: mode },
        source: sourceTag(pgn),
      });
    }
    const targetHdg = pgn.fields['Heading-To-Steer (Course)'];
    if (typeof targetHdg === 'number') {
      out.push({
        channel: Channels.Autopilot.TargetHeading,
        t_ns: pgn.rxTimestamp,
        value: scalar(targetHdg, 'rad'),
        source: sourceTag(pgn),
      });
    }
    const rudder = pgn.fields['Commanded Rudder Angle'];
    if (typeof rudder === 'number') {
      out.push({
        channel: Channels.Autopilot.CommandedRudder,
        t_ns: pgn.rxTimestamp,
        value: scalar(rudder, 'rad'),
        source: sourceTag(pgn),
      });
    }
    const actualHdg = pgn.fields['Vessel Heading'];
    if (typeof actualHdg === 'number') {
      out.push({
        channel: Channels.Autopilot.ActualHeading,
        t_ns: pgn.rxTimestamp,
        value: scalar(actualHdg, 'rad'),
        source: sourceTag(pgn),
      });
    }
    const track = pgn.fields['Track'];
    if (typeof track === 'number') {
      out.push({
        channel: Channels.Autopilot.TargetTrack,
        t_ns: pgn.rxTimestamp,
        value: scalar(track, 'rad'),
        source: sourceTag(pgn),
      });
    }
    return out;
  },

  // PGN 129025 — Position, Rapid Update (lat/lon only, ~10 Hz).
  129025: (pgn) => {
    const lat = pgn.fields['Latitude'];
    const lon = pgn.fields['Longitude'];
    if (typeof lat !== 'number' || typeof lon !== 'number') return [];
    return [
      {
        channel: Channels.Nav.Position,
        t_ns: pgn.rxTimestamp,
        value: { kind: 'geo', value: { lat, lon } },
        source: sourceTag(pgn),
      },
    ];
  },

  // PGN 129026 — COG & SOG, Rapid Update. COG can be reported in either True
  // or Magnetic reference; route to separate channels so the helm UI can
  // label the value with (T) / (M) without guessing.
  129026: (pgn) => {
    const cog = pgn.fields['COG'];
    const sog = pgn.fields['SOG'];
    const ref = String(pgn.fields['COG Reference'] ?? '');
    const out: Sample[] = [];
    if (typeof cog === 'number') {
      const cogChan = ref === 'Magnetic' ? Channels.Nav.CogMagnetic : Channels.Nav.Cog;
      out.push({
        channel: cogChan,
        t_ns: pgn.rxTimestamp,
        value: scalar(cog, 'rad'),
        source: sourceTag(pgn),
      });
    }
    if (typeof sog === 'number') {
      out.push({
        channel: Channels.Nav.Sog,
        t_ns: pgn.rxTimestamp,
        value: scalar(sog, 'm/s'),
        source: sourceTag(pgn),
      });
    }
    return out;
  },

  // PGN 127258 — Magnetic Variation. East-positive (NMEA 2000 convention).
  // True = Magnetic + Variation. The helm uses this to display HDG in True
  // when no device publishes true heading directly.
  127258: (pgn) => {
    const v = pgn.fields['Variation'];
    if (typeof v !== 'number') return [];
    return [
      {
        channel: Channels.Nav.MagVar,
        t_ns: pgn.rxTimestamp,
        value: scalar(v, 'rad'),
        source: sourceTag(pgn),
      },
    ];
  },

  // PGN 127508 — DC Battery Status. Multi-instance (house bank vs. start, etc.).
  // V1: pick instance 0 only and ignore the rest. A future spec will disambiguate
  // multiple banks once we have a UI for it.
  127508: (pgn) => {
    const instance = pgn.fields['Instance'];
    const voltage = pgn.fields['Voltage'];
    if (instance !== 0) return [];
    if (typeof voltage !== 'number') return [];
    return [
      {
        channel: Channels.Electrical.BatteryVoltage,
        t_ns: pgn.rxTimestamp,
        value: scalar(voltage, 'V'),
        source: sourceTag(pgn),
      },
    ];
  },

  // PGN 128267 — Water Depth. We publish the raw transducer depth (the
  // `Depth` field, meters below transducer) on `nav.depth`. The `Offset`
  // field is intentionally ignored in v1 — alarms config has the user
  // dial in a threshold matching whatever reference their depth sounder
  // is reporting (below-transducer vs. below-keel vs. below-waterline).
  128267: (pgn) => {
    const v = pgn.fields['Depth'];
    if (typeof v !== 'number' || !Number.isFinite(v)) return [];
    return [
      {
        channel: Channels.Nav.Depth,
        t_ns: pgn.rxTimestamp,
        value: scalar(v, 'm'),
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
