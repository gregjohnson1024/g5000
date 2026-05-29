import { useEffect, useRef, useState } from 'react';

/**
 * Lazy-initialised AudioContext + continuous klaxon. While any threat is
 * present (and alarm is enabled), plays a two-tone square-wave klaxon —
 * 800 Hz / 600 Hz alternating at 4 Hz — through a soft-knee compressor at
 * near-clipping gain. Stops the moment the threat set goes empty. Respects
 * browser autoplay policies by deferring AudioContext creation until first
 * user interaction (the "Arm audio" button).
 */
export function useThreatAudio(
  threatMmsis: Set<number>,
  enabled: boolean,
): { armed: boolean; arm: () => void; test: (durationMs?: number) => void; testing: boolean } {
  const ctxRef = useRef<AudioContext | null>(null);
  const klaxonRef = useRef<{
    osc: OscillatorNode;
    gain: GainNode;
    toneTimer: ReturnType<typeof setInterval>;
  } | null>(null);
  const [armed, setArmed] = useState(false);
  const [testing, setTesting] = useState(false);
  const testTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = () => {
    if (ctxRef.current) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      ctxRef.current = ctx;
      // Safari (and some Chromium builds) instantiate AudioContext in
      // `suspended` state even when constructed inside a user gesture.
      // resume() inside the same gesture unblocks it.
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      setArmed(true);
    } catch {
      /* AudioContext not available; alarm stays visual-only */
    }
  };

  const startKlaxon = (): void => {
    const ctx = ctxRef.current;
    if (!ctx || klaxonRef.current) return;
    // Soft-knee compressor pre-stage so peaks don't clip and average loudness
    // is pushed up. After compression a master gain at 0.95 is just shy of
    // clipping; the OS / browser volume control is the final ceiling.
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
    // Two-tone alternation: 800 / 600 Hz at 4 Hz (125 ms per tone). Browser
    // setInterval has 4–10 ms jitter — fine for a klaxon.
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

  useEffect(() => {
    // Gate on `armed` (state) rather than `ctxRef.current` (ref) so React
    // knows to re-run this effect when the user clicks "Arm audio". Refs
    // are invisible to the deps array.
    if (!armed) {
      stopKlaxon();
      return;
    }
    // Test mode bypasses the alarm-enabled gate so a "Test alarm" press
    // always sounds, even when the alarm is OFF. Real threats still respect
    // the gate. If both are true the klaxon just stays playing.
    if (testing || (enabled && threatMmsis.size > 0)) {
      startKlaxon();
    } else {
      stopKlaxon();
    }
  }, [threatMmsis, enabled, testing, armed]);

  // Cleanup on unmount — otherwise the klaxon survives a hot reload.
  useEffect(() => {
    return () => {
      stopKlaxon();
      if (testTimerRef.current) clearTimeout(testTimerRef.current);
    };
  }, []);

  const test = (durationMs = 3000): void => {
    if (!ctxRef.current) return;
    if (testTimerRef.current) clearTimeout(testTimerRef.current);
    setTesting(true);
    testTimerRef.current = setTimeout(() => {
      setTesting(false);
      testTimerRef.current = null;
    }, durationMs);
  };

  return { armed, arm, test, testing };
}
