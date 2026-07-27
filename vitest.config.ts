import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * shebang 스트립 — node 는 `#!` 첫 줄을 벗겨서 실행하지만 vite 변환기는 벗기지 않아
 * `SyntaxError: Invalid or unexpected token` 으로 죽는다. 그래서 shebang 이 붙은 스크립트
 * (MCP 서버 엔트리 `scripts/drawing-to-3d/mcp-server.mjs` 등 레포 내 다수)는 지금까지
 * **vitest 에서 임포트조차 불가능**했고, 따라서 단 한 줄도 테스트된 적이 없다 — 실행은
 * 되는데 CI 는 못 보는 사각지대(260727 A-5 `87a9e3f2` 와 같은 종류).
 * `#!` 두 글자만 `//` 로 바꿔 **줄 수·문자 오프셋을 그대로 보존**한다(스택트레이스 무손상).
 */
const stripShebang = {
  name: 'nf-strip-shebang',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!code.startsWith('#!') || !/\.(mjs|cjs|js)(\?|$)/.test(id)) return null;
    return { code: '//' + code.slice(2), map: null };
  },
};

export default defineConfig({
  plugins: [stripShebang, react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
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
