'use client';

export type Orientation = 'north' | 'course' | 'heading';

export function cycleOrientation(o: Orientation): Orientation {
  if (o === 'north') return 'course';
  if (o === 'course') return 'heading';
  return 'north';
}

/**
 * Smallest absolute angular delta between two bearings in degrees, wrapping
 * across the 0/360 seam. Always non-negative, always ≤ 180.
 */
export function wrapBearingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function readFollowFromStorage(raw: string | null): boolean {
  if (raw === null) return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed === true || parsed === false ? parsed : true;
  } catch {
    return true;
  }
}

export function readOrientationFromStorage(raw: string | null): Orientation {
  if (raw === 'north' || raw === 'course' || raw === 'heading') return raw;
  return 'north';
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LivePos } from '../../components/LiveBoatMarker';

const RAD_TO_DEG = 180 / Math.PI;
const BEARING_DEADBAND_DEG = 3;
const EASE_DURATION_MS = 300;
const BEARING_EASE_MS = 500;
const LOOKAHEAD_TOP_FRACTION = 0.3;

export interface ChartCameraHandle {
  follow: boolean;
  orientation: Orientation;
  toggleFollow: () => void;
  enterFollow: () => void;
  cycleOrientation: () => void;
}

/**
 * Owns chart-follow + chart-orientation state, persists each to localStorage,
 * and drives the MapLibre camera in response to position updates and
 * orientation changes.
 *
 * Programmatic-move filtering: MapLibre fires `dragend` with `e.originalEvent`
 * undefined for our own easeTo calls and with a real MouseEvent/TouchEvent
 * for user pans. We only flip `follow` off when the originating event was a
 * user gesture.
 *
 * Bearing dead-band: COG/HDG arrive at ~1 Hz with sensor noise. Re-easing the
 * bearing on every tiny wiggle produces visible jitter. We re-ease only when
 * the next target differs from the last applied bearing by at least
 * BEARING_DEADBAND_DEG.
 *
 * Lookahead: in course/heading orientation while following, set
 * `map.setPadding({ top: 30% * height })` so the viewport center sits below
 * the geometric center — the boat ends up ~30% from the bottom edge and the
 * user sees more ahead than behind.
 */
export function useChartCamera({
  map,
  livePos,
}: {
  map: maplibregl.Map | null;
  livePos: LivePos | null;
}): ChartCameraHandle {
  const [follow, setFollow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return readFollowFromStorage(window.localStorage.getItem('chart:follow'));
  });
  const [orientation, setOrientation] = useState<Orientation>(() => {
    if (typeof window === 'undefined') return 'north';
    return readOrientationFromStorage(window.localStorage.getItem('chart:orientation'));
  });

  // Persist
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('chart:follow', JSON.stringify(follow));
    } catch {
      /* private-mode / quota — ignore */
    }
  }, [follow]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('chart:orientation', orientation);
    } catch {
      /* ignore */
    }
  }, [orientation]);

  // Stale-closure-safe refs for use inside map event handlers
  const followRef = useRef(follow);
  followRef.current = follow;
  const lastAppliedBearingRef = useRef<number>(0);

  // Pan-exit: user-initiated drag drops follow mode
  useEffect(() => {
    if (!map) return;
    const onDragEnd = (e: { originalEvent?: MouseEvent | TouchEvent }): void => {
      if (!e.originalEvent) return; // programmatic move, ignore
      if (followRef.current) setFollow(false);
    };
    map.on('dragend', onDragEnd);
    return () => {
      map.off('dragend', onDragEnd);
    };
  }, [map]);

  // Lookahead padding
  useEffect(() => {
    if (!map) return;
    const lookahead = follow && orientation !== 'north';
    if (lookahead) {
      const h = map.getCanvas().clientHeight;
      map.setPadding({
        top: Math.round(h * LOOKAHEAD_TOP_FRACTION),
        bottom: 0,
        left: 0,
        right: 0,
      });
    } else {
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    }
  }, [map, follow, orientation]);

  // Follow: re-center on each position update
  useEffect(() => {
    if (!map || !follow || !livePos) return;
    map.easeTo({ center: [livePos.lon, livePos.lat], duration: EASE_DURATION_MS });
  }, [map, follow, livePos]);

  // Orientation: apply bearing, with dead-band to suppress jitter
  useEffect(() => {
    if (!map) return;
    let target = 0;
    if (orientation === 'course' && livePos?.cog != null) {
      target = (((livePos.cog * RAD_TO_DEG) % 360) + 360) % 360;
    } else if (orientation === 'heading' && livePos?.hdg != null) {
      target = (((livePos.hdg * RAD_TO_DEG) % 360) + 360) % 360;
    } else if (orientation === 'heading' && livePos?.cog != null) {
      // Heading source missing — fall back to course
      target = (((livePos.cog * RAD_TO_DEG) % 360) + 360) % 360;
    }
    if (wrapBearingDelta(target, lastAppliedBearingRef.current) < BEARING_DEADBAND_DEG) {
      return;
    }
    lastAppliedBearingRef.current = target;
    map.easeTo({ bearing: target, duration: BEARING_EASE_MS });
  }, [map, orientation, livePos?.cog, livePos?.hdg]);

  const toggleFollow = useCallback(() => setFollow((v) => !v), []);
  const enterFollow = useCallback(() => setFollow(true), []);
  const cycleOrientationCb = useCallback(
    () => setOrientation((o) => cycleOrientation(o)),
    [],
  );

  return {
    follow,
    orientation,
    toggleFollow,
    enterFollow,
    cycleOrientation: cycleOrientationCb,
  };
}
