// 상위 .env 로더 — scripts/load-parent-env.cjs (monorepo 루트·번들 루트 후보) 주입.
// Railway/Cloudflare 배포는 대개 파일이 없고 대시보드/Secrets 만 사용 → 무시됨.
// OS/CI/Railway env 에 이미 있으면 덮어쓰지 않음 (배포 환경 우선).
// 반드시 다른 import 보다 먼저 실행 — Sentry 등이 env 를 캡처하기 전에 주입.
require('./scripts/load-parent-env.cjs');

import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs';

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

const nextConfig: NextConfig = {
  output: isTauri ? 'export' : 'standalone',
  trailingSlash: true,
  serverExternalPackages: ['better-sqlite3'],
  async redirects() {
    return [
      {
        source: '/:lang/generative-design/:path*',
        destination: '/:lang/shape-generator/',
        permanent: true,
      },
    ];
  },
  async headers() {
    // CORS: Access-Control-Allow-Origin only accepts a single origin, not a comma-separated list.
    // For multiple origins, dynamic origin matching should be done in middleware.
    // Here we use the first configured origin for the static header.
    const corsHeaders = CORS_ALLOWED_ORIGINS.length > 0
      ? [
          { key: 'Access-Control-Allow-Origin', value: CORS_ALLOWED_ORIGINS[0] },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, x-admin-token, x-admin-secret' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ]
      : [];

    return [
      // CORS for API routes
      ...(corsHeaders.length > 0 ? [{ source: '/api/(.*)', headers: corsHeaders }] : []),
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://api.dicebear.com https://www.facebook.com",
              "font-src 'self' https://fonts.gstatic.com",
              `connect-src 'self' https://api.stripe.com https://www.google-analytics.com https://www.google.com https://*.sentry.io${CSP_EXTRA_CONNECT_SRC ? ` ${CSP_EXTRA_CONNECT_SRC}` : ''}`,
              "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/",
              "frame-ancestors 'none'",
              ...(CSP_INCLUDE_UPGRADE_INSECURE ? (['upgrade-insecure-requests'] as const) : []),
            ].join('; '),
          },
        ],
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
    optimizePackageImports: ['three', '@react-three/fiber', '@react-three/drei', 'lucide-react'],
    serverActions: {
      bodySizeLimit: '10mb',
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
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'three/examples/jsm': false,
      };
      // WASM packages (replicad-opencascadejs) reference Node.js built-ins
      // that don't exist in the browser. Stub them out so the browser bundle
      // builds cleanly; the WASM module is only executed at runtime via
      // dynamic import inside occtEngine.ts.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    // Tauri 빌드 시 API 디렉토리는 scripts/tauri-build.mjs가 임시 이동 처리합니다.
    return config;
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
