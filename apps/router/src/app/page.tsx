import { Map } from '../components/Map';
import { StatusBadge } from '../components/StatusBadge';

export default function HomePage() {
  return (
    <main className="grid grid-cols-[1fr_360px] h-screen">
      <Map center={{ lat: 35, lon: -70 }} zoom={4} />
      <aside className="p-4 border-l border-slate-800 space-y-4">
        <StatusBadge />
        <div className="text-slate-400 text-sm">
          Click on the map to set start / end. Wiring controls in Task 31.
        </div>
      </aside>
    </main>
  );
}
