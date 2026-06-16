'use client';
import { formatChannelValue } from '../../lib/friendly-source';
import { deviceLabel, type DeviceLabelInfo } from '../../lib/device-label';
import { groupSourcesByChannel } from './group-sources';
import { freshnessOf, type Freshness } from './freshness';
import type { SensorDef } from './sensor-definitions';
import {
  SourcePriorityEditor,
  type ObservedEntry,
  type SourcePriorityRule,
} from './SourcePriorityEditor';

interface SensorCardProps {
  def: SensorDef;
  /** Observed entries for any channel (the card filters to its own). */
  observed: ObservedEntry[];
  /** Full priority-rules config (the editor filters to its own channels). */
  rules: SourcePriorityRule[];
  /** N2K device registry keyed by source address, for friendly source names. */
  devices: Map<number, DeviceLabelInfo>;
  saving: boolean;
  onSaveRules: (next: SourcePriorityRule[]) => Promise<void>;
}

const DOT_COLOR: Record<Freshness, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-rose-500',
};

/**
 * One sensor's card on /sensors. Shows, per channel, the freshest value as a
 * headline plus a per-source breakdown (each source's own value + age), so
 * competing/disagreeing broadcasters are visible. The freshness dot tracks the
 * most-recent sample across this sensor's channels.
 */
export function SensorCard({ def, observed, rules, devices, saving, onSaveRules }: SensorCardProps) {
  const own = observed.filter((e) => def.channels.includes(e.channel));
  const minAge = own.length === 0 ? null : Math.min(...own.map((e) => e.ageMs));
  const dot = freshnessOf(minAge);

  // Freshest entry per channel for the headline value.
  const latestByChannel = new Map<string, ObservedEntry>();
  for (const e of own) {
    const prev = latestByChannel.get(e.channel);
    if (!prev || e.ageMs < prev.ageMs) latestByChannel.set(e.channel, e);
  }

  // All sources per channel for the breakdown.
  const bySource = groupSourcesByChannel(own);

  return (
    <section className="border border-slate-800 rounded bg-slate-900/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block w-2 h-2 rounded-full ${DOT_COLOR[dot]}`}
          />
          {def.label}
        </h2>
      </header>

      <div className="space-y-2">
        {def.channels.map((ch, i) => {
          const headline = latestByChannel.get(ch);
          const value = headline ? formatChannelValue(headline.lastValue) : '—';
          const sources = bySource.get(ch) ?? [];
          return (
            <div key={ch} className="space-y-0.5">
              <div
                className={
                  'flex items-baseline justify-between gap-3 ' +
                  (i === 0 ? 'text-lg font-semibold text-slate-100' : 'text-sm text-slate-300')
                }
              >
                <span className="font-mono text-xs text-slate-500">{ch}</span>
                <span className="tabular-nums">{value}</span>
              </div>
              {sources.length === 0 ? (
                <div className="text-xs text-slate-500 pl-3">No source observed.</div>
              ) : (
                <ul className="text-xs text-slate-400 pl-3 space-y-0.5">
                  {sources.map((e) => (
                    <li key={e.source} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{deviceLabel(e.source, devices)}</span>
                      <span className="tabular-nums whitespace-nowrap">
                        <span className="text-slate-300">{formatChannelValue(e.lastValue)}</span>
                        <span className="text-slate-600"> · {(e.ageMs / 1000).toFixed(1)}s</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {def.usedBy.length > 0 && (
        <div className="text-xs">
          <div className="text-slate-500 mb-1">Directly used by:</div>
          <ul className="text-slate-300 list-disc list-inside space-y-0.5">
            {def.usedBy.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {def.calPage && (
        <div>
          <a
            href={def.calPage.href}
            className="inline-block text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded"
          >
            {def.calPage.label} →
          </a>
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none">
          Source priorities ({def.channels.length} channel{def.channels.length === 1 ? '' : 's'})
        </summary>
        <div className="mt-2">
          <SourcePriorityEditor
            channels={def.channels}
            rules={rules}
            observed={observed}
            devices={devices}
            saving={saving}
            onSave={onSaveRules}
          />
        </div>
      </details>
    </section>
  );
}
