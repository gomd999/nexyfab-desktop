/**
 * Local vitest config for occt-worker. Without this, vitest walks up
 * and picks the parent (NexyFab main app) config — which loads React
 * plugins + a setup file that doesn't exist here.
 *
 * Scope: Node env, src/**, no setup files needed. Worker-thread spawns
 * happen in tests against ./src/pool/__fixtures__/echoWorker.ts.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    teardownTimeout: 15_000,
    reporters: process.env.CI ? ['default'] : ['verbose'],
  },
});
