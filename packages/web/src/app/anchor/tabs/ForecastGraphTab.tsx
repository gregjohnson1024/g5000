'use client';

import { useEffect, useState } from 'react';
import type { WeatherForecast, HourPoint } from '../../../lib/weather-dto';
import { computeSky } from '../../../lib/sky';

const DEFAULT_LAT = 32.3;
const DEFAULT_LON = -64.7;

// ── SVG layout constants ─────────────────────────────────────────────────────
const SVG_W = 700;
const TEMP_H = 80;
const PRECIP_H = 40;
const WIND_H = 60;
const AXIS_H = 18;
const PAD_L = 36;
const PAD_R = 12;
const PLOT_W = SVG_W - PAD_L - PAD_R;

// Rows stacked vertically
const TEMP_Y = 0;
const PRECIP_Y = TEMP_H;
const WIND_Y = TEMP_H + PRECIP_H;
const AXIS_Y = TEMP_H + PRECIP_H + WIND_H;
const TOTAL_H = AXIS_Y + AXIS_H;

// How many hours to display
const DISPLAY_HOURS = 72;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map a value in [lo,hi] to a y pixel in [yTop, yBottom] (inverted). */
function yMap(v: number, lo: number, hi: number, yTop: number, yBottom: number): number {
  const t = hi === lo ? 0.5 : clamp((v - lo) / (hi - lo), 0, 1);
  return lerp(yBottom, yTop, t);
}

/** Map an epoch ms to an x pixel within [0, PLOT_W]. */
function xMap(t: number, tMin: number, tSpan: number): number {
  return PAD_L + clamp((t - tMin) / tSpan, 0, 1) * PLOT_W;
}

/** Build SVG polyline points string from x/y pairs. */
function polyline(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** Build day/night bands for the visible time range. */
function buildDayNightBands(
  hours: HourPoint[],
  lat: number,
  lon: number,
  tMin: number,
  tSpan: number,
  yTop: number,
  yBot: number,
): React.ReactElement[] {
  if (hours.length < 2) return [];

  // Collect unique dates spanned by the data.
  const datesMs = new Set<number>();
  for (const h of hours) {
    const d = new Date(h.timeMs);
    datesMs.add(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime());
  }

  const bands: React.ReactElement[] = [];
  for (const dateMs of datesMs) {
    const sky = computeSky(lat, lon, new Date(dateMs));
    const rise = sky.sunrise?.getTime() ?? null;
    const set = sky.sunset?.getTime() ?? null;

    // Night before sunrise
    if (rise !== null && rise > tMin) {
      const x1 = PAD_L;
      const x2 = xMap(rise, tMin, tSpan);
      if (x2 > x1) {
        bands.push(
          <rect
            key={`night-pre-${dateMs}`}
            x={x1}
            y={yTop}
            width={x2 - x1}
            height={yBot - yTop}
            fill="#1e293b"
            opacity={0.5}
          />,
        );
      }
    }

    // Night after sunset
    if (set !== null && set < tMin + tSpan) {
      const x1 = xMap(set, tMin, tSpan);
      const x2 = PAD_L + PLOT_W;
      if (x2 > x1) {
        bands.push(
          <rect
            key={`night-post-${dateMs}`}
            x={x1}
            y={yTop}
            width={x2 - x1}
            height={yBot - yTop}
            fill="#1e293b"
            opacity={0.5}
          />,
        );
      }
    }
  }
  return bands;
}

/** Render the meteogram SVG for a slice of hourly data. */
function Meteogram({
  hours,
  lat,
  lon,
}: {
  hours: HourPoint[];
  lat: number;
  lon: number;
}): React.ReactElement {
  if (hours.length < 2) {
    return <p className="text-xs text-slate-500 italic">No forecast data.</p>;
  }

  const tMin = hours[0]!.timeMs;
  const tMax = hours[hours.length - 1]!.timeMs;
  const tSpan = Math.max(1, tMax - tMin);

  // ── Temperature line ──────────────────────────────────────────────────────
  const temps = hours.map((h) => h.tempC);
  const tLo = Math.min(...temps) - 2;
  const tHi = Math.max(...temps) + 2;
  const tempPts = hours.map((h) => ({
    x: xMap(h.timeMs, tMin, tSpan),
    y: yMap(h.tempC, tLo, tHi, TEMP_Y + 4, TEMP_Y + TEMP_H - 4),
  }));

  // ── Wind line ─────────────────────────────────────────────────────────────
  const winds = hours.map((h) => h.windKn);
  const gusts = hours.map((h) => h.gustKn);
  const wLo = 0;
  const wHi = Math.max(5, ...winds, ...gusts) + 3;
  const windPts = hours.map((h) => ({
    x: xMap(h.timeMs, tMin, tSpan),
    y: yMap(h.windKn, wLo, wHi, WIND_Y + 4, WIND_Y + WIND_H - 4),
  }));
  const gustPts = hours.map((h) => ({
    x: xMap(h.timeMs, tMin, tSpan),
    y: yMap(h.gustKn, wLo, wHi, WIND_Y + 4, WIND_Y + WIND_H - 4),
  }));

  // ── Day/night bands ───────────────────────────────────────────────────────
  const dayNightBands = buildDayNightBands(hours, lat, lon, tMin, tSpan, 0, TOTAL_H - AXIS_H);

  // ── Precip bars ───────────────────────────────────────────────────────────
  const barW = Math.max(2, PLOT_W / hours.length - 0.5);

  // ── Axis ticks (every 6 hours, label every 12) ───────────────────────────
  const tickMs: { ms: number; label: string }[] = [];
  {
    const step = 6 * 3_600_000;
    // Align to first full 6-h boundary after tMin
    const first = Math.ceil(tMin / step) * step;
    for (let t = first; t <= tMax; t += step) {
      const d = new Date(t);
      const h = d.getUTCHours();
      const label =
        h % 12 === 0
          ? `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${h === 0 ? '00' : '12'}Z`
          : h === 6 || h === 18
            ? `${h}Z`
            : '';
      tickMs.push({ ms: t, label });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${TOTAL_H}`}
      className="w-full"
      style={{ height: `${TOTAL_H * 1.1}px` }}
      aria-label="Weather forecast meteogram"
    >
      {/* Day/night background bands */}
      {dayNightBands}

      {/* Section separators */}
      <line
        x1={PAD_L}
        y1={PRECIP_Y}
        x2={SVG_W - PAD_R}
        y2={PRECIP_Y}
        stroke="#1e293b"
        strokeWidth={1}
      />
      <line
        x1={PAD_L}
        y1={WIND_Y}
        x2={SVG_W - PAD_R}
        y2={WIND_Y}
        stroke="#1e293b"
        strokeWidth={1}
      />

      {/* ── Temperature ── */}
      {/* Y-axis label */}
      <text
        x={PAD_L - 4}
        y={TEMP_Y + TEMP_H / 2}
        fill="#64748b"
        fontSize={8}
        textAnchor="end"
        dominantBaseline="central"
      >
        °C
      </text>
      {/* Temp range labels */}
      <text
        x={PAD_L - 4}
        y={TEMP_Y + 4}
        fill="#64748b"
        fontSize={7}
        textAnchor="end"
        dominantBaseline="hanging"
      >
        {Math.round(tHi)}
      </text>
      <text
        x={PAD_L - 4}
        y={TEMP_Y + TEMP_H - 4}
        fill="#64748b"
        fontSize={7}
        textAnchor="end"
        dominantBaseline="auto"
      >
        {Math.round(tLo)}
      </text>
      <polyline points={polyline(tempPts)} fill="none" stroke="#f97316" strokeWidth={1.5} />

      {/* ── Precip bars ── */}
      <text
        x={PAD_L - 4}
        y={PRECIP_Y + PRECIP_H / 2}
        fill="#64748b"
        fontSize={8}
        textAnchor="end"
        dominantBaseline="central"
      >
        %
      </text>
      {hours.map((h) => {
        const pct = clamp(h.precipProbPct, 0, 100);
        const barH = (pct / 100) * (PRECIP_H - 4);
        const x = xMap(h.timeMs, tMin, tSpan) - barW / 2;
        return (
          <rect
            key={h.timeMs}
            x={x}
            y={PRECIP_Y + PRECIP_H - 4 - barH}
            width={barW}
            height={barH}
            fill="#38bdf8"
            opacity={0.6}
          />
        );
      })}

      {/* ── Wind ── */}
      <text
        x={PAD_L - 4}
        y={WIND_Y + WIND_H / 2}
        fill="#64748b"
        fontSize={8}
        textAnchor="end"
        dominantBaseline="central"
      >
        kn
      </text>
      <text
        x={PAD_L - 4}
        y={WIND_Y + 4}
        fill="#64748b"
        fontSize={7}
        textAnchor="end"
        dominantBaseline="hanging"
      >
        {Math.round(wHi)}
      </text>
      {/* Gust line (lighter, behind) */}
      <polyline points={polyline(gustPts)} fill="none" stroke="#94a3b8" strokeWidth={1} />
      {/* Wind line */}
      <polyline points={polyline(windPts)} fill="none" stroke="#34d399" strokeWidth={1.5} />

      {/* ── Time axis ── */}
      {tickMs.map(({ ms, label }) => {
        const x = xMap(ms, tMin, tSpan);
        return (
          <g key={ms}>
            <line x1={x} y1={AXIS_Y} x2={x} y2={AXIS_Y + 4} stroke="#475569" strokeWidth={1} />
            {label && (
              <text
                x={x}
                y={AXIS_Y + 6}
                fill="#64748b"
                fontSize={7}
                textAnchor="middle"
                dominantBaseline="hanging"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      {/* Now line */}
      {Date.now() >= tMin && Date.now() <= tMax && (
        <>
          <line
            x1={xMap(Date.now(), tMin, tSpan)}
            y1={0}
            x2={xMap(Date.now(), tMin, tSpan)}
            y2={AXIS_Y}
            stroke="#f97316"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
          <text
            x={xMap(Date.now(), tMin, tSpan) + 2}
            y={4}
            fill="#f97316"
            fontSize={7}
            dominantBaseline="hanging"
          >
            now
          </text>
        </>
      )}

      {/* Legend */}
      <g transform={`translate(${SVG_W - PAD_R - 120}, ${TEMP_Y + 4})`}>
        <line x1={0} y1={5} x2={14} y2={5} stroke="#f97316" strokeWidth={1.5} />
        <text x={16} y={5} fill="#94a3b8" fontSize={7} dominantBaseline="central">
          Temp
        </text>
        <line x1={50} y1={5} x2={64} y2={5} stroke="#34d399" strokeWidth={1.5} />
        <text x={66} y={5} fill="#94a3b8" fontSize={7} dominantBaseline="central">
          Wind
        </text>
        <line x1={98} y1={5} x2={112} y2={5} stroke="#94a3b8" strokeWidth={1} />
        <text x={114} y={5} fill="#94a3b8" fontSize={7} dominantBaseline="central">
          Gust
        </text>
      </g>
    </svg>
  );
}

export function ForecastGraphTab({ lat, lon }: { lat: number; lon: number }): React.ReactElement {
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [error, setError] = useState(false);

  const effectiveLat = isFinite(lat) ? lat : DEFAULT_LAT;
  const effectiveLon = isFinite(lon) ? lon : DEFAULT_LON;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(false);
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
  const hours = forecast.hourly
    .filter((h) => h.timeMs >= now - 30 * 60_000)
    .slice(0, DISPLAY_HOURS);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 uppercase tracking-wide">
          72-hour meteogram — UTC
        </span>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span>
            <span className="inline-block w-3 h-0.5 bg-orange-400 mr-1 align-middle" />
            Temp
          </span>
          <span>
            <span className="inline-block w-3 h-0.5 bg-emerald-400 mr-1 align-middle" />
            Wind
          </span>
          <span>
            <span className="inline-block w-3 h-0.5 bg-sky-400 mr-1 align-middle" />
            Precip%
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Meteogram hours={hours} lat={effectiveLat} lon={effectiveLon} />
      </div>
    </div>
  );
}
