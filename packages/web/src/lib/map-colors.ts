/**
 * Resolve a CSS custom property to a concrete color for MapLibre paint/layout specs.
 *
 * MapLibre GL parses paint colors itself and cannot resolve `var(--token)` strings —
 * passing one throws at `addLayer` and the layer silently never mounts. So map layers
 * resolve the token once at layer-add time via `getComputedStyle`. Live theme-tracking
 * is not needed: NIGHT recolouring is handled by the canvas-level `--map-filter`.
 */
export function cssColor(token: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value !== '' ? value : fallback;
}
