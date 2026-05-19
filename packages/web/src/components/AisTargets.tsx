'use client';
import { useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { AisTarget } from '@g5000/core';

export interface AisTargetsProps {
  /** Map instance from `onLoad`. Pass `null` until the map is ready. */
  map: maplibregl.Map | null;
  /** Polling interval in ms. Default 2000 — matches the /ais radar page. */
  pollMs?: number;
  /**
   * Minutes of travel to project ahead along each target's COG, at the
   * target's reported SOG. Mirrors CogExtension's own-boat horizon so a
   * single time scale governs every vessel on the chart. Default 360 (6 h).
   */
  cogExtensionMinutes?: number;
}

const M_PER_DEG_LAT = 111_320;
const TARGET_SOURCE_ID = 'ais-targets';
const TARGET_CIRCLE_ID = 'ais-targets-circle';
const COG_SOURCE_ID = 'ais-cog-extensions';
const COG_LAYER_ID = 'ais-cog-extensions-line';
/** Render targets unseen for >1 min in a faded "stale" style. */
const STALE_MS = 60_000;
/** Drop targets unseen for >5 min from the chart entirely (server also
 *  evicts at this threshold). */
const DROP_MS = 5 * 60_000;
// Name labels aren't a maplibre symbol layer — the map style has no
// `glyphs` URL, so a `text-field` layer would silently be dropped. The
// AisNameMarkers helper below renders names as DOM markers instead.

interface TargetsResponse {
  targets: AisTarget[];
  error?: string;
}

/**
 * Renders nearby AIS targets on the chart as gray dots with COG-aligned
 * extension lines and the ship name as a label. Polls `/api/ais/targets`
 * every `pollMs` and writes two GeoJSON sources — the symbol layers
 * sit above wind tiles but the LiveBoatMarker's trail layer keeps top
 * z-order because its component runs moveLayer() on every fix.
 *
 * No CPA/TCPA computation here — that's a richer concern that the
 * dedicated /ais page handles. The chart's purpose is situational
 * awareness only.
 */
export function AisTargets({ map, pollMs = 2000, cogExtensionMinutes = 360 }: AisTargetsProps) {
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const nameMarkers = new Map<number, maplibregl.Marker>();

    const syncNameMarkers = (targets: AisTarget[]): void => {
      const live = new Set<number>();
      const now = Date.now();
      for (const t of targets) {
        if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
        live.add(t.mmsi);
        const label = t.name ?? String(t.mmsi);
        const stale = now - t.lastSeenMs > STALE_MS;
        let m = nameMarkers.get(t.mmsi);
        if (!m) {
          const el = document.createElement('div');
          el.className = 'ais-name-label';
          el.style.cssText =
            'font: 11px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;' +
            'background: rgba(11,14,20,0.7);' +
            'padding: 1px 4px; border-radius: 2px;' +
            'transform: translateY(8px); white-space: nowrap;' +
            'pointer-events: none;';
          el.textContent = label;
          m = new maplibregl.Marker({ element: el, anchor: 'top' });
          nameMarkers.set(t.mmsi, m);
          m.setLngLat([t.lon!, t.lat!]).addTo(map);
        } else {
          if (m.getElement().textContent !== label) m.getElement().textContent = label;
          m.setLngLat([t.lon!, t.lat!]);
        }
        const el = m.getElement();
        el.style.color = stale ? '#64748b' : '#cbd5e1';
        el.style.fontStyle = stale ? 'italic' : 'normal';
        el.style.opacity = stale ? '0.7' : '1';
      }
      for (const [mmsi, m] of nameMarkers) {
        if (!live.has(mmsi)) {
          try {
            m.remove();
          } catch {
            /* ignore */
          }
          nameMarkers.delete(mmsi);
        }
      }
    };

    const setupLayers = (): void => {
      if (!map.getSource(TARGET_SOURCE_ID)) {
        map.addSource(TARGET_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getSource(COG_SOURCE_ID)) {
        map.addSource(COG_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(COG_LAYER_ID)) {
        map.addLayer({
          id: COG_LAYER_ID,
          type: 'line',
          source: COG_SOURCE_ID,
          paint: { 'line-color': '#64748b', 'line-width': 1, 'line-opacity': 0.7 },
        });
      }
      if (!map.getLayer(TARGET_CIRCLE_ID)) {
        map.addLayer({
          id: TARGET_CIRCLE_ID,
          type: 'circle',
          source: TARGET_SOURCE_ID,
          paint: {
            'circle-radius': 5,
            // Stale targets render hollow + dim; fresh ones solid grey.
            'circle-color': ['case', ['get', 'stale'], 'rgba(0,0,0,0)', '#94a3b8'],
            'circle-stroke-color': ['case', ['get', 'stale'], '#64748b', '#0f172a'],
            'circle-stroke-width': 1.2,
            'circle-opacity': ['case', ['get', 'stale'], 0.6, 1],
          },
        });
      }
    };
    // Lazy-init pattern: we don't rely on the 'load' event because it can
    // already have fired by the time this component mounts (LiveBoatMarker
    // attaches before us, and the maplibre map can finish loading between
    // its effect and ours). Every writeSources call ensures the layers
    // exist; first poll creates them, subsequent polls just update data.
    const writeSources = (targets: AisTarget[]): void => {
      if (!map.isStyleLoaded()) return;
      setupLayers();
      const tgtSrc = map.getSource(TARGET_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const cogSrc = map.getSource(COG_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!tgtSrc || !cogSrc) return;
      const now = Date.now();
      // Defense-in-depth — the server evicts at the same threshold, but a
      // stale poll response or transient server hiccup shouldn't leave dots
      // on the chart past their welcome.
      const visible = targets.filter((t) => now - t.lastSeenMs < DROP_MS);
      const tgtFeatures = visible
        .filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lon))
        .map((t) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [t.lon!, t.lat!] },
          properties: {
            mmsi: t.mmsi,
            name: t.name ?? null,
            cog: t.cog ?? null,
            sog: t.sog ?? null,
            stale: now - t.lastSeenMs > STALE_MS,
          },
        }));
      tgtSrc.setData({ type: 'FeatureCollection', features: tgtFeatures });

      const totalSec = cogExtensionMinutes * 60;
      const cogFeatures = visible
        .filter(
          (t) =>
            // Drop COG extensions for stale targets — projecting forward
            // from a >1-min-old position is misleading.
            now - t.lastSeenMs <= STALE_MS &&
            Number.isFinite(t.lat) &&
            Number.isFinite(t.lon) &&
            typeof t.cog === 'number' &&
            Number.isFinite(t.cog) &&
            typeof t.sog === 'number' &&
            Number.isFinite(t.sog) &&
            // Mirror CogExtension's gate so anchored/drifting targets don't
            // draw zero-length lines that maplibre would round into a dot.
            t.sog > 0.05,
        )
        .map((t) => {
          // Flat-earth projection — at 360 min × ~20 kn this is ~120 NM and
          // the great-circle bias is still well below chart-pixel precision
          // at typical zooms. Slower targets stay even smaller.
          const distM = t.sog! * totalSec;
          const dLat = (distM * Math.cos(t.cog!)) / M_PER_DEG_LAT;
          const dLon =
            (distM * Math.sin(t.cog!)) /
            (M_PER_DEG_LAT * Math.max(0.05, Math.cos((t.lat! * Math.PI) / 180)));
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'LineString' as const,
              coordinates: [
                [t.lon!, t.lat!],
                [t.lon! + dLon, t.lat! + dLat],
              ],
            },
            properties: { mmsi: t.mmsi },
          };
        });
      cogSrc.setData({ type: 'FeatureCollection', features: cogFeatures });
      syncNameMarkers(visible.filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lon)));
    };

    const poll = async (): Promise<void> => {
      try {
        const r = await fetch('/api/ais/targets', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as TargetsResponse;
        if (!cancelled) writeSources(j.targets ?? []);
      } catch {
        /* upstream blip — next tick retries */
      }
    };
    void poll();
    pollTimer = setInterval(poll, pollMs);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      for (const m of nameMarkers.values()) {
        try {
          m.remove();
        } catch {
          /* ignore */
        }
      }
      nameMarkers.clear();
      // Best-effort teardown — leaving stale layers around when the
      // component unmounts during HMR would clutter the map.
      for (const id of [TARGET_CIRCLE_ID, COG_LAYER_ID]) {
        if (map.getLayer(id)) {
          try {
            map.removeLayer(id);
          } catch {
            /* style torn down */
          }
        }
      }
      for (const id of [TARGET_SOURCE_ID, COG_SOURCE_ID]) {
        if (map.getSource(id)) {
          try {
            map.removeSource(id);
          } catch {
            /* style torn down */
          }
        }
      }
    };
  }, [map, pollMs, cogExtensionMinutes]);

  return null;
}
