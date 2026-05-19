'use client';
import { useEffect, useRef, useState } from 'react';
import type { AutopilotCommandName, JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';

interface LogRow {
  id: number;
  t: number;
  command: AutopilotCommandName;
  result: string;
}

const COMMANDS: {
  name: AutopilotCommandName;
  label: string;
  group: 'mode' | 'course';
  description: string;
}[] = [
  {
    name: 'auto',
    label: 'ENABLE (AUTO)',
    group: 'mode',
    description: 'Engages heading-hold at the current vessel heading.',
  },
  {
    name: 'standby',
    label: 'DISABLE (STBY)',
    group: 'mode',
    description: 'Disengages active steering — boat falls back to manual / follow-up.',
  },
  {
    name: 'course_-10',
    label: '−10°',
    group: 'course',
    description: 'Adjust target heading 10° to port.',
  },
  {
    name: 'course_-1',
    label: '−1°',
    group: 'course',
    description: 'Adjust target heading 1° to port.',
  },
  {
    name: 'course_+1',
    label: '+1°',
    group: 'course',
    description: 'Adjust target heading 1° to starboard.',
  },
  {
    name: 'course_+10',
    label: '+10°',
    group: 'course',
    description: 'Adjust target heading 10° to starboard.',
  },
];

interface CaptureCodesResponse {
  version: 1;
  captures: Partial<Record<AutopilotCommandName, unknown>>;
}

export function ControlPanel(): React.ReactElement {
  const [captures, setCaptures] = useState<CaptureCodesResponse>({ version: 1, captures: {} });
  const [pendingCommand, setPendingCommand] = useState<AutopilotCommandName | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const logIdRef = useRef(0);
  const { channels } = useSse();
  // useSse returns a fresh Map on every SSE event. The 2s ack-poll below
  // runs inside a long-lived closure; without this ref it would keep reading
  // the snapshot taken at click time and never observe the mode change.
  const channelsRef = useRef(channels);
  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    fetch('/api/autopilot/capture-codes')
      .then((r) => r.json())
      .then((j) => setCaptures(j as CaptureCodesResponse))
      .catch(() => {});
  }, []);

  function isBuiltin(name: AutopilotCommandName): boolean {
    return (
      name === 'standby' ||
      name === 'auto' ||
      name === 'nav' ||
      name === 'wind' ||
      name === 'no_drift'
    );
  }

  function buttonEnabled(name: AutopilotCommandName): boolean {
    if (cooldownUntil > Date.now()) return false;
    if (isBuiltin(name)) return true;
    return Boolean(captures.captures[name]);
  }

  function buttonTooltip(name: AutopilotCommandName): string | undefined {
    if (!isBuiltin(name) && !captures.captures[name]) {
      return `Add captures.${name} to ~/.g5000-router/ap-tx-codes.json after /sniff capture.`;
    }
    return undefined;
  }

  async function confirmAndSend(name: AutopilotCommandName): Promise<void> {
    setPendingCommand(null);
    const t0 = Date.now();
    const modeBefore = channelsRef.current.get('autopilot.mode') as JsonSafeSample | undefined;
    const modeBeforeValue = modeBefore?.value.kind === 'enum' ? modeBefore.value.value : null;

    let resultText: string;
    try {
      const resp = await fetch('/api/autopilot/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: name }),
      });
      const body = (await resp.json()) as {
        ok: boolean;
        txMs?: number;
        error?: { kind: string; message: string };
      };
      if (!resp.ok || !body.ok) {
        const err = body.error;
        if (err?.kind === 'unavailable') resultText = 'bus down — check YDWG';
        else resultText = `TX error: ${err?.message ?? `HTTP ${resp.status}`}`;
      } else {
        // Best-effort ack: watch autopilot.mode for a change within 2 s.
        resultText = 'no mode change within 2 s';
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          const after = channelsRef.current.get('autopilot.mode') as JsonSafeSample | undefined;
          const v = after?.value.kind === 'enum' ? after.value.value : null;
          if (v && v !== modeBeforeValue) {
            resultText = `mode→${v} (${Date.now() - t0} ms)`;
            break;
          }
        }
      }
    } catch (e) {
      resultText = `TX error: ${(e as Error).message}`;
    }
    setLog((prev) =>
      [
        { id: ++logIdRef.current, t: Date.now() / 1000, command: name, result: resultText },
        ...prev,
      ].slice(0, 10),
    );
    setCooldownUntil(Date.now() + 500);
  }

  return (
    <section className="border-t border-amber-800 pt-6 mt-6 space-y-4">
      <div className="bg-amber-900/30 border border-amber-700 rounded p-3 text-amber-100 text-sm space-y-2">
        <div className="font-semibold">⚠ TEST CONTROLS · MAC ONLY</div>
        <p>
          Sends real PGN 130850 frames to the live autopilot. Confirm each press. Increment buttons
          (±1°, ±10°) are disabled until the Triton keypad values are captured at{' '}
          <a href="/sniff" className="underline">
            /sniff
          </a>{' '}
          and added to <code>~/.g5000-router/ap-tx-codes.json</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-slate-400">Mode</h3>
          <div className="grid grid-cols-2 gap-2">
            {COMMANDS.filter((c) => c.group === 'mode').map((c) => (
              <button
                key={c.name}
                type="button"
                disabled={!buttonEnabled(c.name)}
                title={buttonTooltip(c.name)}
                onClick={() => setPendingCommand(c.name)}
                className="px-3 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded font-semibold text-slate-200"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-slate-400">Course adjust</h3>
          <div className="grid grid-cols-4 gap-2">
            {COMMANDS.filter((c) => c.group === 'course').map((c) => (
              <button
                key={c.name}
                type="button"
                disabled={!buttonEnabled(c.name)}
                title={buttonTooltip(c.name)}
                onClick={() => setPendingCommand(c.name)}
                className="px-2 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed rounded font-mono text-slate-200"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pendingCommand && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded p-6 max-w-md space-y-4">
            <div className="text-lg font-semibold text-slate-100">Confirm AP command</div>
            <div className="text-sm text-slate-300">
              Send{' '}
              <span className="font-mono font-semibold">
                {COMMANDS.find((c) => c.name === pendingCommand)?.label}
              </span>{' '}
              to the autopilot?
            </div>
            <div className="text-xs text-slate-400">
              {COMMANDS.find((c) => c.name === pendingCommand)?.description}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCommand(null)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-200 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmAndSend(pendingCommand)}
                className="px-3 py-1 bg-amber-700 hover:bg-amber-600 rounded text-amber-50 text-sm font-semibold"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Recent commands</h3>
        <div className="text-xs font-mono space-y-1 text-slate-300">
          {log.length === 0 && <div className="text-slate-500 italic">No commands sent yet.</div>}
          {log.map((r) => {
            const d = new Date(r.t * 1000);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return (
              <div key={r.id} className="flex gap-3">
                <span className="text-slate-500">{`${hh}:${mm}:${ss}`}</span>
                <span className="font-semibold w-32">
                  {COMMANDS.find((c) => c.name === r.command)?.label ?? r.command}
                </span>
                <span>→ {r.result}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
