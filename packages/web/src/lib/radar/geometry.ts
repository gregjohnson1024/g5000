/**
 * North-up canvas pixel for a spoke cell. `dir` is the spoke direction in
 * [0..spokesPerRev) units (bearing if true-north, else angle from bow). The
 * canvas is square `sizePx`; centre = sizePx/2; the range edge = sizePx/2.
 * 0 = up (north/bow), increasing clockwise.
 */
export function spokeToCanvas(
  dir: number,
  spokesPerRev: number,
  cellIndex: number,
  cellCount: number,
  _range: number,
  sizePx: number,
): { x: number; y: number } {
  const theta = (dir / spokesPerRev) * 2 * Math.PI; // 0 = up, CW
  const r = (cellCount <= 1 ? 0 : cellIndex / (cellCount - 1)) * (sizePx / 2);
  const cx = sizePx / 2;
  const cy = sizePx / 2;
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta) };
}
