'use client';
import type { SourcePriorityRule } from '@g5000/core';
import { formatChannelValue } from '../../lib/friendly-source';
import { deviceLabel, type DeviceLabelInfo } from '../../lib/device-label';
import { pinnedSourceForChannel, setPinnedSource } from '../../lib/source-pin';
import { groupSourcesByChannel } from './group-sources';
import { freshnessOf, type Freshness } from './freshness';
import type { SensorDef } from './sensor-definitions';
import type { ObservedEntry } from './sensors-types';

interface SensorCardProps {
  def: SensorDef;
  /** Observed entries for any channel (the card filters to its own). */
  observed: ObservedEntry[];
  /** Full source-priority config (the card reads/writes its own channels). */
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
 * One sensor's card on /sensors. Per channel: a headline value plus a radio
 * group — `Auto` (most recent) or a single pinned source. Pinning writes a
 * one-entry source-priority rule so the whole app uses only that source (no
 * failover); `Auto` removes the rule. A pinned source that has gone stale
 * stays listed (with `—`) so it remains selectable.
 */
export function SensorCard({ def, observed, rules, devices, saving, onSaveRules }: SensorCardProps) {
  const own = observed.filter((e) => def.channels.includes(e.channel));
  const minAge = own.length === 0 ? null : Math.min(...own.map((e) => e.ageMs));
  const dot = freshnessOf(minAge);

  // Freshest entry per channel for the Auto headline.
  const latestByChannel = new Map<string, ObservedEntry>();
  for (const e of own) {
    const prev = latestByChannel.get(e.channel);
    if (!prev || e.ageMs < prev.ageMs) latestByChannel.set(e.channel, e);
  }

  const bySource = groupSourcesByChannel(own);

  const setPin = (channel: string, source: string | null): void => {
    void onSaveRules(setPinnedSource(rules, channel, source));
  };

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
        {def.channels.map((ch, i) => {
          const pinned = pinnedSourceForChannel(rules, ch);
          const observedForCh = bySource.get(ch) ?? [];

          // Rows: every observed source, plus the pinned source if it isn't
          // currently observed (kept visible so it stays selectable).
          const rows: { source: string; entry: ObservedEntry | null }[] = observedForCh.map(
            (e) => ({ source: e.source, entry: e }),
          );
          if (pinned && !observedForCh.some((e) => e.source === pinned)) {
            rows.push({ source: pinned, entry: null });
          }

          // Headline reflects the choice.
          let headlineValue: string;
          if (pinned) {
            const pe = observedForCh.find((e) => e.source === pinned);
            headlineValue = pe ? formatChannelValue(pe.lastValue) : '—';
          } else {
            const fresh = latestByChannel.get(ch);
            headlineValue = fresh ? formatChannelValue(fresh.lastValue) : '—';
          }

          return (
            <div key={ch} className="space-y-1">
              <div
                className={
                  'flex items-baseline justify-between gap-3 ' +
                  (i === 0 ? 'text-lg font-semibold text-slate-100' : 'text-sm text-slate-300')
                }
              >
                <span className="font-mono text-xs text-slate-500">{ch}</span>
                <span className="tabular-nums">{headlineValue}</span>
              </div>

              <div className="pl-3 space-y-0.5 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-slate-400">
                  <input
                    type="radio"
                    name={`pin-${ch}`}
                    checked={pinned === null}
                    onChange={() => setPin(ch, null)}
                    disabled={saving}
                  />
                  <span>Auto — most recent</span>
                </label>
                {rows.length === 0 ? (
                  <div className="text-slate-500 pl-6">No source observed.</div>
                ) : (
                  rows.map(({ source, entry }) => (
                    <label key={source} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`pin-${ch}`}
                        checked={pinned === source}
                        onChange={() => setPin(ch, source)}
                        disabled={saving}
                      />
                      <span className="truncate flex-1 text-slate-300">
                        {deviceLabel(source, devices)}
                      </span>
                      <span className="tabular-nums whitespace-nowrap">
                        <span className="text-slate-300">
                          {entry ? formatChannelValue(entry.lastValue) : '—'}
                        </span>
                        {entry && (
                          <span className="text-slate-600"> · {(entry.ageMs / 1000).toFixed(1)}s</span>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
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
    </section>
  );
}
