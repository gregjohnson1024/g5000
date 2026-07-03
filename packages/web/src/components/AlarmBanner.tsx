'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { AUDIO_ENABLED_KEY, AUDIO_TOGGLE_EVENT } from './AlarmAudio';

interface AlarmRow {
  id: string;
  severity: 'CRITICAL' | 'WARN' | 'INFO';
  label: string;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARN: 2, INFO: 1 };

export function AlarmBanner() {
  const [topAlarm, setTopAlarm] = useState<AlarmRow | null>(null);
  const [extraCount, setExtraCount] = useState(0);
  const [audioOn, setAudioOn] = useState(true);

  // Mirror the audible-alarm preference owned by AlarmAudio (default on).
  useEffect(() => {
    setAudioOn(localStorage.getItem(AUDIO_ENABLED_KEY) !== '0');
  }, []);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const r = await fetch('/api/alarms');
        if (stopped) return;
        const body = await r.json();
        const active = (body.active ?? []) as AlarmRow[];
        active.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
        setTopAlarm(active[0] ?? null);
        setExtraCount(Math.max(0, active.length - 1));
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

  if (!topAlarm) return null;

  const bg =
    topAlarm.severity === 'CRITICAL'
      ? 'bg-red-600'
      : topAlarm.severity === 'WARN'
        ? 'bg-yellow-500'
        : 'bg-blue-500';

  const toggleAudio = (e: MouseEvent) => {
    // The toggle sits inside the banner <a>; don't navigate to /alerts.
    e.preventDefault();
    e.stopPropagation();
    const next = !audioOn;
    setAudioOn(next);
    localStorage.setItem(AUDIO_ENABLED_KEY, next ? '1' : '0');
    // Same-tab localStorage writes don't fire 'storage' — nudge AlarmAudio.
    window.dispatchEvent(new Event(AUDIO_TOGGLE_EVENT));
  };

  return (
    <a
      href="/alerts"
      className={`flex w-full items-center ${bg} text-white px-4 py-2 text-sm font-semibold sticky top-0 z-50`}
    >
      <span className="flex-1">
        ⚠ {topAlarm.label}
        {extraCount > 0 && <span className="ml-2 opacity-80">(+{extraCount} more)</span>}
      </span>
      <button
        type="button"
        onClick={toggleAudio}
        title={audioOn ? 'Mute alarm sound' : 'Unmute alarm sound'}
        aria-label={audioOn ? 'Mute alarm sound' : 'Unmute alarm sound'}
        className="ml-3 shrink-0 rounded px-2 py-0.5 text-base leading-none hover:bg-black/20"
      >
        {audioOn ? '🔊' : '🔇'}
      </button>
    </a>
  );
}
