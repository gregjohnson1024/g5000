'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { computeCrossoverGrid, type CrossoverGrid } from '@g5000/compute';
import {
  DEFAULT_WARDROBE_SETTINGS,
  wardrobeSettingsOf,
  type SailWardrobe,
  type WardrobeSettings,
} from '@g5000/db/defaults';
import { getConfigColor } from '../../lib/config-color';

const CELL_W = 16;
const CELL_H = 16;
const PAD_LEFT = 36;
const PAD_BOTTOM = 28;

export function CrossoverChart({ wardrobe }: { wardrobe: SailWardrobe }) {
  const settings: WardrobeSettings = useMemo(() => wardrobeSettingsOf(wardrobe), [wardrobe]);
  const grid: CrossoverGrid = useMemo(
    () => computeCrossoverGrid(wardrobe, settings, { twsStepKn: 1, twaStepDeg: 5 }),
    [wardrobe, settings],
  );
  const [hover, setHover] = useState<{ twsIdx: number; twaIdx: number } | null>(null);

  const width = PAD_LEFT + grid.twsBins.length * CELL_W;
  const height = PAD_BOTTOM + grid.twaBins.length * CELL_H;

  const cells: ReactElement[] = [];
  for (let i = 0; i < grid.twsBins.length; i++) {
    for (let j = 0; j < grid.twaBins.length; j++) {
      const cell = grid.cells[i]![j]!;
      const color = cell.winningConfigId ? getConfigColor(cell.winningConfigId) : '#1e293b';
      cells.push(
        <rect
          key={`${i}-${j}`}
          x={PAD_LEFT + i * CELL_W}
          y={(grid.twaBins.length - 1 - j) * CELL_H}
          width={CELL_W - 1}
          height={CELL_H - 1}
          fill={color}
          onMouseEnter={() => setHover({ twsIdx: i, twaIdx: j })}
          onMouseLeave={() => setHover(null)}
        />,
      );
    }
  }

  const hovered = hover ? grid.cells[hover.twsIdx]![hover.twaIdx]! : null;
  const hoveredTws = hover ? grid.twsBins[hover.twsIdx]! : null;
  const hoveredTwa = hover ? grid.twaBins[hover.twaIdx]! : null;

  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-4 space-y-2">
      <div className="text-xs text-slate-500">CROSSOVER CHART (TWS × TWA → winning config)</div>
      <svg width={width} height={height} className="text-slate-400">
        {cells}
        {/* TWS axis labels */}
        {grid.twsBins
          .map((v, i) => ({ v, i }))
          .filter(({ i }) => i % 5 === 0)
          .map(({ v, i }) => (
            <text
              key={`xt-${i}`}
              x={PAD_LEFT + i * CELL_W + CELL_W / 2}
              y={grid.twaBins.length * CELL_H + 16}
              fontSize={10}
              textAnchor="middle"
              fill="currentColor"
            >
              {v.toFixed(0)}
            </text>
          ))}
        {/* TWA axis labels */}
        {grid.twaBins
          .map((v, j) => ({ v, j }))
          .filter(({ j }) => j % 3 === 0)
          .map(({ v, j }) => (
            <text
              key={`yt-${j}`}
              x={PAD_LEFT - 4}
              y={(grid.twaBins.length - 1 - j) * CELL_H + CELL_H / 2 + 3}
              fontSize={10}
              textAnchor="end"
              fill="currentColor"
            >
              {v.toFixed(0)}°
            </text>
          ))}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs">
        {wardrobe.configs.map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: getConfigColor(c.id) }}
            />
            <span className="font-mono text-slate-300">{c.name}</span>
          </span>
        ))}
      </div>
      <div className="text-xs text-slate-400 font-mono min-h-[1.25rem]">
        {hovered && hoveredTws !== null && hoveredTwa !== null ? (
          <>
            TWS {hoveredTws.toFixed(0)} kn · TWA {hoveredTwa.toFixed(0)}°{' — '}
            {hovered.winningConfigId ? (
              <>
                <strong>
                  {wardrobe.configs.find((c) => c.id === hovered.winningConfigId)?.name}
                </strong>{' '}
                @ {hovered.winningSpeedKn!.toFixed(2)} kn
                {hovered.runnerUpConfigId &&
                  ` (runner-up ${wardrobe.configs.find((c) => c.id === hovered.runnerUpConfigId)?.name} ${hovered.runnerUpSpeedKn!.toFixed(2)} kn)`}
              </>
            ) : (
              <em>no data</em>
            )}
          </>
        ) : (
          <em>hover a cell to inspect</em>
        )}
      </div>
    </div>
  );
}
