/** The selectable mast-display day base colours (high-contrast on black). */
export const DAY_BASE_COLORS = [
  'white',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'magenta',
] as const;

export type DayBaseColor = (typeof DAY_BASE_COLORS)[number];

/**
 * Day-mode canvas. Black and white are both offered because legibility depends
 * on ambient light rather than preference: in direct sun a light canvas wins
 * (ambient competes with the panel's emission), while black is better in low
 * light. Night mode is not configurable — it is always red on black.
 */
export const DAY_CANVASES = ['black', 'white'] as const;

export type DayCanvas = (typeof DAY_CANVASES)[number];
