'use client';
import { useState } from 'react';

export interface SourcePriorityRule {
  channelPattern: string;
  sources: string[];
  freshnessSeconds: number;
  blocked?: string[];
}

export interface ObservedEntry {
  channel: string;
  source: string;
  lastSeenMs: number;
  ageMs: number;
  lastValue: unknown;
}

const MIN_FRESHNESS = 0.5;
const MAX_FRESHNESS = 30;

interface SourcePriorityEditorProps {
  channels: string[];
  rules: SourcePriorityRule[];
  observed: ObservedEntry[];
  onSave: (next: SourcePriorityRule[]) => Promise<void>;
  saving: boolean;
}

/**
 * Per-channel source-priority editor, scoped to a subset of channels (a
 * sensor's channels). The parent (/sensors/page.tsx) owns the full rule
 * config and the persistence call; this component just renders the
 * channels we manage and calls back with the next full rules array on
 * each save.
 *
 * Rules whose channelPattern does not match any of our `channels` are
 * passed through unchanged in the save callback.
 */
export function SourcePriorityEditor({
  channels,
  rules,
  observed,
  onSave,
  saving,
}: SourcePriorityEditorProps) {
  const ownedRuleIdx = (channel: string): number =>
    rules.findIndex((r) => r.channelPattern === channel);

  const knownSourcesForChannel = (channel: string): string[] => {
    const set = new Set<string>();
    for (const e of observed) if (e.channel === channel) set.add(e.source);
    return Array.from(set).sort();
  };

  const save = async (
    mutator: (rules: SourcePriorityRule[]) => SourcePriorityRule[],
  ): Promise<void> => {
    const next = mutator(rules);
    await onSave(next);
  };

  return (
    <div className="space-y-3">
      {channels.map((channel) => (
        <ChannelRuleRow
          key={channel}
          channel={channel}
          ruleIdx={ownedRuleIdx(channel)}
          rule={ownedRuleIdx(channel) >= 0 ? (rules[ownedRuleIdx(channel)] ?? null) : null}
          knownSources={knownSourcesForChannel(channel)}
          saving={saving}
          onCreate={() =>
            save((r) => [
              ...r,
              { channelPattern: channel, sources: [], freshnessSeconds: 5 },
            ])
          }
          onUpdate={(next) =>
            save((r) => {
              const idx = r.findIndex((x) => x.channelPattern === channel);
              if (idx < 0) return r;
              const copy = [...r];
              copy[idx] = next;
              return copy;
            })
          }
          onDelete={() =>
            save((r) => r.filter((x) => x.channelPattern !== channel))
          }
        />
      ))}
    </div>
  );
}

interface ChannelRuleRowProps {
  channel: string;
  ruleIdx: number;
  rule: SourcePriorityRule | null;
  knownSources: string[];
  saving: boolean;
  onCreate: () => void;
  onUpdate: (next: SourcePriorityRule) => void;
  onDelete: () => void;
}

function ChannelRuleRow({
  channel,
  rule,
  knownSources,
  saving,
  onCreate,
  onUpdate,
  onDelete,
}: ChannelRuleRowProps) {
  const [pickerSource, setPickerSource] = useState('');

  if (rule === null) {
    return (
      <div className="text-sm text-slate-400 flex items-center justify-between gap-2 border border-slate-800 rounded p-2">
        <span className="font-mono">{channel}</span>
        <button
          type="button"
          onClick={onCreate}
          disabled={saving}
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs rounded disabled:opacity-40"
        >
          + add rule
        </button>
      </div>
    );
  }

  const moveSource = (from: number, to: number): void => {
    if (to < 0 || to >= rule.sources.length) return;
    const next = [...rule.sources];
    const [taken] = next.splice(from, 1);
    if (taken === undefined) return;
    next.splice(to, 0, taken);
    onUpdate({ ...rule, sources: next });
  };

  const removeSource = (idx: number): void => {
    onUpdate({ ...rule, sources: rule.sources.filter((_, i) => i !== idx) });
  };

  const addPickedSource = (): void => {
    if (!pickerSource || rule.sources.includes(pickerSource)) return;
    onUpdate({ ...rule, sources: [...rule.sources, pickerSource] });
    setPickerSource('');
  };

  const setFreshness = (s: number): void => {
    onUpdate({ ...rule, freshnessSeconds: s });
  };

  const availableForPicker = knownSources.filter((s) => !rule.sources.includes(s));

  return (
    <div className="border border-slate-700 rounded p-2 space-y-2 bg-slate-900/50">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-slate-200">{channel}</span>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-40"
        >
          delete rule
        </button>
      </div>

      {rule.sources.length === 0 && (
        <div className="text-xs text-slate-500">No sources yet — add one below.</div>
      )}
      {rule.sources.map((src, idx) => (
        <div key={src} className="flex items-center gap-1 text-sm">
          <span className="text-slate-500 text-xs w-4">{idx + 1}.</span>
          <span className="font-mono text-slate-200 flex-1">{src}</span>
          <button
            type="button"
            onClick={() => moveSource(idx, idx - 1)}
            disabled={saving || idx === 0}
            className="px-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
            aria-label="move up"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => moveSource(idx, idx + 1)}
            disabled={saving || idx === rule.sources.length - 1}
            className="px-1 text-slate-400 hover:text-slate-200 disabled:opacity-30"
            aria-label="move down"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={() => removeSource(idx)}
            disabled={saving}
            className="px-1 text-rose-400 hover:text-rose-300 disabled:opacity-40"
            aria-label="remove"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2 text-sm">
        <select
          value={pickerSource}
          onChange={(e) => setPickerSource(e.target.value)}
          disabled={saving || availableForPicker.length === 0}
          className="bg-slate-800 border border-slate-700 text-slate-200 px-2 py-1 rounded text-xs disabled:opacity-40"
        >
          <option value="">
            {availableForPicker.length === 0
              ? '(no other observed sources)'
              : 'select a source…'}
          </option>
          {availableForPicker.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addPickedSource}
          disabled={saving || !pickerSource}
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs rounded disabled:opacity-40"
        >
          + add
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>freshness window:</span>
        <input
          type="range"
          min={MIN_FRESHNESS}
          max={MAX_FRESHNESS}
          step={0.5}
          value={rule.freshnessSeconds}
          onChange={(e) => setFreshness(Number(e.target.value))}
          disabled={saving}
          className="flex-1"
        />
        <span className="font-mono text-slate-200 w-12 text-right">
          {rule.freshnessSeconds.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
