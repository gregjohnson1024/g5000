export interface WeatherCurrent {
  tempC: number;
  apparentC: number;
  condition: string;
  precipProb: number;
  windKn: number;
  gustKn: number;
  humidity: number;
  uv: number;
  pressure: number;
  updatedAt: number;
}

export interface HourPoint {
  timeMs: number;
  tempC: number;
  windKn: number;
  gustKn: number;
  dirDeg: number;
  cloudPct: number;
  precipProbPct: number;
  humidityPct: number;
  uv: number;
  pressure: number;
}

export interface DayPoint {
  dateMs: number;
  code: number;
  tMaxC: number;
  tMinC: number;
  precipProbMaxPct: number;
  windKnMax: number;
}

export interface WeatherForecast {
  hourly: HourPoint[];
  daily: DayPoint[];
  fetchedAt: number;
}

const WMO_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Rain showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
};

export function wmoLabel(code: number): string {
  return WMO_LABELS[code] ?? 'Unknown';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseCurrent(raw: any): WeatherCurrent {
  const c = raw.current;
  return {
    tempC: c.temperature_2m,
    apparentC: c.apparent_temperature,
    condition: wmoLabel(c.weather_code),
    precipProb: 0,
    windKn: c.wind_speed_10m,
    gustKn: c.wind_gusts_10m,
    humidity: c.relative_humidity_2m,
    uv: 0,
    pressure: c.pressure_msl,
    updatedAt: new Date(c.time + 'Z').getTime(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseForecast(raw: any): WeatherForecast {
  const h = raw.hourly;
  const d = raw.daily;

  const hourly: HourPoint[] = (h.time as string[]).map((t: string, i: number) => ({
    timeMs: new Date(t + 'Z').getTime(),
    tempC: h.temperature_2m[i],
    windKn: h.wind_speed_10m[i],
    gustKn: h.wind_gusts_10m[i],
    dirDeg: h.wind_direction_10m[i],
    cloudPct: h.cloud_cover[i],
    precipProbPct: h.precipitation_probability[i],
    humidityPct: h.relative_humidity_2m[i],
    uv: h.uv_index[i],
    pressure: h.pressure_msl[i],
  }));

  const daily: DayPoint[] = (d.time as string[]).map((t: string, i: number) => ({
    dateMs: new Date(t + 'T00:00:00Z').getTime(),
    code: d.weather_code[i],
    tMaxC: d.temperature_2m_max[i],
    tMinC: d.temperature_2m_min[i],
    precipProbMaxPct: d.precipitation_probability_max[i],
    windKnMax: d.wind_speed_10m_max[i],
  }));

  return { hourly, daily, fetchedAt: Date.now() };
}
