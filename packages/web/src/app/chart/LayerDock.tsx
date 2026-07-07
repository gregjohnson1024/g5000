'use client';

import { useEffect, useRef, useState } from 'react';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { LayersLens } from './lenses/LayersLens';
import { AisLens } from './lenses/AisLens';
import { RouteLens, type RouteLensProps } from './lenses/RouteLens';
import type { LayersState, LayerToggleKey } from './LayersControl';
import type { ChartModel } from './model-layer';
import type { PresetName } from './presets';

/**
 * True once the viewport has been measured as ≥ 1024px (the Tailwind `lg` breakpoint).
 * Returns false during SSR and on the first render before the matchMedia fires.
 * Used to gate which branch actually mounts the lens content so we never have
 * two instances of <AisLens> / <RouteLens> active simultaneously.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent): void => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

/**
 * The three dock lenses. 'ais' and 'route' are Phase-5 T2/T3 stubs.
 */
export type DockLens = 'layers' | 'ais' | 'route';

const LENS_TABS = [
  { value: 'layers' as DockLens, label: 'Layers' },
  { value: 'ais' as DockLens, label: 'AIS' },
  { value: 'route' as DockLens, label: 'Route' },
];

const LS_LENS_KEY = 'chart:lens';

function readStoredLens(searchLens: string | null): DockLens {
  // URL param wins over localStorage
  if (searchLens === 'ais') return 'ais';
  if (searchLens === 'route') return 'route';
  if (searchLens === 'layers') return 'layers';
  try {
    const raw = localStorage.getItem(LS_LENS_KEY);
    if (raw === 'ais' || raw === 'route' || raw === 'layers') return raw;
  } catch {
    /* SSR or private-mode */
  }
  return 'layers';
}

function writeStoredLens(lens: DockLens): void {
  try {
    localStorage.setItem(LS_LENS_KEY, lens);
  } catch {
    /* quota / private-mode */
  }
}

/**
 * LayerDock — the chart's right-side 360px panel (desktop/Pi) that becomes
 * a BottomSheet when the viewport is narrow (< lg = 1024px).
 *
 * Layout rules
 * ────────────
 * lg+ : fixed right column in the `grid-cols-[1fr_360px]` grid set in page.tsx.
 *        The dock fills the column with a scrollable lens body below the tab bar.
 * <lg : a fixed BottomSheet pinned to the bottom. The tab bar is always visible
 *        (peek = tab bar only); tapping a tab opens the body to ~50 vh.
 *
 * The lens tab bar uses SegmentedControl (size=sm) — one implementation, not a
 * new pattern.
 *
 * Lens state seeds from ?lens= URL param (only 'ais' recognized, else 'layers')
 * then falls back to localStorage['chart:lens'].
 */

export function LayerDock({
  searchLens,
  layers,
  onToggle,
  onSelectModel,
  safetyDepthM,
  onSafetyDepthM,
  showTideCurrents,
  routeLensProps,
  activePreset,
  onApplyPreset,
  onResetToDefault,
}: {
  searchLens: string | null;
  layers: LayersState;
  onToggle: (key: LayerToggleKey) => void;
  onSelectModel: (model: ChartModel) => void;
  safetyDepthM: number;
  onSafetyDepthM: (m: number) => void;
  showTideCurrents: boolean;
  /** All props for the Route lens — plumbed from page.tsx. */
  routeLensProps: RouteLensProps;
  /** Currently active preset pill — 'custom' means manual overrides. */
  activePreset: PresetName;
  /** Called when the user taps a named preset button. */
  onApplyPreset: (name: Exclude<PresetName, 'custom'>) => void;
  /** Called when the user clicks "Reset to default". */
  onResetToDefault: () => void;
}): React.ReactElement {
  const [activeLens, setActiveLens] = useState<DockLens>('layers');
  const [hydrated, setHydrated] = useState(false);
  // BottomSheet open state (narrow viewports only)
  const [sheetOpen, setSheetOpen] = useState(false);
  // True when the viewport is ≥ 1024px (lg). After SSR hydration this reflects
  // the real viewport so we can gate which branch mounts the lens content.
  const isDesktop = useIsDesktop();

  // Hydrate lens from URL param / localStorage after mount (SSR-safe)
  useEffect(() => {
    const lens = readStoredLens(searchLens);
    setActiveLens(lens);
    // Auto-open the sheet if a specific lens was requested via URL
    if (searchLens === 'ais' || searchLens === 'route' || searchLens === 'layers') {
      setSheetOpen(true);
    }
    setHydrated(true);
  }, [searchLens]);

  const handleLensChange = (lens: DockLens): void => {
    if (lens === activeLens && sheetOpen) {
      // Tapping the active tab again collapses the sheet (mobile)
      setSheetOpen(false);
      return;
    }
    setActiveLens(lens);
    writeStoredLens(lens);
    setSheetOpen(true);
  };

  const layersLensProps = {
    layers,
    onToggle,
    onSelectModel,
    safetyDepthM,
    onSafetyDepthM,
    showTideCurrents,
    activePreset,
    onApplyPreset,
    onResetToDefault,
  };

  const tabBar = (
    <div className="px-3 py-2">
      <SegmentedControl
        segments={LENS_TABS}
        value={activeLens}
        onChange={handleLensChange}
        aria-label="Chart lens"
        size="sm"
        className="w-full"
      />
    </div>
  );

  // Render the active lens content in exactly ONE branch — desktop or mobile —
  // based on the real viewport width (useIsDesktop). Tailwind `hidden`/`lg:hidden`
  // is display:none, which does NOT unmount React components, so mounting
  // lensContent in both branches would produce two <AisLens> / <RouteLens>
  // instances simultaneously (doubled polling, double audio, split mute state).
  // By gating on isDesktop we ensure only the visible branch mounts the lens.
  const lensNode = hydrated ? renderLens(activeLens, layersLensProps, routeLensProps) : null;

  return (
    <>
      {/* ── Desktop/Pi dock (lg+) ─────────────────────────────────── */}
      {/* Hidden below lg; the BottomSheet takes over. */}
      <aside className="hidden lg:flex flex-col border-l border-hairline bg-surface overflow-hidden">
        {/* Lens tab bar */}
        <div className="flex-shrink-0 border-b border-hairline px-3 py-2">
          <SegmentedControl
            segments={LENS_TABS}
            value={activeLens}
            onChange={(lens) => {
              setActiveLens(lens);
              writeStoredLens(lens);
              setSheetOpen(true); // kept in sync for shared state
            }}
            aria-label="Chart lens"
            size="sm"
            className="w-full"
          />
        </div>
        {/* Scrollable lens body — only mounted here when the desktop column is active */}
        <div className="flex-1 overflow-y-auto px-2 py-1">{isDesktop ? lensNode : null}</div>
      </aside>

      {/* ── Mobile BottomSheet (<lg) ──────────────────────────────── */}
      {/* Only rendered on narrow viewports. */}
      <div className="lg:hidden">
        <MobileSheet open={sheetOpen} tabBar={tabBar} onClose={() => setSheetOpen(false)}>
          {/* Lens body — only mounted here when the mobile sheet is the active branch */}
          <div className="px-2 py-2">{!isDesktop ? lensNode : null}</div>
        </MobileSheet>
      </div>
    </>
  );
}

/** Render the active lens content. */
function renderLens(
  lens: DockLens,
  layersProps: {
    layers: LayersState;
    onToggle: (key: LayerToggleKey) => void;
    onSelectModel: (model: ChartModel) => void;
    safetyDepthM: number;
    onSafetyDepthM: (m: number) => void;
    showTideCurrents: boolean;
    activePreset: PresetName;
    onApplyPreset: (name: Exclude<PresetName, 'custom'>) => void;
    onResetToDefault: () => void;
  },
  routeProps: RouteLensProps,
): React.ReactElement {
  switch (lens) {
    case 'ais':
      return <AisLens />;
    case 'route':
      return <RouteLens {...routeProps} />;
    default:
      return (
        <LayersLens
          state={layersProps.layers}
          onToggle={layersProps.onToggle}
          onSelectModel={layersProps.onSelectModel}
          safetyDepthM={layersProps.safetyDepthM}
          onSafetyDepthM={layersProps.onSafetyDepthM}
          showTideCurrents={layersProps.showTideCurrents}
          activePreset={layersProps.activePreset}
          onApplyPreset={layersProps.onApplyPreset}
          onResetToDefault={layersProps.onResetToDefault}
        />
      );
  }
}

/**
 * MobileSheet — the bottom sheet wrapper for narrow viewports.
 * Always shows tabBar; slides body up when open.
 */
function MobileSheet({
  open,
  tabBar,
  onClose,
  children,
}: {
  open: boolean;
  tabBar: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside detection (close when tapping the map behind the tab bar)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  return (
    <div
      ref={rootRef}
      className="fixed bottom-0 left-0 right-0 z-30 bg-surface-sunken border-t border-hairline"
    >
      {open && (
        <div
          role="dialog"
          aria-label="Chart layers"
          className="border-b border-hairline bg-surface overflow-y-auto"
          style={{ maxHeight: '50vh' }}
        >
          {children}
        </div>
      )}
      {tabBar}
    </div>
  );
}
