import type { AlarmsRegistry } from '@g5000/core';

/**
 * Push WARN/CRITICAL alarm fires to an ntfy topic (https://ntfy.sh or a
 * self-hosted server) so the crew's phones hear about a dragging anchor, MOB,
 * or CPA threat while off the boat's wifi.
 *
 * Wraps registry.fire the same way wireAlarmsHistory does. Push is strictly
 * fire-and-forget: a 5 s abort, every error swallowed (logged once) — a dead
 * internet link at anchor must NEVER touch the alarm path itself.
 *
 * Enabled only when G5000_NTFY_TOPIC is set; G5000_NTFY_URL overrides the
 * server (default https://ntfy.sh). Only fresh fire transitions push — the
 * predicates re-fire active alarms every sample to refresh label/context, and
 * forwarding those would spam a phone at 1 Hz.
 */
export function wireAlarmPush(registry: AlarmsRegistry): void {
  const topic = process.env.G5000_NTFY_TOPIC;
  if (!topic) return; // push disabled — leave the registry untouched
  const base = (process.env.G5000_NTFY_URL ?? 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${base}/${topic}`;
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

    const contextLines = Object.entries(req.context ?? {}).map(
      ([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
    );
    const body = [req.label, ...contextLines].join('\n');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    void fetch(url, {
      method: 'POST',
      headers: {
        Title: req.label,
        Priority: req.severity === 'CRITICAL' ? 'urgent' : 'high',
        Tags: 'warning',
      },
      body,
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!r.ok) logOnce(`HTTP ${r.status}`);
      })
      .catch(logOnce)
      .finally(() => clearTimeout(timer));
  };
}
