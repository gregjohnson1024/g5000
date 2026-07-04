'use client';

import { useEffect, useState } from 'react';
import { ForecastGraphTab } from './tabs/ForecastGraphTab';
import { ForecastTableTab } from './tabs/ForecastTableTab';
import { SolarTab } from './tabs/SolarTab';

type DrawerTab = 'forecast' | 'table' | 'tides' | 'radar' | 'sky' | 'solar';

const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'forecast', label: 'Forecast' },
  { id: 'table', label: 'Table' },
  { id: 'tides', label: 'Tides' },
  { id: 'radar', label: 'Radar' },
  { id: 'sky', label: 'Sky' },
  { id: 'solar', label: 'Solar' },
];

const LS_KEY = 'anchor:drawer';

function readStoredTab(): DrawerTab | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw && TABS.some((t) => t.id === raw)) return raw as DrawerTab;
  } catch {
    /* SSR or private-mode */
  }
  return null;
}

function writeStoredTab(tab: DrawerTab | null): void {
  try {
    if (tab === null) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, tab);
    }
  } catch {
    /* SSR or private-mode */
  }
}

// Default coordinates used when no GPS fix is available yet.
const DEFAULT_LAT = 32.3;
const DEFAULT_LON = -64.7;

export function AnchorDrawer({
  lat,
  lon,
}: {
  lat: number | null;
  lon: number | null;
}): React.ReactElement {
  // Start null (collapsed) for SSR safety; hydrate from localStorage in effect.
  const [activeTab, setActiveTab] = useState<DrawerTab | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setActiveTab(readStoredTab());
    setHydrated(true);
  }, []);

  function handleTabClick(id: DrawerTab): void {
    const next = activeTab === id ? null : id;
    setActiveTab(next);
    writeStoredTab(next);
  }

  const isOpen = hydrated && activeTab !== null;

  const effectiveLat = lat ?? DEFAULT_LAT;
  const effectiveLon = lon ?? DEFAULT_LON;

  function renderTabContent(): React.ReactElement {
    switch (activeTab) {
      case 'forecast':
        return <ForecastGraphTab lat={effectiveLat} lon={effectiveLon} />;
      case 'table':
        return <ForecastTableTab lat={effectiveLat} lon={effectiveLon} />;
      case 'solar':
        return <SolarTab />;
      default:
        return (
          <p className="text-slate-500 text-sm italic">
            {activeTab} content — placeholder (task fills this in)
          </p>
        );
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-slate-950 border-t border-slate-800">
      {/* Slide-up content panel */}
      {isOpen && (
        <div className="border-b border-slate-800 bg-slate-900 px-4 py-4 h-56 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-200 capitalize">{activeTab}</span>
            <button
              type="button"
              aria-label="Collapse drawer"
              onClick={() => handleTabClick(activeTab!)}
              className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
                aria-hidden
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          </div>
          {renderTabContent()}
        </div>
      )}

      {/* Bottom tab bar */}
      <div className="flex">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => handleTabClick(tab.id)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'text-amber-400 bg-slate-900 border-t-2 border-amber-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border-t-2 border-transparent'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
