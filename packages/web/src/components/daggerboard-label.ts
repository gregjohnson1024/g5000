export type BoardSide = 'port' | 'starboard';

const SIDE_LABEL: Record<BoardSide, string> = { port: 'Port', starboard: 'Stbd' };

/** Track-annotation label for a daggerboard position change. */
export function daggerboardLabel(side: BoardSide, pct: number): string {
  const s = SIDE_LABEL[side];
  if (pct === 0) return `${s} board up`;
  if (pct === 100) return `${s} board down`;
  return `${s} board ${pct}%`;
}
