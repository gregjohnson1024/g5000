import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Allow consuming the bus singleton from a parent process when integrated
    // via custom server in Task 13.
    externalDir: true,
  },
};

export default config;
