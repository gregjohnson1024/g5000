'use client';

import { useEffect, useState } from 'react';
import type { WeatherForecast, HourPoint } from '../../../lib/weather-dto';

const DEFAULT_LAT = 32.3;
const DEFAULT_LON = -64.7;

// How many hours to show in the table
const TABLE_HOURS = 48;

// ── Color-scale helpers ──────────────────────────────────────────────────────

/** Interpolate between two hex colors at t ∈ [0,1]. */
function lerpHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const ca = parse(a);
  const cb = parse(b);
  const r = Math.round(ca[0]! + (cb[0]! - ca[0]!) * t)
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(ca[1]! + (cb[1]! - ca[1]!) * t)
    .toString(16)
    .padStart(2, '0');
  const bv = Math.round(ca[2]! + (cb[2]! - ca[2]!) * t)
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${bv}`;
}

/** Clamp t to [0,1]. */
function clamp01(v: number, lo: number, hi: number): number {
  if (hi === lo) return 0.5;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

/** Temperature: blue (cold) → amber (warm). */
function tempColor(v: number, lo: number, hi: number): string {
  const t = clamp01(v, lo, hi);
  // 3-stop: cold=#3b82f6, mid=#94a3b8, hot=#f97316
  if (t < 0.5) return lerpHex('#3b82f6', '#94a3b8', t * 2);
  return lerpHex('#94a3b8', '#f97316', (t - 0.5) * 2);
}

/** Wind / gusts: calm=#1e293b → breeze=#34d399 → strong=#ef4444. */
function windColor(v: number, hi: number): string {
  const t = clamp01(v, 0, hi);
  if (t < 0.5) return lerpHex('#1e293b', '#34d399', t * 2);
  return lerpHex('#34d399', '#ef4444', (t - 0.5) * 2);
}

/** Precip/cloud: none=#1e293b → max=#38bdf8. */
function precipColor(v: number): string {
  return lerpHex('#1e293b', '#38bdf8', clamp01(v, 0, 100));
}

/** Humidity: low=#1e293b → high=#818cf8. */
function humidityColor(v: number): string {
  return lerpHex('#1e293b', '#818cf8', clamp01(v, 20, 100));
}

/** UV: low=#1e293b → high=#fbbf24. */
function uvColor(v: number): string {
  return lerpHex('#1e293b', '#fbbf24', clamp01(v, 0, 11));
}

/** Pressure: colour around a nominal 1013 hPa. High=blue-ish, low=amber-ish. */
function pressureColor(v: number): string {
  const t = clamp01(v, 990, 1040);
  if (t < 0.5) return lerpHex('#f97316', '#64748b', t * 2);
  return lerpHex('#64748b', '#38bdf8', (t - 0.5) * 2);
}

/** Direction arrow as unicode (0° = N). */
function dirArrow(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][idx]!;
}

// ── Row definitions ──────────────────────────────────────────────────────────

interface RowDef {
  label: string;
  unit: string;
  value: (h: HourPoint) => number;
  fmt: (v: number) => string;
  color: (v: number, hours: HourPoint[]) => string;
  /** Optional override for the cell content (e.g., direction arrow + value). */
  render?: (h: HourPoint) => string;
}

function makeRows(hours: HourPoint[]): RowDef[] {
  const windMax = Math.max(5, ...hours.map((h) => h.gustKn));
  const tMin = Math.min(...hours.map((h) => h.tempC));
  const tMax = Math.max(...hours.map((h) => h.tempC));
  return [
    {
      label: 'Temp',
      unit: '°C',
      value: (h) => h.tempC,
      fmt: (v) => `${Math.round(v)}°`,
      color: (v) => tempColor(v, tMin, tMax),
    },
    {
      label: 'Wind',
      unit: 'kn',
      value: (h) => h.windKn,
      fmt: (v) => `${Math.round(v)}`,
      color: (v) => windColor(v, windMax),
    },
    {
      label: 'Gusts',
      unit: 'kn',
      value: (h) => h.gustKn,
      fmt: (v) => `${Math.round(v)}`,
      color: (v) => windColor(v, windMax),
    },
    {
      label: 'Dir',
      unit: '°',
      value: (h) => h.dirDeg,
      fmt: (v) => `${Math.round(v)}`,
      color: (_v) => '#334155',
      render: (h) => `${dirArrow(h.dirDeg)}${Math.round(h.dirDeg)}°`,
    },
    {
      label: 'Cloud',
      unit: '%',
      value: (h) => h.cloudPct,
      fmt: (v) => `${Math.round(v)}%`,
      color: (v) => precipColor(v),
    },
    {
      label: 'Precip',
      unit: '%',
      value: (h) => h.precipProbPct,
      fmt: (v) => `${Math.round(v)}%`,
      color: (v) => precipColor(v),
    },
    {
      label: 'Humidity',
      unit: '%',
      value: (h) => h.humidityPct,
      fmt: (v) => `${Math.round(v)}%`,
      color: (v) => humidityColor(v),
    },
    {
      label: 'UV',
      unit: '',
      value: (h) => h.uv,
      fmt: (v) => v.toFixed(1),
      color: (v) => uvColor(v),
    },
    {
      label: 'Pressure',
      unit: 'hPa',
      value: (h) => h.pressure,
      fmt: (v) => `${Math.round(v)}`,
      color: (v) => pressureColor(v),
    },
  ];
}

/** Choose a readable text colour against a background. */
function textColor(bg: string): string {
  // Parse the background hex and compute luminance
  const r = parseInt(bg.slice(1, 3), 16) / 255;
  const g = parseInt(bg.slice(3, 5), 16) / 255;
  const b = parseInt(bg.slice(5, 7), 16) / 255;
  // Approx relative luminance (gamma-linearised)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 0.45 ? '#0f172a' : '#e2e8f0';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ForecastTableTab({ lat, lon }: { lat: number; lon: number }): React.ReactElement {
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [error, setError] = useState(false);

  const effectiveLat = isFinite(lat) ? lat : DEFAULT_LAT;
  const effectiveLon = isFinite(lon) ? lon : DEFAULT_LON;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/weather/forecast?lat=${effectiveLat}&lon=${effectiveLon}`);
        if (cancelled) return;
        if (!r.ok) {
          setError(true);
          return;
        }
        const data = (await r.json()) as WeatherForecast;
        if (!cancelled) setForecast(data);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [effectiveLat, effectiveLon]);

  if (error) {
    return <p className="text-xs text-slate-500 italic">Forecast unavailable.</p>;
  }
  if (forecast === null) {
    return <p className="text-xs text-slate-500 italic">Loading forecast…</p>;
  }

  const now = Date.now();
  const hours = forecast.hourly.filter((h) => h.timeMs >= now - 30 * 60_000).slice(0, TABLE_HOURS);

  if (hours.length === 0) {
    return <p className="text-xs text-slate-500 italic">No hourly data.</p>;
  }

  const rows = makeRows(hours);

  return (
    <div className="overflow-x-auto">
      <p className="text-[10px] text-slate-600 mb-1 uppercase tracking-wide">
        Hourly heatmap — UTC
      </p>
      <table className="text-[10px] font-mono border-collapse min-w-max">
        <thead>
          <tr>
            {/* Row label column */}
            <th className="sticky left-0 z-10 bg-slate-950 text-slate-500 text-left pr-2 py-0.5 font-normal whitespace-nowrap">
              {' '}
            </th>
            {hours.map((h) => {
              const d = new Date(h.timeMs);
              const hr = d.getUTCHours();
              // Show day/month at midnight, otherwise just the hour
              const label =
                hr === 0
                  ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
                  : hr % 6 === 0
                    ? `${hr}Z`
                    : hr % 3 === 0
                      ? `${hr}`
                      : '';
              return (
                <th
                  key={h.timeMs}
                  className={`py-0.5 px-0 text-center font-normal ${
                    label ? 'text-slate-400' : 'text-slate-700'
                  }`}
                  style={{ minWidth: '22px' }}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              {/* Label cell */}
              <td className="sticky left-0 z-10 bg-slate-950 text-slate-400 pr-2 py-px whitespace-nowrap">
                {row.label}
                {row.unit ? <span className="text-slate-600 ml-0.5">{row.unit}</span> : null}
              </td>
              {/* Data cells */}
              {hours.map((h) => {
                const v = row.value(h);
                const bg = row.color(v, hours);
                const fg = textColor(bg);
                const display = row.render ? row.render(h) : row.fmt(v);
                // Highlight "now" column
                const isNow = Math.abs(h.timeMs - now) < 35 * 60_000;
                return (
                  <td
                    key={h.timeMs}
                    title={`${row.label}: ${display}`}
                    style={{ backgroundColor: bg, color: fg, minWidth: '22px' }}
                    className={`text-center py-px leading-tight ${isNow ? 'ring-1 ring-orange-500/60 ring-inset' : ''}`}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
