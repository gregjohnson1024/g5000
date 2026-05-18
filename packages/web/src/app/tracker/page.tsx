interface TrackerSource {
  name: string;
  url: string;
  description: string;
}

const TRACKERS: TrackerSource[] = [
  {
    name: 'PredictWind',
    url: 'https://forecast.predictwind.com/tracking/display/Sula_Bassana/',
    description: "Sula Bassana passage track + boat data from the boat's PredictWind subscription",
  },
  {
    name: 'Garmin inReach',
    url: 'https://share.garmin.com/9PWOE',
    description: 'Satellite tracking via Iridium — independent of WiFi/cellular',
  },
];

export default function TrackerPage() {
  return (
    <main className="p-4 min-h-screen bg-black">
      <div className="flex items-baseline justify-between mb-3">
        <h1 className="text-xl font-semibold text-slate-300">Tracker</h1>
        <div className="text-xs text-slate-500 font-mono">
          External trackers · refresh independently of the on-boat instruments
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-[calc(100vh-7rem)]">
        {TRACKERS.map((t) => (
          <section
            key={t.name}
            className="flex flex-col bg-slate-900 border border-slate-800 rounded overflow-hidden"
          >
            <header className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-950">
              <div>
                <div className="text-sm font-semibold text-slate-100">{t.name}</div>
                <div className="text-[11px] text-slate-500">{t.description}</div>
              </div>
              <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                title="Open this tracker in a new tab — useful if the embed blocks framing"
              >
                Open ↗
              </a>
            </header>
            <iframe
              src={t.url}
              title={`${t.name} tracker for Sula Bassana`}
              className="flex-1 w-full bg-white"
              // Loosen sandbox a bit so the embedded pages can render maps,
              // make network calls, and run their own scripts. Both PredictWind
              // and Garmin inReach Share require allow-scripts and
              // allow-same-origin to function.
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer-when-downgrade"
              loading="lazy"
            />
          </section>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-slate-600">
        If a panel shows blank, the provider may be blocking embeds via{' '}
        <code className="text-slate-500">X-Frame-Options</code> /{' '}
        <code className="text-slate-500">frame-ancestors</code>. Use the
        &ldquo;Open ↗&rdquo; button to view directly.
      </div>
    </main>
  );
}
