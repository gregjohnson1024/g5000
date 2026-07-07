/**
 * SailGridAxes — shared SVG axis/grid elements for the sail TWS×TWA grid.
 *
 * Used by both SailOverlayChart (view) and SailRegionEditor (edit) to ensure
 * consistent tick labels, grid lines, and axis annotations without duplication.
 *
 * Caller wraps this in an <svg> and provides the CELL_W/CELL_H constants plus
 * the transform `translate(MARGIN_L, 0)` on the grid group.
 *
 * Props:
 *   CELL_W, CELL_H  — pixel size of each grid cell
 *   W, H            — total grid width/height (SAIL_GRID_TWS_BINS * CELL_W, etc.)
 *   MARGIN_L, MARGIN_B — left and bottom margin for axis labels
 *   TWA_STEP_DEG    — SAIL_GRID_TWA_STEP_DEG from @g5000/core
 */

const TWS_TICKS = [0, 5, 10, 15, 20, 25, 30, 35, 40] as const;
const TWA_TICKS = [0, 30, 60, 90, 120, 150, 180] as const;

interface SailGridAxesProps {
  /** Pixel width of each grid cell */
  CELL_W: number;
  /** Pixel height of each grid cell */
  CELL_H: number;
  /** Total grid width (SAIL_GRID_TWS_BINS × CELL_W) */
  W: number;
  /** Total grid height (SAIL_GRID_TWA_BINS × CELL_H) */
  H: number;
  /** Left margin (pixels) */
  MARGIN_L: number;
  /** Bottom margin (pixels) */
  MARGIN_B: number;
  /** TWA step in degrees (SAIL_GRID_TWA_STEP_DEG from @g5000/core) */
  TWA_STEP_DEG: number;
}

/**
 * Grid lines group (render inside the main grid <g transform="translate(MARGIN_L,0)">).
 */
export function SailGridLines({ CELL_W, CELL_H, W, H, TWA_STEP_DEG }: Omit<SailGridAxesProps, 'MARGIN_L' | 'MARGIN_B'>): React.JSX.Element {
  return (
    <>
      {TWS_TICKS.map((kn) => (
        <line
          key={`gx-${kn}`}
          x1={kn * CELL_W}
          y1={0}
          x2={kn * CELL_W}
          y2={H}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
      ))}
      {TWA_TICKS.map((deg) => {
        const y = (deg / TWA_STEP_DEG) * CELL_H;
        return (
          <line
            key={`gy-${deg}`}
            x1={0}
            y1={y}
            x2={W}
            y2={y}
            stroke="currentColor"
            strokeOpacity={0.2}
          />
        );
      })}
    </>
  );
}

/**
 * TWS tick labels at the bottom (render inside the main grid <g transform="translate(MARGIN_L,0)">).
 */
export function SailGridTwsTicks({ CELL_W, H }: Pick<SailGridAxesProps, 'CELL_W' | 'H'>): React.JSX.Element {
  return (
    <>
      {TWS_TICKS.map((kn) => (
        <text
          key={`tx-${kn}`}
          x={kn * CELL_W}
          y={H + 14}
          fontSize={10}
          fill="currentColor"
          fillOpacity={0.7}
          textAnchor="middle"
        >
          {kn}
        </text>
      ))}
    </>
  );
}

/**
 * TWA tick labels on the left side + axis labels for TWA/TWS.
 * Render at the <svg> root level (NOT inside the grid <g>).
 */
export function SailGridTwaTicks({
  CELL_H,
  MARGIN_L,
  MARGIN_B,
  W,
  H,
  TWA_STEP_DEG,
}: Omit<SailGridAxesProps, 'CELL_W'>): React.JSX.Element {
  return (
    <>
      {TWA_TICKS.map((deg) => {
        const y = (deg / TWA_STEP_DEG) * CELL_H;
        return (
          <text
            key={`ty-${deg}`}
            x={MARGIN_L - 6}
            y={y + 4}
            fontSize={10}
            fill="currentColor"
            fillOpacity={0.7}
            textAnchor="end"
          >
            {deg}°
          </text>
        );
      })}
      <text x={4} y={10} fontSize={10} fill="currentColor" fillOpacity={0.7}>
        TWA
      </text>
      <text
        x={W + MARGIN_L - 4}
        y={H + MARGIN_B - 4}
        fontSize={10}
        fill="currentColor"
        fillOpacity={0.7}
        textAnchor="end"
      >
        TWS (kn)
      </text>
    </>
  );
}
