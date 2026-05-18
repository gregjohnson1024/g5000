'use client';

import { useEffect, useRef, useState } from 'react';

const MUTE_KEY = 'g5000.race-audible.muted';

interface Beep {
  freq: number;
  durMs: number;
  type: OscillatorType;
}
const TONE_MINUTE: Beep = { freq: 660, durMs: 200, type: 'square' };
const TONE_MINUTE_LAST: Beep = { freq: 660, durMs: 400, type: 'square' };
const TONE_SECOND: Beep = { freq: 880, durMs: 100, type: 'sine' };
const TONE_LAST5: Beep = { freq: 880, durMs: 80, type: 'sine' };
const TONE_GUN: Beep = { freq: 1320, durMs: 600, type: 'sine' };

// Each threshold = seconds-to-gun at which we fire `tone`. Strictly descending.
const SCHEDULE: Array<{ atSec: number; tone: Beep }> = [
  { atSec: 300, tone: TONE_MINUTE },
  { atSec: 240, tone: TONE_MINUTE },
  { atSec: 180, tone: TONE_MINUTE },
  { atSec: 120, tone: TONE_MINUTE },
  { atSec: 60, tone: TONE_MINUTE_LAST },
  { atSec: 30, tone: TONE_SECOND },
  { atSec: 20, tone: TONE_SECOND },
  { atSec: 10, tone: TONE_SECOND },
  { atSec: 5, tone: TONE_LAST5 },
  { atSec: 4, tone: TONE_LAST5 },
  { atSec: 3, tone: TONE_LAST5 },
  { atSec: 2, tone: TONE_LAST5 },
  { atSec: 1, tone: TONE_LAST5 },
  { atSec: 0, tone: TONE_GUN },
];

export function RaceAudible(): React.ReactElement {
  const [muted, setMuted] = useState(false);
  const [startMs, setStartMs] = useState<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const firedRef = useRef<Set<number>>(new Set());
  const lastStartMsRef = useRef<number | null>(null);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === '1');
  }, []);

  // Warm AudioContext on first user interaction.
  useEffect(() => {
    function warm(): void {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext ??
          (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) ctxRef.current = new Ctx();
      }
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    }
    window.addEventListener('pointerdown', warm);
    window.addEventListener('keydown', warm);
    return () => {
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    };
  }, []);

  // Poll race state for startMs.
  useEffect(() => {
    let stopped = false;
    async function poll(): Promise<void> {
      try {
        const r = await fetch('/api/race/state', { cache: 'no-store' });
        if (stopped || !r.ok) return;
        const j = await r.json();
        setStartMs(j.timer.startMs);
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

  // 100 ms tick — check schedule and fire any thresholds we just crossed.
  useEffect(() => {
    if (startMs === null) {
      firedRef.current.clear();
      lastStartMsRef.current = null;
      return;
    }
    if (lastStartMsRef.current !== startMs) {
      // New race — reset fired set.
      firedRef.current.clear();
      lastStartMsRef.current = startMs;
    }
    const id = setInterval(() => {
      if (muted || !ctxRef.current) return;
      const secsToGun = (startMs - Date.now()) / 1000;
      for (const { atSec, tone } of SCHEDULE) {
        if (firedRef.current.has(atSec)) continue;
        // Fire when secsToGun has just crossed atSec from above.
        // ±100 ms tolerance per tick.
        if (secsToGun <= atSec + 0.05 && secsToGun > atSec - 0.15) {
          fire(ctxRef.current, tone);
          firedRef.current.add(atSec);
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, [startMs, muted]);

  function toggleMute(): void {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  }

  return (
    <button
      type="button"
      onClick={toggleMute}
      className={`px-3 py-2 rounded text-sm font-mono ${muted ? 'bg-red-700 text-white' : 'bg-gray-200 text-gray-800'}`}
      title={muted ? 'Race countdown beeps MUTED' : 'Race countdown beeps on'}
    >
      {muted ? '🔇 Race muted' : '🔊 Race audio'}
    </button>
  );
}

function fire(ctx: AudioContext, t: Beep): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = t.type;
  osc.frequency.value = t.freq;
  osc.connect(gain).connect(ctx.destination);
  gain.gain.value = 0.15;
  osc.start();
  setTimeout(() => {
    try {
      osc.stop();
    } catch {
      /* ignored */
    }
    osc.disconnect();
    gain.disconnect();
  }, t.durMs);
}
