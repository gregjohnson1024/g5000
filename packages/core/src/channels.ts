/**
 * Canonical channel-name constants. Add new channels here as features land;
 * the channel-mapper imports from this file so name changes refactor cleanly.
 */
export const Channels = {
  Wind: {
    ApparentAngle: 'wind.apparent.angle',
    ApparentSpeed: 'wind.apparent.speed',
    TrueAngle: 'wind.true.angle',
    TrueSpeed: 'wind.true.speed',
    TrueDirection: 'wind.true.direction',
  },
  Boat: {
    SpeedWater: 'boat.speed.water',
    HeadingMagnetic: 'boat.heading.magnetic',
    HeadingTrue: 'boat.heading.true',
    RudderAngle: 'boat.rudder.angle',
  },
  Nav: {
    Position: 'nav.gps.position',
    Cog: 'nav.gps.cog',
    Sog: 'nav.gps.sog',
    Depth: 'nav.depth',
  },
  Motion: {
    Heel: 'motion.heel',
    Pitch: 'motion.pitch',
    Yaw: 'motion.yaw',
    RateOfTurn: 'motion.rateOfTurn',
  },
} as const;
