import type { AutopilotCommandName } from '@g5000/core';

export interface CaptureEntry {
  /** Canboatjs field-bag for PGN 130850. Hand-edited after /sniff capture. */
  fields: Record<string, unknown>;
}

export interface CaptureCodes {
  version: 1;
  captures: Partial<Record<AutopilotCommandName, CaptureEntry>>;
}

export type ResolveResult =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; kind: 'missing_capture' | 'unknown_event'; message: string };

/**
 * Map a command name to the PGN 130850 field-bag for txPgn.
 *
 * - standby / auto / nav / wind / no_drift use canboat-documented Event IDs
 *   under Proprietary ID=Autopilot, Command Type=AP Command.
 * - course_+1 / course_-1 / course_+10 / course_-10 must come from
 *   captureCodes (hand-edited from /sniff captures) — they use Event=26
 *   Change course but the magnitude/direction encoding is undocumented.
 */
export function resolveCommand(
  event: AutopilotCommandName,
  captureCodes: CaptureCodes,
): ResolveResult {
  const builtin: Record<string, string> = {
    standby: 'Standby',
    auto: 'Heading mode',
    nav: 'Nav mode',
    wind: 'Wind mode',
    no_drift: 'No Drift mode',
  };
  if (event in builtin) {
    return {
      ok: true,
      fields: {
        'Manufacturer Code': 'Simrad',
        'Industry Code': 'Marine Industry',
        Address: 0,
        'Proprietary ID': 'Autopilot',
        'Command Type': 'AP Command',
        Event: builtin[event]!,
      },
    };
  }
  if (
    event === 'course_+1' ||
    event === 'course_-1' ||
    event === 'course_+10' ||
    event === 'course_-10'
  ) {
    const entry = captureCodes.captures[event];
    if (!entry) {
      return {
        ok: false,
        kind: 'missing_capture',
        message: `no capture entry for ${event} — add it to ~/.g5000-router/ap-tx-codes.json after /sniff capture`,
      };
    }
    return { ok: true, fields: entry.fields };
  }
  return {
    ok: false,
    kind: 'unknown_event',
    message: `unknown autopilot event: ${String(event)}`,
  };
}
