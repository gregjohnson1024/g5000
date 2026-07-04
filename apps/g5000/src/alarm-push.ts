import { subscribeSelected, getSharedSourcePriority } from '@g5000/core';
import type { AlarmsRegistry, AlarmFireRequest, Bus } from '@g5000/core';
import type { AlarmsConfig } from '@g5000/db';
import { sendNtfyPush } from '@g5000/compute';

/**
 * Push WARN/CRITICAL alarm fires to an ntfy topic (https://ntfy.sh or a
 * self-hosted server) so the crew's phones hear about a dragging anchor, MOB,
 * or CPA threat while off the boat's wifi.
 *
 * Wraps registry.fire the same way wireAlarmsHistory does. Push is strictly
 * fire-and-forget: a 5 s abort, every error swallowed (logged once) — a dead
 * internet link at anchor must NEVER touch the alarm path itself.
 *
 * Topic/server are read AT PUSH TIME from the live AlarmsConfig ref
 * (config.push, edited on /alerts) — config wins; the G5000_NTFY_TOPIC /
 * G5000_NTFY_URL env vars are a legacy fallback consulted only when the
 * config values are null/blank. With neither set, nothing is pushed. Only
 * fresh fire transitions push — the predicates re-fire active alarms every
 * sample to refresh label/context, and forwarding those would spam a phone
 * at 1 Hz.
 *
 * When `bus` is provided, a last-known GPS fix is cached so a MOB fired
 * without a position (the helm button sends an empty context) can still
 * carry the incident position in the push body.
 */

export interface AlarmPushOptions {
  /** Live alarms config ref — same object handed to startAlarmsPipeline. */
  configRef?: { current: AlarmsConfig };
  /** Bus to cache nav.gps.position from, for MOB position enrichment. */
  bus?: Bus;
}

type Fix = { lat: number; lon: number };

/** Compact marine DMM, e.g. `41 29.200n 71 19.500w` (see packages/web/src/lib/format-coords.ts). */
function formatDmm(pos: Fix): string {
  const part = (value: number, posHemi: string, negHemi: string): string => {
    const hemi = value >= 0 ? posHemi : negHemi;
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const min = ((abs - deg) * 60).toFixed(3);
    return `${deg} ${min}${hemi}`;
  };
  return `${part(pos.lat, 'n', 's')} ${part(pos.lon, 'e', 'w')}`;
}

function contextFix(context: Record<string, unknown> | undefined): Fix | null {
  if (!context) return null;
  const { lat, lon } = context;
  if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon };
  return null;
}

const defaultBody = (req: AlarmFireRequest): string => {
  const contextLines = Object.entries(req.context ?? {}).map(
    ([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
  );
  return [req.label, ...contextLines].join('\n');
};

/** Per-alarm-id push-body formatters; anything unlisted gets defaultBody. */
const formatters: Record<string, (req: AlarmFireRequest, lastFix: Fix | null) => string> = {
  mob: (req, lastFix) => {
    // Chart-button MOB carries {lat, lon}; helm-button MOB fires {} — enrich
    // from the last-known fix so the push still says WHERE.
    const pos = contextFix(req.context) ?? lastFix;
    return [req.label, pos ? `position ${formatDmm(pos)}` : 'position unknown'].join('\n');
  },
  'anchor-watch': (req) => {
    const d = req.context?.distanceM;
    const lines = [req.label];
    if (typeof d === 'number') lines.push(`${Math.round(d)} m from anchor`);
    return lines.join('\n');
  },
  'high-wind': (req) => {
    const tws = req.context?.twsKn;
    const threshold = req.context?.thresholdKn;
    const lines = [req.label];
    if (typeof tws === 'number') {
      const suffix = typeof threshold === 'number' ? ` (threshold ${threshold} kn)` : '';
      lines.push(`TWS ${tws.toFixed(1)} kn${suffix}`);
    }
    return lines.join('\n');
  },
};

const nonBlank = (s: string | null | undefined): string | null => (s && s.trim() !== '' ? s : null);

export function wireAlarmPush(registry: AlarmsRegistry, opts: AlarmPushOptions = {}): void {
  let lastFix: Fix | null = null;
  if (opts.bus) {
    // Fire-and-forget subscription for the life of the process (the registry
    // wrap below is never unwound either).
    subscribeSelected(opts.bus, 'nav.gps.position', getSharedSourcePriority, (sample) => {
      if (sample.value.kind === 'geo') lastFix = sample.value.value;
    });
  }

  let errorLogged = false;
  const logOnce = (e: unknown): void => {
    if (errorLogged) return;
    errorLogged = true;
    // eslint-disable-next-line no-console
    console.warn(`[alarm-push] ntfy push failed (further failures silenced): ${String(e)}`);
  };

  const rawFire = registry.fire.bind(registry);
  registry.fire = (req) => {
    // Snapshot BEFORE the fire: an active-and-unacked entry means this call is
    // a refresh (updated distance/context), not a new alarm — don't re-push.
    const prev = registry.get(req.id);
    const wasActiveUnacked = prev !== undefined && prev.ackedAt === null && prev.clearedAt === null;
    rawFire(req);
    if (wasActiveUnacked || req.severity === 'INFO') return;

    const push = opts.configRef?.current.push;
    const topic = nonBlank(push?.ntfyTopic) ?? nonBlank(process.env.G5000_NTFY_TOPIC);
    if (!topic) return; // push not configured anywhere
    const url = nonBlank(push?.ntfyUrl) ?? nonBlank(process.env.G5000_NTFY_URL);

    const body = (formatters[req.id] ?? defaultBody)(req, lastFix);
    void sendNtfyPush({
      url,
      topic,
      title: req.label,
      body,
      priority: req.severity === 'CRITICAL' ? 'urgent' : 'high',
    }).then((r) => {
      if (!r.ok) logOnce(r.error ?? `HTTP ${r.status}`);
    });
  };
}
