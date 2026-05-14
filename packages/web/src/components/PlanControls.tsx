'use client';
import { useState } from 'react';

export interface PlanRequest {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  departure: number;
  model: 'GFS' | 'ECMWF';
  polarId: string;
  polar: unknown;
  useCurrents?: boolean;
}

export function PlanControls(props: {
  start?: { lat: number; lon: number };
  end?: { lat: number; lon: number };
  onPlan: (req: PlanRequest) => void;
  loading: boolean;
}) {
  const [model, setModel] = useState<'GFS' | 'ECMWF'>('GFS');
  const [departure, setDeparture] = useState<string>(
    new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
  );
  const [useCurrents, setUseCurrents] = useState<boolean>(false);
  const onSubmit = async () => {
    const polarRes = await fetch('/api/wardrobe/active');
    if (!polarRes.ok) return alert('No polar available (live or cached).');
    const { polar } = await polarRes.json();
    const t = Math.floor(new Date(departure).getTime() / 1000);
    if (!props.start || !props.end) return alert('Click start and end on the map first.');
    props.onPlan({
      start: props.start,
      end: props.end,
      departure: t,
      model,
      polarId: polar.id ?? 'default',
      polar: polar.polar ?? polar,
      useCurrents,
    });
  };
  return (
    <div className="space-y-2">
      <label className="block text-sm">Departure (UTC)
        <input
          type="datetime-local"
          value={departure}
          onChange={(e) => setDeparture(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
        />
      </label>
      <label className="block text-sm">Wind model
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as 'GFS' | 'ECMWF')}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full"
        >
          <option value="GFS">GFS (NOAA)</option>
          <option value="ECMWF">ECMWF</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useCurrents}
          onChange={(e) => setUseCurrents(e.target.checked)}
          className="bg-slate-900 border border-slate-700 rounded"
        />
        Use surface currents (RTOFS)
      </label>
      <button
        disabled={props.loading || !props.start || !props.end}
        onClick={onSubmit}
        className="bg-emerald-700 disabled:bg-slate-700 px-3 py-2 rounded w-full text-sm"
      >
        {props.loading ? 'Planning…' : 'Plan'}
      </button>
    </div>
  );
}
