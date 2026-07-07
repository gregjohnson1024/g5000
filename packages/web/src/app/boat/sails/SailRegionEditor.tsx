'use client';

import { useState } from 'react';
import {
  SAIL_GRID_TWS_BINS,
  SAIL_GRID_TWA_BINS,
  SAIL_GRID_TWA_STEP_DEG,
  cellKey,
} from '@g5000/core';
import type { Sail } from '@g5000/db';
import { colorForId } from '../../../lib/config-color';
import { Button } from '../../../components/ui';
import { SailGridLines, SailGridTwsTicks, SailGridTwaTicks } from './SailGridAxes';

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
        <span className="text-sm text-ink">
          Editing: <b>{sail.name}</b> <span className="text-ink-3">({cells.size} cells)</span>
        </span>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty}
          onClick={() => {
            void onSave(Array.from(cells).sort());
            setDirty(false);
          }}
        >
          Save
        </Button>
      </div>
      <svg
        viewBox={`0 0 ${W + MARGIN_L} ${H + MARGIN_B}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto max-w-[900px]"
      >
        <g transform={`translate(${MARGIN_L},0)`}>
          {/* Cell grid */}
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

          {/* Grid overlay lines (shared axis primitive) */}
          <SailGridLines
            CELL_W={CELL_W}
            CELL_H={CELL_H}
            W={W}
            H={H}
            TWA_STEP_DEG={SAIL_GRID_TWA_STEP_DEG}
          />

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
    </div>
  );
}
