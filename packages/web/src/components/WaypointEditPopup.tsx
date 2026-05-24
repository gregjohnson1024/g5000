'use client';
import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { fmtLatLonDmm } from '../lib/format-coords';
import { parseWaypointForm } from './waypoint-form';

export interface EditableWaypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  notes?: string;
}

export function WaypointEditPopup({
  map,
  waypoint,
  onSaved,
  onDeleted,
  onClose,
}: {
  map: maplibregl.Map | null;
  waypoint: EditableWaypoint;
  onSaved: (updated: EditableWaypoint) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const [name, setName] = useState(waypoint.name);
  const [positionRaw, setPositionRaw] = useState(fmtLatLonDmm(waypoint.lat, waypoint.lon));
  const [notes, setNotes] = useState(waypoint.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setName(waypoint.name);
    setPositionRaw(fmtLatLonDmm(waypoint.lat, waypoint.lon));
    setNotes(waypoint.notes ?? '');
    setError(null);
  }, [waypoint.id, waypoint.name, waypoint.lat, waypoint.lon, waypoint.notes]);

  useEffect(() => {
    if (!map) return;
    const project = (): void => {
      const p = map.project([waypoint.lon, waypoint.lat]);
      setPt({ x: p.x, y: p.y });
    };
    project();
    map.on('move', project);
    map.on('zoom', project);
    return () => {
      map.off('move', project);
      map.off('zoom', project);
    };
  }, [map, waypoint.lon, waypoint.lat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!pt) return null;

  const save = async (): Promise<void> => {
    const parsed = parseWaypointForm({ name, positionRaw, notes });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/waypoints/${waypoint.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.patch),
      });
      const j = (await res.json()) as {
        ok: boolean;
        waypoint?: EditableWaypoint;
        error?: { message?: string };
      };
      if (res.ok && j.ok && j.waypoint) {
        onSaved({
          id: j.waypoint.id,
          name: j.waypoint.name,
          lat: j.waypoint.lat,
          lon: j.waypoint.lon,
          notes: j.waypoint.notes,
        });
      } else {
        setError(j.error?.message ?? 'Save failed');
      }
    } catch {
      setError('Save failed');
    } finally {
      setBusy(false);
    }
  };

  const del = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/waypoints/${waypoint.id}`, { method: 'DELETE' });
      const j = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (res.ok && j.ok) {
        onDeleted(waypoint.id);
      } else {
        setError(j.error?.message ?? 'Delete failed');
      }
    } catch {
      setError('Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute z-30 w-64 -translate-x-1/2 -translate-y-full -mt-3 bg-slate-900/95 border border-slate-700 rounded shadow-lg p-3 space-y-2"
      style={{ left: pt.x, top: pt.y }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-100">Edit waypoint</span>
        <button type="button" onClick={onClose} aria-label="close" className="text-xs text-slate-400 hover:text-slate-200">
          ✕
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name"
        disabled={busy}
        className="w-full min-w-0 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded"
      />
      <input
        type="text"
        value={positionRaw}
        onChange={(e) => setPositionRaw(e.target.value)}
        placeholder="41 29.2n 71 19.5w"
        disabled={busy}
        className="w-full min-w-0 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded font-mono"
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="notes"
        rows={2}
        disabled={busy}
        className="w-full min-w-0 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-2 py-1 rounded"
      />
      {error && <div className="text-xs text-rose-400">{error}</div>}
      <div className="flex gap-2">
        <button type="button" onClick={() => void save()} disabled={busy} className="flex-1 px-2 py-1 text-xs rounded border bg-sky-600 text-white border-sky-700 hover:bg-sky-500 disabled:opacity-40">
          Save
        </button>
        <button type="button" onClick={() => void del()} disabled={busy} className="px-2 py-1 text-xs rounded border bg-slate-800 text-rose-300 border-rose-800 hover:bg-rose-950 disabled:opacity-40">
          Delete
        </button>
      </div>
    </div>
  );
}
