import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages that must not be bundled by Next.js. @g5000/db wraps
  // better-sqlite3 (native addon, cannot be bundled). @g5000/grib will shell
  // out to wgrib2 and read files from disk; bundling adds nothing and
  // complicates worker/child_process behavior. The other workspace deps are
  // listed for consistency so the router never accidentally double-bundles
  // their internals.
  serverExternalPackages: [
    '@g5000/db',
    '@g5000/compute',
    '@g5000/grib',
    '@g5000/coastline',
    '@g5000/routing',
  ],
  experimental: {
    externalDir: true,
  },
};

export default config;
