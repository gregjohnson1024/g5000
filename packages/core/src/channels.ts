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
  /** Active sail-crossover recommendation (current config + suggested config + stability). */
  SAIL_RECOMMENDATION: 'sail.recommendation',
  Boat: {
    SpeedWater: 'boat.speed.water',
    HeadingMagnetic: 'boat.heading.magnetic',
    HeadingTrue: 'boat.heading.true',
    RudderAngle: 'boat.rudder.angle',
    /** Leeway angle estimate, radians (signed; lee positive). */
    Leeway: 'boat.leeway',
  },
  Nav: {
    Position: 'nav.gps.position',
    /** Course over ground, True reference. */
    Cog: 'nav.gps.cog',
    /** Course over ground, Magnetic reference. Some devices publish this instead of true. */
    CogMagnetic: 'nav.gps.cog.magnetic',
    Sog: 'nav.gps.sog',
    Depth: 'nav.depth',
    /** Magnetic variation in radians; East-positive (NMEA 2000 convention).
     *  True = Magnetic + Variation. */
    MagVar: 'nav.magvar',
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
  Electrical: {
    /** Battery bank DC voltage in volts. Currently mapped from PGN 127508,
     *  lowest-instance battery. Future: instance-disambiguation. */
    BatteryVoltage: 'electrical.battery.voltage',
  },
  Race: {
    /** Signed perpendicular distance from boat to start line, meters.
     *  Positive = boat is on the pre-start side. Sign flips on crossing.
     *  Published only when both line ends are pinged. */
    LineDistanceToLine: 'race.line.distanceToLine',
    /** Haversine distance to the port end of the line, meters. */
    LineDistancePort: 'race.line.distancePort',
    /** Haversine distance to the starboard end of the line, meters. */
    LineDistanceStbd: 'race.line.distanceStbd',
    /** Seconds to cross the line at current SOG·cos(angle). Null when
     *  closing speed is non-positive (boat moving away or parallel). */
    LineTimeToLine: 'race.line.timeToLine',
    /** Line bias, radians. Positive = port end favored upwind. Requires
     *  wind.true.direction. */
    LineBias: 'race.line.bias',
    /** Predicted on-course-side (over-early) flag. True if boat would
     *  cross line before startMs at current vector, projected over
     *  settings.ocsLookAheadSec. */
    LineOcsPredicted: 'race.line.ocsPredicted',
    /** Velocity-Made-good toward the active mark, m/s. Wind-free. */
    Vmc: 'race.vmc',
    /** Target boat speed (polar-interpolated) at current TWS, |TWA|, m/s. */
    TargetSpeed: 'race.targetSpeed',
    /** Target TWA (optimal-VMG) at current TWS, radians. */
    TargetTwa: 'race.targetTwa',
    /** Percent of polar = BSP / TBS · 100. */
    PercentPolar: 'race.percentPolar',
    /** Signed wind shift vs 5-min baseline, radians. */
    WindShiftBias: 'race.windShift.bias',
    /** One-shot event channel: emits when shift persists > 60s above threshold. */
    WindShiftEvent: 'race.windShift.event',
    /** Polyline projection of the port-tack layline, array of {lat,lon}. */
    LaylinePort: 'race.laylines.port',
    /** Polyline projection of the starboard-tack layline. */
    LaylineStbd: 'race.laylines.stbd',
  },
  Groove: {
    /** Point of sail: 'upwind' | 'reaching' | 'downwind' | 'not-sailing'. */
    PointOfSail: 'groove.pointOfSail',
    /** Who is steering: 'human' | 'autopilot'. */
    HelmSource: 'groove.helmSource',
    /** Instantaneous in-groove flag: enum 'in' | 'out'. */
    InGroove: 'groove.inGroove',
    /** Time-weighted % of the rolling window spent in-groove. */
    TimeInGroove: 'groove.timeInGroove',
    /** VMG efficiency %, point-of-sail-correct. */
    VmgEfficiency: 'groove.vmgEfficiency',
    /** VMG to/from the wind, m/s. */
    Vmg: 'groove.vmg',
    /** |TWA| − targetTwa, radians (signed: + footing, − pinching). */
    TargetTwaError: 'groove.targetTwaError',
    /** Circular std-dev of TWA over the window, radians. */
    TwaSteadiness: 'groove.twaSteadiness',
    /** Coefficient of variation of STW over the window (dimensionless). */
    SpeedCv: 'groove.speedCv',
    /** Rudder reversals per minute over the window. */
    SteeringEffort: 'groove.steeringEffort',
    /** Max rising slope of STW over the window, m/s². */
    BuildRate: 'groove.buildRate',
  },
  Tide: {
    /** Active tide station name. */
    Station: 'tide.station',
    /** Active tide source: 'admiralty' | 'chs'. */
    Source: 'tide.source',
    /** Interpolated height now, metres above Chart Datum (suppressed when no bracketing pair). */
    HeightNow: 'tide.heightNow',
    /** Tide state: 'rising' | 'falling' | 'stand' (height concept, not current slack). */
    State: 'tide.state',
    /** Next tidal event type: 'HW' | 'LW'. */
    NextEventType: 'tide.nextEventType',
    /** Seconds until the next tidal event. */
    NextEventInSec: 'tide.nextEventInSec',
    /** Height of the next tidal event, metres above Chart Datum. */
    NextEventHeight: 'tide.nextEventHeight',
  },
} as const;
