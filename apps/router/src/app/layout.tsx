import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'g5000 Weather Router',
  description: 'GRIB-driven passage planner',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 h-screen flex flex-col">
        <nav className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 flex items-center gap-4 text-sm">
          <Link href="/" className="font-semibold text-amber-300 hover:text-amber-200">
            g5000 router
          </Link>
          <Link href="/" className="text-slate-300 hover:text-amber-200">
            Chart
          </Link>
          <Link href="/forecast" className="text-slate-300 hover:text-amber-200">
            Forecast
          </Link>
          <Link href="/waypoints" className="text-slate-300 hover:text-amber-200">
            Waypoints
          </Link>
          <Link href="/tracks" className="text-slate-300 hover:text-amber-200">
            Tracks
          </Link>
          <Link href="/plans" className="text-slate-300 hover:text-amber-200">
            Plans
          </Link>
          <Link href="/window" className="text-slate-300 hover:text-amber-200">
            Window
          </Link>
          <Link href="/grib" className="text-slate-300 hover:text-amber-200">
            GRIB
          </Link>
          <Link href="/settings" className="text-slate-300 hover:text-amber-200">
            Settings
          </Link>
        </nav>
        <div className="flex-1 min-h-0 overflow-auto">{children}</div>
      </body>
    </html>
  );
}
