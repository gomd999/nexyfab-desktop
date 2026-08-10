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
 * keep working. Production ships only `'wasm-unsafe-eval'`.
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
  /**
   * Explicitly permit JavaScript string evaluation for a narrowly scoped
   * consumer. Never enable this on the global production header. The current
   * exception is the authenticated precision-CAD route whose third-party
   * Emscripten glue still evaluates generated JavaScript while booting OCCT.
   */
  allowUnsafeEval?: boolean;
}

const EXACT_CAD_ROUTE = '/:lang(kr|en|ja|cn|es|ar)/shape-generator/:path*';
const EXACT_CAD_PIPELINE_WORKER_ROUTE = '/_next/static/chunks/pipeline-worker.:hash.js';

/**
 * Build the CSP `Content-Security-Policy` header value.
 *
 * Exposed so tests can assert specific directives without re-parsing the
 * whole grouped header array.
 */
export function buildCspValue(opts: BuildSecurityHeadersOptions = {}): string {
  const isDev = opts.isDev === true;
  const extra = (opts.extraConnectSrc ?? '')
    .split(/\s+/)
    .map(value => safeOrigin(value, isDev, true))
    .filter((value): value is string => Boolean(value))
    .join(' ');
  const includeUpgrade = opts.includeUpgradeInsecure !== false;

  // wasm-unsafe-eval permits WebAssembly compilation without granting ambient
  // JavaScript eval(). Next's inline bootstrap still requires unsafe-inline
  // until the application moves to request nonces.
  const scriptSrcParts = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    // blob: — the client OpenSCAD-WASM render worker imports the emscripten
    // glue from a same-origin blob URL (Studio in-browser CAD). Safer than data:.
    'blob:',
    'https://www.googletagmanager.com',
    'https://www.google-analytics.com',
    'https://connect.facebook.net',
    'https://www.google.com/recaptcha/',
    'https://www.gstatic.com/recaptcha/',
  ];
  if (isDev || opts.allowUnsafeEval === true) {
    scriptSrcParts.splice(1, 0, "'unsafe-eval'");
  }

  const directives: string[] = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `script-src ${scriptSrcParts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://api.dicebear.com https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com https://www.google.co.kr",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' https://api.stripe.com https://www.google-analytics.com https://analytics.google.com https://stats.g.doubleclick.net https://www.google.com https://*.sentry.io${
      extra ? ` ${extra}` : ''
    }`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ];

  if (includeUpgrade) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Build the sole production CSP exception needed by the browser OCCT kernel.
 *
 * Replicad's current Emscripten glue evaluates generated JavaScript during
 * kernel startup, so `wasm-unsafe-eval` by itself is insufficient. Keeping
 * these as later, route-specific headers preserves the stricter global CSP.
 * The worker needs its own response header because it does not inherit the
 * creating document's route-specific policy.
 * Moving the kernel to isolated, eval-free worker glue remains future
 * hardening work.
 */
export function buildExactCadCspHeaders(
  opts: BuildSecurityHeadersOptions = {},
): SecurityHeadersGroup[] {
  const value = buildCspValue({ ...opts, allowUnsafeEval: true });
  return [EXACT_CAD_ROUTE, EXACT_CAD_PIPELINE_WORKER_ROUTE].map(source => ({
    source,
    headers: [{ key: 'Content-Security-Policy', value }],
  }));
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
  const cors = (opts.corsAllowedOrigins ?? [])
    .map(value => safeOrigin(value, opts.isDev === true, false))
    .filter((value): value is string => Boolean(value));

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
        { key: 'Vary', value: 'Origin' },
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
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
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

function safeOrigin(value: string, allowLocalHttp: boolean, allowWebSocket: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[;\r\n]/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (
      url.protocol !== 'https:'
      && !(allowWebSocket && url.protocol === 'wss:')
      && !(allowLocalHttp && local && url.protocol === 'http:')
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
