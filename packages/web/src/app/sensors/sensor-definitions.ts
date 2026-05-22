import { Channels } from '@g5000/core';

export type SensorId =
  | 'heading'
  | 'bsp'
  | 'apparent-wind'
  | 'gps'
  | 'depth'
  | 'motion'
  | 'battery';

export interface SensorDef {
  /** Stable id, used as React key and for persisted card-open state. */
  id: SensorId;
  /** Card header label. */
  label: string;
  /** Channels belonging to this sensor, in display order. The first is the
   * "primary" reading and gets prominent type in the card. */
  channels: string[];
  /** Optional link to the cal page for this sensor. Omitted when no page exists. */
  calPage?: { label: string; href: string };
  /** Static list of downstream pipelines that consume this sensor's readings.
   * Empty list ⇒ display-only sensor (currently: motion). */
  usedBy: string[];
}

/**
 * The seven v1 sensor cards on /sensors, in render order.
 *
 * "Directly used by" entries are hand-maintained — pipelines change slowly
 * enough that this is cheaper than runtime graph introspection. Update this
 * table when a new pipeline starts consuming a sensor's reading.
 */
export const SENSOR_DEFS: SensorDef[] = [
  {
    id: 'heading',
    label: 'Heading',
    channels: [
      Channels.Boat.HeadingMagnetic,
      Channels.Boat.HeadingTrue,
      Channels.Nav.MagVar,
    ],
    calPage: { label: 'Damping / heading offset', href: '/damping' },
    usedBy: [
      'True wind',
      'Layline angles',
      'COG–HDG comparison',
      'Polar %',
      'AIS bearing display',
    ],
  },
  {
    id: 'bsp',
    label: 'Speed through water (BSP)',
    channels: [Channels.Boat.SpeedWater],
    calPage: { label: 'Damping / BSP cal', href: '/damping' },
    usedBy: [
      'True wind',
      'VMG',
      'Polar %',
      'Current estimate',
      'Sail-timeline ETA',
    ],
  },
  {
    id: 'apparent-wind',
    label: 'Apparent wind',
    channels: [Channels.Wind.ApparentAngle, Channels.Wind.ApparentSpeed],
    calPage: { label: 'Damping / AWS-AWA', href: '/damping' },
    usedBy: [
      'True wind',
      'Polars and targets',
      'Race wind-shift detector',
      'Sail crossover',
      'VMC',
    ],
  },
  {
    id: 'gps',
    label: 'GPS',
    channels: [
      Channels.Nav.Position,
      Channels.Nav.Cog,
      Channels.Nav.CogMagnetic,
      Channels.Nav.Sog,
    ],
    usedBy: [
      'SOG',
      'COG',
      'VMC',
      'Distance / ETA',
      'Route plan',
      'AIS CPA',
      'Anchor watch',
      'Live boat marker',
      'Track recorder',
      'Start-line geometry',
    ],
  },
  {
    id: 'depth',
    label: 'Depth',
    channels: [Channels.Nav.Depth],
    usedBy: ['Anchor watch', 'Shallow alarm'],
  },
  {
    id: 'motion',
    label: 'Motion (IMU)',
    channels: [
      Channels.Motion.Heel,
      Channels.Motion.Pitch,
      Channels.Motion.Yaw,
      Channels.Motion.RateOfTurn,
    ],
    usedBy: [],
  },
  {
    id: 'battery',
    label: 'Battery',
    channels: [Channels.Electrical.BatteryVoltage],
    usedBy: ['Low-battery alarm (when configured)'],
  },
];
