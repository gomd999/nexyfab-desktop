/**
 * cspHeaders — pins the security headers, with emphasis on the Phase-5 OCCT
 * WASM activation directives. Without these the browser real-OCCT worker
 * (occt-worker-launcher → opencascade.js) silently fails to boot, so a future
 * edit that drops one must fail CI here rather than in production.
 */
import { describe, it, expect } from 'vitest';
import { buildCspValue, buildSecurityHeaders } from './cspHeaders';

describe('buildCspValue — Phase 5 OCCT WASM directives', () => {
  it("script-src permits 'wasm-unsafe-eval' (WebAssembly.compile)", () => {
    expect(buildCspValue()).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
  });

  it("worker-src allows 'self' + blob: (Emscripten worker/pthread boot)", () => {
    expect(buildCspValue()).toMatch(/worker-src 'self' blob:/);
  });

  it('keeps the core lockdown directives', () => {
    const csp = buildCspValue();
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  it('appends extra connect-src origins when provided', () => {
    const csp = buildCspValue({ extraConnectSrc: 'https://example.test' });
    expect(csp).toMatch(/connect-src[^;]*https:\/\/example\.test/);
  });

  it('omits upgrade-insecure-requests when explicitly disabled (local HTTP)', () => {
    expect(buildCspValue({ includeUpgradeInsecure: false })).not.toMatch(/upgrade-insecure-requests/);
    expect(buildCspValue()).toMatch(/upgrade-insecure-requests/);
  });
});

describe('buildSecurityHeaders — /occt-worker/* asset headers', () => {
  it('serves the WASM dir with same-origin CORP + a 1-year immutable cache', () => {
    const groups = buildSecurityHeaders();
    const occt = groups.find((g) => g.source === '/occt-worker/(.*)');
    expect(occt).toBeDefined();
    const corp = occt!.headers.find((h) => h.key === 'Cross-Origin-Resource-Policy');
    const cache = occt!.headers.find((h) => h.key === 'Cache-Control');
    expect(corp?.value).toBe('same-origin');
    expect(cache?.value).toMatch(/immutable/);
  });

  it('applies the global CSP (with the WASM directives) to every path', () => {
    const groups = buildSecurityHeaders();
    const global = groups.find((g) => g.source === '/(.*)');
    const csp = global!.headers.find((h) => h.key === 'Content-Security-Policy');
    expect(csp?.value).toMatch(/'wasm-unsafe-eval'/);
    expect(csp?.value).toMatch(/worker-src 'self' blob:/);
  });

  it('emits a CORS group only when origins are allow-listed', () => {
    expect(buildSecurityHeaders().some((g) => g.source === '/api/(.*)')).toBe(false);
    const withCors = buildSecurityHeaders({ corsAllowedOrigins: ['https://app.example'] });
    const cors = withCors.find((g) => g.source === '/api/(.*)');
    expect(cors?.headers.find((h) => h.key === 'Access-Control-Allow-Origin')?.value).toBe('https://app.example');
  });
});
