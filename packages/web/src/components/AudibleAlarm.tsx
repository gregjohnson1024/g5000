'use client';

import { useEffect, useRef, useState } from 'react';

const MUTE_KEY = 'g5000.audible-alarm.muted';

export function AudibleAlarm() {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState<'CRITICAL' | 'WARN' | 'INFO' | null>(null);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === '1');
  }, []);

  // Warm the AudioContext on first user interaction (autoplay policy).
  useEffect(() => {
    function warm() {
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

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms');
        if (stopped) return;
        const body = await r.json();
        const top = (body.active ?? [])[0]?.severity ?? null;
        setActive(top);
      } catch {
        // transient
      }
    }
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (muted || !active || !ctxRef.current) return;
    const ctx = ctxRef.current;
    const cfg =
      active === 'CRITICAL'
        ? { freq: 880, type: 'square' as const, onMs: 200, offMs: 200 }
        : active === 'WARN'
          ? { freq: 440, type: 'sine' as const, onMs: 500, offMs: 1000 }
          : { freq: 440, type: 'sine' as const, onMs: 250, offMs: 60_000 };

    function beep() {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cfg.type;
      osc.frequency.value = cfg.freq;
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
      }, cfg.onMs);
    }
    beep();
    intervalRef.current = setInterval(beep, cfg.onMs + cfg.offMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, muted]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  }

  return (
    <button
      onClick={toggleMute}
      className={`fixed bottom-4 left-4 px-3 py-2 rounded text-sm font-mono z-40 ${muted ? 'bg-red-700 text-white' : 'bg-gray-200 text-gray-800'}`}
      title={muted ? 'Audible alarms MUTED — click to unmute' : 'Audible alarms on — click to mute'}
    >
      {muted ? '🔇 MUTED' : '🔊 Audio'}
    </button>
  );
}
