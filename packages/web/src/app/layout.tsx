import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Navbar } from './Navbar';
import { AlarmBanner } from '../components/AlarmBanner';
import { AlarmAudio } from '../components/AlarmAudio';
import { StorageMigrationGate } from '../components/StorageMigrationGate';
import { SseStoreProvider } from '../components/SseStoreProvider';
import { ThemeController } from '../components/ThemeController';

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
          <StorageMigrationGate />
          <ThemeController />
          <AlarmBanner />
          <AlarmAudio />
          <Navbar hiddenHrefs={hiddenHrefs} />
          {children}
        </SseStoreProvider>
      </body>
    </html>
  );
}
