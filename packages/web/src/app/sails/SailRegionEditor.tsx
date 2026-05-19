'use client';

import { useState } from 'react';
import {
  SAIL_GRID_TWS_BINS,
  SAIL_GRID_TWA_BINS,
  SAIL_GRID_TWA_STEP_DEG,
  cellKey,
} from '@g5000/core';
import type { Sail } from '@g5000/db';
import { colorForId } from '../../lib/config-color';

const CELL_W = 14;
const CELL_H = 14;

interface Props {
  sail: Sail;
  onSave: (cells: string[]) => Promise<void>;
}

export function SailRegionEditor({ sail, onSave }: Props) {
  const [cells, setCells] = useState<Set<string>>(new Set(sail.region.cells));
  const [dirty, setDirty] = useState(false);

  function toggle(twsIdx: number, twaIdx: number) {
    const key = cellKey({ twsIdx, twaIdx });
    const next = new Set(cells);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCells(next);
    setDirty(true);
  }

  const W = SAIL_GRID_TWS_BINS * CELL_W;
  const H = SAIL_GRID_TWA_BINS * CELL_H;
  const MARGIN_L = 40;
  const MARGIN_B = 28;
  const color = colorForId(sail.id);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">
          Editing: <b>{sail.name}</b> ({cells.size} cells)
        </span>
        <button
          disabled={!dirty}
          onClick={() => {
            void onSave(Array.from(cells).sort());
            setDirty(false);
          }}
          className="px-2 py-1 bg-blue-500 text-white text-sm rounded disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <svg
        viewBox={`0 0 ${W + MARGIN_L} ${H + MARGIN_B}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto max-w-[900px]"
      >
        <g transform={`translate(${MARGIN_L},0)`}>
          {Array.from({ length: SAIL_GRID_TWA_BINS }, (_, twaIdx) =>
            Array.from({ length: SAIL_GRID_TWS_BINS }, (_, twsIdx) => {
              const key = cellKey({ twsIdx, twaIdx });
              const on = cells.has(key);
              return (
                <rect
                  key={key}
                  x={twsIdx * CELL_W}
                  y={twaIdx * CELL_H}
                  width={CELL_W}
                  height={CELL_H}
                  fill={on ? color : 'currentColor'}
                  fillOpacity={on ? 0.55 : 0.03}
                  stroke="currentColor"
                  strokeOpacity={0.15}
                  onClick={() => toggle(twsIdx, twaIdx)}
                  style={{ cursor: 'pointer' }}
                />
              );
            }),
          )}

          {/* TWS tick labels (bottom) */}
          {[0, 5, 10, 15, 20, 25, 30, 35, 40].map((kn) => (
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
        </g>

        {/* TWA tick labels (left) */}
        {[0, 30, 60, 90, 120, 150, 180].map((deg) => {
          const y = (deg / SAIL_GRID_TWA_STEP_DEG) * CELL_H;
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
          y={H + 24}
          fontSize={10}
          fill="currentColor"
          fillOpacity={0.7}
          textAnchor="end"
        >
          TWS (kn)
        </text>
      </svg>
    </div>
  );
}
