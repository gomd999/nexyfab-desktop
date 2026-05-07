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
