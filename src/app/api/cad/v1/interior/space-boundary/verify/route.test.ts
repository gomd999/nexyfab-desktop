import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => 'test') }));
const segments = [
  { id: 'a', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { id: 'b', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
  { id: 'c', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } }, { id: 'd', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
];
describe('CAD v1 space boundary verification', () => {
  it('returns measured conservative closure evidence', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/interior/space-boundary/verify', { method: 'POST', body: JSON.stringify({ segments }) }));
    expect(await response.json()).toMatchObject({ ok: true, result: { closed: true, loopCount: 1, loopAreasMm2: [100], conservative: true }, quoteOrRfqSideEffects: false });
  });
  it('rejects incomplete geometry', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/interior/space-boundary/verify', { method: 'POST', body: JSON.stringify({ segments: segments.slice(0, 2) }) }));
    expect(response.status).toBe(400);
  });
});
