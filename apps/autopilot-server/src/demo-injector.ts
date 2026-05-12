import type { Bus, VesselClass } from '@g5000/core';
import { createAisTargetsRegistry } from '@g5000/bridge';

const KN = 0.514444;
const DEG = Math.PI / 180;
const NM = 1852;
const M_PER_DEG_LAT = 111_320;

// Own-boat home position — Ottawa-ish so the synthetic AIS targets have
// realistic lat/lon values. Anything plausible would work; this is purely
// cosmetic for the /chart page.
const OWN_LAT = 45.0;
const OWN_LON = -75.0;

interface SyntheticTarget {
  mmsi: number;
  name: string;
  vesselClass: VesselClass;
  /** Initial lat/lon (degrees). Updated forward each tick by cog/sog. */
  lat: number;
  lon: number;
  /** Course over ground (radians, 0 = N, π/2 = E). */
  cog: number;
  /** Speed over ground (m/s). */
  sog: number;
  vesselType?: number;
  length?: number;
  beam?: number;
}

/**
 * Place a target at a bearing/range from own-pos. Bearing in radians, compass
 * convention (0 = N, +ve = E).
 */
function targetFromBearing(
  ownLat: number,
  ownLon: number,
  bearingRad: number,
  rangeM: number,
): { lat: number; lon: number } {
  const ownLatRad = (ownLat * Math.PI) / 180;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(ownLatRad);
  const dx = rangeM * Math.sin(bearingRad); // east meters
  const dy = rangeM * Math.cos(bearingRad); // north meters
  return {
    lat: ownLat + dy / M_PER_DEG_LAT,
    lon: ownLon + dx / mPerDegLon,
  };
}

/** Build the initial synthetic target set, positioned relative to own. */
function buildSyntheticTargets(ownLat: number, ownLon: number): SyntheticTarget[] {
  const t1 = targetFromBearing(ownLat, ownLon, 30 * DEG, 2 * NM);
  const t2 = targetFromBearing(ownLat, ownLon, -45 * DEG, 3 * NM);
  // Place the close-range target slightly off the collision line so it's a
  // genuine threat (CPA below 1 NM but not exactly 0).
  const t3 = targetFromBearing(ownLat, ownLon, 90 * DEG, 0.8 * NM);
  return [
    {
      mmsi: 538003154,
      name: 'TANKER ONE',
      vesselClass: 'A',
      lat: t1.lat,
      lon: t1.lon,
      cog: Math.PI, // heading S — toward own
      sog: 8 * KN,
      vesselType: 80,
      length: 200,
      beam: 30,
    },
    {
      mmsi: 367123456,
      name: 'FERRY OUTBOUND',
      vesselClass: 'B',
      lat: t2.lat,
      lon: t2.lon,
      cog: Math.PI / 4, // NE
      sog: 6 * KN,
      vesselType: 60,
      length: 80,
      beam: 15,
    },
    {
      mmsi: 211222333,
      name: 'SAILBOAT NEAR',
      vesselClass: 'B',
      lat: t3.lat,
      lon: t3.lon,
      cog: Math.PI, // heading S — crosses own's path
      sog: 5 * KN,
      vesselType: 36,
      length: 12,
      beam: 4,
    },
  ];
}

/**
 * Dead-reckon a target forward by `dtSeconds` based on its cog + sog.
 */
function advance(target: SyntheticTarget, dtSeconds: number, originLat: number): void {
  const dEast = target.sog * Math.sin(target.cog) * dtSeconds;
  const dNorth = target.sog * Math.cos(target.cog) * dtSeconds;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  target.lat += dNorth / M_PER_DEG_LAT;
  target.lon += dEast / mPerDegLon;
}

/**
 * Periodically publish synthetic wind/boat/motion samples to the shared bus.
 * Used for bench-side visual validation of /helm, /polars, /chart, capture
 * wizards, etc. when no real boat hardware is available. The values aren't
 * physically consistent — TWS/TWA/BSP just oscillate independently — but
 * they're plausible enough to demo the UI.
 *
 * Also populates the shared AIS targets registry with 3 synthetic vessels
 * that dead-reckon forward each tick, so /chart shows meaningful traffic.
 */
export function startDemoInjector(bus: Bus): () => void {
  const startedAt = Date.now();
  const aisRegistry = createAisTargetsRegistry();
  // Mutable own-boat position so it advances each tick consistently with the
  // published sog+cog. If we leave own.position fixed while publishing nonzero
  // sog, the CPA math sees a phantom own-velocity against a stationary position
  // and computes nonsense TCPAs.
  let ownLat = OWN_LAT;
  let ownLon = OWN_LON;
  const targets = buildSyntheticTargets(ownLat, ownLon);
  let lastTickMs = startedAt;

  const id = setInterval(() => {
    const now = Date.now();
    const t = (now - startedAt) / 1000; // seconds since start
    const dt = (now - lastTickMs) / 1000;
    lastTickMs = now;

    // Slow TWS oscillation 8 ± 4 kn (period ~2 min)
    const twsKn = 8 + 4 * Math.sin(t / 20);
    const tws = twsKn * KN;
    // TWA sweeps 30°-150° (period ~1 min)
    const twaDeg = 90 + 60 * Math.sin(t / 10);
    const twa = twaDeg * DEG;
    // BSP roughly 70% of TWS at the current TWA (rough cat polar shape)
    const bspKn = twsKn * 0.7 * Math.sin(Math.abs(twa)) + 0.5;
    const bsp = bspKn * KN;
    // Slowly turning heading (one full rotation every 6 min)
    const hdgDeg = (t / 60) * 60;
    const hdg = (((hdgDeg % 360) + 360) % 360) * DEG;
    const now_ns = BigInt(now) * 1_000_000n;
    const pub = (channel: string, value: number, unit: string) => {
      bus.publish({
        channel,
        t_ns: now_ns,
        value: { kind: 'scalar', value, unit },
        source: 'demo',
      });
    };
    // Apparent wind — rough approximation, leaves visible numbers on /inspect.
    pub('wind.apparent.speed', tws + bsp * 0.4, 'm/s');
    pub('wind.apparent.angle', twa * 0.8, 'rad');
    // Calibrated true wind — published directly so the polar pipeline sees it
    // without needing the true-wind compute pipeline to run.
    pub('wind.true.speed', tws, 'm/s');
    pub('wind.true.angle', twa, 'rad');
    pub('wind.true.direction', (hdg + twa + 2 * Math.PI) % (2 * Math.PI), 'rad');
    pub('boat.speed.water', bsp, 'm/s');
    pub('boat.heading.magnetic', hdg, 'rad');
    const ownCog = hdg + 0.03;
    const ownSog = bsp + 0.08;
    pub('nav.gps.cog', ownCog, 'rad');
    pub('nav.gps.sog', ownSog, 'm/s');

    // Advance own position consistently with the published velocity so that
    // own.position and own.cog/sog tell the same story — otherwise CPA math
    // computes against a phantom velocity.
    const ownDEast = ownSog * Math.sin(ownCog) * dt;
    const ownDNorth = ownSog * Math.cos(ownCog) * dt;
    const mPerDegLonAtOwn = M_PER_DEG_LAT * Math.cos((ownLat * Math.PI) / 180);
    ownLat += ownDNorth / M_PER_DEG_LAT;
    ownLon += ownDEast / mPerDegLonAtOwn;
    pub('motion.heel', 0.08 * Math.sin(t / 7), 'rad');
    pub('motion.pitch', 0.03 * Math.cos(t / 5), 'rad');
    pub('motion.yaw', hdg, 'rad');
    pub('motion.rateOfTurn', 0.01, 'rad/s');

    // Own-boat position as a geo sample. /chart needs this for CPA math.
    bus.publish({
      channel: 'nav.gps.position',
      t_ns: now_ns,
      value: { kind: 'geo', value: { lat: ownLat, lon: ownLon } },
      source: 'demo',
    });

    // Advance the synthetic AIS targets and upsert into the registry. The
    // SAILBOAT NEAR target stays in CPA-alarm range for the first few minutes
    // of the demo so the /chart alarm UI shows a threat right away.
    for (const target of targets) {
      advance(target, dt, ownLat);
      aisRegistry.upsert({
        mmsi: target.mmsi,
        vesselClass: target.vesselClass,
        name: target.name,
        lat: target.lat,
        lon: target.lon,
        cog: target.cog,
        sog: target.sog,
        heading: target.cog,
        vesselType: target.vesselType,
        length: target.length,
        beam: target.beam,
      });
    }
  }, 250);
  return () => clearInterval(id);
}
