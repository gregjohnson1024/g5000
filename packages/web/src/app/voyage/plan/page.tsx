'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCoordinate, parseLatLon, fmtLatDmm, fmtLonDmm } from '../../../lib/coords';

/** Compact marine DMM for a single axis: `41 45.898n` / `71 07.710w`. */
function compactDmm(val: number, axis: 'lat' | 'lon'): string {
  const p = axis === 'lat' ? fmtLatDmm(val) : fmtLonDmm(val);
  return `${p.deg} ${p.min}${p.hemi.toLowerCase()}`;
}
import { greatCircleNm, bearingDeg } from '../../../lib/geo';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Panel,
  TextField,
  CoordField,
} from '../../../components/ui';
import type { ColumnDef } from '../../../components/ui';

interface Waypoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  notes?: string;
  createdAt: string;
}

interface CurrentPos {
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// Inline-edit state for one row
// ---------------------------------------------------------------------------

interface EditState {
  id: string;
  name: string;
  latRaw: string;
  lonRaw: string;
  notes: string;
}

export default function WaypointsPage() {
  const [list, setList] = useState<Waypoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-form state
  const [name, setName] = useState('');
  // CoordField value: null until the user enters a valid coord
  const [addCoord, setAddCoord] = useState<{ lat: number; lon: number } | null>(null);
  // Separate lat/lon fields (fallback)
  const [latRaw, setLatRaw] = useState('');
  const [lonRaw, setLonRaw] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Per-row edit state
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Current boat position for the Distance column
  const [currentPos, setCurrentPos] = useState<CurrentPos | null>(null);

  // GPX import
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

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

  // Poll current position (15 s)
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch('/api/stats/eta', { cache: 'no-store' });
        const j = (await r.json()) as
          | { ok: true; eta: { currentLat: number; currentLon: number } }
          | { ok: false };
        if (cancelled) return;
        if (j.ok) setCurrentPos({ lat: j.eta.currentLat, lon: j.eta.currentLon });
        else setCurrentPos(null);
      } catch {
        if (!cancelled) setCurrentPos(null);
      }
    };
    void tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleAdd = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      let lat: number;
      let lon: number;
      if (addCoord !== null) {
        lat = addCoord.lat;
        lon = addCoord.lon;
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
      setAddCoord(null);
      setLatRaw('');
      setLonRaw('');
      setNotes('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRequest = (w: Waypoint): void => {
    setPendingDelete({ id: w.id, name: w.name });
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/waypoints/${id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error?.message ?? 'delete failed');
        return;
      }
      if (!j.ok) throw new Error(j.error?.message ?? 'delete failed');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File): Promise<void> => {
    setError(null);
    setImportMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/waypoints/import-gpx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/gpx+xml' },
        body: await file.text(),
      });
      const j = (await res.json()) as {
        ok: boolean;
        imported?: { waypoints: number; routes: number };
        error?: { message?: string };
      };
      if (!j.ok) throw new Error(j.error?.message ?? 'import failed');
      const { waypoints: nw = 0, routes: nr = 0 } = j.imported ?? {};
      setImportMsg(
        `Imported ${nw} waypoint${nw === 1 ? '' : 's'}` +
          (nr > 0 ? ` and ${nr} route${nr === 1 ? '' : 's'}` : ''),
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const beginEdit = (w: Waypoint): void => {
    setEditing({
      id: w.id,
      name: w.name,
      latRaw: compactDmm(w.lat, 'lat'),
      lonRaw: compactDmm(w.lon, 'lon'),
      notes: w.notes ?? '',
    });
    setEditError(null);
  };

  const cancelEdit = (): void => {
    setEditing(null);
    setEditError(null);
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing) return;
    setEditError(null);
    setBusy(true);
    try {
      const lat = parseCoordinate(editing.latRaw, 'lat');
      const lon = parseCoordinate(editing.lonRaw, 'lon');
      const res = await fetch(`/api/waypoints/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editing.name.trim(), lat, lon, notes: editing.notes.trim() }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'save failed');
      setEditing(null);
      await reload();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // DataTable column definitions
  // ------------------------------------------------------------------

  const columns: ColumnDef<Waypoint>[] = [
    {
      key: 'name',
      label: 'Name',
      align: 'left',
      sortable: true,
      sortValue: (w) => w.name,
      render: (w) =>
        editing?.id === w.id ? (
          <input
            type="text"
            value={editing.name}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, name: e.target.value } : prev))
            }
            className="w-full bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 font-mono text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
          />
        ) : (
          <span className="font-mono text-ink">{w.name}</span>
        ),
    },
    {
      key: 'lat',
      label: 'Latitude',
      align: 'left',
      sortValue: (w) => w.lat,
      render: (w) =>
        editing?.id === w.id ? (
          <input
            type="text"
            value={editing.latRaw}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, latRaw: e.target.value } : prev))
            }
            className="w-full bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 font-mono text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
          />
        ) : (
          <span className="font-mono">{compactDmm(w.lat, 'lat')}</span>
        ),
    },
    {
      key: 'lon',
      label: 'Longitude',
      align: 'left',
      sortValue: (w) => w.lon,
      render: (w) =>
        editing?.id === w.id ? (
          <input
            type="text"
            value={editing.lonRaw}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, lonRaw: e.target.value } : prev))
            }
            className="w-full bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 font-mono text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
          />
        ) : (
          <span className="font-mono">{compactDmm(w.lon, 'lon')}</span>
        ),
    },
    {
      key: 'dist',
      label: 'Distance',
      unit: 'NM',
      align: 'right',
      sortValue: (w) => (currentPos ? greatCircleNm(currentPos, w) : null),
      render: (w) => {
        if (editing?.id === w.id) return <span className="text-ink-4">—</span>;
        if (!currentPos) return <span className="text-ink-4">—</span>;
        const nm = greatCircleNm(currentPos, w);
        const brg = String(Math.round(bearingDeg(currentPos, w))).padStart(3, '0');
        return (
          <span className="font-mono tabular-nums">
            {nm.toFixed(1)} <span className="text-ink-3">{brg}°T</span>
          </span>
        );
      },
    },
    {
      key: 'notes',
      label: 'Notes',
      align: 'left',
      render: (w) =>
        editing?.id === w.id ? (
          <input
            type="text"
            value={editing.notes}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, notes: e.target.value } : prev))
            }
            className="w-full bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus]"
          />
        ) : (
          <span className="text-ink-2">{w.notes ?? ''}</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (w) =>
        editing?.id === w.id ? (
          <div className="flex items-center justify-end gap-2 min-h-[44px]">
            <Button size="sm" variant="primary" onClick={() => void saveEdit()} disabled={busy}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 min-h-[44px]">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => beginEdit(w)}
              disabled={editing !== null}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => handleDeleteRequest(w)}
              disabled={busy || editing !== null}
            >
              Delete
            </Button>
          </div>
        ),
    },
  ];

  return (
    <main className="page-main p-4 space-y-4">
      <h1 className="text-[1.111rem] font-semibold text-ink-value">Voyage Plan</h1>

      {/* NOTE: Routes are GPX-imported alongside waypoints but are not managed
          as first-class objects in this UI — the import endpoint handles them,
          but there is no route-list view. This is the honest current state;
          routes-as-first-class is a follow-up task. */}

      {/* Add waypoint form */}
      <Panel label="New waypoint">
        <div className="space-y-3 pt-1">
          {error && <p className="text-danger text-body-sm">{error}</p>}
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            placeholder="BR-4"
            className="max-w-xs"
          />
          <CoordField
            label="Coordinates (paste lat &amp; lon together)"
            value={addCoord}
            onChange={setAddCoord}
            caption="DMS / DMM / decimal accepted, or fill separately below"
          />
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="text-label uppercase tracking-wider text-ink-2 block mb-1">
                Latitude
              </label>
              <input
                type="text"
                value={latRaw}
                onChange={(e) => setLatRaw(e.target.value)}
                placeholder="41 45.898n"
                className="w-full bg-surface-sunken border border-hairline rounded-[--r-control] px-3 h-11 font-mono text-ink placeholder:text-ink-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] hover:border-hairline-strong"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-label uppercase tracking-wider text-ink-2 block mb-1">
                Longitude
              </label>
              <input
                type="text"
                value={lonRaw}
                onChange={(e) => setLonRaw(e.target.value)}
                placeholder="71 07.710w"
                className="w-full bg-surface-sunken border border-hairline rounded-[--r-control] px-3 h-11 font-mono text-ink placeholder:text-ink-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[--focus] hover:border-hairline-strong"
              />
            </div>
          </div>
          <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
          <Button
            variant="primary"
            onClick={() => void handleAdd()}
            disabled={busy || name.trim().length === 0}
          >
            Add waypoint
          </Button>
        </div>
      </Panel>

      {/* Waypoints table */}
      <Panel
        label="Saved waypoints"
        action={
          <div className="flex items-center gap-2">
            <a
              href="/api/waypoints/export-gpx"
              download
              className="px-3 min-h-[36px] inline-flex items-center text-body-sm border border-hairline rounded-[--r-control] text-ink-2 hover:bg-surface-raised transition-colors"
            >
              Export GPX
            </a>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Import GPX
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gpx,application/gpx+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleImportFile(file);
              }}
            />
          </div>
        }
      >
        {importMsg && <p className="text-ok text-body-sm mb-3">{importMsg}</p>}
        {editError && <p className="text-danger text-body-sm mb-3">{editError}</p>}
        {loading ? (
          <p className="text-ink-4 text-body-sm py-4">Loading…</p>
        ) : (
          <DataTable
            columns={columns}
            rows={list}
            rowKey={(w) => w.id}
            defaultSortKey="name"
            defaultSortDir="asc"
            density="default"
          />
        )}
        {!loading && list.length === 0 && (
          <p className="text-ink-4 text-body-sm py-2">
            No waypoints yet. Add one above or import a GPX file.
          </p>
        )}
        {!currentPos && list.length > 0 && (
          <p className="text-ink-4 text-caption mt-2">
            Distance column unavailable — no active track.
          </p>
        )}
      </Panel>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void handleDeleteConfirm()}
        title="Delete waypoint?"
        message={
          pendingDelete ? `Delete waypoint "${pendingDelete.name}"? This cannot be undone.` : ''
        }
        confirmLabel="Delete"
      />
    </main>
  );
}
