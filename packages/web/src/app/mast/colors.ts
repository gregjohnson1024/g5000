import type { DayBaseColor, DayCanvas } from '@g5000/mast';

/** Hex for each selectable day base colour — bright/high-contrast on black. */
export const MAST_BASE_COLOR_HEX: Record<DayBaseColor, string> = {
  white: '#ffffff',
  red: '#ff5555',
  orange: '#ff9f43',
  yellow: '#ffd23f',
  green: '#4ade80',
  cyan: '#22d3ee',
  blue: '#60a5fa',
  magenta: '#e879f9',
};

/**
 * The same hues darkened for a WHITE canvas. The palette above is documented
 * "bright/high-contrast on black" and is unusable on white — #ffd23f yellow is
 * barely legible and #ffffff is invisible. Note 'white' maps to near-black
 * here: the neutral choice means "no tint", which is white ink on a black
 * canvas and black ink on a white one.
 */
export const MAST_BASE_COLOR_HEX_ON_WHITE: Record<DayBaseColor, string> = {
  white: '#0f172a',
  red: '#b91c1c',
  orange: '#c2410c',
  yellow: '#a16207',
  green: '#15803d',
  cyan: '#0e7490',
  blue: '#1d4ed8',
  magenta: '#a21caf',
};

/** Pick the base-colour hex appropriate to the active day canvas. */
export function mastBaseColorHex(color: DayBaseColor, canvas: DayCanvas): string {
  return canvas === 'white' ? MAST_BASE_COLOR_HEX_ON_WHITE[color] : MAST_BASE_COLOR_HEX[color];
}
