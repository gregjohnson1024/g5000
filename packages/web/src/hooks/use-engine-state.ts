'use client';
import { useEffect, useState } from 'react';

/** Polls GET /api/boat-state; true if either engine is annotated running. */
export function useEngineState(pollMs = 5000): boolean {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch('/api/boat-state');
        const json = (await res.json()) as {
          boatState?: {
            engines?: { port?: { running?: boolean }; starboard?: { running?: boolean } };
          };
        };
        const e = json.boatState?.engines;
        if (alive) setRunning(Boolean(e?.port?.running || e?.starboard?.running));
      } catch {
        /* keep last value */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return running;
}
