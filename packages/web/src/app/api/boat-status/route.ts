import { stat } from 'node:fs/promises';
import path from 'node:path';
import { firstValueFrom } from 'rxjs';
import { getSharedConfigStore } from '@g5000/db';
import { getSharedDeviceRegistry, listSessions } from '@g5000/bridge';
import { sessionsDir } from '../sessions/dir';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STALE_DEVICE_MS = 10_000; // matches freshness.ts STALE_THRESHOLD_MS

/** Compute the config DB file path (same logic as the g5000 app). */
function configDbPath(): string {
  if (process.env.CONFIG_DB) return process.env.CONFIG_DB;
  return path.resolve(process.cwd(), 'data', 'config.db');
}

/** Age of the config DB file in days, or null if unreadable. */
async function configDbAgeDays(): Promise<number | null> {
  try {
    const s = await stat(configDbPath());
    return (Date.now() - s.mtimeMs) / (1000 * 60 * 60 * 24);
  } catch {
    return null;
  }
}

/** True if all values in a 2-D array equal `target`. */
function allEqual2D(arr: number[][], target: number): boolean {
  return arr.every((row) => row.every((v) => v === target));
}

/**
 * Detect whether a cal table differs from its identity default.
 * Returns true if the user has made any non-trivial change.
 */
function awsAwaCalCustomized(cal: {
  angleCorrection: number[][];
  speedMultiplier: number[][];
}): boolean {
  return !allEqual2D(cal.angleCorrection, 0) || !allEqual2D(cal.speedMultiplier, 1);
}

function bspCalCustomized(cal: { multiplier: number[] }): boolean {
  return cal.multiplier.some((v) => v !== 1);
}

function compassCalCustomized(cal: { deviation: number[] }): boolean {
  return cal.deviation.some((v) => v !== 0);
}

/** Format a days count as "Nd" or "<1d". */
function fmtDays(days: number): string {
  if (days < 1) return '<1d';
  return `${Math.floor(days)}d`;
}

/** ISO date string prefix for "today" in UTC (YYYY-MM-DD). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface BoatStatusCard {
  /** Route href this card links to. */
  href: string;
  /** Human-readable card label. */
  label: string;
  /** Short description line (static, from card definition). */
  desc: string;
  /**
   * Live status line. null = still loading; '' = nothing notable to show;
   * string = displayable status (shown below desc).
   */
  statusLine: string;
  /**
   * Tint applied to the card border/bg.
   * 'ok' | 'warn' | 'neutral' — drives token-class selection on the client.
   */
  tint: 'ok' | 'warn' | 'neutral';
}

export interface BoatStatusResponse {
  performance: BoatStatusCard[];
  setup: BoatStatusCard[];
  diagnostics: BoatStatusCard[];
}

export async function GET(): Promise<Response> {
  // ---------- gather data in parallel ----------
  const [awsCal, bspCal, compassCal, dbAgeDays, sessions, deviceSnap] = await Promise.all([
    // Cal tables — all best-effort (ConfigStore may not be initialised in test)
    (async () => {
      try {
        const store = getSharedConfigStore();
        return await firstValueFrom(store.awsAwaCal$);
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const store = getSharedConfigStore();
        return await firstValueFrom(store.bspCal$);
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const store = getSharedConfigStore();
        return await firstValueFrom(store.compassDeviation$);
      } catch {
        return null;
      }
    })(),
    configDbAgeDays(),
    // Sessions — count those that started today
    (async () => {
      try {
        return await listSessions(sessionsDir());
      } catch {
        return [];
      }
    })(),
    // Devices snapshot
    (async () => {
      try {
        return getSharedDeviceRegistry().snapshot();
      } catch {
        return null;
      }
    })(),
  ]);

  // ---------- compute status strings ----------

  // Wind cal
  const windCalCustomized = awsCal ? awsAwaCalCustomized(awsCal) : null;
  let windCalStatus = '—';
  let windCalTint: BoatStatusCard['tint'] = 'neutral';
  if (windCalCustomized === null) {
    windCalStatus = '—'; // offline
  } else if (windCalCustomized) {
    windCalStatus = dbAgeDays !== null ? `calibrated · db ${fmtDays(dbAgeDays)} old` : 'calibrated';
    windCalTint = 'ok';
  } else {
    windCalStatus = 'identity (uncalibrated)';
    windCalTint = 'warn';
  }

  // BSP cal
  const bspCalCustomized_ = bspCal ? bspCalCustomized(bspCal) : null;
  let bspCalStatus = '—';
  let bspCalTint: BoatStatusCard['tint'] = 'neutral';
  if (bspCalCustomized_ === null) {
    bspCalStatus = '—';
  } else if (bspCalCustomized_) {
    bspCalStatus = 'calibrated';
    bspCalTint = 'ok';
  } else {
    bspCalStatus = 'identity (uncalibrated)';
    bspCalTint = 'warn';
  }

  // Compass cal
  const compassCalCustomized_ = compassCal ? compassCalCustomized(compassCal) : null;
  let compassCalStatus = '—';
  let compassCalTint: BoatStatusCard['tint'] = 'neutral';
  if (compassCalCustomized_ === null) {
    compassCalStatus = '—';
  } else if (compassCalCustomized_) {
    compassCalStatus = 'calibrated';
    compassCalTint = 'ok';
  } else {
    compassCalStatus = 'identity (uncalibrated)';
    compassCalTint = 'warn';
  }

  // Devices — count silent (stale) ones
  const now = Date.now();
  let silentCount = 0;
  let totalDevices = 0;
  if (deviceSnap) {
    for (const d of deviceSnap.values()) {
      totalDevices++;
      if (now - d.lastSeenMs > STALE_DEVICE_MS) silentCount++;
    }
  }
  const deviceStatus =
    deviceSnap === null
      ? '—'
      : totalDevices === 0
        ? 'no devices observed'
        : silentCount > 0
          ? `${silentCount} device${silentCount === 1 ? '' : 's'} silent`
          : `${totalDevices} device${totalDevices === 1 ? '' : 's'} active`;
  const deviceTint: BoatStatusCard['tint'] =
    deviceSnap === null ? 'neutral' : silentCount > 0 ? 'warn' : 'ok';

  // Sessions today
  const today = todayUtc();
  const todaySessions = sessions.filter((s) => (s.startedAt ?? s.mtime).startsWith(today)).length;
  const sessionStatus =
    sessions === null
      ? '—'
      : todaySessions === 0
        ? 'no sessions today'
        : `${todaySessions} session${todaySessions === 1 ? '' : 's'} today`;
  const sessionTint: BoatStatusCard['tint'] = todaySessions > 0 ? 'ok' : 'neutral';

  // ---------- build response ----------
  const response: BoatStatusResponse = {
    performance: [
      {
        href: '/boat/polars',
        label: 'Polars',
        desc: 'Boat speed targets vs TWS/TWA grid',
        statusLine: '', // polar revision count could go here; deferred
        tint: 'neutral',
      },
      {
        href: '/boat/sails',
        label: 'Sails',
        desc: 'Sail wardrobe — add, remove, set active',
        statusLine: '',
        tint: 'neutral',
      },
      {
        href: '/boat/crossover',
        label: 'Crossover',
        desc: 'TWS/TWA region editor per sail',
        statusLine: '',
        tint: 'neutral',
      },
    ],
    setup: [
      {
        href: '/boat/setup',
        label: 'Setup',
        desc: 'App settings, satellite cache, source mode',
        statusLine: '',
        tint: 'neutral',
      },
      {
        href: '/boat/setup/profile',
        label: 'Profile',
        desc: 'Mast geometry, magnetic variation, MMSI',
        statusLine: '',
        tint: 'neutral',
      },
      {
        href: '/boat/setup/displays',
        label: 'Displays',
        desc: 'Mast display layout, night mode, brightness',
        statusLine: '',
        tint: 'neutral',
      },
      {
        href: '/boat/setup/damping',
        label: 'Damping',
        desc: 'Per-channel EMA filter time constants',
        statusLine: '',
        tint: 'neutral',
      },
      {
        href: '/boat/setup/cal/wind',
        label: 'Wind cal',
        desc: 'AWS/AWA calibration table',
        statusLine: windCalStatus,
        tint: windCalTint,
      },
      {
        href: '/boat/setup/cal/bsp',
        label: 'BSP cal',
        desc: 'Boat speed calibration',
        statusLine: bspCalStatus,
        tint: bspCalTint,
      },
      {
        href: '/boat/setup/cal/compass',
        label: 'Compass',
        desc: 'Compass deviation table',
        statusLine: compassCalStatus,
        tint: compassCalTint,
      },
    ],
    diagnostics: [
      {
        href: '/boat/diag',
        label: 'Diagnostics',
        desc: 'N2K bus inspection, session replay, and server logs',
        statusLine: deviceStatus,
        tint: deviceTint,
      },
      {
        href: '/boat/diag/sensors',
        label: 'Sensors',
        desc: 'Per-channel source freshness and priority',
        statusLine: deviceStatus,
        tint: deviceTint,
      },
      {
        href: '/boat/diag/sessions',
        label: 'Sessions',
        desc: 'Recorded sessions — replay, download, delete',
        statusLine: sessionStatus,
        tint: sessionTint,
      },
    ],
  };

  return Response.json(response);
}
