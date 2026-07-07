'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSse } from '../../../hooks/use-sse';
import { fmtLatLonDmm } from '../../../lib/coords';

interface LineEnd {
  lat: number;
  lon: number;
  pingedAt: string;
}
interface LineSnap {
  port?: LineEnd;
  stbd?: LineEnd;
  preStartSide?: 'port' | 'stbd';
}

/**
 * Returns Tailwind token class strings for a start-line end button.
 *
 * Marine-correct assignment:
 *   port  → red  (--color-port)
 *   stbd  → green (--color-stbd)
 *
 * Night theme: both resolve to red-family values; P/S encoded by
 * the word label glyph ("Port" / "Stbd"), not hue.
 */
export function portStbdToken(end: 'port' | 'stbd'): { bg: string; hover: string; text: string } {
  if (end === 'port') {
    return { bg: 'bg-port/30', hover: 'hover:bg-port/50', text: 'text-port' };
  }
  return { bg: 'bg-stbd/30', hover: 'hover:bg-stbd/50', text: 'text-stbd' };
}

export function LinePingPanel(): React.ReactElement {
  const [line, setLine] = useState<LineSnap>({});
  const [confirming, setConfirming] = useState(false);
  /** Inline error state — replaces window.alert for the no-GPS path. */
  const [noGpsEnd, setNoGpsEnd] = useState<'port' | 'stbd' | null>(null);
  const { channels } = useSse();

  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setLine(j.line ?? {});
      } catch {
        /* retry */
      }
    }
    void poll();
    const id = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const ping = useCallback(
    async (end: 'port' | 'stbd') => {
      const pos = channels.get('nav.gps.position');
      if (!pos || pos.value.kind !== 'geo') {
        // Show an inline error chip instead of window.alert
        setNoGpsEnd(end);
        // Auto-clear after 4 s so it doesn't linger on glance surface
        setTimeout(() => setNoGpsEnd(null), 4000);
        return;
      }
      setNoGpsEnd(null);
      const position = pos.value.value;
      // Boat position at ping time matches the ping position itself for the
      // common case (you're standing at the end). The /api/race/line handler
      // uses boatPos to determine preStartSide on the second ping.
      await fetch('/api/race/line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping', end, position, boatPos: position }),
      });
      const r = await fetch('/api/race/state', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setLine(j.line ?? {});
      }
    },
    [channels],
  );

  const clear = useCallback(async () => {
    await fetch('/api/race/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    });
    setConfirming(false);
    setLine({});
  }, []);

  const portTok = portStbdToken('port');
  const stbdTok = portStbdToken('stbd');

  return (
    <div className="bg-surface border border-hairline rounded-[var(--r-panel)] p-4 flex flex-col gap-3">
      <div className="text-xs uppercase tracking-wider text-ink-2">Start line</div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void ping('port')}
          className={[
            portTok.bg,
            portTok.hover,
            portTok.text,
            'border border-port/60',
            'rounded-[var(--r-control)] p-4 text-lg font-semibold',
          ].join(' ')}
        >
          Ping Port End
          {line.port && (
            <div className="text-xs font-mono font-normal mt-1 opacity-80">
              {fmtLatLonDmm(line.port.lat, line.port.lon)}
            </div>
          )}
        </button>
        <button
          type="button"
          onClick={() => void ping('stbd')}
          className={[
            stbdTok.bg,
            stbdTok.hover,
            stbdTok.text,
            'border border-stbd/60',
            'rounded-[var(--r-control)] p-4 text-lg font-semibold',
          ].join(' ')}
        >
          Ping Stbd End
          {line.stbd && (
            <div className="text-xs font-mono font-normal mt-1 opacity-80">
              {fmtLatLonDmm(line.stbd.lat, line.stbd.lon)}
            </div>
          )}
        </button>
      </div>

      {/* Inline no-GPS error — replaces window.alert on a glance surface */}
      {noGpsEnd !== null && (
        <div
          role="alert"
          className="text-xs font-mono text-danger bg-danger-surface border border-danger-strong rounded-[var(--r-badge)] px-3 py-1.5"
        >
          No GPS position — cannot ping {noGpsEnd} end
        </div>
      )}

      {line.port && line.stbd && !line.preStartSide && (
        <div className="text-xs text-accent font-mono">
          motor off the line — pre-start side will set automatically
        </div>
      )}
      {line.preStartSide && (
        <div className="text-xs text-ink-2 font-mono">pre-start side: {line.preStartSide}</div>
      )}
      {(line.port || line.stbd) && (
        <>
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="self-end text-xs text-danger underline"
            >
              Clear line
            </button>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-danger">Clear both ends?</span>
              <button
                type="button"
                onClick={() => void clear()}
                className="text-xs px-2 py-1 bg-danger-strong text-ink-value rounded-[var(--r-control)]"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs px-2 py-1 bg-surface-raised text-ink rounded-[var(--r-control)]"
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
