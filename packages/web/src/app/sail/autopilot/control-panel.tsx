'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AutopilotCommandName, JsonSafeSample } from '@g5000/core';
import { useSse } from '../../../hooks/use-sse';
import { fmtClockTime } from '../../../lib/tz';
import { useShipClock } from '../../../lib/use-ship-clock';
import { Dialog } from '../../../components/ui/Dialog';
import { Button } from '../../../components/ui/Button';
import { HoldButton } from '../../../components/ui/HoldButton';

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
  const clock = useShipClock();
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

  const pendingDef = COMMANDS.find((c) => c.name === pendingCommand);
  const isEngageDisengage = pendingCommand === 'auto' || pendingCommand === 'standby';

  return (
    <section className="border-t border-[var(--hairline)] pt-6 mt-6 space-y-4">
      {/* Warning banner — tokens only */}
      <div
        className="[border-radius:var(--r-panel)] border border-[var(--warning-strong,theme(colors.amber.700))] p-3 text-sm space-y-2"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--warning-surface, #78350f) 30%, transparent)',
          color: 'var(--warning-ink, #fef3c7)',
        }}
      >
        <div className="font-semibold">⚠ TEST CONTROLS · MAC ONLY</div>
        <p>
          Sends real PGN 130850 frames to the live autopilot. Confirm each press. Increment buttons
          (±1°, ±10°) are disabled until the Triton keypad values are captured at{' '}
          <Link href="/sniff" className="underline">
            /sniff
          </Link>{' '}
          and added to <code>~/.g5000-router/ap-tx-codes.json</code>.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Mode buttons — ENABLE(AUTO) / DISABLE(STBY) as HoldButton */}
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-ink-2">Mode</h3>
          <div className="grid grid-cols-2 gap-2">
            {COMMANDS.filter((c) => c.group === 'mode').map((c) => (
              <HoldButton
                key={c.name}
                holdMs={800}
                disabled={!buttonEnabled(c.name)}
                title={buttonTooltip(c.name)}
                onHold={() => setPendingCommand(c.name)}
                fillColor="bg-accent"
                className="min-h-[44px] px-3 py-3 font-semibold text-ink-value bg-surface-raised border border-hairline-strong text-[0.833rem]"
              >
                {c.label}
              </HoldButton>
            ))}
          </div>
        </div>

        {/* Course adjust buttons */}
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-ink-2">Course adjust</h3>
          <div className="grid grid-cols-4 gap-2">
            {COMMANDS.filter((c) => c.group === 'course').map((c) => (
              <Button
                key={c.name}
                variant="secondary"
                size="md"
                disabled={!buttonEnabled(c.name)}
                title={buttonTooltip(c.name)}
                onClick={() => setPendingCommand(c.name)}
                className="font-mono"
              >
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Confirm dialog — Dialog primitive with focus trap + Escape */}
      <Dialog
        open={pendingCommand !== null}
        onClose={() => setPendingCommand(null)}
        title="Confirm AP command"
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingCommand(null)}>
              Cancel
            </Button>
            {isEngageDisengage ? (
              /* Engage / disengage require a hold */
              <HoldButton
                holdMs={800}
                disabled={pendingCommand === null}
                onHold={() => {
                  if (pendingCommand !== null) void confirmAndSend(pendingCommand);
                }}
                confirmedLabel="Sent ✓"
                fillColor="bg-accent"
                className="min-h-[44px] px-4 py-2 text-[0.833rem] font-semibold bg-accent text-on-accent border border-accent [border-radius:var(--r-control)] hover:opacity-90"
              >
                Hold to send
              </HoldButton>
            ) : (
              <Button
                variant="primary"
                onClick={() => pendingCommand !== null && void confirmAndSend(pendingCommand)}
              >
                Send
              </Button>
            )}
          </>
        }
      >
        <p className="text-ink">
          Send <span className="font-mono font-semibold">{pendingDef?.label}</span> to the
          autopilot?
        </p>
        {pendingDef?.description && (
          <p className="text-[0.833rem] text-ink-3 mt-2">{pendingDef.description}</p>
        )}
        {isEngageDisengage && (
          <p className="text-[0.833rem] text-ink-2 mt-2 font-medium">Hold the button to confirm.</p>
        )}
      </Dialog>

      {/* Ack log — ship-clock timestamps */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-ink-2 mb-2">Recent commands</h3>
        <div className="text-xs font-mono space-y-1 text-ink-3">
          {log.length === 0 && <div className="text-ink-4 italic">No commands sent yet.</div>}
          {log.map((r) => (
            <div key={r.id} className="flex gap-3">
              <span className="text-ink-4">{fmtClockTime(r.t, clock)}</span>
              <span className="font-semibold w-32">
                {COMMANDS.find((c) => c.name === r.command)?.label ?? r.command}
              </span>
              <span>→ {r.result}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
