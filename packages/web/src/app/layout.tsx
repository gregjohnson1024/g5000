import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { NavShell } from './NavShell';
import { AlarmAudio } from '../components/AlarmAudio';
import { AlarmStore } from '../components/AlarmStore';
import { StorageMigrationGate } from '../components/StorageMigrationGate';
import { SseStoreProvider } from '../components/SseStoreProvider';
import { ThemeController } from '../components/ThemeController';
import { ThemeStoreProvider } from '../lib/theme-store';
import { Takeover } from '../components/ui/Takeover';

export const metadata: Metadata = {
  title: 'G5000',
  description: 'Performance instrument processor',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Read env at render time so /ais and friends can be removed per-host
// via Pi systemd Environment= lines without rebuilding.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  const hiddenHrefs: string[] = [];
  if (process.env.G5000_HIDE_AIS === '1') hiddenHrefs.push('/ais');

  return (
    <html lang="en">
      <head>
        {/*
         * Pre-hydration theme script: reads g5000:theme from localStorage and
         * sets data-theme on <html> synchronously before React hydrates. This
         * eliminates the default-day flash on subsequent page loads when a
         * non-day theme is persisted. The script is intentionally tiny and
         * inlined — no external file, no React dependency.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('g5000:theme');if(t==='night'||t==='sun')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-screen flex flex-col">
        <SseStoreProvider>
          {/*
           * ThemeStoreProvider holds the shared theme state (current theme +
           * setTheme). ThemeController reads from it to push SSE-received
           * boat-wide theme changes into the store. NavShell's ThemeChip reads
           * from it to display + cycle the theme. Must wrap ThemeController.
           */}
          <ThemeStoreProvider>
            <StorageMigrationGate />
            {/*
             * ThemeController owns the /api/mast/stream SSE subscription and
             * forwards boat-wide theme pushes into the shared ThemeStore.
             * It renders nothing — the AppBar ThemeChip is the UI.
             */}
            <ThemeController />
            {/*
             * AlarmStore mounts ONE /api/alarms poll (via usePoll) and exposes
             * the derived state through useAlarms(). All consumers — AlarmAudio,
             * NavShell (AlarmLane + bell), AlarmBanner — read from this context
             * instead of running independent fetches.
             */}
            <AlarmStore>
              <AlarmAudio />
              <NavShell hiddenHrefs={hiddenHrefs} />
              {children}
              {/*
               * Takeover mounts as a sibling of NavShell and children so it
               * can consume useAlarms() from the enclosing <AlarmStore>.
               * z-[200] places it above all page content, NavShell (z-50),
               * and Dialogs (z-50). Renders null when no CRITICAL qualifier
               * alarm is active — zero overhead during normal operation.
               */}
              <Takeover />
            </AlarmStore>
          </ThemeStoreProvider>
        </SseStoreProvider>
      </body>
    </html>
  );
}
