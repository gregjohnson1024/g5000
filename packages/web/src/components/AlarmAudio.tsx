'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Global audible alarm, mounted once in the root layout. Polls /api/alarms
 * every 2 s; while any ACTIVE unacked alarm exists it sounds through a lazily
 * created AudioContext (same klaxon recipe as /ais's use-threat-audio):
 *
 *   - CRITICAL → continuous two-tone square-wave klaxon (800/600 Hz at 4 Hz)
 *   - WARN     → short chirp roughly once per 2 s
 *
 * Browser autoplay policy means the AudioContext can only start after a user
 * gesture, so we arm on the first document pointerdown/keydown. The speaker
 * on/off toggle lives in AlarmBanner (localStorage 'alarms:audio-enabled');
 * it dispatches 'alarms:audio-toggle' so this component reacts immediately.
 */

export const AUDIO_ENABLED_KEY = 'alarms:audio-enabled';
export const AUDIO_TOGGLE_EVENT = 'alarms:audio-toggle';

interface AlarmRow {
  id: string;
  severity: 'CRITICAL' | 'WARN' | 'INFO';
}

type SoundMode = 'CRITICAL' | 'WARN' | null;

export function AlarmAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const klaxonRef = useRef<{
    osc: OscillatorNode;
    gain: GainNode;
    toneTimer: ReturnType<typeof setInterval>;
  } | null>(null);
  const chirpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [armed, setArmed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<SoundMode>(null);

  // Speaker on/off preference — default on; AlarmBanner owns the toggle UI.
  useEffect(() => {
    const read = () => setEnabled(localStorage.getItem(AUDIO_ENABLED_KEY) !== '0');
    read();
    window.addEventListener(AUDIO_TOGGLE_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(AUDIO_TOGGLE_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);

  // Arm the AudioContext on the first user gesture (autoplay policy).
  useEffect(() => {
    const arm = () => {
      document.removeEventListener('pointerdown', arm);
      document.removeEventListener('keydown', arm);
      if (ctxRef.current) return;
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctor();
        // Safari (and some Chromium builds) instantiate AudioContext in
        // `suspended` state even inside a user gesture; resume() unblocks it.
        if (ctx.state === 'suspended') {
          void ctx.resume();
        }
        ctxRef.current = ctx;
        setArmed(true);
      } catch {
        /* AudioContext not available; alarms stay visual-only */
      }
    };
    document.addEventListener('pointerdown', arm);
    document.addEventListener('keydown', arm);
    return () => {
      document.removeEventListener('pointerdown', arm);
      document.removeEventListener('keydown', arm);
    };
  }, []);

  // Poll the active alarm set; the worst severity picks the sound.
  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms', { cache: 'no-store' });
        if (stopped) return;
        const body = await r.json();
        const active = (body.active ?? []) as AlarmRow[];
        if (active.some((a) => a.severity === 'CRITICAL')) setMode('CRITICAL');
        else if (active.some((a) => a.severity === 'WARN')) setMode('WARN');
        else setMode(null);
      } catch {
        // transient
      }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  const startKlaxon = (): void => {
    const ctx = ctxRef.current;
    if (!ctx || klaxonRef.current) return;
    // Soft-knee compressor pre-stage so peaks don't clip and average loudness
    // is pushed up; master gain 0.95 sits just shy of clipping.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 6;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.1;
    const master = ctx.createGain();
    master.gain.value = 0.95;
    const osc = ctx.createOscillator();
    osc.type = 'square'; // harsher than sine → louder perceived volume
    osc.frequency.value = 800;
    osc.connect(compressor).connect(master).connect(ctx.destination);
    osc.start();
    // Two-tone alternation: 800 / 600 Hz at 4 Hz (125 ms per tone).
    let toggle = false;
    const toneTimer = setInterval(() => {
      toggle = !toggle;
      osc.frequency.setValueAtTime(toggle ? 600 : 800, ctx.currentTime);
    }, 125);
    klaxonRef.current = { osc, gain: master, toneTimer };
  };

  const stopKlaxon = (): void => {
    const k = klaxonRef.current;
    if (!k) return;
    clearInterval(k.toneTimer);
    try {
      k.osc.stop();
      k.osc.disconnect();
      k.gain.disconnect();
    } catch {
      /* already stopped */
    }
    klaxonRef.current = null;
  };

  const chirpOnce = (): void => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  };

  const startChirp = (): void => {
    if (chirpTimerRef.current) return;
    chirpOnce();
    chirpTimerRef.current = setInterval(chirpOnce, 2000);
  };

  const stopChirp = (): void => {
    if (!chirpTimerRef.current) return;
    clearInterval(chirpTimerRef.current);
    chirpTimerRef.current = null;
  };

  useEffect(() => {
    if (!armed || !enabled || mode === null) {
      stopKlaxon();
      stopChirp();
      return;
    }
    if (mode === 'CRITICAL') {
      stopChirp();
      startKlaxon();
    } else {
      stopKlaxon();
      startChirp();
    }
  }, [armed, enabled, mode]);

  // Cleanup on unmount — otherwise the klaxon survives a hot reload.
  useEffect(() => {
    return () => {
      stopKlaxon();
      stopChirp();
    };
  }, []);

  return null;
}
