import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['services/fea-worker/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    teardownTimeout: 10_000,
    maxWorkers: 1,
  },
});
