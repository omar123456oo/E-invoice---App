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
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/scripts/**'] },
  },
});
