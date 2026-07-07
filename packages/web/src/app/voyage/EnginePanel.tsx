'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  fmtTimestamp,
  parseDatetimeLocalInput,
  toDatetimeLocalInput,
  type TzMode,
} from '../../lib/tz';

interface EngineState {
  on: boolean;
  rpm?: number;
}

interface EngineSummary {
  trackedHours: { port: number; stbd: number };
  totalHours: { port: number; stbd: number };
  current: { port: EngineState; stbd: EngineState; t: number } | null;
}

interface EngineEntry {
  t: number;
  port: EngineState;
  stbd: EngineState;
  note?: string;
}

function fmtHoursMin(h: number): string {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}

export function EnginePanel({ tz }: { tz: TzMode }) {
  const [summary, setSummary] = useState<EngineSummary | null>(null);
  const [baseline, setBaseline] = useState<{ port: number; stbd: number }>({ port: 0, stbd: 0 });
  const [entries, setEntries] = useState<EngineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form state. `whenInput` is the raw string from the datetime-local
  // widget; interpretation as UTC or local depends on the current `tz`
  // mode at submit time.
  const [portOn, setPortOn] = useState(false);
  const [portRpm, setPortRpm] = useState<string>('');
  const [stbdOn, setStbdOn] = useState(false);
  const [stbdRpm, setStbdRpm] = useState<string>('');
  const [note, setNote] = useState<string>('');
  // Stored as an absolute UNIX timestamp; rendered into the input via
  // toDatetimeLocalInput(anchor, tz) so toggling tz preserves the
  // moment-in-time rather than its wallclock string.
  const [whenAnchor, setWhenAnchor] = useState<number>(() => Date.now() / 1000);
  const whenInput = toDatetimeLocalInput(whenAnchor, tz);
  const [useNow, setUseNow] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  // Seed the form with the current engine state EXACTLY ONCE on mount.
  // Without this ref-gate, the 10 s refresh interval would write
  // setPortOn / setPortRpm / etc on every tick — overwriting whatever
  // the user is typing.
  const seededRef = useRef(false);

  const refresh = useCallback(async ({ seedForm = false } = {}) => {
    try {
      const r = await fetch('/api/engine/state', { cache: 'no-store' });
      const j = (await r.json()) as
        | {
            ok: true;
            baseline: { port: number; stbd: number };
            summary: EngineSummary;
            entries: EngineEntry[];
          }
        | { ok: false; error?: { message?: string } };
      if (!j.ok) {
        setError(j.error?.message ?? 'load failed');
        return;
      }
      setSummary(j.summary);
      setBaseline(j.baseline);
      setEntries(j.entries);
      if (seedForm && !seededRef.current && j.summary.current) {
        setPortOn(j.summary.current.port.on);
        setStbdOn(j.summary.current.stbd.on);
        setPortRpm(
          j.summary.current.port.rpm !== undefined ? String(j.summary.current.port.rpm) : '',
        );
        setStbdRpm(
          j.summary.current.stbd.rpm !== undefined ? String(j.summary.current.stbd.rpm) : '',
        );
        seededRef.current = true;
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh({ seedForm: true });
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const t = useNow ? Date.now() / 1000 : whenAnchor;
      const body = {
        t,
        port: {
          on: portOn,
          ...(portRpm && !Number.isNaN(Number(portRpm)) ? { rpm: Number(portRpm) } : {}),
        },
        stbd: {
          on: stbdOn,
          ...(stbdRpm && !Number.isNaN(Number(stbdRpm)) ? { rpm: Number(stbdRpm) } : {}),
        },
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const r = await fetch('/api/engine/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'save failed');
      setNote('');
      // Reset "when" to now after a successful submit.
      setWhenAnchor(Date.now() / 1000);
      setUseNow(true);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const updateBaseline = async (which: 'port' | 'stbd', value: number): Promise<void> => {
    try {
      const r = await fetch('/api/engine/baseline', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [which]: value }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error?.message ?? 'baseline save failed');
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Engines</h2>

      {error && (
        <div className="text-rose-400 text-xs bg-rose-900/20 border border-rose-800 rounded p-2">
          {error}
        </div>
      )}

      {/* Current state + hours */}
      <div className="grid grid-cols-2 gap-3">
        <EngineHoursTile
          label="Port"
          on={summary?.current?.port.on ?? false}
          rpm={summary?.current?.port.rpm}
          trackedHours={summary?.trackedHours.port ?? 0}
          totalHours={summary?.totalHours.port ?? 0}
          baselineH={baseline.port}
          onBaselineChange={(v) => void updateBaseline('port', v)}
        />
        <EngineHoursTile
          label="Starboard"
          on={summary?.current?.stbd.on ?? false}
          rpm={summary?.current?.stbd.rpm}
          trackedHours={summary?.trackedHours.stbd ?? 0}
          totalHours={summary?.totalHours.stbd ?? 0}
          baselineH={baseline.stbd}
          onBaselineChange={(v) => void updateBaseline('stbd', v)}
        />
      </div>

      {/* Log a new state entry */}
      <form
        onSubmit={submit}
        className="bg-slate-900 border border-slate-800 rounded p-3 space-y-3"
      >
        <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
          Log state change
        </div>
        <div className="grid grid-cols-2 gap-3">
          <EngineFormCol
            label="Port"
            on={portOn}
            setOn={setPortOn}
            rpm={portRpm}
            setRpm={setPortRpm}
          />
          <EngineFormCol
            label="Starboard"
            on={stbdOn}
            setOn={setStbdOn}
            rpm={stbdRpm}
            setRpm={setStbdRpm}
          />
        </div>
        <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-end">
          <label className="flex-1 text-xs text-slate-400 flex flex-col gap-1">
            Note (optional)
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
              placeholder="e.g. fuel xfer, high vibration"
            />
          </label>
          <label className="text-xs text-slate-400 flex flex-col gap-1">
            <span className="flex items-center gap-2">
              When ({tz === 'utc' ? 'UTC' : 'local'})
              <label className="flex items-center gap-1 normal-case">
                <input
                  type="checkbox"
                  checked={useNow}
                  onChange={(e) => setUseNow(e.target.checked)}
                />
                <span>now</span>
              </label>
            </span>
            <input
              type="datetime-local"
              value={whenInput}
              onChange={(e) => setWhenAnchor(parseDatetimeLocalInput(e.target.value, tz))}
              disabled={useNow}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 disabled:opacity-40"
            />
            <span className="text-[10px] text-slate-500 font-mono">
              ≡{' '}
              {fmtTimestamp(
                useNow ? Date.now() / 1000 : whenAnchor,
                tz === 'utc' ? 'local' : 'utc',
              )}
            </span>
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-700 text-white px-4 py-2 rounded text-sm"
          >
            {submitting ? 'Saving…' : 'Log change'}
          </button>
        </div>
      </form>

      {/* History */}
      {entries.length > 0 && (
        <details className="bg-slate-900 border border-slate-800 rounded">
          <summary className="cursor-pointer px-3 py-2 text-xs text-slate-400 uppercase tracking-wider hover:text-slate-200">
            History ({entries.length} entr{entries.length === 1 ? 'y' : 'ies'})
          </summary>
          <div className="px-3 pb-3 max-h-72 overflow-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="py-1 pr-2">When ({tz === 'utc' ? 'UTC' : 'local'})</th>
                  <th className="py-1 pr-2">Port</th>
                  <th className="py-1 pr-2">Stbd</th>
                  <th className="py-1 pr-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e) => (
                  <tr key={e.t} className="border-t border-slate-800">
                    <td className="py-1 pr-2 text-slate-300">{fmtTimestamp(e.t, tz)}</td>
                    <td className="py-1 pr-2 text-slate-200">
                      {e.port.on ? `on${e.port.rpm ? ` ${e.port.rpm} rpm` : ''}` : 'off'}
                    </td>
                    <td className="py-1 pr-2 text-slate-200">
                      {e.stbd.on ? `on${e.stbd.rpm ? ` ${e.stbd.rpm} rpm` : ''}` : 'off'}
                    </td>
                    <td className="py-1 pr-2 text-slate-400">{e.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function EngineFormCol({
  label,
  on,
  setOn,
  rpm,
  setRpm,
}: {
  label: string;
  on: boolean;
  setOn: (v: boolean) => void;
  rpm: string;
  setRpm: (v: string) => void;
}) {
  return (
    <div className="space-y-2 bg-slate-950 border border-slate-800 rounded p-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300 font-semibold">{label}</span>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            className="w-4 h-4"
          />
          <span>on</span>
        </label>
      </div>
      <label className="block text-xs text-slate-400">
        RPM
        <input
          type="number"
          min={0}
          max={6000}
          step={50}
          value={rpm}
          onChange={(e) => setRpm(e.target.value)}
          disabled={!on}
          className="block bg-slate-900 border border-slate-700 rounded px-2 py-1 w-full text-slate-200 disabled:opacity-40 mt-1"
          placeholder="—"
        />
      </label>
    </div>
  );
}

function EngineHoursTile({
  label,
  on,
  rpm,
  trackedHours,
  totalHours,
  baselineH,
  onBaselineChange,
}: {
  label: string;
  on: boolean;
  rpm?: number;
  trackedHours: number;
  totalHours: number;
  baselineH: number;
  onBaselineChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(baselineH));
  useEffect(() => {
    setDraft(String(baselineH));
  }, [baselineH]);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-1">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
        <div
          className={`px-2 py-0.5 rounded text-[10px] font-mono ${on ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-500'}`}
        >
          {on ? (rpm ? `ON · ${rpm} RPM` : 'ON') : 'OFF'}
        </div>
      </div>
      <div className="text-2xl font-mono text-slate-100">{totalHours.toFixed(1)}</div>
      <div className="text-[10px] text-slate-500 font-mono">
        baseline {baselineH.toFixed(1)} h + g5000 {fmtHoursMin(trackedHours)}
      </div>
      <div className="text-[10px] text-slate-500">
        {editing ? (
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={100000}
              step={0.1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 w-20 text-slate-200 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                const n = Number(draft);
                if (Number.isFinite(n) && n >= 0) onBaselineChange(n);
                setEditing(false);
              }}
              className="px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 rounded text-emerald-100 text-[10px]"
            >
              save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(String(baselineH));
                setEditing(false);
              }}
              className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-200 text-[10px]"
            >
              cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="underline hover:text-slate-300"
          >
            edit baseline
          </button>
        )}
      </div>
    </div>
  );
}
