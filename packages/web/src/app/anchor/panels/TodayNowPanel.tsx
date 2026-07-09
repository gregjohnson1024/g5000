'use client';

import { useEffect, useState } from 'react';
import { tideSnapshot } from '@g5000/tide';
import type { TidalEvent } from '@g5000/tide';
import type { JsonSafeSample } from '@g5000/core';
import type { WeatherCurrent, HourPoint } from '../../../lib/weather-dto';
import { fmtShortTime } from '../../../lib/tz';
import { useShipClock } from '../../../lib/use-ship-clock';
import { Panel } from '../../../components/ui/Panel';

// Default position (Bermuda) — used when no GPS fix is available.
const DEFAULT_LAT = 32.3;
const DEFAULT_LON = -64.7;

function geo(s: JsonSafeSample | undefined): { lat: number; lon: number } | null {
  if (!s || s.value.kind !== 'geo') return null;
  return s.value.value;
}

interface ActiveTide {
  tideSource: string | null;
  pinnedStationId: string | null;
  pinnedSourceId: string | null;
}

export function TodayNowPanel({
  channels,
  weatherLat,
  weatherLon,
}: {
  channels: ReadonlyMap<string, JsonSafeSample>;
  /** Optional override lat for weather/forecast (from settings weatherPin or anchor position). */
  weatherLat?: number;
  /** Optional override lon for weather/forecast (from settings weatherPin or anchor position). */
  weatherLon?: number;
}): React.ReactElement {
  const clock = useShipClock();
  const position = geo(channels.get('nav.gps.position'));
  const lat = weatherLat ?? position?.lat ?? DEFAULT_LAT;
  const lon = weatherLon ?? position?.lon ?? DEFAULT_LON;

  // ── Weather ─────────────────────────────────────────────────────────────────
  const [weather, setWeather] = useState<WeatherCurrent | null>(null);
  const [precipProb, setPrecipProb] = useState<number | null>(null);
  const [weatherError, setWeatherError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [curRes, fcastRes] = await Promise.all([
          fetch(`/api/weather/current?lat=${lat}&lon=${lon}`),
          fetch(`/api/weather/forecast?lat=${lat}&lon=${lon}`),
        ]);
        if (cancelled) return;
        if (curRes.ok) {
          const cur = (await curRes.json()) as WeatherCurrent;
          if (!cancelled) setWeather(cur);
        } else {
          if (!cancelled) setWeatherError(true);
        }
        // Pull precipProbPct from the first upcoming hourly point.
        if (fcastRes.ok) {
          const fcast = (await fcastRes.json()) as { hourly: HourPoint[] };
          const now = Date.now();
          const upcoming = (fcast.hourly ?? []).find((h) => h.timeMs >= now - 30 * 60_000);
          if (!cancelled && upcoming != null) setPrecipProb(upcoming.precipProbPct);
        }
      } catch {
        if (!cancelled) setWeatherError(true);
      }
    }
    void load();
    // Refresh every 10 minutes (weather is cached server-side).
    const timer = setInterval(() => void load(), 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lat, lon]);

  // ── Tide ─────────────────────────────────────────────────────────────────────
  const [tideEvents, setTideEvents] = useState<TidalEvent[]>([]);
  const [tideLoading, setTideLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  // Tick the now pointer once per minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadTide() {
      setTideLoading(true);
      try {
        // Fetch active pinned station.
        const ar = await fetch('/api/tide/active');
        if (!ar.ok || cancelled) {
          if (!cancelled) setTideLoading(false);
          return;
        }
        const active = (await ar.json()) as ActiveTide & { ok: boolean };
        if (!active.ok || !active.pinnedStationId || !active.pinnedSourceId) {
          if (!cancelled) setTideLoading(false);
          return;
        }
        // Fetch events for pinned station.
        const er = await fetch(
          `/api/tide/events?stationId=${encodeURIComponent(active.pinnedStationId)}&source=${encodeURIComponent(active.pinnedSourceId)}`,
        );
        if (!er.ok || cancelled) {
          if (!cancelled) setTideLoading(false);
          return;
        }
        const ej = (await er.json()) as { ok: boolean; events: TidalEvent[] };
        if (!cancelled) {
          if (ej.ok) {
            setTideEvents([...ej.events].sort((a, b) => a.timeMs - b.timeMs));
          }
          setTideLoading(false);
        }
      } catch {
        if (!cancelled) setTideLoading(false);
      }
    }
    void loadTide();
    return () => {
      cancelled = true;
    };
  }, []);

  const snapshot = tideEvents.length >= 2 ? tideSnapshot(tideEvents, now) : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Panel label="Today &amp; Now">
      <div className="flex flex-col gap-2">
        {/* Weather section */}
        <div className="flex flex-col gap-1">
          {weatherError ? (
            <span className="text-xs text-ink-3 italic">Weather unavailable</span>
          ) : weather === null ? (
            <span className="text-xs text-ink-3 italic">Loading…</span>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold font-mono text-ink-value">
                  {Math.round(weather.tempC)}°C
                </span>
                <span className="text-xs text-ink-3">{weather.condition}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono text-ink-2">
                <span>
                  Wind <span className="text-ink-value">{Math.round(weather.windKn)} kn</span>
                  {weather.gustKn > weather.windKn + 2 && (
                    <span className="text-ink-3"> G{Math.round(weather.gustKn)}</span>
                  )}
                </span>
                {precipProb !== null && (
                  <span>
                    Precip <span className="text-ink-value">{Math.round(precipProb)}%</span>
                  </span>
                )}
                <span>
                  Feels <span className="text-ink-value">{Math.round(weather.apparentC)}°C</span>
                </span>
              </div>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-hairline" />

        {/* Tide section */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.611rem] uppercase tracking-wide text-ink-4">Tide</span>
          {tideLoading ? (
            <span className="text-xs text-ink-3 italic">Loading…</span>
          ) : snapshot === null || snapshot.heightNowM === null ? (
            <span className="text-xs text-ink-3 italic">— no station</span>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-mono text-ink-2">
              <span>
                <span className="text-info">{snapshot.heightNowM.toFixed(2)} m</span>
                {snapshot.state && (
                  <span className="ml-1 text-ink-3 capitalize">{snapshot.state}</span>
                )}
              </span>
              {snapshot.next && (
                <span className="text-ink-3">
                  Next {snapshot.next.type}{' '}
                  <span className="text-ink-2">{snapshot.next.heightM.toFixed(1)} m</span>
                  {' @ '}
                  {fmtShortTime(snapshot.next.timeMs / 1000, clock)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
