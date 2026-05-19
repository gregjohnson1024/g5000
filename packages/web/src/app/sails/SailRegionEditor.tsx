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
      <svg width={W + 40} height={H + 30}>
        <g transform="translate(40,0)">
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
                  fill={on ? color : 'white'}
                  fillOpacity={on ? 0.55 : 1}
                  stroke="#ddd"
                  onClick={() => toggle(twsIdx, twaIdx)}
                />
              );
            }),
          )}
          {[0, 30, 60, 90, 120, 150, 180].map((deg) => {
            const y = (deg / SAIL_GRID_TWA_STEP_DEG) * CELL_H;
            return (
              <text key={`ly-${deg}`} x={-30} y={y + 4} fontSize={10}>
                {deg}°
              </text>
            );
          })}
          {[0, 10, 20, 30, 40].map((kn) => (
            <text key={`lx-${kn}`} x={kn * CELL_W} y={H + 14} fontSize={10}>
              {kn}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
