import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // Phase-2 Task 2f: /ais absorbed as chart AIS lens
      { source: '/ais', destination: '/chart?lens=ais', permanent: true },
      // Phase-2 route-move: SAIL section (Task 2a)
      { source: '/helm', destination: '/sail', permanent: true },
      { source: '/race', destination: '/sail/race', permanent: true },
      { source: '/autopilot', destination: '/sail/autopilot', permanent: true },
      // Phase-2 route-move: CONDITIONS section (Task 2b)
      { source: '/forecast', destination: '/conditions', permanent: true },
      { source: '/tide', destination: '/conditions/tides', permanent: true },
      // Real legacy route was /tides (plural); keep both spellings covered
      { source: '/tides', destination: '/conditions/tides', permanent: true },
      { source: '/currents', destination: '/conditions/currents', permanent: true },
      { source: '/grib', destination: '/conditions/models', permanent: true },
      { source: '/window', destination: '/conditions/windows', permanent: true },
      // Phase-2 route-move: VOYAGE section (Task 2c)
      // passage → /voyage (primary, depth-neutral; EnginePanel co-moved)
      { source: '/passage', destination: '/voyage', permanent: true },
      // tracker → /voyage/tracker
      { source: '/tracker', destination: '/voyage/tracker', permanent: true },
      // Plan unification: waypoints wins (richest: full CRUD + GPX import/export + coord parsing)
      // routes and marks-and-routes both redirect to /voyage/plan
      { source: '/waypoints', destination: '/voyage/plan', permanent: true },
      { source: '/routes', destination: '/voyage/plan', permanent: true },
      { source: '/marks-and-routes', destination: '/voyage/plan', permanent: true },
      // Logbook unification: trips wins (StatCard grammar, day-grouped feed per proposal)
      // tracks and log both redirect to /voyage/logbook
      { source: '/trips', destination: '/voyage/logbook', permanent: true },
      { source: '/tracks', destination: '/voyage/logbook', permanent: true },
      { source: '/log', destination: '/voyage/logbook', permanent: true },
      // Phase-2 route-move: BOAT Diagnostics (Task 2e)
      { source: '/wind-diag', destination: '/boat/diag/wind', permanent: true },
      { source: '/devices', destination: '/boat/diag/devices', permanent: true },
      { source: '/sensors', destination: '/boat/diag/sensors', permanent: true },
      { source: '/sniff', destination: '/boat/diag/sniff', permanent: true },
      { source: '/inspect', destination: '/boat/diag/inspect', permanent: true },
      { source: '/sessions', destination: '/boat/diag/sessions', permanent: true },
      { source: '/logs', destination: '/boat/diag/logs', permanent: true },
      // Phase-2 route-move: BOAT section (Task 2d)
      // Performance — most-specific first
      { source: '/polars', destination: '/boat/polars', permanent: true },
      { source: '/sails/crossover', destination: '/boat/crossover', permanent: true },
      { source: '/sails', destination: '/boat/sails', permanent: true },
      // Setup hub + legacy sub-pages
      { source: '/settings', destination: '/boat/setup', permanent: true },
      { source: '/mast-config', destination: '/boat/setup/displays', permanent: true },
      { source: '/damping', destination: '/boat/setup/damping', permanent: true },
      // Calibration leaves
      { source: '/calibration/wind', destination: '/boat/setup/cal/wind', permanent: true },
      { source: '/calibration/bsp', destination: '/boat/setup/cal/bsp', permanent: true },
      {
        source: '/calibration/compass',
        destination: '/boat/setup/cal/compass',
        permanent: true,
      },
    ];
  },
  // @g5000/core and @g5000/db must not be bundled by Next.js. Both host
  // process-level singletons (shared bus, ConfigStore) that g5000 app
  // sets before Next boots. Bundling them creates a second module instance
  // and the route handler sees a null singleton. @g5000/db also depends on
  // better-sqlite3 (native addon), which cannot be bundled regardless.
  serverExternalPackages: [
    '@g5000/core',
    '@g5000/db',
    '@g5000/compute',
    '@g5000/bridge',
    // canboatjs has a conditional require('md' + 'ns') in venus-mqtt.js
    // that defeats static bundler analysis but trips Turbopack's resolver.
    // Letting Node resolve canboatjs at runtime sidesteps the issue.
    '@canboat/canboatjs',
  ],
  experimental: {
    // Allow consuming the bus singleton from a parent process when integrated
    // via custom server in Task 13.
    externalDir: true,
    // When an error lands while a client-side navigation is in flight
    // (post-deploy stale chunk, dropped wifi), hard-navigate to the clicked
    // destination instead of rendering an error card. Complements the
    // stale-build auto-reload in app/error.tsx / app/global-error.tsx.
    appNavFailHandling: true,
  },
};

export default config;
