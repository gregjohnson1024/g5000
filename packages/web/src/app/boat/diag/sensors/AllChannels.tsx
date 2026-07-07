'use client';
import type { SourcePriorityRule } from '@g5000/core';
import type { DeviceLabelInfo } from '../../../../lib/device-label';
import { channelKind } from '../../../../lib/channel-label';
import { groupSourcesByChannel } from './group-sources';
import { SENSOR_DEFS } from './sensor-definitions';
import type { ObservedEntry } from './sensors-types';
import { ChannelPanel } from './ChannelPanel';

interface AllChannelsProps {
  observed: ObservedEntry[];
  rules: SourcePriorityRule[];
  devices: Map<number, DeviceLabelInfo>;
  saving: boolean;
  onSaveRules: (next: SourcePriorityRule[]) => Promise<void>;
}

/** Channels already shown in a curated SensorCard — excluded from this section. */
const CURATED = new Set(SENSOR_DEFS.flatMap((d) => d.channels));

/**
 * Every live channel NOT in a curated card, grouped into Measured (from
 * devices) and Computed (g5000). Always expanded. Reuses ChannelPanel so the
 * value display + single-source pin behave exactly like the curated cards.
 */
export function AllChannels({ observed, rules, devices, saving, onSaveRules }: AllChannelsProps) {
  const byChannel = groupSourcesByChannel(observed);
  const others = [...byChannel.keys()].filter((ch) => !CURATED.has(ch)).sort();

  const measured: string[] = [];
  const computed: string[] = [];
  for (const ch of others) {
    const sources = (byChannel.get(ch) ?? []).map((e) => e.source);
    (channelKind(sources) === 'measured' ? measured : computed).push(ch);
  }

  const renderGroup = (title: string, channels: string[]) =>
    channels.length === 0 ? null : (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {channels.map((ch) => (
          <ChannelPanel
            key={ch}
            channel={ch}
            entries={byChannel.get(ch) ?? []}
            rules={rules}
            devices={devices}
            saving={saving}
            onSaveRules={onSaveRules}
          />
        ))}
      </div>
    );

  return (
    <section className="border border-slate-800 rounded bg-slate-900/40 p-4 space-y-4">
      <h2 className="text-base font-semibold text-slate-100">All channels</h2>
      {others.length === 0 ? (
        <div className="text-sm text-slate-500">No other channels.</div>
      ) : (
        <>
          {renderGroup('Measured (from devices)', measured)}
          {renderGroup('Computed (g5000)', computed)}
        </>
      )}
    </section>
  );
}
