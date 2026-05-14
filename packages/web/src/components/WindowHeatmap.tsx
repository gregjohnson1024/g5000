'use client';

export interface WindowResult {
  departure: number;
  eta: number;
  distance: number;
  meanTws: number;
  maxTws: number;
  incomplete?: boolean;
  reason?: 'exceeded_max_hours' | 'no_wind' | 'land_blocked';
}

export function WindowHeatmap({
  results,
  onPick,
}: {
  results: WindowResult[];
  onPick: (r: WindowResult) => void;
}) {
  if (results.length === 0) return null;
  const hours = results
    .filter((r) => !r.incomplete)
    .map((r) => (r.eta - r.departure) / 3600);
  const min = hours.length > 0 ? Math.min(...hours) : 0;
  const max = hours.length > 0 ? Math.max(...hours) : 1;
  const color = (h: number) => {
    const t = (h - min) / Math.max(1, max - min);
    const r = Math.round(34 + (250 - 34) * t);
    const g = Math.round(197 - 100 * t);
    return `rgb(${r}, ${g}, 120)`;
  };
  // group by day-of-departure
  const byDay = new Map<string, WindowResult[]>();
  for (const r of results) {
    const k = new Date(r.departure * 1000).toISOString().slice(0, 10);
    const arr = byDay.get(k) ?? [];
    arr.push(r);
    byDay.set(k, arr);
  }
  return (
    <table className="text-xs font-mono">
      <tbody>
        {[...byDay.entries()].map(([day, rs]) => (
          <tr key={day}>
            <td className="text-slate-500 pr-2">{day}</td>
            {rs.map((r) => {
              const etaH = (r.eta - r.departure) / 3600;
              const tip = r.incomplete
                ? `Dep: ${new Date(r.departure * 1000).toISOString()}\nIncomplete${r.reason ? `: ${r.reason}` : ''}`
                : `Dep: ${new Date(r.departure * 1000).toISOString()}\nETA: ${etaH.toFixed(1)} h\nDist: ${(r.distance / 1852).toFixed(0)} NM\nMean TWS: ${r.meanTws.toFixed(1)} m/s\nMax TWS: ${r.maxTws.toFixed(1)} m/s`;
              return (
                <td
                  key={r.departure}
                  onClick={() => onPick(r)}
                  className="w-8 h-6 cursor-pointer border border-slate-900"
                  style={{ background: r.incomplete ? '#444' : color(etaH) }}
                  title={tip}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
