'use client';

import type React from 'react';
import type { AwsAwaCalTable } from '@g5000/db';

export interface CalHeatmapProps {
  cal: AwsAwaCalTable;
  selected?: { awsIdx: number; awaIdx: number };
  onSelect?: (cell: { awsIdx: number; awaIdx: number }) => void;
}

const RAD_TO_DEG = 180 / Math.PI;

export function CalHeatmap({ cal, selected, onSelect }: CalHeatmapProps) {
  const maxAbs = Math.max(1e-6, ...cal.angleCorrection.flat().map(Math.abs));

  // Inline style for the cell color since Tailwind v4's JIT may not pick up
  // dynamic arbitrary classnames at every value.
  const cellStyle = (v: number): React.CSSProperties => {
    if (Math.abs(v) < 1e-9) return { backgroundColor: '#1e293b' };
    const intensity = Math.min(1, Math.abs(v) / maxAbs);
    const channel = Math.floor(intensity * 200 + 30);
    if (v < 0) {
      return { backgroundColor: `rgb(${channel},24,24)` };
    }
    return { backgroundColor: `rgb(24,24,${channel})` };
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs font-mono">
        <thead>
          <tr>
            <th className="p-1 text-slate-500">AWS \ |AWA|</th>
            {cal.awaBins.map((awa, i) => (
              <th key={i} className="p-1 text-slate-500 text-right">
                {(awa * RAD_TO_DEG).toFixed(0)}°
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cal.awsBins.map((aws, awsIdx) => (
            <tr key={awsIdx}>
              <th className="p-1 text-slate-500 text-right pr-2">{aws.toFixed(0)} m/s</th>
              {cal.awaBins.map((_, awaIdx) => {
                const v = cal.angleCorrection[awsIdx]![awaIdx]!;
                const isSelected = selected?.awsIdx === awsIdx && selected.awaIdx === awaIdx;
                return (
                  <td
                    key={awaIdx}
                    onClick={() => onSelect?.({ awsIdx, awaIdx })}
                    style={cellStyle(v)}
                    className={`p-2 cursor-pointer text-right ${
                      isSelected ? 'ring-2 ring-amber-400' : ''
                    }`}
                    title={`AWS ${aws.toFixed(1)} m/s, |AWA| ${(
                      cal.awaBins[awaIdx]! * RAD_TO_DEG
                    ).toFixed(0)}°, cal ${(v * RAD_TO_DEG).toFixed(2)}°`}
                  >
                    {(v * RAD_TO_DEG).toFixed(1)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-2">
        Cell values shown in degrees. Click a cell to select it.
      </p>
    </div>
  );
}
