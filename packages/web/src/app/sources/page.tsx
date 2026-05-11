'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * /sources — source-priority arbitration UI.
 *
 * Two sections:
 *
 *   1. Observed sources — for each channel that has a sample in the last
 *      ~5s, list the source tags currently publishing, with last-update
 *      age. Lets the user see what's competing in real time.
 *   2. Priority rules — the persisted SourcePriorityConfig (an ordered
 *      array of rules). Each rule edits its channel pattern, ordered
 *      source list (with up/down + delete), and freshness slider.
 *
 * The selector only takes effect when a compute pipeline opts in via
 * `subscribeSelected`. The banner reminds the user of this. No pipelines
 * currently opt in — this iteration ships the foundation only.
 */

interface SourcePriorityRule {
  channelPattern: string;
  sources: string[];
  freshnessSeconds: number;
}

type SourcePriorityConfig = SourcePriorityRule[];

interface ObservedEntry {
  channel: string;
  source: string;
  lastSeenMs: number;
  ageMs: number;
}

interface ObservedResponse {
  entries: ObservedEntry[];
  windowMs: number;
}

const POLL_MS = 1000;
const MIN_FRESHNESS = 0.5;
const MAX_FRESHNESS = 30;

export default function SourcesPage() {
  const [observed, setObserved] = useState<ObservedEntry[]>([]);
  const [observedErr, setObservedErr] = useState<string | null>(null);

  const [rules, setRules] = useState<SourcePriorityConfig | null>(null);
  const [draft, setDraft] = useState<SourcePriorityConfig>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Poll the observed-sources endpoint.
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/sources/observed', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET observed: ${res.status}`);
        const body = (await res.json()) as ObservedResponse;
        if (!alive) return;
        setObserved(body.entries);
        setObservedErr(null);
      } catch (e) {
        if (alive) setObservedErr(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/config/source-priority', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET source-priority: ${res.status}`);
      const body = (await res.json()) as SourcePriorityConfig;
      setRules(body);
      setDraft(body.map((r) => ({ ...r, sources: [...r.sources] })));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Derived: group observed entries by channel for the per-channel display.
  const observedByChannel = useMemo<Map<string, ObservedEntry[]>>(() => {
    const m = new Map<string, ObservedEntry[]>();
    for (const e of observed) {
      const list = m.get(e.channel);
      if (list) list.push(e);
      else m.set(e.channel, [e]);
    }
    return m;
  }, [observed]);

  const dirty = useMemo(() => {
    if (!rules) return false;
    return JSON.stringify(rules) !== JSON.stringify(draft);
  }, [rules, draft]);

  const handleSave = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/config/source-priority', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`PUT failed: ${res.status} ${t}`);
      }
      setRules(draft.map((r) => ({ ...r, sources: [...r.sources] })));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addRule = (channelPattern: string): void => {
    if (!channelPattern) return;
    setDraft((prev) => [
      ...prev,
      { channelPattern, sources: [], freshnessSeconds: 2 },
    ]);
  };

  const deleteRule = (idx: number): void => {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const setRuleChannelPattern = (idx: number, channelPattern: string): void => {
    setDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, channelPattern } : r)));
  };

  const setRuleFreshness = (idx: number, freshness: number): void => {
    const clamped = Math.max(MIN_FRESHNESS, Math.min(MAX_FRESHNESS, freshness));
    setDraft((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, freshnessSeconds: clamped } : r)),
    );
  };

  const addSource = (idx: number, source: string): void => {
    if (!source) return;
    setDraft((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        if (r.sources.includes(source)) return r;
        return { ...r, sources: [...r.sources, source] };
      }),
    );
  };

  const removeSource = (ruleIdx: number, srcIdx: number): void => {
    setDraft((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        return { ...r, sources: r.sources.filter((_, j) => j !== srcIdx) };
      }),
    );
  };

  const moveSource = (ruleIdx: number, srcIdx: number, delta: -1 | 1): void => {
    setDraft((prev) =>
      prev.map((r, i) => {
        if (i !== ruleIdx) return r;
        const j = srcIdx + delta;
        if (j < 0 || j >= r.sources.length) return r;
        const next = [...r.sources];
        const tmp = next[srcIdx]!;
        next[srcIdx] = next[j]!;
        next[j] = tmp;
        return { ...r, sources: next };
      }),
    );
  };

  const findRuleForChannel = useCallback(
    (channel: string): { rule: SourcePriorityRule; index: number } | null => {
      for (let i = 0; i < draft.length; i++) {
        if (channelMatches(draft[i]!.channelPattern, channel)) {
          return { rule: draft[i]!, index: i };
        }
      }
      return null;
    },
    [draft],
  );

  // Channel list to render in the observed section:
  //   - any channel currently publishing
  //   - any channel that has a configured rule
  // Curated channels are not auto-shown — keeps the page tight.
  const channelsToShow = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const e of observed) set.add(e.channel);
    for (const r of draft) {
      // For literal patterns (no wildcard), include the pattern as a row
      // so the user can configure rules for channels that aren't yet
      // publishing. Wildcard patterns can't be inverted to a list of
      // channels, so we skip them here — they still appear in the rules
      // table below.
      if (!r.channelPattern.includes('*')) set.add(r.channelPattern);
    }
    return Array.from(set).sort();
  }, [observed, draft]);

  const [newRulePattern, setNewRulePattern] = useState('');

  return (
    <main className="p-6 space-y-6 max-w-5xl">
      <h1 className="text-2xl font-semibold">Sources & priority</h1>

      <div className="text-sm text-slate-400 space-y-1">
        <p>
          When two devices publish the same channel (e.g. GPS over N2K and 0183), a priority rule
          picks the highest-priority source whose last sample is within the freshness window. The
          bus itself still receives every source — the selector is a layer on top.
        </p>
        <p className="text-amber-400">
          Rules below take effect only for channels consumed by{' '}
          <span className="font-mono">subscribeSelected</span> callers — currently:{' '}
          <span className="font-mono">(none yet)</span>. Configure rules here so they apply once a
          compute pipeline opts in.
        </p>
      </div>

      {observedErr && <div className="text-red-400 text-sm">Observed sources: {observedErr}</div>}
      {err && <div className="text-red-400 text-sm">Rules: {err}</div>}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Observed sources (last 5 s)</h2>
        {channelsToShow.length === 0 && (
          <p className="text-sm text-slate-500">No samples seen yet…</p>
        )}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-800">
              <th className="p-2">Channel</th>
              <th className="p-2">Publishers</th>
              <th className="p-2">Current rule</th>
              <th className="p-2 w-32 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channelsToShow.map((ch) => {
              const pubs = observedByChannel.get(ch) ?? [];
              const ruleMatch = findRuleForChannel(ch);
              return (
                <tr key={ch} className="border-b border-slate-900 align-top">
                  <td className="p-2 font-mono">{ch}</td>
                  <td className="p-2">
                    {pubs.length === 0 ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {pubs.map((p) => (
                          <li key={p.source} className="font-mono text-xs">
                            <span className="text-slate-300">{p.source}</span>{' '}
                            <span className="text-slate-500">({p.ageMs} ms ago)</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="p-2">
                    {ruleMatch ? (
                      <div className="text-xs">
                        <div className="text-slate-400">
                          Rule #{ruleMatch.index + 1} · pattern{' '}
                          <span className="font-mono">{ruleMatch.rule.channelPattern}</span> ·
                          freshness {ruleMatch.rule.freshnessSeconds.toFixed(1)} s
                        </div>
                        <ol className="list-decimal ml-5 text-slate-300 font-mono">
                          {ruleMatch.rule.sources.map((s, i) => (
                            <li key={s + i}>{s}</li>
                          ))}
                        </ol>
                      </div>
                    ) : (
                      <span className="text-slate-500 text-xs">no rule</span>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {!ruleMatch && (
                      <button
                        onClick={() => addRule(ch)}
                        className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded"
                      >
                        Add rule
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Priority rules</h2>
          <div className="flex items-center gap-2">
            {savedFlash && <span className="text-green-400 text-xs">Saved.</span>}
            <button
              onClick={() => void handleSave()}
              disabled={busy || !dirty}
              className="px-3 py-1 bg-amber-600 text-slate-900 rounded font-medium text-sm disabled:opacity-50"
            >
              {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>

        {rules === null && !err && <p className="text-slate-400 text-sm">Loading…</p>}

        {draft.length === 0 && rules !== null && (
          <p className="text-sm text-slate-500">No rules configured. Use the table above to add one.</p>
        )}

        <div className="space-y-3">
          {draft.map((rule, idx) => (
            <div
              key={idx}
              className="border border-slate-800 rounded p-3 bg-slate-900/30 space-y-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500">#{idx + 1}</span>
                <label className="text-xs text-slate-400">Channel pattern:</label>
                <input
                  type="text"
                  value={rule.channelPattern}
                  onChange={(e) => setRuleChannelPattern(idx, e.target.value)}
                  className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm font-mono w-72"
                  placeholder="wind.apparent.angle or wind.**"
                />
                <label className="text-xs text-slate-400 ml-2">Freshness:</label>
                <input
                  type="range"
                  min={MIN_FRESHNESS}
                  max={MAX_FRESHNESS}
                  step={0.5}
                  value={rule.freshnessSeconds}
                  onChange={(e) => setRuleFreshness(idx, Number(e.target.value))}
                  className="w-32"
                />
                <input
                  type="number"
                  min={MIN_FRESHNESS}
                  max={MAX_FRESHNESS}
                  step={0.5}
                  value={rule.freshnessSeconds}
                  onChange={(e) => setRuleFreshness(idx, Number(e.target.value))}
                  className="w-16 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-right text-sm font-mono"
                />
                <span className="text-xs text-slate-400">s</span>
                <button
                  onClick={() => deleteRule(idx)}
                  className="ml-auto px-2 py-1 text-xs bg-red-900 hover:bg-red-800 text-red-100 rounded"
                  title="Delete rule"
                >
                  Delete
                </button>
              </div>
              <SourceList
                sources={rule.sources}
                onAdd={(s) => addSource(idx, s)}
                onRemove={(j) => removeSource(idx, j)}
                onMove={(j, d) => moveSource(idx, j, d)}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
          <input
            type="text"
            value={newRulePattern}
            onChange={(e) => setNewRulePattern(e.target.value)}
            placeholder="Channel pattern for new rule"
            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm font-mono w-72"
          />
          <button
            onClick={() => {
              if (newRulePattern) {
                addRule(newRulePattern);
                setNewRulePattern('');
              }
            }}
            disabled={!newRulePattern}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm disabled:opacity-50"
          >
            Add rule
          </button>
        </div>
      </section>

      <p className="text-xs text-slate-500 pt-4 border-t border-slate-800">
        Source patterns match by exact equality or trailing-<span className="font-mono">*</span>{' '}
        prefix (e.g. <span className="font-mono">n2k:*</span> matches any N2K source). Channel
        patterns use the same dot-segment syntax as the bus (<span className="font-mono">*</span>{' '}
        for one segment, <span className="font-mono">**</span> for trailing wildcard).
      </p>
    </main>
  );
}

interface SourceListProps {
  sources: string[];
  onAdd: (source: string) => void;
  onRemove: (idx: number) => void;
  onMove: (idx: number, delta: -1 | 1) => void;
}

function SourceList({ sources, onAdd, onRemove, onMove }: SourceListProps) {
  const [newSource, setNewSource] = useState('');
  return (
    <div className="space-y-1">
      {sources.length === 0 && (
        <p className="text-xs text-slate-500 italic">No sources — rule will not match anything.</p>
      )}
      {sources.map((s, j) => (
        <div key={s + j} className="flex items-center gap-2 text-sm">
          <span className="text-slate-500 w-5 text-right">{j + 1}.</span>
          <span className="font-mono flex-1">{s}</span>
          <button
            onClick={() => onMove(j, -1)}
            disabled={j === 0}
            className="px-2 py-0.5 text-xs bg-slate-800 hover:bg-slate-700 rounded disabled:opacity-30"
            title="Move up (higher priority)"
          >
            ↑
          </button>
          <button
            onClick={() => onMove(j, 1)}
            disabled={j === sources.length - 1}
            className="px-2 py-0.5 text-xs bg-slate-800 hover:bg-slate-700 rounded disabled:opacity-30"
            title="Move down"
          >
            ↓
          </button>
          <button
            onClick={() => onRemove(j)}
            className="px-2 py-0.5 text-xs bg-red-900/60 hover:bg-red-800 text-red-100 rounded"
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <input
          type="text"
          value={newSource}
          onChange={(e) => setNewSource(e.target.value)}
          placeholder="Source tag (e.g. n2k:127250@dev0x10 or n2k:*)"
          className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-sm font-mono flex-1"
        />
        <button
          onClick={() => {
            if (newSource) {
              onAdd(newSource);
              setNewSource('');
            }
          }}
          disabled={!newSource}
          className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * Mirror of the bus / selector channel-pattern matcher. Same syntax: `*` =
 * one segment, `**` = trailing wildcard.
 */
function channelMatches(pattern: string, channel: string): boolean {
  if (!pattern.includes('*')) return pattern === channel;
  const segs = pattern.split('.');
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === '**') return false; // invalid pattern — treat as no-match
  }
  const trailingDoubleStar = segs[segs.length - 1] === '**';
  const fixed = trailingDoubleStar ? segs.slice(0, -1) : segs;
  const chSegs = channel.split('.');
  if (trailingDoubleStar) {
    if (chSegs.length < fixed.length) return false;
  } else if (chSegs.length !== fixed.length) {
    return false;
  }
  for (let i = 0; i < fixed.length; i++) {
    const f = fixed[i];
    const c = chSegs[i];
    if (f === '*') continue;
    if (f !== c) return false;
  }
  return true;
}
