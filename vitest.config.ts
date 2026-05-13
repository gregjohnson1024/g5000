import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/*/test/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
      'apps/*/test/**/*.test.{ts,tsx}',
    ],
    coverage: { provider: 'v8' },
    pool: 'forks',
  },
});
