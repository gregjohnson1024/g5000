'use client';

/**
 * RouteLens — route-planning content inside the LayerDock.
 *
 * Hosts every widget that was previously in the <aside> children slot in
 * page.tsx: StatusBadge + LiveValues, optional RadarControls, AnchorCard,
 * RoutePlanPanel, PlaybackScrubber + RouteWeatherPanel + RouteDetailsBox
 * (when a route exists), and the wind-timeline / wind-legend / CMEMS-status /
 * HRRR-domain-warning / Fit-to-forecast-region block.
 *
 * Pure plumbing — no new behaviour beyond what was in the old children slot.
 */

import maplibregl from 'maplibre-gl';
import { StatusBadge } from '../../../components/StatusBadge';
import { TzToggle } from '../../../components/TzToggle';
import { AnchorCard } from '../AnchorCard';
import { RoutePlanPanel } from '../RoutePlanPanel';
import { PlaybackScrubber } from '../PlaybackScrubber';
import { RouteWeatherPanel } from '../../../components/RouteWeatherPanel';
import { RouteDetailsBox } from '../RouteDetailsBox';
import { WindTimeline } from '../WindTimeline';
import { WindLegend } from '../../../components/WindLegend';
import { RadarControls } from '../RadarControls';
import { fmtLatDmm, fmtLonDmm } from '../../../lib/coords';
import { MS_TO_KN, RAD_TO_DEG, wrap360 } from '../../../lib/units';
import { fmtHourLabel, type TzMode } from '../../../lib/tz';
import { inHrrrDomain } from '../../../lib/hrrr-helpers';
import type { LivePos } from '../../../components/LiveBoatMarker';
import type { RouteColorMode } from '../../../components/RoutePolyline';
import type { PlaybackState } from '../../../lib/route-playback';
import type { WindGrid } from '../../../components/WindOverlay';
import type { Route } from '@g5000/routing';
import type { RoutePlan } from '../use-route-plan';
import type { ModelLayerView } from '../model-layer';

/** Route-color constants (must stay in sync with page.tsx). */
const ROUTE_COLOR: Record<'GFS' | 'ECMWF', string> = {
  GFS: 'var(--accent-hi)',
  ECMWF: 'var(--route-alt)',
};

export interface RouteLensProps {
  /** Live GPS fix (null = no fix yet). */
  livePos: LivePos | null;
  /** Saved waypoints available as route endpoints. */
  waypoints: Array<{ id: string; name: string; lat: number; lon: number }>;
  /** The active in-progress route plan (ordered waypoint ids + mutators). */
  routePlan: RoutePlan;
  /** Computed routes indexed by model (GFS / ECMWF). */
  routes: Partial<Record<'GFS' | 'ECMWF', Route>>;
  /** UTC ↔ local toggle (UTC-everywhere: no new local-time surfaces added). */
  tz: TzMode;
  /** Setter for the UTC ↔ local toggle rendered in the lens header. */
  onTz: (tz: TzMode) => void;
  /** Route line-colour display mode. */
  routeColorMode: RouteColorMode;
  onRouteColorMode: (m: RouteColorMode) => void;
  /** True when any route leg is motoring (disables TWA colouring). */
  hasMotoring: boolean;
  /** Called when a new set of routes is computed by RoutePlanPanel. */
  onRouted: (next: Partial<Record<'GFS' | 'ECMWF', Route>>) => void;
  /** Clears all routes + playback clock. */
  onClearRoute: () => void;
  showIsochrones: boolean;
  onShowIsochrones: (v: boolean) => void;
  showRouteWind: boolean;
  onShowRouteWind: (v: boolean) => void;
  /** Playback states per model — drives RouteDetailsBox readouts. */
  playbackStates: Partial<Record<'GFS' | 'ECMWF', PlaybackState>>;
  onPlaybackStates: (states: Partial<Record<'GFS' | 'ECMWF', PlaybackState>>) => void;
  /** Shared playback clock (unix s). Null until the scrubber initialises. */
  playT: number | null;
  onPlayT: (t: number) => void;
  /** Called by PlaybackScrubber so it can drive the wind timeline. */
  onWindHour: (t: number) => void;
  /** MapLibre instance — needed by PlaybackScrubber for ghost-boat markers. */
  mapInstance: maplibregl.Map | null;
  // --- Wind-model / timeline state ---
  mv: ModelLayerView;
  availableHours: { gfs: number[]; ecmwf: number[]; hrrr: number[] };
  latestRunAt: { gfs: number | null; ecmwf: number | null; hrrr: number | null };
  windHours: number;
  windLockNow: boolean;
  windGrid: WindGrid | null;
  windStatus: string | null;
  currentStatus: string | null;
  forecastBbox: { latMin: number; latMax: number; lonMin: number; lonMax: number } | null;
  /** Model selection from LayersState (for HRRR domain warning). */
  activeModel: string;
  setWindHours: React.Dispatch<React.SetStateAction<number>>;
  setWindLockNow: React.Dispatch<React.SetStateAction<boolean>>;
  // --- Radar ---
  showRadar: boolean;
  mayaraWsBase: string;
  radarOpacity: number;
  onRadarOpacity: (v: number) => void;
  radarRangeM: number;
  onRadarRange: (m: number) => void;
  // --- Error display ---
  error: string | undefined;
}

export function RouteLens({
  livePos,
  waypoints,
  routePlan,
  routes,
  tz,
  onTz,
  routeColorMode,
  onRouteColorMode,
  hasMotoring,
  onRouted,
  onClearRoute,
  showIsochrones,
  onShowIsochrones,
  showRouteWind,
  onShowRouteWind,
  playbackStates,
  onPlaybackStates,
  playT,
  onPlayT,
  onWindHour,
  mapInstance,
  mv,
  availableHours,
  latestRunAt,
  windHours,
  windLockNow,
  windGrid,
  windStatus,
  currentStatus,
  forecastBbox,
  activeModel,
  setWindHours,
  setWindLockNow,
  showRadar,
  mayaraWsBase,
  radarOpacity,
  onRadarOpacity,
  radarRangeM,
  onRadarRange,
  error,
}: RouteLensProps): React.ReactElement {
  const hasRoute = Object.keys(routes).length > 0;

  return (
    <div className="space-y-3 px-2 py-2">
      {/* ── Status + live position ───────────────────────────────── */}
      <div className="flex items-center justify-between">
        <StatusBadge />
        <TzToggle tz={tz} setTz={onTz} />
      </div>
      <LiveValues p={livePos} />

      {/* ── Radar controls (only when radar layer is active) ─────── */}
      {showRadar && mayaraWsBase && (
        <RadarControls
          baseUrl="/api/radar"
          wsBase={mayaraWsBase}
          opacity={radarOpacity}
          onOpacity={onRadarOpacity}
          rangeM={radarRangeM}
          onRange={onRadarRange}
        />
      )}

      {/* ── Anchor watch card ────────────────────────────────────── */}
      <AnchorCard livePos={livePos} />

      {/* ── Route plan controls ──────────────────────────────────── */}
      <RoutePlanPanel
        waypoints={waypoints}
        tz={tz}
        hasRoute={hasRoute}
        ids={routePlan.ids}
        onIdsChange={routePlan.setIds}
        colorMode={routeColorMode}
        onColorMode={onRouteColorMode}
        colorTwaDisabled={hasMotoring}
        onRouted={onRouted}
        onClear={onClearRoute}
        showIsochrones={showIsochrones}
        onShowIsochrones={onShowIsochrones}
        showRouteWind={showRouteWind}
        onShowRouteWind={onShowRouteWind}
      />

      {/* ── Playback + route details (when a route exists) ───────── */}
      {hasRoute && (
        <>
          <PlaybackScrubber
            map={mapInstance}
            routes={routes}
            tz={tz}
            onStates={onPlaybackStates}
            onWindHour={onWindHour}
            t={playT ?? undefined}
            onTChange={onPlayT}
          />
          <RouteWeatherPanel routes={routes} t={playT} onTChange={onPlayT} />
          {(['GFS', 'ECMWF'] as const)
            .filter((m) => routes[m])
            .map((m) => (
              <RouteDetailsBox
                key={m}
                model={m}
                color={ROUTE_COLOR[m]}
                state={playbackStates[m] ?? null}
              />
            ))}
        </>
      )}

      {/* ── Wind timeline / legend / CMEMS / HRRR block ─────────── */}
      <div className="space-y-2 bg-surface/60 border border-hairline rounded p-2">
        {mv.isCurrent && (
          <div className="text-xs space-y-1 pt-1 border-t border-hairline mt-1">
            <p className="text-ink-3">
              Surface currents from Copernicus Marine (CMEMS) daily-mean global analysis (1/12°,
              surface depth). Colour = speed in knots; arrows = direction. Refreshed automatically;
              trigger a manual pull from the Forecast page.
            </p>
            {currentStatus && <p className="text-ink-3">{currentStatus}</p>}
          </div>
        )}
        {mv.isWindModel && (
          <WindTimeline
            availableHours={availableHours}
            latestRunAt={latestRunAt}
            windHours={windHours}
            windLockNow={windLockNow}
            tz={tz}
            model={mv.windModel}
            setWindHours={setWindHours}
            setWindLockNow={setWindLockNow}
          />
        )}
        {mv.isWindModel && windGrid && (
          <div className="text-xs text-ink-3 leading-tight">
            <div>
              Showing: <span className="text-ink font-mono">{windGrid.model.toUpperCase()}</span>
            </div>
            <div>
              Run: <span className="text-ink font-mono">{fmtHourLabel(windGrid.runAt, tz)}</span>
            </div>
            <div>
              Valid:{' '}
              <span className="text-ink font-mono">{fmtHourLabel(windGrid.validAt, tz)}</span> (+
              {windGrid.forecastHour}h)
            </div>
          </div>
        )}
        {activeModel === 'hrrr' && forecastBbox && !inHrrrDomain(forecastBbox) && (
          <div className="text-xs text-[color:var(--warn)]">
            HRRR covers US waters only — no data for this area. Move the forecast region inside the
            continental US, or pick GFS/ECMWF for offshore.
          </div>
        )}
        {mv.isWindModel && windStatus && (
          <div className="text-xs text-[color:var(--ok)]">{windStatus}</div>
        )}
        {mv.isWindModel && forecastBbox && mapInstance && (
          <FitToForecastButton mapInstance={mapInstance} forecastBbox={forecastBbox} />
        )}
        {mv.isWindModel && <WindLegend />}
      </div>

      {error && <div className="text-[color:var(--danger)] text-xs">{error}</div>}
    </div>
  );
}

/** Inline sub-component: "Fit to forecast region" button. */
function FitToForecastButton({
  mapInstance,
  forecastBbox,
}: {
  mapInstance: maplibregl.Map;
  forecastBbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          mapInstance.fitBounds(
            [
              [forecastBbox.lonMin, forecastBbox.latMin],
              [forecastBbox.lonMax, forecastBbox.latMax],
            ],
            { padding: 40, duration: 600 },
          );
        } catch {
          /* style not ready */
        }
      }}
      className="w-full px-2 py-1 text-xs bg-surface-raised hover:bg-hairline-strong rounded"
      title="Zoom to the forecast region to see and drag the corner handles"
    >
      Fit to forecast region
    </button>
  );
}

/** Live position readout (compact marine DMM). */
function LiveValues({ p }: { p: LivePos | null }): React.ReactElement {
  if (!p) {
    return <div className="text-xs text-ink-3">Waiting for live fix…</div>;
  }
  const lat = fmtLatDmm(p.lat);
  const lon = fmtLonDmm(p.lon);
  const cogDeg = typeof p.cog === 'number' ? wrap360(p.cog * RAD_TO_DEG) : null;
  const hdgDeg = typeof p.hdg === 'number' ? wrap360(p.hdg * RAD_TO_DEG) : null;
  const sogKn = typeof p.sog === 'number' ? p.sog * MS_TO_KN : null;
  return (
    <div className="text-xs space-y-0.5 bg-surface/60 border border-hairline rounded p-2">
      <div className="font-mono text-ink-value">
        {`${lat.deg} ${lat.min}${lat.hemi.toLowerCase()}`}
      </div>
      <div className="font-mono text-ink-value">
        {`${lon.deg} ${lon.min}${lon.hemi.toLowerCase()}`}
      </div>
      <div className="text-ink-2">
        SOG:{' '}
        <span className="text-ink-value font-mono">
          {sogKn !== null ? `${sogKn.toFixed(1)} kn` : '—'}
        </span>
      </div>
      <div className="text-ink-2">
        COG:{' '}
        <span className="text-ink-value font-mono">
          {cogDeg !== null ? `${cogDeg.toFixed(0)}° T` : '—'}
        </span>
      </div>
      <div className="text-ink-2">
        HDG:{' '}
        <span className="text-ink-value font-mono">
          {hdgDeg !== null ? `${hdgDeg.toFixed(0)}° T` : '—'}
        </span>
      </div>
    </div>
  );
}
