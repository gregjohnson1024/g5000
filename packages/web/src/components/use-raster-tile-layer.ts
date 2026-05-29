import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';

/**
 * Distributive Omit: applies Omit to each member of a union separately, so a
 * narrowed `{ type: 'circle', paint }` keeps its own `paint`. A plain
 * `Omit<LayerSpecification, …>` collapses the union and drops per-member props.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type LayerSpecConfig = DistributiveOmit<LayerSpecification, 'id' | 'source' | 'layout'>;

/**
 * Shared MapLibre overlay scaffold for the chart's tile/vector layers.
 *
 * EncLayer, SatelliteLayer, and EncBuoyLayer each mounted an identical
 * pair of effects: an `ensure()` that idempotently adds a source + layer
 * (inserted below the `__above-wind__` z-order sentinel) and retries on
 * `styledata`, plus a second effect that toggles the layer's visibility.
 * This hook holds that verbatim scaffold; callers pass the per-layer
 * source spec, the layer spec (sans the id / source / visibility the hook
 * injects), and the ids.
 *
 * MapLibre traps preserved exactly (see CLAUDE.md → "MapLibre traps"):
 *  - Do NOT gate on map.isStyleLoaded(); the chart page hands us `map`
 *    from Map.tsx's onLoad, so add* is safe. try/catch survives an HMR
 *    teardown where the map is gone between renders.
 *  - Keep the `map.on('styledata', ensure)` retry.
 *  - Insert below the `__above-wind__` sentinel via beforeId.
 *  - The visibility toggle lives in its own effect so visible flips don't
 *    re-run add*.
 *
 * `layer` carries everything specific to the layer (type, paint, etc.)
 * minus the id/source/layout.visibility the hook fills in — e.g. the
 * EncBuoyLayer `match` colour expression rides along here.
 */
export function useRasterTileLayer({
  map,
  visible,
  sourceId,
  layerId,
  source,
  layer,
}: {
  map: maplibregl.Map | null;
  visible: boolean;
  sourceId: string;
  layerId: string;
  source: maplibregl.SourceSpecification;
  layer: LayerSpecConfig;
}): void {
  useEffect(() => {
    if (!map) return;
    const ensure = (): void => {
      try {
        if (!map.getSource(sourceId)) {
          map.addSource(sourceId, source);
        }
        if (!map.getLayer(layerId)) {
          const beforeId = map.getLayer('__above-wind__') ? '__above-wind__' : undefined;
          map.addLayer(
            {
              ...layer,
              id: layerId,
              source: sourceId,
              layout: { visibility: visible ? 'visible' : 'none' },
            } as maplibregl.AddLayerObject,
            beforeId,
          );
        }
      } catch {
        /* style torn down mid-render; the next styledata event retries */
      }
    };

    ensure();
    map.on('styledata', ensure);
    return () => {
      map.off('styledata', ensure);
    };
    // sourceId/layerId/source/layer are constant-valued per layer (the ids are
    // module constants; the source/layer literals are rebuilt each render but
    // never change), and the getSource/getLayer guards are idempotent — so
    // re-running only on [map, visible] matches the pre-refactor behavior.
    // exhaustive-deps is intentionally suppressed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, visible]);

  useEffect(() => {
    if (!map) return;
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, visible]);
}
