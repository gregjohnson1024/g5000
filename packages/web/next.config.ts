import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // @h6000/core and @h6000/db must not be bundled by Next.js. Both host
  // process-level singletons (shared bus, ConfigStore) that autopilot-server
  // sets before Next boots. Bundling them creates a second module instance
  // and the route handler sees a null singleton. @h6000/db also depends on
  // better-sqlite3 (native addon), which cannot be bundled regardless.
  serverExternalPackages: ['@h6000/core', '@h6000/db', '@h6000/compute'],
  experimental: {
    // Allow consuming the bus singleton from a parent process when integrated
    // via custom server in Task 13.
    externalDir: true,
  },
};

export default config;
