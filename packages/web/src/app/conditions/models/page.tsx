'use client';

/**
 * /conditions/models — GRIB cache viewer.
 *
 * Phase 6 task-2:
 *   - Converted from server component to client component so it can subscribe
 *     to BroadcastChannel('forecast-cache') and auto-refresh when /conditions
 *     posts a 'fetch-complete' event.
 *   - Retokenized (no raw Tailwind slate-* or explicit bg-slate classes).
 *   - Uses Panel + DataTable primitives.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Panel } from '../../../components/ui';
import { DataTable } from '../../../components/ui';
import type { ColumnDef } from '../../../components/ui/DataTable';
import { fmtTimestamp, type ShipClock } from '../../../lib/tz';
import { useShipClock } from '../../../lib/use-ship-clock';

interface CacheEntry {
  model: string;
  runTime: string;
  size: number;
  mtime: number;
}

interface CacheResponse {
  ok: boolean;
  items: CacheEntry[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/** GRIB run identifier (e.g. '2026-07-09 12Z') — always UTC, never ship time. */
function formatRunTime(run: string): string {
  const n = Number(run);
  if (!Number.isFinite(n) || n <= 0) return run;
  return new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

function formatMtime(ms: number, clock: ShipClock): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return fmtTimestamp(Math.floor(ms / 1000), clock);
}

// ── DataTable column definitions ─────────────────────────────────────────────

function buildCols(clock: ShipClock): ColumnDef<CacheEntry>[] {
  return [
    {
      key: 'model',
      label: 'Model',
      sortable: true,
      align: 'left',
      render: (r) => r.model.toUpperCase(),
      sortValue: (r) => r.model,
    },
    {
      key: 'runTime',
      label: 'Run time (UTC)',
      sortable: true,
      render: (r) => formatRunTime(r.runTime),
      sortValue: (r) => Number(r.runTime),
    },
    {
      key: 'size',
      label: 'Size',
      sortable: true,
      render: (r) => formatSize(r.size),
      sortValue: (r) => r.size,
    },
    {
      key: 'mtime',
      label: 'Last modified',
      sortable: true,
      render: (r) => formatMtime(r.mtime, clock),
      sortValue: (r) => r.mtime,
    },
  ];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GribCachePage() {
  const clock = useShipClock();
  const cols = useMemo(() => buildCols(clock), [clock]);
  const [items, setItems] = useState<CacheEntry[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch('/api/grib/list', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as CacheResponse;
      if (j.ok) {
        setItems(j.items);
        setTotalSize(j.items.reduce((acc, it) => acc + it.size, 0));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Subscribe to forecast-cache BroadcastChannel — same channel /conditions posts to
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('forecast-cache');
    bc.onmessage = () => {
      // A refresh completed on /conditions — reload our cache list
      void reload();
    };
    return () => bc.close();
  }, [reload]);

  const chipLabel = `${items.length} run${items.length === 1 ? '' : 's'} · ${formatSize(totalSize)}`;

  return (
    <main className="page-main p-6 space-y-4">
      <h1 className="text-xl font-semibold text-ink">GRIB Cache</h1>

      <Panel
        label="Cached model runs"
        chip={loading ? 'neutral' : err ? 'alarm' : 'ok'}
        chipLabel={loading ? 'Loading…' : err ? 'Error' : chipLabel}
      >
        {err && <p className="text-body-sm text-danger mb-3">{err}</p>}

        {!loading && items.length === 0 && !err && (
          <p className="text-body-sm text-ink-3">Cache is empty.</p>
        )}

        {items.length > 0 && (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <DataTable
              columns={cols}
              rows={items}
              rowKey={(r) => `${r.model}/${r.runTime}`}
              defaultSortKey="mtime"
              defaultSortDir="desc"
            />
          </div>
        )}
      </Panel>

      <p className="text-caption text-ink-4">
        Cache auto-refreshes when a fetch completes on the Forecast page. Navigate between tabs —
        both pages share the same <code className="font-mono">forecast-cache</code> broadcast
        channel.
      </p>
    </main>
  );
}
