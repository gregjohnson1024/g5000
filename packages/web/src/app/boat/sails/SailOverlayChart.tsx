'use client';

import { useMemo } from 'react';
import { SAIL_GRID_TWS_BINS, SAIL_GRID_TWA_BINS, SAIL_GRID_TWA_STEP_DEG } from '@g5000/core';
import type { SailCategory, SailWardrobe } from '@g5000/db';
import { colorForId } from '../../../lib/config-color';
import { SailGridLines, SailGridTwsTicks, SailGridTwaTicks } from './SailGridAxes';

const CELL_W = 14;
const CELL_H = 14;

interface Props {
  wardrobe: SailWardrobe;
  filterCategory?: SailCategory | 'all';
  liveCell?: { twsIdx: number; twaIdx: number };
}

export function SailOverlayChart({ wardrobe, filterCategory = 'all', liveCell }: Props) {
  const sails = useMemo(
    () =>
      filterCategory === 'all'
        ? wardrobe.sails
        : wardrobe.sails.filter((s) => s.category === filterCategory),
    [wardrobe, filterCategory],
  );

  const W = SAIL_GRID_TWS_BINS * CELL_W;
  const H = SAIL_GRID_TWA_BINS * CELL_H;
  const MARGIN_L = 40;
  const MARGIN_B = 28;

  return (
    <svg
      viewBox={`0 0 ${W + MARGIN_L} ${H + MARGIN_B}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-auto max-w-[900px]"
    >
      <g transform={`translate(${MARGIN_L},0)`}>
        {/* Grid lines (shared axis primitive) */}
        <SailGridLines
          CELL_W={CELL_W}
          CELL_H={CELL_H}
          W={W}
          H={H}
          TWA_STEP_DEG={SAIL_GRID_TWA_STEP_DEG}
        />

        {/* Region fills */}
        {sails.map((sail) => (
          <g key={sail.id} fill={colorForId(sail.id)} fillOpacity={0.3}>
            {sail.region.cells.map((key) => {
              const [tx, ty] = key.split(',').map(Number);
              return (
                <rect
                  key={`${sail.id}-${key}`}
                  x={(tx as number) * CELL_W}
                  y={(ty as number) * CELL_H}
                  width={CELL_W}
                  height={CELL_H}
                />
              );
            })}
          </g>
        ))}

        {/* Live position */}
        {liveCell && (
          <circle
            cx={liveCell.twsIdx * CELL_W + CELL_W / 2}
            cy={liveCell.twaIdx * CELL_H + CELL_H / 2}
            r={5}
            fill="currentColor"
            stroke="white"
            strokeWidth={2}
          />
        )}

        {/* TWS tick labels (bottom) */}
        <SailGridTwsTicks CELL_W={CELL_W} H={H} />
      </g>

      {/* TWA tick labels + axis annotations (root level) */}
      <SailGridTwaTicks
        CELL_H={CELL_H}
        MARGIN_L={MARGIN_L}
        MARGIN_B={MARGIN_B}
        W={W}
        H={H}
        TWA_STEP_DEG={SAIL_GRID_TWA_STEP_DEG}
      />
    </svg>
  );
}
