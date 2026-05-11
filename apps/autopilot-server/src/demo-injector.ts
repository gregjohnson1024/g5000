import type { Bus } from '@g5000/core';

const KN = 0.514444;
const DEG = Math.PI / 180;

/**
 * Periodically publish synthetic wind/boat/motion samples to the shared bus.
 * Used for bench-side visual validation of /helm, /polars, capture wizards,
 * etc. when no real boat hardware is available. The values aren't physically
 * consistent — TWS/TWA/BSP just oscillate independently — but they're
 * plausible enough to demo the UI.
 */
export function startDemoInjector(bus: Bus): () => void {
  const startedAt = Date.now();
  const id = setInterval(() => {
    const t = (Date.now() - startedAt) / 1000; // seconds since start
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
    const hdg = ((hdgDeg % 360) + 360) % 360 * DEG;
    const now_ns = BigInt(Date.now()) * 1_000_000n;
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
    pub('wind.true.calibrated.speed', tws, 'm/s');
    pub('wind.true.calibrated.angle', twa, 'rad');
    pub('wind.true.calibrated.direction', (hdg + twa + 2 * Math.PI) % (2 * Math.PI), 'rad');
    pub('boat.speed.water', bsp, 'm/s');
    pub('boat.heading.magnetic', hdg, 'rad');
    pub('nav.gps.cog', hdg + 0.03, 'rad');
    pub('nav.gps.sog', bsp + 0.08, 'm/s');
    pub('motion.heel', 0.08 * Math.sin(t / 7), 'rad');
    pub('motion.pitch', 0.03 * Math.cos(t / 5), 'rad');
    pub('motion.yaw', hdg, 'rad');
    pub('motion.rateOfTurn', 0.01, 'rad/s');
  }, 250);
  return () => clearInterval(id);
}
