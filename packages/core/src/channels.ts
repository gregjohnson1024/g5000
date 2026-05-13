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
    /** Course over ground, True reference. */
    Cog: 'nav.gps.cog',
    /** Course over ground, Magnetic reference. Some devices publish this instead of true. */
    CogMagnetic: 'nav.gps.cog.magnetic',
    Sog: 'nav.gps.sog',
    Depth: 'nav.depth',
  },
  Motion: {
    Heel: 'motion.heel',
    Pitch: 'motion.pitch',
    Yaw: 'motion.yaw',
    RateOfTurn: 'motion.rateOfTurn',
  },
  Autopilot: {
    /** Steering mode (enum from PGN 127237: "Heading Control", "Track Control", etc.). */
    Mode: 'autopilot.mode',
    /** Heading-To-Steer in radians [0, 2π). */
    TargetHeading: 'autopilot.target.heading',
    /** Commanded rudder angle in radians (signed; +stbd, -port). */
    CommandedRudder: 'autopilot.commandedRudder',
    /** Vessel heading per autopilot's own reference, radians. */
    ActualHeading: 'autopilot.actual.heading',
    /** Track-to-steer in radians when in Track Control mode. */
    TargetTrack: 'autopilot.target.track',
  },
} as const;
