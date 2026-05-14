'use client';
import { useCallback, useEffect, useState } from 'react';
import { parseCoordinate, parseLatLon, formatCoordinate } from '../../lib/coords';

interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  notes?: string;
  createdAt: string;
}

export default function WaypointsPage() {
  const [list, setList] = useState<Waypoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-form state
  const [name, setName] = useState('');
  const [latRaw, setLatRaw] = useState('');
  const [lonRaw, setLonRaw] = useState('');
  const [pasteRaw, setPasteRaw] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Per-row edit state (id of row being edited)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLatRaw, setEditLatRaw] = useState('');
  const [editLonRaw, setEditLonRaw] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/waypoints', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'load failed');
      setList(j.waypoints);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAdd = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      let lat: number;
      let lon: number;
      if (pasteRaw.trim().length > 0) {
        const parsed = parseLatLon(pasteRaw);
        lat = parsed.lat;
        lon = parsed.lon;
      } else {
        lat = parseCoordinate(latRaw, 'lat');
        lon = parseCoordinate(lonRaw, 'lon');
      }
      const res = await fetch('/api/waypoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), lat, lon, notes: notes.trim() || undefined }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'create failed');
      setName('');
      setLatRaw('');
      setLonRaw('');
      setPasteRaw('');
      setNotes('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm(`Delete waypoint ${id}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/waypoints/${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'delete failed');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (w: Waypoint): void => {
    setEditingId(w.id);
    setEditName(w.name);
    setEditLatRaw(formatCoordinate(w.lat, 'lat', { format: 'dmm' }));
    setEditLonRaw(formatCoordinate(w.lon, 'lon', { format: 'dmm' }));
    setEditNotes(w.notes ?? '');
  };

  const saveEdit = async (id: string): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const lat = parseCoordinate(editLatRaw, 'lat');
      const lon = parseCoordinate(editLonRaw, 'lon');
      const res = await fetch(`/api/waypoints/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), lat, lon, notes: editNotes.trim() }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'save failed');
      setEditingId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Waypoints</h1>

      {error && <p className="text-rose-400 text-sm">{error}</p>}

      <section className="space-y-2 border border-slate-800 rounded p-4 bg-slate-900/30">
        <h2 className="text-base font-semibold">New waypoint</h2>
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
          <span className="text-slate-400">
            Paste lat & lon together (DMS / DM.M / decimal accepted)
          </span>
          <input
            type="text"
            value={pasteRaw}
            onChange={(e) => setPasteRaw(e.target.value)}
            placeholder={`41 45.898n 71 07.710w`}
            className="block w-full max-w-2xl mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono"
          />
        </label>
        <div className="text-xs text-slate-500">or fill them separately:</div>
        <div className="flex gap-3">
          <label className="block text-sm flex-1 max-w-xs">
            <span className="text-slate-400">Latitude</span>
            <input
              type="text"
              value={latRaw}
              onChange={(e) => setLatRaw(e.target.value)}
              placeholder={`41 45.898n`}
              className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono"
            />
          </label>
          <label className="block text-sm flex-1 max-w-xs">
            <span className="text-slate-400">Longitude</span>
            <input
              type="text"
              value={lonRaw}
              onChange={(e) => setLonRaw(e.target.value)}
              placeholder={`71 07.710w`}
              className="block w-full mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-slate-400">Notes (optional)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="block w-full max-w-2xl mt-1 px-2 py-1 bg-slate-900 border border-slate-700 rounded"
          />
        </label>
        <button
          onClick={() => void handleAdd()}
          disabled={busy || name.trim().length === 0}
          className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium disabled:opacity-50"
        >
          Add waypoint
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Saved waypoints</h2>
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && list.length === 0 && (
          <p className="text-slate-500 text-sm">No waypoints yet.</p>
        )}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="p-2">Name</th>
              <th className="p-2">Latitude</th>
              <th className="p-2">Longitude</th>
              <th className="p-2">Decimal</th>
              <th className="p-2">Notes</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) =>
              editingId === w.id ? (
                <tr key={w.id} className="border-b border-slate-900 align-top bg-slate-900/40">
                  <td className="p-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono w-full"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={editLatRaw}
                      onChange={(e) => setEditLatRaw(e.target.value)}
                      className="px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono w-full"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={editLonRaw}
                      onChange={(e) => setEditLonRaw(e.target.value)}
                      className="px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono w-full"
                    />
                  </td>
                  <td className="p-2 text-slate-500 text-xs">edit above</td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      className="px-2 py-1 bg-slate-900 border border-slate-700 rounded w-full"
                    />
                  </td>
                  <td className="p-2 text-right space-x-1">
                    <button
                      onClick={() => void saveEdit(w.id)}
                      disabled={busy}
                      className="px-2 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={w.id} className="border-b border-slate-900">
                  <td className="p-2 font-mono">{w.name}</td>
                  <td className="p-2 font-mono">
                    {formatCoordinate(w.lat, 'lat', { format: 'dmm' })}
                  </td>
                  <td className="p-2 font-mono">
                    {formatCoordinate(w.lon, 'lon', { format: 'dmm' })}
                  </td>
                  <td className="p-2 font-mono text-slate-400">
                    {w.lat.toFixed(5)}, {w.lon.toFixed(5)}
                  </td>
                  <td className="p-2 text-slate-300">{w.notes ?? ''}</td>
                  <td className="p-2 text-right space-x-1">
                    <button
                      onClick={() => beginEdit(w)}
                      className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleDelete(w.id)}
                      disabled={busy}
                      className="px-2 py-1 text-xs bg-red-900 hover:bg-red-800 text-red-100 rounded disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
