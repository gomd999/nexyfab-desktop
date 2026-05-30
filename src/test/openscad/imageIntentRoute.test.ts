// @vitest-environment node
/**
 * POST /api/nexyfab/intent-from-image — route contract.
 *
 * Mocks the vision API and the heavy dependencies so the route can be
 * exercised without an upstream key. Confirms plan gating, input
 * validation, happy path, and AI non-JSON failure propagation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const planMock = vi.fn(async () => ({ ok: true, userId: 'u-test', plan: 'pro' }));
vi.mock('@/lib/plan-guard', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return {
    ...real,
    checkPlan: (...args: unknown[]) => planMock(...args as []),
    consumeMonthlyMetricSlot: vi.fn(async () => ({ ok: true, used: 1, limit: 30 })),
  };
});

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: Date.now() + 3_600_000 })),
}));

vi.mock('@/lib/ai/userBudget', () => ({
  checkUserBudget: vi.fn(async () => ({
    ok: true, usedCents: 0, limitUsd: 5, approaching: false, fraction: 0, resetAtMs: Date.now() + 86_400_000,
  })),
}));

vi.mock('@/lib/ai/telemetry', () => ({
  recordPromptCall: vi.fn(),
  classifyAiError: vi.fn(() => 'unknown'),
}));

vi.mock('@/lib/enterprise-cad-audit', () => ({
  logCadPipelineAudit: vi.fn(),
  CadAuditAction: { IMAGE_INTENT_EXTRACTED: 'cad.image_intent.extracted' },
}));

vi.mock('@/lib/error-capture', () => ({ captureServerError: vi.fn() }));

vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));

// Cache always empty so every call hits the vision mock; reset per test.
vi.mock('@/lib/ai/intentCache', () => ({
  getCachedIntent: vi.fn(async () => null),
  setCachedIntent: vi.fn(async () => undefined),
}));

// Vision mock — default happy. Tests override per-call via mockImplementationOnce.
const visionCompletion = vi.fn();
vi.mock('@/lib/ai/vision', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return {
    ...real,
    visionCompletion: (...args: unknown[]) => visionCompletion(...args as []),
    isVisionAvailable: () => true,
  };
});

type RoutePOST = (typeof import('@/app/api/nexyfab/intent-from-image/route'))['POST'];
let POST: RoutePOST;

// Minimal valid 1×1 PNG, base64 encoded.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

beforeEach(async () => {
  vi.resetModules();
  planMock.mockReset();
  planMock.mockResolvedValue({ ok: true, userId: 'u-test', plan: 'pro' });
  visionCompletion.mockReset();
  visionCompletion.mockResolvedValue({
    text: JSON.stringify({
      shapeId: 'box',
      params: { width: 50, height: 30, depth: 20 },
      features: [],
      facets: 64,
      summary: 'A simple rectangular bracket, ~50mm long.',
    }),
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    latencyMs: 120,
    promptTokens: 100,
    completionTokens: 50,
  });
  ({ POST } = await import('@/app/api/nexyfab/intent-from-image/route'));
});

function callRoute(body: unknown) {
  const req = new Request('http://test/api/nexyfab/intent-from-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<RoutePOST>[0]);
}

describe('POST /api/nexyfab/intent-from-image', () => {
  it('returns 403 PLAN_LOCKED when the user is on the free plan', async () => {
    planMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Plan upgrade required' }), { status: 403 }),
    } as unknown as { ok: true; userId: string; plan: string });
    const res = await callRoute({ imageBase64: PNG_DATA_URL });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('PLAN_LOCKED');
    expect(String(body.error)).toMatch(/Pro plan/i);
  });

  it('returns 400 IMAGE_REQUIRED when imageBase64 is missing', async () => {
    const res = await callRoute({ hintText: 'no image here' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('IMAGE_REQUIRED');
  });

  it('returns 200 with intent + scad on the happy path', async () => {
    const res = await callRoute({ imageBase64: PNG_DATA_URL, hintText: 'bracket' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.intent.shapeId).toBe('box');
    expect(body.intent.params).toEqual({ width: 50, height: 30, depth: 20 });
    expect(typeof body.scad).toBe('string');
    expect(body.scad.length).toBeGreaterThan(0);
    expect(body.summary).toMatch(/bracket/i);
    expect(body.cached).toBe(false);
  });

  it('returns 502 NON_JSON when the vision model returns non-JSON text', async () => {
    visionCompletion.mockResolvedValueOnce({
      text: 'I am sorry, I cannot identify this shape today.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      latencyMs: 100,
    });
    const res = await callRoute({ imageBase64: PNG_DATA_URL });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('NON_JSON');
    expect(body.raw).toBeTruthy();
  });
});
