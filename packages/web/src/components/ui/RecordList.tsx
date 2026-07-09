/**
 * RecordList — Tier-1 primitive.
 *
 * A day-grouped feed of heterogeneous records (tracks, trips, log entries).
 * Inspired by the voyage logbook design: one feed, kind filter, day-grouped
 * headers, trips' StatCard grammar at the top of each group.
 *
 * Keeps the keep-list invariants:
 *   - trips' StatCard grammar (kept — see overhaul-keep-list)
 *   - day-grouped feed structure
 *   - stable ship-clock timestamps
 *
 * Token-only. No raw hex.
 */

'use client';

import { useMemo, useState } from 'react';
import { fmtDayLabel, toDayKey } from '../../lib/tz';
import { useShipClock } from '../../lib/use-ship-clock';

export type RecordKind = string;

export interface RecordItem {
  /** Unique identifier */
  id: string | number;
  /** Record kind (e.g. 'track', 'trip', 'log') — used for filtering */
  kind: RecordKind;
  /** UTC timestamp for grouping and display */
  tMs: number;
  /** Rendered content for the record row */
  render: () => React.ReactNode;
  /** Optional stat chips shown in the day-header (trips' StatCard grammar) */
  dayStat?: React.ReactNode;
}

export interface RecordListProps {
  /** All records (unsorted — this component sorts by time desc) */
  items: RecordItem[];
  /** All available kind options for the filter */
  kindOptions?: { value: RecordKind; label: string }[];
  /** Placeholder shown when the list is empty */
  emptyLabel?: string;
  className?: string;
}

export function RecordList({
  items,
  kindOptions,
  emptyLabel = 'No records.',
  className = '',
}: RecordListProps): React.ReactElement {
  const [kindFilter, setKindFilter] = useState<RecordKind | 'all'>('all');
  const clock = useShipClock();

  // Filter
  const filtered = useMemo(() => {
    if (kindFilter === 'all') return items;
    return items.filter((item) => item.kind === kindFilter);
  }, [items, kindFilter]);

  // Sort descending by time
  const sorted = useMemo(() => [...filtered].sort((a, b) => b.tMs - a.tMs), [filtered]);

  // Group by ship-clock date
  const groups = useMemo(() => {
    const map = new Map<string, RecordItem[]>();
    for (const item of sorted) {
      const k = toDayKey(item.tMs / 1000, clock);
      const arr = map.get(k) ?? [];
      arr.push(item);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [sorted, clock]);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Kind filter */}
      {kindOptions && kindOptions.length > 1 && (
        <div className="flex flex-wrap gap-2 text-body-sm">
          <button
            type="button"
            onClick={() => setKindFilter('all')}
            aria-pressed={kindFilter === 'all'}
            className={[
              'px-3 py-1 rounded-[--r-control] border transition-colors',
              kindFilter === 'all'
                ? 'border-accent bg-accent text-on-accent font-medium'
                : 'border-hairline text-ink-2 hover:text-ink hover:border-hairline-strong',
            ].join(' ')}
          >
            All
          </button>
          {kindOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setKindFilter(opt.value)}
              aria-pressed={kindFilter === opt.value}
              className={[
                'px-3 py-1 rounded-[--r-control] border transition-colors',
                kindFilter === opt.value
                  ? 'border-accent bg-accent text-on-accent font-medium'
                  : 'border-hairline text-ink-2 hover:text-ink hover:border-hairline-strong',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Day-grouped feed */}
      {groups.length === 0 ? (
        <div className="py-8 text-center text-ink-4 font-mono">{emptyLabel}</div>
      ) : (
        groups.map(([dateKey, dayItems]) => (
          <div key={dateKey}>
            {/* Day header — StatCard grammar (keep-list) */}
            <div className="flex items-center gap-3 mb-2 pb-1 border-b border-hairline">
              <span className="text-label uppercase tracking-wider text-ink-3">
                {fmtDayLabel(dayItems[0]!.tMs / 1000, clock, { year: true })}
              </span>
              {/* Day-level stat chips from the first item that provides one */}
              {dayItems.find((i) => i.dayStat)?.dayStat}
            </div>

            {/* Records */}
            <div className="space-y-1">
              {dayItems.map((item) => (
                <div key={item.id} className="text-body-sm">
                  {item.render()}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
