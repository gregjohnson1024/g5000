import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // @g5000/core and @g5000/db must not be bundled by Next.js. Both host
  // process-level singletons (shared bus, ConfigStore) that autopilot-server
  // sets before Next boots. Bundling them creates a second module instance
  // and the route handler sees a null singleton. @g5000/db also depends on
  // better-sqlite3 (native addon), which cannot be bundled regardless.
  serverExternalPackages: ['@g5000/core', '@g5000/db', '@g5000/compute', '@g5000/bridge'],
  experimental: {
    // Allow consuming the bus singleton from a parent process when integrated
    // via custom server in Task 13.
    externalDir: true,
  },
};

export default config;
