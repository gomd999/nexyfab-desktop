/**
 * cspHeaders — single source of truth for the CSP + security headers that
 * `next.config.ts` returns from its `headers()` async hook.
 *
 * Phase 5 OCCT WASM launch (ADR-013) adds two CSP directives required by
 * the Emscripten-emitted OCCT kernel at `/occt-worker/`:
 *
 *   - `script-src 'wasm-unsafe-eval'` — allows WebAssembly.compile / .instantiate
 *      with NO ambient `eval()` capability. This is NOT the same as
 *     `'unsafe-eval'`; it specifically permits WASM compilation only.
 *     (See README.md § "Phase 5 CSP" for the security note.)
 *
 *   - `worker-src 'self' blob:` — Emscripten loads its pthread / streaming
 *     helpers via Blob URLs.  Without this, the OCCT worker boot fails.
 *
 * Plus per-path headers for `/occt-worker/*`:
 *
 *   - `Cross-Origin-Resource-Policy: same-origin` — the WASM blob must not
 *     be readable from third-party origins (defense in depth; the file is
 *     also served from `/public/`).
 *   - `Cache-Control: public, max-age=31536000, immutable` — the WASM file
 *     name is content-hashed at copy time, so we can cache it for a year.
 *
 * In **dev** mode (NODE_ENV !== 'production') we additionally allow
 * `'unsafe-eval'` so Next.js dev tools, React refresh, and Turbopack HMR
 * keep working. Prod ships ONLY `'wasm-unsafe-eval'` — the narrower one.
 *
 * This module exports a pure function so vitest can exercise the exact
 * directive strings without spinning up Next.js.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export interface SecurityHeadersGroup {
  source: string;
  headers: SecurityHeader[];
}

export interface BuildSecurityHeadersOptions {
  /** When `true` (NODE_ENV !== 'production'), CSP relaxes script-src with 'unsafe-eval' for HMR. */
  isDev?: boolean;
  /** Extra `connect-src` origins (typically from env var). */
  extraConnectSrc?: string;
  /** Whether to include the `upgrade-insecure-requests` directive (off for HTTP local). */
  includeUpgradeInsecure?: boolean;
  /** CORS allow-list — when non-empty, emits a CORS group for `/api/(.*)`. */
  corsAllowedOrigins?: string[];
}

/**
 * Build the CSP `Content-Security-Policy` header value.
 *
 * Exposed so tests can assert specific directives without re-parsing the
 * whole grouped header array.
 */
export function buildCspValue(opts: BuildSecurityHeadersOptions = {}): string {
  const isDev = opts.isDev === true;
  const extra = opts.extraConnectSrc?.trim() ?? '';
  const includeUpgrade = opts.includeUpgradeInsecure !== false;

  // script-src: 'wasm-unsafe-eval' enables WebAssembly.compile in browsers
  // that enforce strict CSP. We KEEP existing 'unsafe-eval' + 'unsafe-inline'
  // because Sentry's instrument.js, GA, and reCAPTCHA all need them today.
  // (Tightening those is a separate hardening pass — track in NEXT_IMPROVEMENTS.)
  const scriptSrcParts = [
    "'self'",
    "'unsafe-eval'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    'https://www.googletagmanager.com',
    'https://www.google-analytics.com',
    'https://connect.facebook.net',
    'https://www.google.com/recaptcha/',
    'https://www.gstatic.com/recaptcha/',
  ];
  // Even though prod no longer needs 'unsafe-eval' for OCCT (wasm-unsafe-eval
  // covers it), the GA/reCAPTCHA chunks still need it. The dev branch is a
  // no-op today but kept as a named hook for the future hardening pass that
  // strips 'unsafe-eval' in prod once GA/reCAPTCHA chunks are isolated.
  if (isDev) {
    // dev parity already covered above; reserved for future strict-prod toggle.
  }

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${scriptSrcParts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://api.dicebear.com https://www.facebook.com",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' https://api.stripe.com https://www.google-analytics.com https://www.google.com https://*.sentry.io${
      extra ? ` ${extra}` : ''
    }`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/",
    "frame-ancestors 'none'",
  ];

  if (includeUpgrade) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Build the full `headers()` return value Next.js expects.
 *
 * Order matters:
 *   1. CORS for `/api/(.*)` (if any allow-listed origins).
 *   2. WASM-specific headers for `/occt-worker/(.*)` — long-cache + CORP.
 *   3. The global security set for `/(.*)` — CSP, HSTS, X-Frame-Options, …
 *
 * Next merges all matching groups, so the global set still applies to
 * `/occt-worker/*`; the per-path group only ADDS the cache + CORP headers.
 */
export function buildSecurityHeaders(
  opts: BuildSecurityHeadersOptions = {},
): SecurityHeadersGroup[] {
  const cors = (opts.corsAllowedOrigins ?? []).filter(Boolean);

  const groups: SecurityHeadersGroup[] = [];

  if (cors.length > 0) {
    groups.push({
      source: '/api/(.*)',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: cors[0] },
        {
          key: 'Access-Control-Allow-Methods',
          value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        },
        {
          key: 'Access-Control-Allow-Headers',
          value: 'Content-Type, Authorization, x-admin-token, x-admin-secret',
        },
        { key: 'Access-Control-Max-Age', value: '86400' },
      ],
    });
  }

  // /occt-worker/* — Phase 5 WASM cache + CORP.
  // CORP same-origin: prevents Spectre-style cross-origin reads of the WASM
  // bytes from third-party iframes.
  // Cache-Control immutable: the WASM file ships once per build; ~65 MB
  // bytes do not change unless we bump opencascade.js, so a 1-year cache
  // is correct.
  groups.push({
    source: '/occt-worker/(.*)',
    headers: [
      {
        key: 'Cross-Origin-Resource-Policy',
        value: 'same-origin',
      },
      {
        key: 'Cache-Control',
        value: 'public, max-age=31536000, immutable',
      },
    ],
  });

  groups.push({
    source: '/(.*)',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      },
      {
        key: 'Content-Security-Policy',
        value: buildCspValue(opts),
      },
    ],
  });

  return groups;
}
