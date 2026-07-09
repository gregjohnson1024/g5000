'use client';
import { useEffect, useState, useCallback } from 'react';
import { SatelliteCachePanel } from './SatelliteCachePanel';
import { PLANNING_DEFAULTS, type PlanningSettings } from '../../../lib/planning-settings';
import {
  NumberField,
  Checkbox,
  SelectField,
  SaveBar,
  useDirtySave,
  Panel,
  SegmentedControl,
} from '../../../components/ui';
import { useThemeStore } from '../../../lib/theme-store';
import { useShipClock } from '../../../lib/use-ship-clock';
import { useSseChannel } from '../../../hooks/use-sse-store';
import { fmtClockSuffix, fmtClockTime, suggestedOffsetMin, type ClockMode } from '../../../lib/tz';

type SourceMode = 'live' | 'demo' | 'replay';
interface SourceModeStatus {
  mode: SourceMode;
  sessionId?: string;
  paceMode?: 'realtime' | 'asap';
  phase?: 'running' | 'finished' | 'error';
  startedAt?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Shared: PATCH a single top-level key to /api/settings (no clobber race).
// ---------------------------------------------------------------------------

async function patchSettings(key: string, value: unknown): Promise<void> {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [key]: value }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `PATCH failed: HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Planning section — staged save via SaveBar + useDirtySave
// ---------------------------------------------------------------------------

type PlanningDraft = Required<PlanningSettings>;

function freshDefaults(): PlanningDraft {
  return {
    stepMinutes: PLANNING_DEFAULTS.stepMinutes,
    pruneBucketDeg: PLANNING_DEFAULTS.pruneBucketDeg,
    headingFanDeg: PLANNING_DEFAULTS.headingFanDeg,
    headingResolutionDeg: PLANNING_DEFAULTS.headingResolutionDeg,
    maxHours: PLANNING_DEFAULTS.maxHours,
    avoidLand: PLANNING_DEFAULTS.avoidLand,
    autoMotor: { ...PLANNING_DEFAULTS.autoMotor },
  };
}

function PlanningSection() {
  const [serverValue, setServerValue] = useState<PlanningDraft | null>(null);

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j: { ok?: boolean; settings?: { planning?: Partial<PlanningDraft> } }) => {
        const defaults = freshDefaults();
        if (j.ok && j.settings?.planning) {
          setServerValue({
            ...defaults,
            ...j.settings.planning,
            autoMotor: { ...defaults.autoMotor, ...(j.settings.planning.autoMotor ?? {}) },
          });
        } else {
          setServerValue(defaults);
        }
      })
      .catch(() => setServerValue(freshDefaults()));
  }, []);

  const { draft, setDraftKey, dirtyCount, isDirty, busy, err, ok, save, reset } =
    useDirtySave<PlanningDraft>({
      initial: serverValue,
      onSave: async (d) => patchSettings('planning', d),
    });

  if (!draft) return <p className="text-ink-3 text-body-sm">Loading…</p>;

  return (
    <section>
      <Panel label="Planning" className="space-y-4">
        <NumberField
          label="Frontier size"
          unit="°"
          value={draft.pruneBucketDeg}
          onChange={(v) => setDraftKey('pruneBucketDeg', v)}
          step={0.5}
          min={0.5}
          caption="Smaller = denser frontier, slower but finer."
        />
        <NumberField
          label="Isochrone length"
          unit="min"
          value={draft.stepMinutes}
          onChange={(v) => setDraftKey('stepMinutes', v)}
          step={5}
          min={5}
          caption="Time between isochrones / planner step."
        />
        <NumberField
          label="Heading fan"
          unit="±°"
          value={draft.headingFanDeg}
          onChange={(v) => setDraftKey('headingFanDeg', v)}
          step={5}
          min={5}
          caption="Search width around bearing-to-destination."
        />
        <NumberField
          label="Heading resolution"
          unit="°"
          value={draft.headingResolutionDeg}
          onChange={(v) => setDraftKey('headingResolutionDeg', v)}
          step={1}
          min={1}
          caption="Headings tried per fan."
        />
        <NumberField
          label="Max hours"
          value={draft.maxHours}
          onChange={(v) => setDraftKey('maxHours', v)}
          step={12}
          min={12}
          caption="Planning horizon cap."
        />
        <Checkbox
          label="Avoid land"
          checked={draft.avoidLand}
          onChange={(v) => setDraftKey('avoidLand', v)}
          caption="Uncheck to skip the land check on open-ocean routes — faster."
        />

        <fieldset className="border border-hairline rounded-[--r-panel] p-3 space-y-3">
          <legend className="text-label uppercase tracking-wider text-ink-2 px-1">
            Auto-motor
          </legend>
          <NumberField
            label="Motor below"
            unit="kn"
            value={draft.autoMotor.minSailKt}
            onChange={(v) => setDraftKey('autoMotor', { ...draft.autoMotor, minSailKt: v })}
            step={0.5}
            min={0}
            caption="Motor when sailing speed falls below this. 0 = never motor."
          />
          <NumberField
            label="Motor speed"
            unit="kn"
            value={draft.autoMotor.motorKt}
            onChange={(v) => setDraftKey('autoMotor', { ...draft.autoMotor, motorKt: v })}
            step={0.5}
            min={0}
            caption="Engine speed used during motor segments."
          />
        </fieldset>
      </Panel>

      <SaveBar
        dirtyCount={dirtyCount}
        busy={busy}
        visible={isDirty}
        err={err}
        ok={ok}
        onSave={() => void save()}
        onDiscard={reset}
      >
        <button
          type="button"
          onClick={reset}
          disabled={busy}
          className="px-3 py-1.5 text-body-sm rounded-[--r-control] border border-hairline text-ink-3 hover:text-ink disabled:opacity-50 transition-colors"
        >
          Reset to defaults
        </button>
      </SaveBar>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tide & currents section — instant-apply checkbox with inline feedback
// ---------------------------------------------------------------------------

function TideCurrentsSection() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j: { ok?: boolean; settings?: { canadianTideCurrents?: boolean } }) => {
        if (j.ok) setEnabled(j.settings?.canadianTideCurrents === true);
      })
      .catch(() => {});
  }, []);

  // Instant-apply: PATCH only the canadianTideCurrents key on every toggle.
  const apply = async (next: boolean): Promise<void> => {
    setEnabled(next);
    setStatus('Saving…');
    try {
      await patchSettings('canadianTideCurrents', next);
      setStatus('Saved');
    } catch {
      setStatus('Save failed');
    }
    setTimeout(() => setStatus(null), 2500);
  };

  return (
    <Panel label="Tide & currents">
      <div className="space-y-3">
        <Checkbox
          label="Canadian Tide/Currents (CHS stations)"
          checked={enabled}
          onChange={(v) => void apply(v)}
          caption="Shows the Tide and Currents tabs plus the chart's station overlays. Station data covers Canadian waters only, so this is off by default."
        />
        {status && (
          <p className="text-body-sm text-ink-3" aria-live="polite">
            {status}
          </p>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Anchor dashboard settings — staged save via SaveBar + useDirtySave
// ---------------------------------------------------------------------------

interface AnchorDashboardConfig {
  bowHeightM?: number;
  droopDeductM?: number;
  depthOffsets?: {
    keelBelowTransducerM?: number;
    transducerToWaterlineM?: number;
  };
  weatherPin?: { lat: number; lon: number } | null;
}

// Flat draft for dirty tracking (nested objects become individual fields).
interface AnchorDashboardDraft {
  bowHeightM: number;
  droopDeductM: number;
  keelBelowTransducerM: number;
  transducerToWaterlineM: number;
  pinEnabled: boolean;
  pinLat: number;
  pinLon: number;
}

const ANCHOR_DEFAULTS: AnchorDashboardDraft = {
  bowHeightM: 0,
  droopDeductM: 0,
  keelBelowTransducerM: 0,
  transducerToWaterlineM: 0,
  pinEnabled: false,
  pinLat: 0,
  pinLon: 0,
};

function anchorConfigToDraft(cfg: AnchorDashboardConfig): AnchorDashboardDraft {
  return {
    bowHeightM: cfg.bowHeightM ?? 0,
    droopDeductM: cfg.droopDeductM ?? 0,
    keelBelowTransducerM: cfg.depthOffsets?.keelBelowTransducerM ?? 0,
    transducerToWaterlineM: cfg.depthOffsets?.transducerToWaterlineM ?? 0,
    pinEnabled: cfg.weatherPin != null,
    pinLat: cfg.weatherPin?.lat ?? 0,
    pinLon: cfg.weatherPin?.lon ?? 0,
  };
}

function draftToAnchorConfig(d: AnchorDashboardDraft): AnchorDashboardConfig {
  return {
    bowHeightM: d.bowHeightM,
    droopDeductM: d.droopDeductM,
    depthOffsets: {
      keelBelowTransducerM: d.keelBelowTransducerM,
      transducerToWaterlineM: d.transducerToWaterlineM,
    },
    weatherPin:
      d.pinEnabled && Number.isFinite(d.pinLat) && Number.isFinite(d.pinLon)
        ? { lat: d.pinLat, lon: d.pinLon }
        : null,
  };
}

function AnchorDashboardSection() {
  const [serverValue, setServerValue] = useState<AnchorDashboardDraft | null>(null);

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j: { ok?: boolean; settings?: { anchorDashboard?: AnchorDashboardConfig } }) => {
        if (j.ok && j.settings?.anchorDashboard) {
          setServerValue(anchorConfigToDraft(j.settings.anchorDashboard));
        } else {
          setServerValue({ ...ANCHOR_DEFAULTS });
        }
      })
      .catch(() => setServerValue({ ...ANCHOR_DEFAULTS }));
  }, []);

  const { draft, setDraftKey, dirtyCount, isDirty, busy, err, ok, save, reset } =
    useDirtySave<AnchorDashboardDraft>({
      initial: serverValue,
      onSave: async (d) => patchSettings('anchorDashboard', draftToAnchorConfig(d)),
    });

  if (!draft) return <p className="text-ink-3 text-body-sm">Loading…</p>;

  return (
    <section>
      <Panel label="Anchor dashboard" className="space-y-4">
        <fieldset className="border border-hairline rounded-[--r-panel] p-3 space-y-3">
          <legend className="text-label uppercase tracking-wider text-ink-2 px-1">
            Rode &amp; scope
          </legend>
          <NumberField
            label="Bow height"
            unit="m"
            value={draft.bowHeightM}
            onChange={(v) => setDraftKey('bowHeightM', v)}
            step={0.1}
            min={0}
            caption="Height of bow chock above the waterline."
          />
          <NumberField
            label="Droop deduct"
            unit="m"
            value={draft.droopDeductM}
            onChange={(v) => setDraftKey('droopDeductM', v)}
            step={0.1}
            min={0}
            caption="Catenary sag to subtract from the counter reading."
          />
        </fieldset>

        <fieldset className="border border-hairline rounded-[--r-panel] p-3 space-y-3">
          <legend className="text-label uppercase tracking-wider text-ink-2 px-1">
            Depth offsets
          </legend>
          <NumberField
            label="Keel below transducer"
            unit="m"
            value={draft.keelBelowTransducerM}
            onChange={(v) => setDraftKey('keelBelowTransducerM', v)}
            step={0.1}
            min={0}
            caption="Depth under keel = sounder − this value."
          />
          <NumberField
            label="Transducer to waterline"
            unit="m"
            value={draft.transducerToWaterlineM}
            onChange={(v) => setDraftKey('transducerToWaterlineM', v)}
            step={0.1}
            min={0}
            caption="Total water depth = sounder + this value."
          />
        </fieldset>

        <fieldset className="border border-hairline rounded-[--r-panel] p-3 space-y-3">
          <legend className="text-label uppercase tracking-wider text-ink-2 px-1">
            Weather pin
          </legend>
          <Checkbox
            label="Pin weather to a fixed position (instead of following the live GPS fix)"
            checked={draft.pinEnabled}
            onChange={(v) => setDraftKey('pinEnabled', v)}
          />
          {draft.pinEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Lat"
                value={draft.pinLat}
                onChange={(v) => setDraftKey('pinLat', v)}
                step={0.0001}
                caption="e.g. 41.63"
              />
              <NumberField
                label="Lon"
                value={draft.pinLon}
                onChange={(v) => setDraftKey('pinLon', v)}
                step={0.0001}
                caption="e.g. −71.26"
              />
            </div>
          )}
          <p className="text-caption text-ink-3">
            When unchecked, the anchor page weather and forecast follow the live GPS position.
          </p>
        </fieldset>
      </Panel>

      <SaveBar
        dirtyCount={dirtyCount}
        busy={busy}
        visible={isDirty}
        err={err}
        ok={ok}
        onSave={() => void save()}
        onDiscard={reset}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Emporia AC settings — staged save via SaveBar + useDirtySave
// ---------------------------------------------------------------------------

type Leg = 'L1' | 'L2' | '240V';

interface EmporiaConfig {
  legAssignments: Record<string, Leg>;
  hiddenChannels: string[];
}

interface EmporiaChannelInfo {
  channelNum: string;
  name: string;
  multiplier: number;
}

const SKIP_CHANNEL_NUMS_SETTINGS = new Set(['1,2,3']);
const SKIP_NAMES_SETTINGS = /^balance$/i;

function EmporiaAcSection() {
  const [channels, setChannels] = useState<EmporiaChannelInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [serverValue, setServerValue] = useState<EmporiaConfig | null>(null);

  const defaultCfg: EmporiaConfig = { legAssignments: {}, hiddenChannels: [] };

  useEffect(() => {
    void fetch('/api/settings')
      .then((r) => r.json())
      .then((j: { ok?: boolean; settings?: { emporiaConfig?: EmporiaConfig } }) => {
        setServerValue(j.ok && j.settings?.emporiaConfig ? j.settings.emporiaConfig : defaultCfg);
      })
      .catch(() => setServerValue(defaultCfg));

    void fetch('/api/emporia/devices', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { devices?: Array<{ channels: EmporiaChannelInfo[] }> }) => {
        const all: EmporiaChannelInfo[] = [];
        for (const dev of j.devices ?? []) {
          for (const ch of dev.channels) {
            if (SKIP_CHANNEL_NUMS_SETTINGS.has(ch.channelNum)) continue;
            if (SKIP_NAMES_SETTINGS.test(ch.name)) continue;
            all.push(ch);
          }
        }
        setChannels(all);
        setDevicesLoaded(true);
      })
      .catch(() => setDevicesLoaded(true));
  }, []);

  const { draft, setDraft, dirtyCount, isDirty, busy, err, ok, save, reset } =
    useDirtySave<EmporiaConfig>({
      initial: serverValue,
      onSave: async (d) => patchSettings('emporiaConfig', d),
    });

  const setLeg = useCallback(
    (channelNum: string, leg: Leg | '') => {
      if (!draft) return;
      const next = { ...draft.legAssignments };
      if (leg === '') {
        delete next[channelNum];
      } else {
        next[channelNum] = leg;
      }
      setDraft({ ...draft, legAssignments: next });
    },
    [draft, setDraft],
  );

  const setHidden = useCallback(
    (channelNum: string, hidden: boolean) => {
      if (!draft) return;
      const set = new Set(draft.hiddenChannels);
      if (hidden) set.add(channelNum);
      else set.delete(channelNum);
      setDraft({ ...draft, hiddenChannels: [...set] });
    },
    [draft, setDraft],
  );

  const legOptions: Array<{ value: Leg | ''; label: string }> = [
    { value: '', label: '—' },
    { value: 'L1', label: 'L1' },
    { value: 'L2', label: 'L2' },
    { value: '240V', label: '240V' },
  ];

  return (
    <section>
      <Panel label="Emporia AC">
        <p className="text-caption text-ink-3 mb-3">
          Assign each circuit to a leg (L1 / L2 / 240V) or hide it from the AC Loads view. Requires
          an Emporia Vue 3 connected or <code>EMPORIA_SIM=1</code>.
        </p>

        {!devicesLoaded && <p className="text-ink-3 text-body-sm italic">Loading channels…</p>}

        {devicesLoaded && channels.length === 0 && (
          <p className="text-ink-3 text-body-sm italic">
            No Emporia device found (connect one, or run with EMPORIA_SIM=1).
          </p>
        )}

        {devicesLoaded && channels.length > 0 && draft && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 items-center text-label uppercase tracking-wider text-ink-3">
              <span>Circuit</span>
              <span>Leg</span>
              <span>Hide</span>
            </div>
            {channels.map((ch) => (
              <div
                key={ch.channelNum}
                className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center"
              >
                <span className="text-ink text-body-sm truncate">
                  {ch.name}
                  <span className="text-ink-3 ml-1 text-caption">#{ch.channelNum}</span>
                </span>
                <SelectField
                  label=""
                  value={(draft.legAssignments[ch.channelNum] ?? '') as Leg | ''}
                  onChange={(v) => setLeg(ch.channelNum, v as Leg | '')}
                  options={legOptions}
                  className="w-24"
                />
                <Checkbox
                  label=""
                  checked={draft.hiddenChannels.includes(ch.channelNum)}
                  onChange={(v) => setHidden(ch.channelNum, v)}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <SaveBar
        dirtyCount={dirtyCount}
        busy={busy}
        visible={isDirty}
        err={err}
        ok={ok}
        onSave={() => void save()}
        onDiscard={reset}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Root page: source mode + SocketCAN (instant-apply; untouched) + sections
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Clock section — boat-wide UTC ↔ ship-time display mode (immediate save,
// synced to every connected browser over the mast SSE stream like the theme)
// ---------------------------------------------------------------------------

/** '' = Auto (GPS); otherwise offsetMin as a string, half-hour steps. */
function offsetOptions(gpsSuggestionMin: number | null): Array<{ value: string; label: string }> {
  const opts: Array<{ value: string; label: string }> = [
    {
      value: '',
      label:
        gpsSuggestionMin !== null
          ? `Auto — GPS suggests ${fmtClockSuffix({ mode: 'ship', offsetMin: gpsSuggestionMin })}`
          : 'Auto — from GPS (no fix yet → UTC)',
    },
  ];
  for (let m = -720; m <= 840; m += 30) {
    opts.push({ value: String(m), label: `UTC${fmtClockSuffix({ mode: 'ship', offsetMin: m })}` });
  }
  return opts;
}

function ClockSection() {
  const { clockCfg, setClockCfg } = useThemeStore();
  const clock = useShipClock();
  const { sample } = useSseChannel('nav.gps.position');
  const v = sample?.value as { lon?: number } | null | undefined;
  const gpsSuggestionMin = typeof v?.lon === 'number' ? suggestedOffsetMin(v.lon) : null;

  // Live preview, seeded on mount (a Date.now() initialiser would make the
  // SSR text differ from the client's — React #418).
  const [nowSec, setNowSec] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowSec(Date.now() / 1000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Panel label="Clock" className="space-y-4">
      <p className="text-caption text-ink-3">
        Boat-wide time display for every panel, table, and time input — synced to all connected
        displays. <strong>UTC</strong> is the z-suffixed convention; <strong>Ship time</strong>{' '}
        renders UTC plus a fixed offset with a ±H suffix so the modes can never be confused.
      </p>
      <SegmentedControl<ClockMode>
        aria-label="Clock display mode"
        segments={[
          { value: 'utc', label: 'UTC' },
          { value: 'ship', label: 'Ship time' },
        ]}
        value={clockCfg.mode}
        onChange={(mode) => setClockCfg({ ...clockCfg, mode })}
      />
      {clockCfg.mode === 'ship' && (
        <SelectField
          label="UTC offset"
          caption="Auto follows the GPS longitude (nautical zones); pick an explicit offset to override — e.g. to keep DST or a chosen ship's time."
          value={clockCfg.offsetMin === null ? '' : String(clockCfg.offsetMin)}
          onChange={(val) =>
            setClockCfg({ ...clockCfg, offsetMin: val === '' ? null : Number(val) })
          }
          options={offsetOptions(gpsSuggestionMin)}
        />
      )}
      {nowSec !== null && (
        <p className="text-body-sm font-mono tabular-nums text-ink-2">
          Now: {fmtClockTime(nowSec, clock).toLowerCase()}
          {clock.mode === 'ship' && (
            <span className="text-ink-3">
              {' '}
              ({fmtClockTime(nowSec, { mode: 'utc', offsetMin: 0 }).toLowerCase()})
            </span>
          )}
        </p>
      )}
    </Panel>
  );
}

export default function SettingsPage() {
  const [sourceMode, setSourceMode] = useState<SourceModeStatus | null>(null);
  const [sourceModeBusy, setSourceModeBusy] = useState<boolean>(false);
  const [sourceModeError, setSourceModeError] = useState<string | undefined>();

  const [socketCanEnabled, setSocketCanEnabled] = useState<boolean>(false);
  const [socketCanInterface, setSocketCanInterface] = useState<string>('can0');
  const [socketCanRunning, setSocketCanRunning] = useState<boolean>(false);
  const [socketCanBusy, setSocketCanBusy] = useState<boolean>(false);
  const [socketCanError, setSocketCanError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/source-mode', { cache: 'no-store' });
        const j = (await res.json()) as SourceModeStatus | { error: string };
        if (cancelled) return;
        if ('error' in j) setSourceModeError(j.error);
        else {
          setSourceMode(j);
          setSourceModeError(undefined);
        }
      } catch (e) {
        if (!cancelled) setSourceModeError(String(e));
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/socketcan', { cache: 'no-store' });
        const j = (await res.json()) as
          | { ok: true; state: { enabled: boolean; interface: string; running: boolean } }
          | { ok: false; error?: { message?: string } };
        if (cancelled) return;
        if (j.ok) {
          setSocketCanEnabled(j.state.enabled);
          setSocketCanInterface(j.state.interface);
          setSocketCanRunning(j.state.running);
          setSocketCanError(undefined);
        }
      } catch (e) {
        if (!cancelled) setSocketCanError(String(e));
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const onApplySocketCan = async (enabled: boolean, iface: string): Promise<void> => {
    setSocketCanBusy(true);
    setSocketCanError(undefined);
    try {
      const res = await fetch('/api/socketcan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled, interface: iface }),
      });
      const j = (await res.json()) as
        | { ok: true; state: { enabled: boolean; interface: string; running: boolean } }
        | {
            ok: false;
            error?: { message?: string };
            state?: { enabled: boolean; interface: string; running: boolean };
          };
      if (j.ok) {
        setSocketCanEnabled(j.state.enabled);
        setSocketCanInterface(j.state.interface);
        setSocketCanRunning(j.state.running);
      } else {
        if (j.state) {
          setSocketCanEnabled(j.state.enabled);
          setSocketCanInterface(j.state.interface);
          setSocketCanRunning(j.state.running);
        }
        setSocketCanError(j.error?.message ?? 'SocketCAN toggle failed');
      }
    } catch (e) {
      setSocketCanError(String(e));
    } finally {
      setSocketCanBusy(false);
    }
  };

  const onSetSourceMode = async (mode: 'live' | 'demo'): Promise<void> => {
    if (sourceMode?.mode === mode) return;
    setSourceModeBusy(true);
    setSourceModeError(undefined);
    try {
      const res = await fetch('/api/source-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const j = (await res.json()) as SourceModeStatus | { error: string };
      if ('error' in j) setSourceModeError(j.error);
      else setSourceMode(j);
    } catch (e) {
      setSourceModeError(String(e));
    } finally {
      setSourceModeBusy(false);
    }
  };

  return (
    <main className="p-8 max-w-2xl space-y-6 text-ink">
      <h1 className="text-title">Settings</h1>

      {/* Source mode — instant-apply radio */}
      <fieldset
        className={`border rounded-[--r-panel] p-3 space-y-2 ${
          sourceMode?.mode === 'demo'
            ? 'border-[--accent] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
            : sourceMode?.mode === 'replay'
              ? 'border-[--info] bg-[color-mix(in_srgb,var(--info)_10%,transparent)]'
              : 'border-hairline'
        }`}
      >
        <legend className="px-2 text-body-sm text-ink-2">Source mode</legend>
        <p className="text-caption text-ink-3">
          Switches the data source feeding the bus and pipelines. <strong>Live</strong> ingests from
          the real NMEA hardware (NGT-1 / YDWG / 0183). <strong>Demo</strong> swaps in a synthetic
          injector — useful on the dock or for UI work without a boat. <strong>Replay</strong> mode
          (not switchable here) is started via the Sessions page.
        </p>
        <div className="flex items-center gap-4 flex-wrap text-body-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="source-mode"
              value="live"
              checked={sourceMode?.mode === 'live'}
              disabled={sourceModeBusy || sourceMode === null}
              onChange={() => void onSetSourceMode('live')}
            />
            <span>Live</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="source-mode"
              value="demo"
              checked={sourceMode?.mode === 'demo'}
              disabled={sourceModeBusy || sourceMode === null}
              onChange={() => void onSetSourceMode('demo')}
            />
            <span>Demo</span>
          </label>
          {sourceMode?.mode === 'replay' && (
            <span className="text-[--info] font-mono text-caption">
              replay · {sourceMode.sessionId ?? 'unknown'} · {sourceMode.phase ?? '—'}
            </span>
          )}
          {sourceModeBusy && <span className="text-ink-3 text-caption">Switching…</span>}
        </div>
        {sourceMode?.mode === 'demo' && (
          <div className="text-[--warn] text-caption">
            Demo data is synthetic — anything plotted on /chart or /helm is fake. Switch back to{' '}
            <strong>Live</strong> before relying on navigation data.
          </div>
        )}
        {sourceModeError && <div className="text-danger text-caption">{sourceModeError}</div>}
      </fieldset>

      {/* SocketCAN — instant-apply checkbox */}
      <fieldset
        className={`border rounded-[--r-panel] p-3 space-y-2 ${
          socketCanRunning
            ? 'border-[--info] bg-[color-mix(in_srgb,var(--info)_10%,transparent)]'
            : socketCanEnabled
              ? 'border-[--accent] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
              : 'border-hairline'
        }`}
      >
        <legend className="px-2 text-body-sm text-ink-2">Live ingest — SocketCAN (PiCAN-M)</legend>
        <p className="text-caption text-ink-3">
          Reads N2K frames directly from a Linux SocketCAN interface (e.g. the PiCAN-M HAT on the
          boat Pi). Runs <em>alongside</em> YDWG-02 and NGT-1 — the bridge dedupes by source address
          + PGN, so toggling this on while YDWG stays connected is safe for verification.
        </p>
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={socketCanEnabled}
            disabled={socketCanBusy}
            onChange={(e) =>
              void onApplySocketCan(e.target.checked, socketCanInterface.trim() || 'can0')
            }
          />
          <span>Enable SocketCAN ingest</span>
          {socketCanBusy && <span className="text-caption text-ink-3">Applying…</span>}
          {!socketCanBusy && socketCanEnabled && socketCanRunning && (
            <span className="text-caption text-[--info] font-mono">running</span>
          )}
          {!socketCanBusy && socketCanEnabled && !socketCanRunning && (
            <span className="text-caption text-[--warn] font-mono">
              not running (driver failed to start)
            </span>
          )}
        </label>
        <label className="block text-body-sm">
          CAN interface name
          <input
            type="text"
            value={socketCanInterface}
            onChange={(e) => setSocketCanInterface(e.target.value)}
            onBlur={() => {
              if (
                socketCanEnabled &&
                socketCanInterface.trim().length > 0 &&
                socketCanInterface.trim() !== 'can0'
              ) {
                void onApplySocketCan(true, socketCanInterface.trim());
              }
            }}
            placeholder="can0"
            disabled={socketCanBusy}
            className="bg-surface-sunken border border-hairline rounded-[--r-control] px-2 py-1 w-48 font-mono disabled:opacity-40 ml-2"
          />
          <span className="text-caption text-ink-3 ml-2">
            usually <code>can0</code>; <code>vcan0</code> for virtual-CAN testing
          </span>
        </label>
        <p className="text-caption text-ink-3">
          Takes effect immediately — the driver is added to or removed from the live bridge via{' '}
          <code>/api/socketcan</code> without a service restart. Persisted to{' '}
          <code>~/.g5000-router/settings.json</code> so it also survives the next reboot.
        </p>
        {socketCanError && <div className="text-danger text-caption">{socketCanError}</div>}
      </fieldset>

      <ClockSection />

      <SatelliteCachePanel />

      <PlanningSection />

      <TideCurrentsSection />

      <AnchorDashboardSection />

      <EmporiaAcSection />
    </main>
  );
}
