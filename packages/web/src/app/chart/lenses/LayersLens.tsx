'use client';

import type { LayersState, LayerToggleKey } from '../LayersControl';
import type { ChartModel } from '../model-layer';
import type { PresetName } from '../presets';

/**
 * LayersLens — the "Layers" tab content inside LayerDock.
 *
 * Reproduces exactly the same toggle set as the old LayersControl popover:
 *   osm / enc / satellite / buoys / bathy (+ safety-depth input) /
 *   ais / aisCog / tideStations / currentStations / radar
 * Plus the mutually-exclusive model radio:
 *   None / GFS / ECMWF / HRRR / CMEMS
 *
 * Phase-5 T6 addition — Manual layer presets:
 *   A small button group at the top (Default / Race / Anchor / Passage)
 *   plus an explicit active-preset pill and a "Reset to default" button.
 *   Clicking a preset calls onApplyPreset; toggling any layer individually
 *   clears the pill to 'custom' via onClearPreset.
 *   Presets are USER-INVOKED ONLY — never auto-applied on mode change.
 *
 * Tokens only — no raw hex, no slate-/zinc- colour classes.
 * Each toggle uses aria-pressed; each model radio uses role=radio + aria-checked.
 */

const PRESET_LABELS: Array<{ name: Exclude<PresetName, 'custom'>; label: string }> = [
  { name: 'default', label: 'Default' },
  { name: 'race', label: 'Race' },
  { name: 'anchor', label: 'Anchor' },
  { name: 'passage', label: 'Passage' },
];

export function LayersLens({
  state,
  onToggle,
  onSelectModel,
  safetyDepthM,
  onSafetyDepthM,
  showTideCurrents,
  activePreset,
  onApplyPreset,
  onResetToDefault,
}: {
  state: LayersState;
  onToggle: (key: LayerToggleKey) => void;
  onSelectModel: (model: ChartModel) => void;
  safetyDepthM: number;
  onSafetyDepthM: (m: number) => void;
  showTideCurrents: boolean;
  /** Which preset pill is currently active ('custom' = manual state). */
  activePreset: PresetName;
  /** Called when the user taps a preset button. */
  onApplyPreset: (name: Exclude<PresetName, 'custom'>) => void;
  /** Called when the user clicks "Reset to default". */
  onResetToDefault: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      {/* ── Preset picker ────────────────────────────────── */}
      <SectionLabel>Preset</SectionLabel>

      {/* Active-preset pill */}
      <div className="px-2 pb-1 flex items-center gap-2">
        <span
          className={[
            'text-xs px-2 py-0.5 rounded-full font-medium border select-none',
            activePreset === 'custom'
              ? 'border-hairline-strong text-ink-3 bg-transparent'
              : 'border-accent text-accent bg-accent/10',
          ].join(' ')}
          aria-live="polite"
          aria-label={`Active preset: ${activePreset}`}
        >
          {activePreset === 'custom' ? 'custom' : activePreset}
        </span>
        {/* Reset button — only meaningful when a named preset is active OR when
            layers have been customised away from the default. */}
        <button
          type="button"
          onClick={onResetToDefault}
          className="text-xs text-ink-3 hover:text-ink underline-offset-2 hover:underline transition-colors"
          title="Reset all layers to default"
        >
          Reset to default
        </button>
      </div>

      {/* Preset button group */}
      <div role="group" aria-label="Layer presets" className="px-2 pb-2 flex gap-1.5 flex-wrap">
        {PRESET_LABELS.map(({ name, label }) => (
          <button
            key={name}
            type="button"
            aria-pressed={activePreset === name}
            onClick={() => onApplyPreset(name)}
            className={[
              'px-3 py-1 rounded text-sm transition-colors border',
              activePreset === name
                ? 'bg-accent/15 border-accent text-accent font-medium'
                : 'border-hairline-strong text-ink-2 hover:bg-surface-raised hover:text-ink',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Basemaps ─────────────────────────────────────── */}
      <SectionLabel>Basemap</SectionLabel>
      <ToggleRow label="OSM base" pressed={state.osm} onToggle={() => onToggle('osm')} />
      <ToggleRow label="NOAA chart" pressed={state.enc} onToggle={() => onToggle('enc')} />
      <ToggleRow
        label="Satellite"
        pressed={state.satellite}
        onToggle={() => onToggle('satellite')}
      />

      {/* ── Depth ────────────────────────────────────────── */}
      <SectionLabel>Depth</SectionLabel>
      <ToggleRow label="Depth (GEBCO)" pressed={state.bathy} onToggle={() => onToggle('bathy')} />
      {state.bathy ? (
        <label className="flex items-center justify-between pl-7 pr-2 py-1 text-sm text-ink-2">
          Safety depth
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={1}
              value={safetyDepthM}
              onChange={(e) => onSafetyDepthM(Math.max(0, Number(e.target.value) || 0))}
              className="w-14 bg-surface-sunken border border-hairline-strong rounded px-1 py-0.5 text-right text-ink focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
              aria-label="Safety depth in metres (0 = off)"
            />
            <span className="text-ink-3">m</span>
          </span>
        </label>
      ) : null}
      <ToggleRow label="Buoys" pressed={state.buoys} onToggle={() => onToggle('buoys')} />

      {/* ── Model overlay (mutually exclusive) ───────────── */}
      <SectionLabel>Model overlay</SectionLabel>
      <div role="radiogroup" aria-label="Forecast / current model overlay">
        <ModelRow
          label="None"
          active={state.model === 'none'}
          onSelect={() => onSelectModel('none')}
        />
        <ModelRow
          label="GFS wind"
          active={state.model === 'gfs'}
          onSelect={() => onSelectModel('gfs')}
        />
        <ModelRow
          label="ECMWF wind"
          active={state.model === 'ecmwf'}
          onSelect={() => onSelectModel('ecmwf')}
        />
        <ModelRow
          label="HRRR (3 km)"
          active={state.model === 'hrrr'}
          onSelect={() => onSelectModel('hrrr')}
        />
        <ModelRow
          label="CMEMS currents"
          active={state.model === 'cmems'}
          onSelect={() => onSelectModel('cmems')}
        />
      </div>

      {/* ── AIS ──────────────────────────────────────────── */}
      <SectionLabel>AIS</SectionLabel>
      <ToggleRow label="AIS targets" pressed={state.ais} onToggle={() => onToggle('ais')} />
      {state.ais ? (
        <ToggleRow
          label="AIS COG extension"
          pressed={state.aisCog}
          indent
          onToggle={() => onToggle('aisCog')}
        />
      ) : null}

      {/* ── Stations (CHS gate) ──────────────────────────── */}
      {showTideCurrents ? (
        <>
          <SectionLabel>Stations</SectionLabel>
          <ToggleRow
            label="Tide stations"
            pressed={state.tideStations}
            onToggle={() => onToggle('tideStations')}
          />
          <ToggleRow
            label="Current stations"
            pressed={state.currentStations}
            onToggle={() => onToggle('currentStations')}
          />
        </>
      ) : null}

      {/* ── Radar ────────────────────────────────────────── */}
      <SectionLabel>Radar</SectionLabel>
      <ToggleRow label="Halo radar" pressed={state.radar} onToggle={() => onToggle('radar')} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="px-2 pt-2 pb-0.5 text-[11px] uppercase tracking-widest font-semibold text-ink-3 select-none">
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  pressed,
  indent = false,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  indent?: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={[
        'w-full flex items-center justify-between rounded px-2 py-2 text-sm transition-colors',
        pressed
          ? 'bg-surface-raised text-ink'
          : 'text-ink-2 hover:bg-surface-raised hover:text-ink',
      ].join(' ')}
    >
      <span className={indent ? 'pl-4 text-ink-3' : undefined}>{label}</span>
      <span
        aria-hidden="true"
        className={[
          'w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0',
          pressed ? 'bg-accent border-accent' : 'bg-transparent border-hairline-strong',
        ].join(' ')}
      >
        {pressed ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path
              d="M2 5l2.5 2.5L8 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-on-accent"
            />
          </svg>
        ) : null}
      </span>
    </button>
  );
}

function ModelRow({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={[
        'w-full flex items-center justify-between rounded px-2 py-2 text-sm transition-colors',
        active ? 'bg-surface-raised text-ink' : 'text-ink-2 hover:bg-surface-raised hover:text-ink',
      ].join(' ')}
    >
      <span>{label}</span>
      {/* Filled/hollow circle: role=radio visual */}
      <span
        aria-hidden="true"
        className={[
          'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
          active ? 'border-accent' : 'border-hairline-strong',
        ].join(' ')}
      >
        {active ? <span className="w-2 h-2 rounded-full bg-accent block" /> : null}
      </span>
    </button>
  );
}
