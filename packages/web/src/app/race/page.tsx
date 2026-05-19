'use client';

import { RaceTimer } from './RaceTimer';
import { RaceAudible } from './RaceAudible';
import { LinePingPanel } from './LinePingPanel';
import { ActiveMarkSelector } from './ActiveMarkSelector';
import { RaceSettings } from './RaceSettings';
import { WindShiftPlot } from '../../components/WindShiftPlot';

export default function RacePage(): React.ReactElement {
  return (
    <main className="p-4 min-h-screen bg-black">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-slate-300">Race</h1>
        <RaceAudible />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
        <div className="md:col-span-2">
          <RaceTimer />
        </div>
        <LinePingPanel />
        <ActiveMarkSelector />
        <div className="md:col-span-2">
          <WindShiftPlot />
        </div>
        <div className="md:col-span-2">
          <RaceSettings />
        </div>
      </div>
    </main>
  );
}
