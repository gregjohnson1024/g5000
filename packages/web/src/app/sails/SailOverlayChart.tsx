'use client';

import { useMemo } from 'react';
import { SAIL_GRID_TWS_BINS, SAIL_GRID_TWA_BINS, SAIL_GRID_TWA_STEP_DEG } from '@g5000/core';
import type { SailCategory, SailWardrobe } from '@g5000/db';
import { colorForId } from '../../lib/config-color';

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

  return (
    <svg width={W + 40} height={H + 30}>
      <g transform="translate(40,0)">
        {/* Axis lines */}
        {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((kn) => (
          <line key={`gx-${kn}`} x1={kn * CELL_W} y1={0} x2={kn * CELL_W} y2={H} stroke="#eee" />
        ))}
        {[0, 30, 60, 90, 120, 150, 180].map((deg) => {
          const y = (deg / SAIL_GRID_TWA_STEP_DEG) * CELL_H;
          return <line key={`gy-${deg}`} x1={0} y1={y} x2={W} y2={y} stroke="#eee" />;
        })}

        {/* Region fills */}
        {sails.map((sail) => (
          <g key={sail.id} fill={colorForId(sail.id)} fillOpacity={0.25}>
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
            fill="black"
            stroke="white"
            strokeWidth={2}
          />
        )}
      </g>
      <text x={10} y={10} fontSize={10}>
        TWA
      </text>
      <text x={W} y={H + 20} fontSize={10}>
        TWS (kn)
      </text>
    </svg>
  );
}
