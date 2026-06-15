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
