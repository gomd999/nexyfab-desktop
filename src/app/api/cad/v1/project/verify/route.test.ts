import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => 'test') }));

describe('CAD v1 project verify', () => {
  beforeEach(() => vi.clearAllMocks());
  it('returns the common fail-closed result without quote/RFQ side effects', async () => {
    const request = new NextRequest('http://localhost/api/cad/v1/project/verify', { method: 'POST', body: JSON.stringify({ structure: { valid: true }, placement: { required: 1, resolved: 0, invalid: 0 }, assembly: { applicable: true } }), headers: { 'content-type': 'application/json' } });
    const response = await POST(request); const body = await response.json();
    expect(body).toMatchObject({ ok: true, releaseReady: false, quoteOrRfqSideEffects: false });
    expect(body.gates.some((gate: { id: string; status: string }) => gate.id === 'placement' && gate.status === 'not_run')).toBe(true);
  });
  it('rejects inconsistent placement counts', async () => {
    const request = new NextRequest('http://localhost/api/cad/v1/project/verify', { method: 'POST', body: JSON.stringify({ structure: { valid: true }, placement: { required: 1, resolved: 2, invalid: 0 } }) });
    expect((await POST(request)).status).toBe(400);
  });
});
