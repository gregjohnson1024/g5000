'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  fmtHourLabel,
  fmtTimestamp,
  parseDatetimeLocalInput,
  readTzMode,
  toDatetimeLocalInput,
  writeTzMode,
  type TzMode,
} from '../../lib/tz';
import { TzToggle } from '../../components/TzToggle';
import { fmtLatLonDmm } from '../../lib/format-coords';

interface EtaSnapshot {
  destinationLat: number;
  destinationLon: number;
  destinationLabel: string;
  distanceNm: number;
  bearingDeg: number;
  avgSpeedKn3h: number | null;
  etaUnixSec: number | null;
  etaSecRemaining: number | null;
  currentLat: number;
  currentLon: number;
  currentAtUnixSec: number;
}

const M_TO_NM = 1 / 1852;
const TZ_KEY = 'passage:tz';

interface DistanceStats {
  d1hM: number;
  d3hM: number;
  d6hM: number;
  d12hM: number;
  d24hM: number;
  lastPointAt: number | null;
  trackId: string | null;
  trackStartAt: number | null;
  history24h: Array<{ endingAt: number; d24hM: number }>;
  daily7: Array<{
    startsAt: number;
    endsAt: number;
    distanceM: number;
    complete: boolean;
  }>;
}

function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 60)}m`;
}

function Sparkline({
  data,
  tz,
  width = 600,
  height = 60,
}: {
  data: Array<{ endingAt: number; d24hM: number }>;
  tz: TzMode;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div className="text-xs text-slate-500 italic">
        Need ≥ 24 h of track for a 24h-rolling history. ({data.length} bucket
        {data.length === 1 ? '' : 's'} so far.)
      </div>
    );
  }
  // History is newest-first from the API. Reverse for left-to-right time order.
  const series = [...data].reverse();
  const xs = series.map((d) => d.endingAt);
  const ys = series.map((d) => d.d24hM * M_TO_NM);
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const padY = (yMax - yMin) * 0.1 || 1;
  const yLo = yMin - padY;
  const yHi = yMax + padY;
  const px = (x: number): number =>
    ((x - xMin) / Math.max(1, xMax - xMin)) * (width - 24) + 12;
  const py = (y: number): number =>
    height - 12 - ((y - yLo) / Math.max(0.0001, yHi - yLo)) * (height - 24);
  const path = series
    .map((d, i) => {
      const x = px(d.endingAt);
      const y = py(d.d24hM * M_TO_NM);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const lastNm = ys[ys.length - 1]!.toFixed(1);
  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        className="bg-slate-900 border border-slate-800 rounded"
      >
        <path d={path} fill="none" stroke="#fbbf24" strokeWidth="1.5" />
        {series.map((d, i) => (
          <circle
            key={d.endingAt}
            cx={px(d.endingAt)}
            cy={py(d.d24hM * M_TO_NM)}
            r={i === series.length - 1 ? 2.5 : 1}
            fill="#fbbf24"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
        <span>{fmtHourLabel(xMin, tz)}</span>
        <span>
          range {yMin.toFixed(0)}–{yMax.toFixed(0)} NM · latest {lastNm} NM
        </span>
        <span>{fmtHourLabel(xMax, tz)}</span>
      </div>
    </div>
  );
}

export default function PassagePage() {
  const [stats, setStats] = useState<DistanceStats | null>(null);
  const [eta, setEta] = useState<EtaSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Page-level timezone preference — controls how every timestamp on this
  // page is displayed AND how datetime-local form inputs are interpreted.
  // Default Local (matches /chart and what the user prefers for passage
  // planning); persisted to localStorage so the choice sticks across reloads.
  const [tz, setTz] = useState<TzMode>('local');
  useEffect(() => {
    setTz(readTzMode(TZ_KEY, 'local'));
  }, []);
  useEffect(() => {
    writeTzMode(TZ_KEY, tz);
  }, [tz]);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const [distR, etaR] = await Promise.all([
          fetch('/api/stats/distance', { cache: 'no-store' }),
          fetch('/api/stats/eta', { cache: 'no-store' }),
        ]);
        const distJ = (await distR.json()) as
          | { ok: true; stats: DistanceStats }
          | { ok: false; error?: { message?: string } };
        const etaJ = (await etaR.json()) as
          | { ok: true; eta: EtaSnapshot }
          | { ok: false; error?: { message?: string } };
        if (cancelled) return;
        if (distJ.ok) {
          setStats(distJ.stats);
          setError(null);
        } else {
          setError(distJ.error?.message ?? 'unknown error');
        }
        setEta(etaJ.ok ? etaJ.eta : null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <main className="p-4 min-h-screen bg-black space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-slate-300">Passage</h1>
        <div className="flex items-center gap-3">
          <TzToggle tz={tz} setTz={setTz} />
          {stats?.trackId && (
            <div className="text-xs text-slate-500 font-mono">
              {stats.trackId}
              {stats.trackStartAt &&
                ` · ${fmtDuration((stats.lastPointAt ?? Date.now() / 1000) - stats.trackStartAt)} elapsed`}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="text-rose-400 text-sm bg-rose-900/20 border border-rose-800 rounded p-2">
          {error}
        </div>
      )}

      {!stats?.trackId && !error && (
        <div className="text-slate-400 text-sm">
          No active track. Start one on{' '}
          <a href="/tracks" className="underline hover:text-slate-200">
            /tracks
          </a>
          .
        </div>
      )}

      {stats?.trackId && (
        <>
          {eta && <EtaTile eta={eta} tz={tz} />}

          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <DistanceTile label="Last 1 h" valueNm={stats.d1hM * M_TO_NM} hours={1} />
            <DistanceTile label="Last 3 h" valueNm={stats.d3hM * M_TO_NM} hours={3} />
            <DistanceTile label="Last 6 h" valueNm={stats.d6hM * M_TO_NM} hours={6} />
            <DistanceTile label="Last 12 h" valueNm={stats.d12hM * M_TO_NM} hours={12} />
            <DistanceTile label="Last 24 h" valueNm={stats.d24hM * M_TO_NM} hours={24} highlight />
          </section>

          {stats.daily7.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                Previous 7 UTC-days (midnight to midnight)
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
                {stats.daily7.map((d) => (
                  <DailyTile key={d.startsAt} bucket={d} tz={tz} />
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              24 h rolling (per hour, since track start)
            </h2>
            <Sparkline data={stats.history24h} tz={tz} />
          </section>
        </>
      )}

      <EnginePanel tz={tz} />
    </main>
  );
}

function DailyTile({
  bucket,
  tz,
}: {
  bucket: {
    startsAt: number;
    endsAt: number;
    distanceM: number;
    complete: boolean;
  };
  tz: TzMode;
}) {
  const nm = bucket.distanceM * M_TO_NM;
  const startsD = new Date(bucket.startsAt * 1000);
  // The "label" for the bucket is the calendar date of `startsAt` —
  // matches the marine convention of "today's run" = midnight-to-midnight
  // of the date you started.
  const label =
    tz === 'utc'
      ? `${String(startsD.getUTCDate()).padStart(2, '0')} ${startsD.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`
      : `${String(startsD.getDate()).padStart(2, '0')} ${startsD.toLocaleString('en-GB', { month: 'short' })}`;
  return (
    <div
      className={`rounded p-2 border flex flex-col gap-0.5 ${
        bucket.complete
          ? 'bg-slate-900 border-slate-800'
          : 'bg-slate-900/50 border-slate-800 border-dashed'
      }`}
      title={bucket.complete ? 'Full 24 h bucket' : 'Partial — bucket extends before track start'}
    >
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className="text-2xl font-mono text-slate-100">{nm.toFixed(1)}</div>
        <div className="text-xs text-slate-400">NM</div>
      </div>
      <div className="text-[10px] text-slate-500 font-mono">
        avg {(nm / 24).toFixed(2)} NM/h{bucket.complete ? '' : ' · partial'}
      </div>
    </div>
  );
}

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

function EnginePanel({ tz }: { tz: TzMode }) {
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
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
        Engines
      </h2>

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
              ≡ {fmtTimestamp(useNow ? Date.now() / 1000 : whenAnchor, tz === 'utc' ? 'local' : 'utc')}
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
                {[...entries]
                  .reverse()
                  .map((e) => (
                    <tr key={e.t} className="border-t border-slate-800">
                      <td className="py-1 pr-2 text-slate-300">
                        {fmtTimestamp(e.t, tz)}
                      </td>
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

function DistanceTile({
  label,
  valueNm,
  hours,
  highlight = false,
}: {
  label: string;
  valueNm: number;
  /** Window length in hours; used to compute the avg-speed subtitle. */
  hours: number;
  highlight?: boolean;
}) {
  const avgKn = valueNm / hours;
  return (
    <div
      className={`rounded p-4 flex flex-col gap-1 border ${
        highlight
          ? 'bg-amber-900/20 border-amber-700'
          : 'bg-slate-900 border-slate-800'
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="flex items-baseline gap-1">
        <div className="text-3xl font-mono text-slate-100">{valueNm.toFixed(1)}</div>
        <div className="text-sm text-slate-400">NM</div>
      </div>
      <div className="text-base text-slate-400 font-mono">
        avg {avgKn.toFixed(2)} NM/h
      </div>
    </div>
  );
}

function weekdayFor(unixSec: number, tz: TzMode): string {
  return new Date(unixSec * 1000).toLocaleString('en-US', {
    weekday: 'short',
    timeZone: tz === 'utc' ? 'UTC' : undefined,
  });
}

function EtaTile({ eta, tz }: { eta: EtaSnapshot; tz: TzMode }) {
  const altTz: TzMode = tz === 'utc' ? 'local' : 'utc';
  return (
    <section className="bg-slate-900 border border-amber-700 rounded p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider text-amber-400">ETA</div>
          <div className="text-lg font-semibold text-slate-100">
            {eta.destinationLabel}
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {fmtLatLonDmm(eta.destinationLat, eta.destinationLon)}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-baseline gap-1 justify-end">
            <div className="text-4xl font-mono text-slate-100">{eta.distanceNm.toFixed(1)}</div>
            <div className="text-sm text-slate-400">NM remaining</div>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            bearing {eta.bearingDeg.toFixed(0)}°T
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm font-mono">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Avg speed (last 3 h)</div>
          <div className="text-xl text-slate-100">
            {eta.avgSpeedKn3h !== null ? `${eta.avgSpeedKn3h.toFixed(2)} kn` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Time remaining</div>
          <div className="text-xl text-slate-100">
            {eta.etaSecRemaining !== null ? fmtDuration(eta.etaSecRemaining) : '—'}
          </div>
        </div>
      </div>
      <div className="text-base font-mono text-slate-100">
        {eta.etaUnixSec !== null
          ? `${weekdayFor(eta.etaUnixSec, tz)} ${fmtTimestamp(eta.etaUnixSec, tz)}`
          : '— stopped, no ETA'}
        {eta.etaUnixSec !== null && (
          <span className="text-xs text-slate-500 ml-2">
            ({weekdayFor(eta.etaUnixSec, altTz)} {fmtTimestamp(eta.etaUnixSec, altTz)})
          </span>
        )}
      </div>
    </section>
  );
}
