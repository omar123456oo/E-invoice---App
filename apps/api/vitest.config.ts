import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/scripts/**'],
      // Floor at the level measured on 2026-10-19 (vitest 5); raise it as coverage improves, never lower it.
      thresholds: { lines: 79, statements: 74, branches: 64, functions: 75 },
    },
  },
});
