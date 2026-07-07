'use client';
import type { SourcePriorityRule } from '@g5000/core';
import { formatChannelValue } from '../../../../lib/friendly-source';
import { deviceLabel, type DeviceLabelInfo } from '../../../../lib/device-label';
import { pinnedSourceForChannel, setPinnedSource } from '../../../../lib/source-pin';
import { channelLabel } from '../../../../lib/channel-label';
import type { ObservedEntry } from './sensors-types';

interface ChannelPanelProps {
  channel: string;
  /** Observed entries for THIS channel only (any order). */
  entries: ObservedEntry[];
  rules: SourcePriorityRule[];
  devices: Map<number, DeviceLabelInfo>;
  saving: boolean;
  onSaveRules: (next: SourcePriorityRule[]) => Promise<void>;
  /** Larger headline for a card's primary channel. */
  emphasis?: boolean;
}

/**
 * One channel: a headline value (reflecting the pin) plus a radio group —
 * `Auto` (most recent) or a single pinned source. Shared by the curated
 * SensorCards and the "All channels" section so pin behaviour is identical.
 */
export function ChannelPanel({
  channel,
  entries,
  rules,
  devices,
  saving,
  onSaveRules,
  emphasis = false,
}: ChannelPanelProps) {
  const pinned = pinnedSourceForChannel(rules, channel);
  const sorted = [...entries].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  );

  // Rows: every observed source, plus the pinned source if it isn't currently
  // observed (kept visible so it stays selectable).
  const rows: { source: string; entry: ObservedEntry | null }[] = sorted.map((e) => ({
    source: e.source,
    entry: e,
  }));
  if (pinned && !sorted.some((e) => e.source === pinned)) {
    rows.push({ source: pinned, entry: null });
  }

  let headlineValue: string;
  if (pinned) {
    const pe = sorted.find((e) => e.source === pinned);
    headlineValue = pe ? formatChannelValue(pe.lastValue) : '—';
  } else {
    const fresh = sorted.reduce<ObservedEntry | null>(
      (best, e) => (!best || e.ageMs < best.ageMs ? e : best),
      null,
    );
    headlineValue = fresh ? formatChannelValue(fresh.lastValue) : '—';
  }

  const setPin = (source: string | null): void => {
    void onSaveRules(setPinnedSource(rules, channel, source));
  };

  return (
    <div className="space-y-1">
      <div
        className={
          'flex items-baseline justify-between gap-3 ' +
          (emphasis ? 'text-lg font-semibold text-slate-100' : 'text-sm text-slate-300')
        }
      >
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="truncate">{channelLabel(channel)}</span>
          <span className="font-mono text-xs text-slate-600 truncate">{channel}</span>
        </span>
        <span className="tabular-nums">{headlineValue}</span>
      </div>

      <div className="pl-3 space-y-0.5 text-xs">
        <label className="flex items-center gap-2 cursor-pointer text-slate-400">
          <input
            type="radio"
            name={`pin-${channel}`}
            checked={pinned === null}
            onChange={() => setPin(null)}
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
                name={`pin-${channel}`}
                checked={pinned === source}
                onChange={() => setPin(source)}
                disabled={saving}
              />
              <span className="truncate flex-1 text-slate-300">{deviceLabel(source, devices)}</span>
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
}
