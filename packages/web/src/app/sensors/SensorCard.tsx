'use client';
import type { SourcePriorityRule } from '@g5000/core';
import type { DeviceLabelInfo } from '../../lib/device-label';
import { groupSourcesByChannel } from './group-sources';
import { freshnessOf, type Freshness } from './freshness';
import type { SensorDef } from './sensor-definitions';
import type { ObservedEntry } from './sensors-types';
import { ChannelPanel } from './ChannelPanel';

interface SensorCardProps {
  def: SensorDef;
  /** Observed entries for any channel (the card filters to its own). */
  observed: ObservedEntry[];
  /** Full source-priority config (passed through to each ChannelPanel). */
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
 * One curated sensor's card on /sensors: a freshness dot + name, a
 * ChannelPanel per channel (value + pin), and the "used by" / cal-page extras.
 */
export function SensorCard({ def, observed, rules, devices, saving, onSaveRules }: SensorCardProps) {
  const own = observed.filter((e) => def.channels.includes(e.channel));
  const minAge = own.length === 0 ? null : Math.min(...own.map((e) => e.ageMs));
  const dot = freshnessOf(minAge);
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

      <div className="space-y-3">
        {def.channels.map((ch, i) => (
          <ChannelPanel
            key={ch}
            channel={ch}
            entries={bySource.get(ch) ?? []}
            rules={rules}
            devices={devices}
            saving={saving}
            onSaveRules={onSaveRules}
            emphasis={i === 0}
          />
        ))}
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
    </section>
  );
}
