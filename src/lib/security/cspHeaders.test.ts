/**
 * cspHeaders — pins the security headers, with emphasis on the Phase-5 OCCT
 * WASM activation directives. Without these the browser real-OCCT worker
 * (occt-worker-launcher → opencascade.js) silently fails to boot, so a future
 * edit that drops one must fail CI here rather than in production.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCspValue,
  buildExactCadCspHeaders,
  buildSecurityHeaders,
} from './cspHeaders';

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

  it('permits the GA4 collection endpoints used after analytics consent', () => {
    const csp = buildCspValue();
    expect(csp).toMatch(/connect-src[^;]*https:\/\/analytics\.google\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/stats\.g\.doubleclick\.net/);
    expect(csp).toMatch(/img-src[^;]*https:\/\/www\.google\.co\.kr/);
  });

  it("does not grant JavaScript eval in production", () => {
    const script = buildCspValue({ isDev: false }).split(';')
      .find(value => value.trim().startsWith('script-src')) ?? '';
    expect(script.split(/\s+/)).not.toContain("'unsafe-eval'");
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
    expect(cors?.headers.some((h) => h.key === 'Access-Control-Allow-Credentials')).toBe(false);
  });

  it('drops malformed CORS origins instead of reflecting them', () => {
    const groups = buildSecurityHeaders({ corsAllowedOrigins: ['https://safe.example\r\nX-Evil: 1'] });
    expect(groups.some((g) => g.source === '/api/(.*)')).toBe(false);
  });
});

describe('buildExactCadCspHeaders — route-scoped Emscripten exception', () => {
  it("grants ambient eval only on the precision-CAD route", () => {
    const global = buildSecurityHeaders({ isDev: false })
      .find(group => group.source === '/(.*)')!
      .headers.find(header => header.key === 'Content-Security-Policy')!.value;
    const exactCad = buildExactCadCspHeaders({ isDev: false });
    const documentPolicy = exactCad.find(group => group.source.includes('/shape-generator/'))!;
    const workerPolicy = exactCad.find(group => group.source.includes('pipeline-worker.'))!;
    const scoped = documentPolicy.headers[0].value;

    expect(exactCad).toHaveLength(2);
    expect(documentPolicy.source).toBe('/:lang(kr|en|ja|cn|es|ar)/shape-generator/:path*');
    expect(workerPolicy.source).toBe('/_next/static/chunks/pipeline-worker.:hash.js');
    expect(global.split(';').find(value => value.trim().startsWith('script-src')))
      .not.toContain("'unsafe-eval'");
    expect(scoped.split(';').find(value => value.trim().startsWith('script-src')))
      .toContain("'unsafe-eval'");
    expect(workerPolicy.headers[0].value.split(';').find(value => value.trim().startsWith('script-src')))
      .toContain("'unsafe-eval'");
  });
});
