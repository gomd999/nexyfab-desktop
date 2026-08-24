import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '127.0.0.1') }));

describe('CAD product qualification route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an unknown domain without release side effects', async () => {
    const { POST } = await import('./route');
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/product-qualification', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domain: 'unknown', contract: {} }),
    }));
    const payload = await response.json();
    expect(response.status).toBe(422);
    expect(payload).toMatchObject({ ok: false, commercialReleaseReady: false, quoteOrRfqSideEffects: false, releaseBlocker: 'GOVERNED_EXTERNAL_QUALIFICATION_REQUIRED' });
  });

  it('returns a fail-closed civil contract evaluation', async () => {
    const { POST } = await import('./route');
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/product-qualification', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domain: 'civil', contract: {} }),
    }));
    const payload = await response.json();
    expect(response.status).toBe(422);
    expect(payload.evaluation).toMatchObject({ domain: 'civil', status: 'FAIL', commercialReleaseReady: false, quoteOrRfqSideEffects: false });
  });
});
