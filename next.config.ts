// 상위 .env 로더 — scripts/load-parent-env.cjs (monorepo 루트·번들 루트 후보) 주입.
// Railway/Cloudflare 배포는 대개 파일이 없고 대시보드/Secrets 만 사용 → 무시됨.
// OS/CI/Railway env 에 이미 있으면 덮어쓰지 않음 (배포 환경 우선).
// 반드시 다른 import 보다 먼저 실행 — Sentry 등이 env 를 캡처하기 전에 주입.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- side-effect loader must run before static imports are evaluated
require('./scripts/load-parent-env.cjs');

import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs';
import {
  buildExactCadCspHeaders,
  buildSecurityHeaders,
} from './src/lib/security/cspHeaders';
import { resolveBuildIdentity } from './src/lib/buildIdentity';

const isDev = process.env.NODE_ENV !== 'production';

// CORS allowed origins — add trusted partner domains here
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const CSP_EXTRA_CONNECT_SRC = (process.env.CSP_EXTRA_CONNECT_SRC ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .join(' ');

/** HTTP 로컬(127.0.0.1)에서 `upgrade-insecure-requests` 는 정적 청크 URL 이 https 로 승격되어 TLS 없는 dev/E2E 서버에서 스크립트 전부 실패·무한 "Loading 3D workspace…" 를 유발한다. */
const CSP_INCLUDE_UPGRADE_INSECURE = process.env.CSP_OMIT_UPGRADE_INSECURE !== '1';

// Tauri 빌드 시 static export, 웹 배포 시 standalone
const isTauri = process.env.TAURI === 'true';
const buildIdentity = resolveBuildIdentity(process.env, isDev);

const nextConfig: NextConfig = {
  // Lets CI/diagnostics build in an isolated cache while a deployed
  // standalone process is still holding the default `.next` directory.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  output: isTauri ? 'export' : 'standalone',
  // Standalone tracing otherwise walks multi-GB desktop/build/reference
  // directories that cannot be imported by the web runtime. Keep runtime
  // data, public assets and OCCT workers eligible while excluding only
  // development evidence and unrelated build products.
  outputFileTracingExcludes: {
    '*': [
      './.claude/**/*',
      './.git/**/*',
      './src-tauri/**/*',
      './out/**/*',
      './out2/**/*',
      './docs/**/*',
      './e2e/**/*',
      './tests/**/*',
      './test-results/**/*',
      './playwright-report/**/*',
      './validation-reports/**/*',
      // Mutable local/volume state is never a deploy artifact. These files
      // may exist while a local build is running, and broad fs/path calls can
      // otherwise make Next's standalone tracer copy hundreds of MB (or a
      // developer database) into the server image.
      './data/**/*',
      './nexyfab.db',
      './nexyfab.db-*',
    ],
  },
  // The browser Precision CAD API loads the reviewed installer-core MCP
  // implementation at runtime. Keep its transitive ESM modules in standalone
  // deployments even though the import is intentionally dynamic.
  outputFileTracingIncludes: {
    '/api/nexyfab/projects/*/precision-cad-agent/*': [
      './scripts/drawing-to-3d/**/*',
      './scripts/engineering-core/**/*',
    ],
    // The exact-promotion route is the only server entry point that loads the
    // real Node OCCT adapter. Keep its narrowly required WASM runtime files in
    // standalone output without tracing the package for every API route.
    '/api/nexyfab/projects/*/architecture-interior-exact': [
      './node_modules/opencascade.js/dist/opencascade.wasm.js',
      './node_modules/opencascade.js/dist/opencascade.wasm.wasm',
      './node_modules/opencascade.js/package.json',
      './src/lib/occt/**/*',
    ],
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  trailingSlash: true,
  serverExternalPackages: ['better-sqlite3'],
  // Stamp the build with a short commit SHA so sentry-forward.ts can tag
  // every event with the exact deployed version. Railway sets
  // RAILWAY_GIT_COMMIT_SHA at build time; falls back to a manual override
  // or 'dev' in local builds.
  env: {
    // Compiled into the server bundle, including local Railway uploads where
    // no Git commit SHA is available.
    NEXYFAB_BUILD_ID: buildIdentity.buildId,
    NEXT_PUBLIC_RELEASE: buildIdentity.publicRelease,
  },
  async redirects() {
    return [
      {
        source: '/ko/:path*',
        destination: '/kr/:path*',
        permanent: true,
      },
      {
        source: '/zh/:path*',
        destination: '/cn/:path*',
        permanent: true,
      },
      {
        source: '/:lang/generative-design/:path*',
        destination: '/:lang/shape-generator/',
        permanent: true,
      },
    ];
  },
  async headers() {
    // Delegates to `src/lib/security/cspHeaders.ts` so the directive set is
    // unit-testable without booting Next.js. The function is pure — env
    // values are captured at module load (above).
    const securityHeaders = buildSecurityHeaders({
      isDev,
      extraConnectSrc: CSP_EXTRA_CONNECT_SRC,
      includeUpgradeInsecure: CSP_INCLUDE_UPGRADE_INSECURE,
      corsAllowedOrigins: CORS_ALLOWED_ORIGINS,
    });
    const exactCadCspHeaders = buildExactCadCspHeaders({
      isDev,
      extraConnectSrc: CSP_EXTRA_CONNECT_SRC,
      includeUpgradeInsecure: CSP_INCLUDE_UPGRADE_INSECURE,
    });
    return [
      ...securityHeaders,
      // Must follow the global group: Next uses the later value when the same
      // header key matches. This exception is limited to the authenticated
      // precision-CAD editor; all other production routes remain eval-free.
      ...exactCadCspHeaders,
      {
        // These files are not content-hashed, so use a bounded cache instead
        // of immutable. This prevents a 65+ MB download on every editor visit
        // while allowing a corrected kernel to replace the cached copy.
        source: '/occt-worker/:path*',
        headers: [{
          key: 'Cache-Control',
          value: 'public, max-age=86400, stale-while-revalidate=604800',
        }],
      },
      {
        source: '/replicad_single.wasm',
        headers: [{
          key: 'Cache-Control',
          value: 'public, max-age=86400, stale-while-revalidate=604800',
        }],
      },
      {
        source: '/occt-import-js.wasm',
        headers: [{
          key: 'Cache-Control',
          value: 'public, max-age=86400, stale-while-revalidate=604800',
        }],
      },
    ];
  },
  productionBrowserSourceMaps: false,
  images: {
    // Tauri static export에서는 이미지 최적화 비활성화
    unoptimized: isTauri,
    formats: isTauri ? undefined : ['image/avif', 'image/webp'],
    remotePatterns: isTauri ? [] : [
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
        pathname: '/7.x/**',
      },
    ],
  },
  experimental: {
    // Proxy clones API bodies so both the security boundary and route can
    // consume them. Complex CAD evidence routes explicitly accept up to
    // 500 MB. A lower buffer silently truncates multipart bodies before the
    // route sees them. src/proxy.ts still rejects ordinary APIs above 16 MB
    // and applies narrower 150/300/500 MB route-specific limits.
    proxyClientMaxBodySize: '500mb',
    optimizePackageImports: ['three', '@react-three/fiber', '@react-three/drei', 'lucide-react'],
    serverActions: {
      bodySizeLimit: '10mb',
      // Server Action encryption key is consumed by Next.js directly from env
      // `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (Next 16+ no longer accepts it in
      // config). Pin it on every Railway/Cloudflare env so action IDs stay
      // stable across rolling deploys. Without it old tabs crash on submit
      // with "Failed to find Server Action …" — see
      // src/instrumentation-client.ts for the client-side recovery handler.
    },
  },
  // Turbopack config (Next.js 16 default bundler)
  turbopack: {
    resolveAlias: {
      // Prevent SSR bundling of Three.js JSM examples (client-only)
      'three/examples/jsm': {},
    },
  },
  // Webpack config retained for non-Turbopack builds (e.g. CI, Docker)
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    if (isServer) {
      // three/examples/jsm is client-only (OrbitControls, TransformControls,
      // BufferGeometryUtils' mergeVertices/mergeGeometries, …). Stub it on the
      // SERVER bundle so SSR never pulls browser-only example code.
      // IMPORTANT: this alias was previously in the `!isServer` branch, which
      // nulled these in the BROWSER bundle — silently breaking auto-drawing
      // (mergeVertices), mesh patterns/helix/merge (mergeGeometries), and the
      // assembly viewer controls. It must stub the server, not the client.
      config.resolve.alias = {
        ...config.resolve.alias,
        'three/examples/jsm': false,
      };
    }
    if (!isServer) {
      // WASM packages (replicad-opencascadejs) reference Node.js built-ins
      // that don't exist in the browser. Stub them out so the browser bundle
      // builds cleanly; the WASM module is only executed at runtime via
      // dynamic import inside occtEngine.ts.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        // planegcs WASM (Emscripten output) uses require('url').fileURLToPath
        // for Node-side initialization; never runs in the browser, but
        // webpack tries to resolve it during bundling.
        url: false,
      };
      // planegcs's Emscripten output (planegcs.js) is a single huge
      // self-contained module that confuses webpack's static analyzer
      // with literal './' strings and Node-only require() calls. Tell
      // webpack to skip parsing it entirely — treat it as pre-bundled
      // opaque blob. The browser will evaluate it at runtime via the
      // dynamic import chunk where the Emscripten loader detects the
      // browser env via importScripts/window checks.
      const existingNoParse = config.module?.noParse;
      const noParseList = existingNoParse
        ? (Array.isArray(existingNoParse) ? existingNoParse : [existingNoParse])
        : [];
      config.module = {
        ...config.module,
        noParse: [
          ...noParseList,
          /@salusoft89[\\/]planegcs[\\/]dist[\\/]planegcs_dist[\\/]planegcs\.js$/,
        ],
      };
    }
    // Tauri 빌드 시 API 디렉토리는 scripts/tauri-build.mjs가 임시 이동 처리합니다.
    return config;
  },
};

// Sentry's build-time webpack plugin (release creation + sourcemap upload)
// needs SENTRY_AUTH_TOKEN to do anything — without it there is nothing for it
// to upload, and this session found it throws an uncaught TypeError deep in
// its own plugin (not our code) instead of a clean skip when org/project/token
// are all unset, crashing `next build` entirely on any machine without the
// token configured (every local/dev machine — Railway sets it as a secret).
// Skip the wrapper unless all three upload coordinates are present. A token
// inherited by itself (common on developer machines) must not crash a build
// that has no destination org/project.
const sentryBuildConfigured = [
  process.env.SENTRY_AUTH_TOKEN,
  process.env.SENTRY_ORG,
  process.env.SENTRY_PROJECT,
].every((value) => typeof value === 'string' && value.trim().length > 0);

export default sentryBuildConfigured
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      widenClientFileUpload: true,
      webpack: {
        treeshake: { removeDebugLogging: true },
        automaticVercelMonitors: false,
      },
    })
  : nextConfig;
