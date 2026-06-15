// @vitest-environment node
/**
 * POST /api/nexyfab/request-quote — route contract.
 *
 * Mocks plan / rate-limit / slot so the route exercises the provider
 * registry without a DB or real estimator. Confirms input validation,
 * happy path through the internal provider, NOT_CONFIGURED 503 when
 * explicitly requesting the unconfigured Xometry stub, and the rate-limit
 * 429 path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const planMock = vi.fn(async () => ({ ok: true, userId: 'u-test', plan: 'free' }));
const slotMock = vi.fn(async () => ({ ok: true, used: 1, limit: 20 }));
vi.mock('@/lib/plan-guard', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return {
    ...real,
    checkPlan: (...args: unknown[]) => planMock(...args as []),
    consumeMonthlyMetricSlot: (...args: unknown[]) => slotMock(...args as []),
  };
});

const rateLimitMock = vi.fn(() => ({ allowed: true, remaining: 59, resetAt: Date.now() + 3_600_000 }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args as []),
}));

vi.mock('@/lib/enterprise-cad-audit', () => ({
  logCadPipelineAudit: vi.fn(),
  CadAuditAction: { QUOTE_REQUESTED: 'cad.quote.requested' },
}));

vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));

type RoutePOST = (typeof import('@/app/api/nexyfab/request-quote/route'))['POST'];
let POST: RoutePOST;

beforeEach(async () => {
  vi.resetModules();
  planMock.mockReset();
  planMock.mockResolvedValue({ ok: true, userId: 'u-test', plan: 'free' });
  slotMock.mockReset();
  slotMock.mockResolvedValue({ ok: true, used: 1, limit: 20 });
  rateLimitMock.mockReset();
  rateLimitMock.mockReturnValue({ allowed: true, remaining: 59, resetAt: Date.now() + 3_600_000 });
  delete process.env.XOMETRY_API_KEY;
  ({ POST } = await import('@/app/api/nexyfab/request-quote/route'));
});

function callRoute(body: unknown) {
  const req = new Request('http://test/api/nexyfab/request-quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<RoutePOST>[0]);
}

describe('POST /api/nexyfab/request-quote', () => {
  it('returns 400 BAD_PROCESS when process is missing or invalid', async () => {
    const res = await callRoute({ material: 'aluminum_6061', quantity: 1 });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('BAD_PROCESS');

    const res2 = await callRoute({ process: 'cnc_mill', quantity: 1 });
    expect(res2.status).toBe(400);
    const data2 = await res2.json();
    expect(data2.code).toBe('BAD_MATERIAL');
  });

  it('returns 200 with an internal-provider quote on the happy path', async () => {
    const res = await callRoute({
      process: 'cnc_mill',
      material: 'aluminum_6061',
      quantity: 1,
      bboxMm: { wMm: 50, hMm: 50, dMm: 50 },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.quote.providerId).toBe('internal');
    expect(data.quote.totalUsd).toBeGreaterThan(0);
    expect(data.quote.unitPriceUsd).toBeGreaterThan(0);
    expect(data.quote.leadTimeDays).toBe(5); // cnc_mill heuristic
    expect(Array.isArray(data.quote.lineItems)).toBe(true);
    expect(data.quote.confidence).not.toBe('binding');
  });

  it('returns 503 NOT_CONFIGURED when explicitly requesting the xometry provider stub', async () => {
    const res = await callRoute({
      providerId: 'xometry',
      process: 'cnc_mill',
      material: 'aluminum_6061',
      quantity: 1,
      bboxMm: { wMm: 50, hMm: 50, dMm: 50 },
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('NOT_CONFIGURED');
    expect(data.providerId).toBe('xometry');
    expect(String(data.error)).toMatch(/Xometry/i);
  });

  it('returns 429 RATE_LIMIT when the rate limiter denies the request', async () => {
    rateLimitMock.mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
    const res = await callRoute({
      process: 'cnc_mill',
      material: 'aluminum_6061',
      quantity: 1,
      bboxMm: { wMm: 50, hMm: 50, dMm: 50 },
    });
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.code).toBe('RATE_LIMIT');
  });
});
