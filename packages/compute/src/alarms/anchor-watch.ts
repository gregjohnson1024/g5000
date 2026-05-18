import type { Bus, AlarmsRegistry } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';

const ID = 'anchor-watch';

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function startAnchorWatchPredicate(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
): { dispose(): void } {
  const unsubscribe = bus.subscribe('nav.gps.position', (sample) => {
    const cfg = configRef.current;
    if (!cfg.enabled[ID]) return;
    const anchor = cfg.thresholds.anchor;
    if (!anchor.armed || !anchor.point) return;
    if (sample.value.kind !== 'geo') return;
    const pos = sample.value.value;
    const distance = haversineMeters(anchor.point, pos);
    if (distance > anchor.radiusM) {
      registry.fire({
        id: ID,
        severity: 'CRITICAL',
        label: 'Anchor Drift',
        sticky: true,
        context: { distanceM: Math.round(distance), position: pos },
      });
    } else {
      registry.clear(ID);
    }
  });
  return { dispose: () => unsubscribe() };
}
