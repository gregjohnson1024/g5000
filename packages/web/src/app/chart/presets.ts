/**
 * presets.ts — Manual layer presets for the chart.
 *
 * Each preset is a PARTIAL patch over the current LayersState — only the keys
 * listed here change when you apply it; everything else stays as-is. The user
 * invokes presets explicitly; they are NEVER applied automatically on mode
 * changes or navigation (see proposal §4: "system proposes / sailor disposes").
 *
 * The `DEFAULT_LAYERS` constant is the canonical baseline that `resetLayers()`
 * restores to. It mirrors the inline default in page.tsx so the two never drift.
 *
 * Design rationale for each preset (documented inline per brief):
 *
 *   Default   — OSM on, AIS + COG on, no model overlay, extras off. Clean chart.
 *
 *   Race      — GFS wind model (see the forecast) + AIS targets + COG extensions
 *               on (critical for collision avoidance at the start line). Buoys off
 *               (clutter on a crowded course). A racing sailor's minimum viable chart.
 *
 *   Anchor    — radar on (situational awareness at anchor) + AIS targets on. OSM on.
 *               No model overlay (not needed at anchor). Minimal overlays. Sat off
 *               (radar is the nearby picture; sat wastes bandwidth).
 *
 *   Passage   — GFS wind model + buoys on (aids to navigation matter on a long leg).
 *               AIS + COG on (watchkeeping). No radar (no mast unit underway, and
 *               the range is too short for offshore use). Bathy off — ocean depths
 *               visible but not highlighted (safety-depth = 0 default).
 */

import type { LayersState } from './LayersControl';
import type { ChartModel } from './model-layer';

export type PresetName = 'default' | 'race' | 'anchor' | 'passage' | 'custom';

/** The baseline chart state — matches the inline defaults in page.tsx. */
export const DEFAULT_LAYERS: LayersState = {
  osm: true,
  enc: false,
  satellite: false,
  buoys: false,
  bathy: false,
  ais: true,
  aisCog: true,
  tideStations: false,
  currentStations: false,
  radar: false,
  model: 'none' as ChartModel,
};

/**
 * Partial patches keyed by preset name.
 * Applying a preset = { ...currentLayers, ...CHART_PRESETS[name] }
 * so keys NOT listed here are left exactly as they were.
 */
export const CHART_PRESETS: Record<Exclude<PresetName, 'custom'>, Partial<LayersState>> = {
  default: {
    osm: true,
    enc: false,
    satellite: false,
    buoys: false,
    bathy: false,
    ais: true,
    aisCog: true,
    tideStations: false,
    currentStations: false,
    radar: false,
    model: 'none' as ChartModel,
  },

  race: {
    // GFS wind model shows forecast — critical for tactical decisions.
    model: 'gfs' as ChartModel,
    // AIS + COG mandatory for collision avoidance at the start line.
    ais: true,
    aisCog: true,
    // Radar off by default for race (no offshore range benefit; start-line
    // area is congested and the AIS picture is sufficient).
    radar: false,
    // Buoys off — reduces clutter on a course-racing chart.
    buoys: false,
  },

  anchor: {
    // Radar on — primary nearby-traffic / weather tool at anchor.
    radar: true,
    // AIS on — complements radar for vessel identification.
    ais: true,
    aisCog: true,
    // No model overlay — wind forecasts irrelevant when stationary.
    model: 'none' as ChartModel,
    // Satellite and ENC off — OSM is sufficient in a quiet anchorage.
    satellite: false,
    enc: false,
    // Buoys off — no need to clutter the anchor chart.
    buoys: false,
  },

  passage: {
    // GFS wind for offshore route weather.
    model: 'gfs' as ChartModel,
    // Buoys on — aids to navigation matter on a coastal/offshore leg.
    buoys: true,
    // AIS + COG on — watchkeeping.
    ais: true,
    aisCog: true,
    // Radar off — short range not useful offshore.
    radar: false,
    // Sat off — saves bandwidth underway.
    satellite: false,
  },
};

/**
 * Returns a fresh DEFAULT_LAYERS object (new reference each call so React state
 * always sees a change).
 */
export function resetLayers(): LayersState {
  return { ...DEFAULT_LAYERS };
}

/**
 * Apply a named preset as a partial patch over the current layers.
 * Returns a new LayersState object; does NOT mutate the input.
 */
export function applyPresetPatch(
  current: LayersState,
  name: Exclude<PresetName, 'custom'>,
): LayersState {
  return { ...current, ...CHART_PRESETS[name] };
}
