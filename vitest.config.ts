import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /** Per-test 60s, hooks 30s, teardown 30s. A single test that exceeds 60s is a bug — fail loud, don't hang CI. */
    testTimeout: 60_000,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    /** Whole-suite 15min hard cap. If we ever blow past this it's almost certainly a hang, not real work. */
    bail: 0,
    /** Print slow tests so we can shrink them before they become hang candidates. */
    slowTestThreshold: 5_000,
    reporters: process.env.CI ? ['default'] : ['verbose'],
    /** Ensure single-module resolution for Three peer deps (fixes three-mesh-bvh BVH undefined in Vitest). */
    server: {
      deps: {
        inline: ['three', 'three-mesh-bvh', 'three-bvh-csg'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**', 'src/app/api/**'],
      exclude: ['src/test/**', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      /** Prefer ESM src entries — avoids UMD `require` mixing with internal `src/` imports (fixes BVH undefined). */
      'three-mesh-bvh': path.resolve(__dirname, 'node_modules/three-mesh-bvh/src/index.js'),
      'three-bvh-csg': path.resolve(__dirname, 'node_modules/three-bvh-csg/src/index.js'),
    },
    /** Avoid two copies of three / mesh-bvh (breaks BVH base class under Vitest). */
    dedupe: ['three', 'three-mesh-bvh', 'three-bvh-csg'],
  },
});
