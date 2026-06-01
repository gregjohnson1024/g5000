'use client';

import { useEffect, useState, type ReactElement } from 'react';

interface AlertSnapshot {
  key: string;
  src: number;
  type: string;
  category?: string;
  state: string;
  ackStatus?: string;
  acknowledgeSupport?: boolean;
  priority?: number;
  text?: string;
  location?: string;
  lastSeenMs: number;
}

const ALERT_TYPE_STYLE: Record<string, string> = {
  'Emergency Alarm': 'bg-red-900/40 border-red-700 text-red-200',
  Alarm: 'bg-red-900/30 border-red-800 text-red-200',
  Warning: 'bg-amber-900/30 border-amber-700 text-amber-200',
  Caution: 'bg-yellow-900/30 border-yellow-700 text-yellow-200',
  unknown: 'bg-slate-800 border-slate-700 text-slate-200',
};

export function AlertsPanel(): ReactElement | null {
  const [alerts, setAlerts] = useState<AlertSnapshot[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch('/api/alerts', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as { alerts: AlertSnapshot[] };
        if (!cancelled) setAlerts(j.alerts);
      } catch {
        /* next tick retries */
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Surface only alerts that aren't already in a resolved state AND
  // are still actively transmitting. Navico proprietary alerts have no
  // ack/cleared PGN we can rely on — the issuer just stops sending the
  // 130850 frames when the helmsman silences the alarm at the MFD. So
  // if we haven't seen a refresh in the last 5 seconds, consider it
  // cleared by the operator and hide the panel.
  const now = Date.now();
  const visible = alerts.filter(
    (a) => a.state !== 'Normal' && a.state !== 'Disabled' && now - a.lastSeenMs < 5000,
  );
  if (visible.length === 0) return null;

  const acknowledge = async (key: string): Promise<void> => {
    setError(null);
    setBusyKey(key);
    try {
      const r = await fetch('/api/alerts/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, command: 'Acknowledge' }),
      });
      const j = (await r.json()) as { ok: boolean; error?: { message?: string } };
      if (!j.ok) setError(j.error?.message ?? 'acknowledge failed');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="mb-4 space-y-2">
      {visible.map((a) => {
        const style = ALERT_TYPE_STYLE[a.type] ?? ALERT_TYPE_STYLE.unknown;
        const sub = [
          a.state,
          a.priority !== undefined ? `prio ${a.priority}` : null,
          `src 0x${a.src.toString(16).padStart(2, '0')}`,
          a.category,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={a.key} className={`border rounded p-3 flex items-center gap-3 ${style}`}>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wide opacity-80">
                {a.type}
                {a.text ? <span className="ml-2 normal-case opacity-100">{a.text}</span> : null}
              </div>
              <div className="text-[10px] opacity-70 mt-0.5 font-mono">{sub}</div>
              {a.location && <div className="text-[10px] opacity-70 italic">{a.location}</div>}
            </div>
            <button
              type="button"
              disabled={busyKey === a.key || a.acknowledgeSupport === false}
              onClick={() => void acknowledge(a.key)}
              className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-900 rounded hover:bg-white disabled:opacity-40"
              title={
                a.acknowledgeSupport === false
                  ? "Issuer doesn't support Acknowledge for this alert"
                  : 'Send PGN 126984 Alert Response to clear'
              }
            >
              {busyKey === a.key ? 'Sending…' : 'Clear'}
            </button>
          </div>
        );
      })}
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}
