'use client';
import { useState } from 'react';
import { parseLatLon, formatCoordinate } from '../../lib/coords';
import { reorder } from './reorder';

export interface RouteBuilderProps {
  initial?: { id?: string; name: string; waypointIds: string[]; notes?: string };
  allWaypoints: { id: string; name: string; lat: number; lon: number }[];
  onSaved: () => void;
  onCancel: () => void;
  onWaypointCreated: (wp: { id: string; name: string; lat: number; lon: number }) => void;
}

export default function RouteBuilder({
  initial,
  allWaypoints,
  onSaved,
  onCancel,
  onWaypointCreated,
}: RouteBuilderProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [waypointIds, setWaypointIds] = useState<string[]>(initial?.waypointIds ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Picker state
  const [pickerQuery, setPickerQuery] = useState('');

  // New-waypoint inline form state
  const [showNewWp, setShowNewWp] = useState(false);
  const [newWpName, setNewWpName] = useState('');
  const [newWpPaste, setNewWpPaste] = useState('');
  const [newWpBusy, setNewWpBusy] = useState(false);
  const [newWpError, setNewWpError] = useState<string | null>(null);

  const wpMap = new Map(allWaypoints.map((w) => [w.id, w]));
  const presentIds = new Set(waypointIds);

  const filteredWaypoints = allWaypoints.filter(
    (w) =>
      !presentIds.has(w.id) &&
      (pickerQuery.trim() === '' ||
        w.name.toLowerCase().includes(pickerQuery.trim().toLowerCase())),
  );

  const handleAddWaypoint = (id: string) => {
    if (!presentIds.has(id)) {
      setWaypointIds((prev) => [...prev, id]);
    }
  };

  const handleRemove = (index: number) => {
    setWaypointIds((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUp = (index: number) => {
    if (index === 0) return;
    setWaypointIds((prev) => reorder(prev, index, index - 1));
  };

  const handleDown = (index: number) => {
    if (index === waypointIds.length - 1) return;
    setWaypointIds((prev) => reorder(prev, index, index + 1));
  };

  const handleCreateWaypoint = async (): Promise<void> => {
    setNewWpError(null);
    setNewWpBusy(true);
    try {
      const parsed = parseLatLon(newWpPaste);
      const res = await fetch('/api/waypoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newWpName.trim(), lat: parsed.lat, lon: parsed.lon }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'create failed');
      const wp = j.waypoint as { id: string; name: string; lat: number; lon: number };
      onWaypointCreated(wp);
      setWaypointIds((prev) => [...prev, wp.id]);
      setNewWpName('');
      setNewWpPaste('');
      setShowNewWp(false);
    } catch (e) {
      setNewWpError(e instanceof Error ? e.message : String(e));
    } finally {
      setNewWpBusy(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const isEdit = !!initial?.id;
      const url = isEdit ? `/api/routes/${initial!.id}` : '/api/routes';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), waypointIds, notes: notes.trim() || undefined }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'save failed');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-slate-800 rounded p-4 bg-slate-900/30 space-y-4">
      <h2 className="text-base font-semibold">{initial?.id ? 'Edit route' : 'New route'}</h2>

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      <label className="block text-sm">
        <span className="text-slate-400">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="block w-80 mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono"
        />
      </label>

      <label className="block text-sm">
        <span className="text-slate-400">Notes (optional)</span>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="block w-full max-w-2xl mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded"
        />
      </label>

      {/* Ordered waypoint list */}
      <div className="space-y-1">
        <h3 className="text-sm text-slate-400 font-medium">Waypoints</h3>
        {waypointIds.length === 0 && (
          <p className="text-slate-500 text-sm">No waypoints added yet.</p>
        )}
        {waypointIds.map((id, i) => {
          const wp = wpMap.get(id);
          return (
            <div
              key={`${id}-${i}`}
              className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm"
            >
              <span className="text-slate-500 w-5 text-right">{i + 1}.</span>
              <span className="font-mono flex-1">
                {wp ? (
                  <>
                    {wp.name}
                    <span className="text-slate-500 ml-2">
                      {formatCoordinate(wp.lat, 'lat', { format: 'dmm' })}{' '}
                      {formatCoordinate(wp.lon, 'lon', { format: 'dmm' })}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">{id} (unknown)</span>
                )}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => handleUp(i)}
                  disabled={i === 0}
                  title="Move up"
                  className="px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => handleDown(i)}
                  disabled={i === waypointIds.length - 1}
                  title="Move down"
                  className="px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  onClick={() => handleRemove(i)}
                  title="Remove"
                  className="px-1.5 py-0.5 text-xs bg-red-900 hover:bg-red-800 text-red-100 rounded"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Waypoint picker */}
      <div className="space-y-1">
        <h3 className="text-sm text-slate-400 font-medium">Add waypoint from saved list</h3>
        <input
          type="text"
          value={pickerQuery}
          onChange={(e) => setPickerQuery(e.target.value)}
          placeholder="Filter by name…"
          className="block w-full max-w-sm px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm font-mono"
        />
        {filteredWaypoints.length === 0 &&
          pickerQuery.trim() === '' &&
          presentIds.size === allWaypoints.length && (
            <p className="text-slate-500 text-xs">All waypoints already added.</p>
          )}
        {filteredWaypoints.length === 0 && pickerQuery.trim() !== '' && (
          <p className="text-slate-500 text-xs">No matching waypoints.</p>
        )}
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {filteredWaypoints.map((w) => (
            <button
              key={w.id}
              onClick={() => handleAddWaypoint(w.id)}
              className="block w-full text-left px-2 py-1 text-sm bg-slate-800 hover:bg-slate-700 rounded font-mono"
            >
              {w.name}{' '}
              <span className="text-slate-500 text-xs">
                {formatCoordinate(w.lat, 'lat', { format: 'dmm' })}{' '}
                {formatCoordinate(w.lon, 'lon', { format: 'dmm' })}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* New waypoint inline form */}
      <div className="space-y-2">
        {!showNewWp ? (
          <button
            onClick={() => setShowNewWp(true)}
            className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded"
          >
            + New waypoint
          </button>
        ) : (
          <div className="border border-slate-700 rounded p-3 bg-slate-900/50 space-y-2">
            <h4 className="text-sm font-medium text-slate-300">Create new waypoint</h4>
            {newWpError && <p className="text-rose-400 text-xs">{newWpError}</p>}
            <label className="block text-sm">
              <span className="text-slate-400">Name</span>
              <input
                type="text"
                value={newWpName}
                onChange={(e) => setNewWpName(e.target.value)}
                className="block w-64 mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Coordinates (DMS / DMM / decimal)</span>
              <input
                type="text"
                value={newWpPaste}
                onChange={(e) => setNewWpPaste(e.target.value)}
                placeholder="41 45.898n 71 07.710w"
                className="block w-full max-w-md mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono text-sm"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => void handleCreateWaypoint()}
                disabled={
                  newWpBusy || newWpName.trim().length === 0 || newWpPaste.trim().length === 0
                }
                className="px-3 py-1 text-sm bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
              >
                Create &amp; add
              </button>
              <button
                onClick={() => {
                  setShowNewWp(false);
                  setNewWpName('');
                  setNewWpPaste('');
                  setNewWpError(null);
                }}
                className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Save / Cancel */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => void handleSave()}
          disabled={busy || name.trim().length === 0}
          className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded font-medium disabled:opacity-50"
        >
          {initial?.id ? 'Save changes' : 'Create route'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
