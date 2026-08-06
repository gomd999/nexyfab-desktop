import { describe, expect, it, vi } from 'vitest'; import { NextRequest } from 'next/server'; import { POST } from './route';
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) })); vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => 'test') }));
describe('CAD v1 MEP interference verification', () => {
  it('returns continuous geometry evidence', async () => { const body = { runs: [{ id: 'p', system: 'pipe', centerline: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], outerDiameterMm: 20 }], obstacles: [] }; const response = await POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) })); expect(await response.json()).toMatchObject({ ok: true, result: { clear: true, checkedRunSegments: 1, method: 'continuous_capsule_distance', conservative: true }, quoteOrRfqSideEffects: false }); });
  it('rejects malformed top-level geometry', async () => { const response = await POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ runs: 'bad', obstacles: [] }) })); expect(response.status).toBe(400); });
});
