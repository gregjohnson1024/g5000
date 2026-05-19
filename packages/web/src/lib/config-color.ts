/**
 * Stable color for a sail-config id. Hue is derived from a tiny FNV-1a
 * hash of the id so the same id always yields the same hue, and unrelated
 * ids land at different hues. Saturation/lightness fixed for a coherent
 * palette across the chart, helm badge, and timeline.
 *
 * No schema change — the persisted color field is captured as a future
 * issue. v1: identifiers map deterministically to hues.
 */
export function colorForId(id: string): string {
  return getConfigColor(id);
}

export function getConfigColor(id: string): string {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Spread the hash across 360° of hue. Use the lower 16 bits modulo for
  // a flat distribution.
  const hue = ((h >>> 0) & 0xffff) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
