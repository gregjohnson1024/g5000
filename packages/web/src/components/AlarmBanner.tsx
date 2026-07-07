'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, Volume2, VolumeX } from 'lucide-react';
import { AUDIO_ENABLED_KEY, AUDIO_TOGGLE_EVENT } from './AlarmAudio';
import { useAlarms } from './AlarmStore';

export function AlarmBanner() {
  const [audioOn, setAudioOn] = useState(true);

  // Mirror the audible-alarm preference owned by AlarmAudio (default on).
  useEffect(() => {
    setAudioOn(localStorage.getItem(AUDIO_ENABLED_KEY) !== '0');
  }, []);

  // Read from shared AlarmStore (no second poll).
  const { active } = useAlarms();
  const topAlarm = active[0] ?? null;
  const extraCount = Math.max(0, active.length - 1);

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
    <Link
      href="/alerts"
      className={`flex w-full items-center ${bg} text-white px-4 py-2 text-sm font-semibold sticky top-0 z-50`}
    >
      <span className="flex items-center gap-2 flex-1">
        <AlertTriangle size={16} strokeWidth={2} aria-hidden className="shrink-0" />
        {topAlarm.label}
        {extraCount > 0 && <span className="ml-1 opacity-80">(+{extraCount} more)</span>}
      </span>
      <button
        type="button"
        onClick={toggleAudio}
        title={audioOn ? 'Mute alarm sound' : 'Unmute alarm sound'}
        aria-label={audioOn ? 'Mute alarm sound' : 'Unmute alarm sound'}
        className="ml-3 shrink-0 rounded px-2 py-0.5 hover:bg-black/20 flex items-center"
      >
        {audioOn ? (
          <Volume2 size={16} strokeWidth={2} aria-hidden />
        ) : (
          <VolumeX size={16} strokeWidth={2} aria-hidden />
        )}
      </button>
    </Link>
  );
}
