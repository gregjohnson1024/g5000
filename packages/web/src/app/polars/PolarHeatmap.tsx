'use client';

import type React from 'react';
import type { PolarTable } from '@g5000/db';

export interface PolarHeatmapProps {
  polar: PolarTable;
  selected?: { twsIdx: number; twaIdx: number };
  onSelect?: (cell: { twsIdx: number; twaIdx: number }) => void;
}

const MS_TO_KNOTS = 1 / 0.514444;
const RAD_TO_DEG = 180 / Math.PI;

export function PolarHeatmap({ polar, selected, onSelect }: PolarHeatmapProps) {
  const maxBsp = Math.max(1e-6, ...polar.boatSpeed.flat());

  const cellStyle = (v: number): React.CSSProperties => {
    if (v <= 0) return { backgroundColor: '#1e293b', color: '#e2e8f0' };
    const intensity = Math.min(1, v / maxBsp);
    // Cool teal → bright cyan as speed rises.
    const r = Math.floor(24 + intensity * 80);
    const g = Math.floor(80 + intensity * 150);
    const b = Math.floor(160 + intensity * 60);
    // Switch text colour by perceived luminance so cells stay legible at the bright end.
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const color = luma > 0.55 ? '#0f172a' : '#e2e8f0';
    return { backgroundColor: `rgb(${r},${g},${b})`, color };
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs font-mono">
        <thead>
          <tr>
            <th className="p-1 text-slate-500">TWS \ TWA</th>
            {polar.twaBins.map((twa, i) => (
              <th key={i} className="p-1 text-slate-500 text-right">
                {(twa * RAD_TO_DEG).toFixed(0)}°
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {polar.twsBins.map((tws, twsIdx) => (
            <tr key={twsIdx}>
              <th className="p-1 text-slate-500 text-right pr-2">
                {(tws * MS_TO_KNOTS).toFixed(0)} kn
              </th>
              {polar.twaBins.map((_, twaIdx) => {
                const v = polar.boatSpeed[twsIdx]![twaIdx]!;
                const isSelected = selected?.twsIdx === twsIdx && selected.twaIdx === twaIdx;
                return (
                  <td
                    key={twaIdx}
                    onClick={() => onSelect?.({ twsIdx, twaIdx })}
                    style={cellStyle(v)}
                    className={`p-2 cursor-pointer text-right ${
                      isSelected ? 'ring-2 ring-amber-400' : ''
                    }`}
                    title={`TWS ${(tws * MS_TO_KNOTS).toFixed(1)} kn, TWA ${(
                      polar.twaBins[twaIdx]! * RAD_TO_DEG
                    ).toFixed(0)}°, target ${(v * MS_TO_KNOTS).toFixed(2)} kn`}
                  >
                    {(v * MS_TO_KNOTS).toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-2">
        Boat speed shown in knots. Click a cell to edit.
      </p>
    </div>
  );
}
