/**
 * csp.test — covers the security headers wired into `next.config.ts`.
 *
 * We test the pure builder in `src/lib/security/cspHeaders.ts` instead of
 * loading `next.config.ts` directly. Importing the actual config under
 * vitest would drag in `@sentry/nextjs`, `withSentryConfig`, and the
 * top-of-file `require('./scripts/load-parent-env.cjs')` side effect —
 * none of which are relevant to validating the CSP directive set.
 *
 * Phase 5 launch step 10 — verifies:
 *   1. The directive list shape Next.js expects (`{ source, headers }` rows).
 *   2. `script-src` gains `'wasm-unsafe-eval'` (NOT `'unsafe-eval'` alone).
 *   3. `worker-src 'self' blob:` is present.
 *   4. `/occt-worker/(.*)` has `Cross-Origin-Resource-Policy: same-origin`.
 *   5. `/occt-worker/(.*)` has `Cache-Control: public, max-age=31536000, immutable`.
 *   6. CORS group is gated by the allow-list.
 *   7. `upgrade-insecure-requests` can be opted out (CSP_OMIT_UPGRADE_INSECURE).
 *   8. Dev keeps `'unsafe-eval'` for HMR while production removes it.
 *   9. The connect-src directive extends with env-provided extras.
 *   10. The global `/(.*)` row stays in place with all classic security headers.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCspValue,
  buildExactCadCspHeaders,
  buildSecurityHeaders,
} from '../../lib/security/cspHeaders';

describe('buildSecurityHeaders', () => {
  it('returns an array of header groups', () => {
    const out = buildSecurityHeaders();
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('emits a `/occt-worker/(.*)` group with CORP same-origin', () => {
    const out = buildSecurityHeaders();
    const occt = out.find((g) => g.source === '/occt-worker/(.*)');
    expect(occt).toBeDefined();
    const corp = occt!.headers.find(
      (h) => h.key === 'Cross-Origin-Resource-Policy',
    );
    expect(corp?.value).toBe('same-origin');
  });

  it('emits a `/occt-worker/(.*)` group with Cache-Control immutable', () => {
    const out = buildSecurityHeaders();
    const occt = out.find((g) => g.source === '/occt-worker/(.*)');
    const cc = occt!.headers.find((h) => h.key === 'Cache-Control');
    expect(cc?.value).toBe('public, max-age=31536000, immutable');
  });

  it('emits a `/(.*)` group with Content-Security-Policy', () => {
    const out = buildSecurityHeaders();
    const global = out.find((g) => g.source === '/(.*)');
    expect(global).toBeDefined();
    const csp = global!.headers.find(
      (h) => h.key === 'Content-Security-Policy',
    );
    expect(csp).toBeDefined();
    expect(csp!.value.length).toBeGreaterThan(0);
  });

  it('emits a `/(.*)` group with HSTS, X-Frame-Options, and friends', () => {
    const out = buildSecurityHeaders();
    const global = out.find((g) => g.source === '/(.*)');
    const keys = global!.headers.map((h) => h.key);
    expect(keys).toContain('Strict-Transport-Security');
    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Referrer-Policy');
    expect(keys).toContain('Permissions-Policy');
  });

  it('omits the CORS group when no origins are allow-listed', () => {
    const out = buildSecurityHeaders({ corsAllowedOrigins: [] });
    const cors = out.find((g) => g.source === '/api/(.*)');
    expect(cors).toBeUndefined();
  });

  it('emits the CORS group when an origin is allow-listed', () => {
    const out = buildSecurityHeaders({
      corsAllowedOrigins: ['https://partner.example.com'],
    });
    const cors = out.find((g) => g.source === '/api/(.*)');
    expect(cors).toBeDefined();
    const allow = cors!.headers.find(
      (h) => h.key === 'Access-Control-Allow-Origin',
    );
    expect(allow?.value).toBe('https://partner.example.com');
  });
});

describe('buildCspValue', () => {
  it("script-src includes 'wasm-unsafe-eval' for OCCT WASM compilation", () => {
    const csp = buildCspValue();
    expect(csp).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
  });

  it("worker-src is 'self' blob: for Emscripten Blob URLs", () => {
    const csp = buildCspValue();
    expect(csp).toMatch(/worker-src 'self' blob:/);
  });

  it("dev mode keeps 'unsafe-eval' for Next.js HMR", () => {
    const csp = buildCspValue({ isDev: true });
    expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it("prod mode removes ambient 'unsafe-eval'", () => {
    const csp = buildCspValue({ isDev: false });
    const script = csp.split(';').find(value => value.trim().startsWith('script-src')) ?? '';
    expect(script.split(/\s+/)).not.toContain("'unsafe-eval'");
    expect(script.split(/\s+/)).toContain("'wasm-unsafe-eval'");
  });

  it('connect-src appends extra origins when provided', () => {
    const csp = buildCspValue({ extraConnectSrc: 'https://api.example.com' });
    expect(csp).toMatch(/connect-src[^;]*https:\/\/api\.example\.com/);
  });

  it('includes `upgrade-insecure-requests` by default', () => {
    const csp = buildCspValue();
    expect(csp).toMatch(/upgrade-insecure-requests/);
  });

  it('omits `upgrade-insecure-requests` when includeUpgradeInsecure=false', () => {
    const csp = buildCspValue({ includeUpgradeInsecure: false });
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
  });

  it("retains existing connect-src origins (sentry, google, stripe)", () => {
    const csp = buildCspValue();
    expect(csp).toMatch(/connect-src[^;]*https:\/\/api\.stripe\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/analytics\.google\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/stats\.g\.doubleclick\.net/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.sentry\.io/);
  });

  it("retains existing img-src 'self' data: blob: + dicebear", () => {
    const csp = buildCspValue();
    expect(csp).toMatch(/img-src 'self' data: blob:/);
    expect(csp).toMatch(/img-src[^;]*https:\/\/api\.dicebear\.com/);
    expect(csp).toMatch(/img-src[^;]*https:\/\/www\.google\.co\.kr/);
  });

  it("frame-ancestors is 'none' (clickjacking defence)", () => {
    const csp = buildCspValue();
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  it('rejects CSP directive injection from environment origins', () => {
    const csp = buildCspValue({ extraConnectSrc: "https://ok.example; script-src *" });
    expect(csp).not.toContain('ok.example');
    expect(csp).not.toContain('script-src *');
  });

  it('adds object/base/form restrictions', () => {
    const csp = buildCspValue({ isDev: false });
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});

describe('precision-CAD production CSP exception', () => {
  it('is limited to the localized shape-generator route', () => {
    const groups = buildExactCadCspHeaders({ isDev: false });
    expect(groups.map(group => group.source)).toEqual([
      '/:lang(kr|en|ja|cn|es|ar)/shape-generator/:path*',
      '/_next/static/chunks/pipeline-worker.:hash.js',
    ]);
    for (const group of groups) {
      const csp = group.headers.find(header => header.key === 'Content-Security-Policy')!.value;
      const script = csp.split(';').find(value => value.trim().startsWith('script-src')) ?? '';
      expect(script.split(/\s+/)).toContain("'unsafe-eval'");
    }
  });
});
