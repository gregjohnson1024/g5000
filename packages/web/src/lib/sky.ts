import * as SunCalc from 'suncalc';

export interface SkyInfo {
  sunrise: Date;
  sunset: Date;
  civilDawn: Date;
  civilDusk: Date;
  nauticalDawn: Date;
  nauticalDusk: Date;
  astroDawn: Date;
  astroDusk: Date;
  dayLengthMs: number;
  moon: { phase: number; illumination: number; rise: Date | null; set: Date | null };
}

export function computeSky(lat: number, lon: number, date: Date): SkyInfo {
  const t = SunCalc.getTimes(date, lat, lon);
  const illum = SunCalc.getMoonIllumination(date);
  const moonT = SunCalc.getMoonTimes(date, lat, lon);
  return {
    sunrise: t.sunrise,
    sunset: t.sunset,
    civilDawn: t.dawn,
    civilDusk: t.dusk,
    nauticalDawn: t.nauticalDawn,
    nauticalDusk: t.nauticalDusk,
    astroDawn: t.nightEnd,
    astroDusk: t.night,
    dayLengthMs: t.sunset.getTime() - t.sunrise.getTime(),
    moon: {
      phase: illum.phase,
      illumination: illum.fraction,
      rise: moonT.rise ?? null,
      set: moonT.set ?? null,
    },
  };
}
