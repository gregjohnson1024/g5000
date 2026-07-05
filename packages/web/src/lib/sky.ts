import * as SunCalc from 'suncalc';

export interface SkyInfo {
  /** null at extreme latitudes (polar day / polar night) */
  sunrise: Date | null;
  sunset: Date | null;
  civilDawn: Date | null;
  civilDusk: Date | null;
  nauticalDawn: Date | null;
  nauticalDusk: Date | null;
  astroDawn: Date | null;
  astroDusk: Date | null;
  /** null when sunrise or sunset is null (polar conditions) */
  dayLengthMs: number | null;
  moon: { phase: number; illumination: number; rise: Date | null; set: Date | null };
}

export function computeSky(lat: number, lon: number, date: Date): SkyInfo {
  const t = SunCalc.getTimes(date, lat, lon);
  const illum = SunCalc.getMoonIllumination(date);
  const moonT = SunCalc.getMoonTimes(date, lat, lon);
  const dayLengthMs = t.sunset && t.sunrise ? t.sunset.getTime() - t.sunrise.getTime() : null;
  return {
    sunrise: t.sunrise,
    sunset: t.sunset,
    civilDawn: t.dawn,
    civilDusk: t.dusk,
    nauticalDawn: t.nauticalDawn,
    nauticalDusk: t.nauticalDusk,
    astroDawn: t.nightEnd,
    astroDusk: t.night,
    dayLengthMs,
    moon: {
      phase: illum.phase,
      illumination: illum.fraction,
      rise: moonT.rise ?? null,
      set: moonT.set ?? null,
    },
  };
}
