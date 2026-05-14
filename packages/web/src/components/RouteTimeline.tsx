'use client';
import type { Route } from '@g5000/routing';
import { routeToGpx } from '../lib/gpx';

export function RouteTimeline({ route }: { route: Route }) {
  const KN = 1.94384;
  const DEG = 180 / Math.PI;
  const onExport = () => {
    const blob = new Blob([routeToGpx(route, 'Route')], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'route.gpx';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-2">
      <button onClick={onExport} className="bg-slate-700 px-2 py-1 rounded text-xs">
        Export GPX
      </button>
      <div className="text-xs max-h-64 overflow-y-auto font-mono">
        <table className="w-full">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left">t</th>
              <th>TWS</th>
              <th>TWA</th>
              <th>BSP</th>
            </tr>
          </thead>
          <tbody>
            {route.legs.map((l, i) => (
              <tr key={i}>
                <td>{new Date(l.t * 1000).toISOString().slice(11, 16)}</td>
                <td className="text-right">{(l.tws * KN).toFixed(1)}</td>
                <td className="text-right">{(l.twa * DEG).toFixed(0)}°</td>
                <td className="text-right">{(l.bsp * KN).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
