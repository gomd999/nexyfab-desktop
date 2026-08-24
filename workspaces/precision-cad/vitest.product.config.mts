import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Scope-owned runner for product tests under domains without changing the root config. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['domains/**/*.test.ts'],
    maxWorkers: 4,
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '../..', 'src'),
    },
  },
});
