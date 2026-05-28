// Garmin inReach Share was tried as a second tracker but didn't render
// reliably inside an iframe (Leaflet pre-mount errors, broken controls).
// Keeping just PredictWind, which works cleanly.
const PW = {
  name: 'PredictWind',
  url: 'https://forecast.predictwind.com/tracking/display/Sula_Bassana/',
  description: "Sula Bassana passage track + boat data from the boat's PredictWind subscription",
};

export default function TrackerPage() {
  return (
    <main className="p-4 flex-1 min-h-0 bg-black flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <h1 className="text-xl font-semibold text-slate-300">Tracker</h1>
        <div className="text-xs text-slate-500 font-mono">
          External tracker · refreshes independently of the on-boat instruments
        </div>
      </div>

      <section className="flex-1 flex flex-col bg-slate-900 border border-slate-800 rounded overflow-hidden">
        <header className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-950">
          <div>
            <div className="text-sm font-semibold text-slate-100">{PW.name}</div>
            <div className="text-[11px] text-slate-500">{PW.description}</div>
          </div>
          <a
            href={PW.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            title="Open the tracker in a new tab — useful if the embed misbehaves"
          >
            Open ↗
          </a>
        </header>
        <iframe
          src={PW.url}
          title={`${PW.name} tracker for Sula Bassana`}
          className="flex-1 w-full bg-white"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          referrerPolicy="no-referrer-when-downgrade"
          loading="lazy"
        />
      </section>
    </main>
  );
}
