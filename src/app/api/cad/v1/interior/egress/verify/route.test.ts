import { describe, expect, it, vi } from 'vitest'; import { NextRequest } from 'next/server'; import { POST } from './route';
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) })); vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => 'test') }));
const body = { nodes: [{ id: 'o', point: { x: 0, y: 0 } }, { id: 'e', point: { x: 1000, y: 0 } }], edges: [{ id: 'p', from: 'o', to: 'e', clearWidthMm: 900 }], originNodeIds: ['o'], exitNodeIds: ['e'], maximumTravelDistanceMm: 2000, minimumClearWidthMm: 800 };
describe('CAD v1 egress verification', () => {
  it('returns governed measured path evidence', async () => { const response = await POST(new NextRequest('http://localhost/api/cad/v1/interior/egress/verify', { method: 'POST', body: JSON.stringify(body) })); expect(await response.json()).toMatchObject({ ok: true, result: { passed: true, originResults: [{ travelDistanceMm: 1000, bottleneckWidthMm: 900 }], conservative: true }, quoteOrRfqSideEffects: false }); });
  it('rejects absent governed limits', async () => { const response = await POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify({ nodes: [] }) })); expect(response.status).toBe(400); });
});
