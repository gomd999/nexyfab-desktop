// @vitest-environment node
/**
 * POST /api/nexyfab/reverse-engineer — route contract.
 *
 * Mocks plan / rate-limit / classifier so the route can be exercised
 * without a real STL parse pipeline. Confirms plan gating, input
 * validation, happy path, and size-limit propagation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const planMock = vi.fn(async () => ({ ok: true, userId: 'u-test', plan: 'pro' }));
const slotMock = vi.fn(async () => ({ ok: true, used: 1, limit: 50 }));
vi.mock('@/lib/plan-guard', async (orig) => {
  const real = await orig() as Record<string, unknown>;
  return {
    ...real,
    checkPlan: (...args: unknown[]) => planMock(...args as []),
    consumeMonthlyMetricSlot: (...args: unknown[]) => slotMock(...args as []),
  };
});

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: Date.now() + 3_600_000 })),
}));

vi.mock('@/lib/enterprise-cad-audit', () => ({
  logCadPipelineAudit: vi.fn(),
  CadAuditAction: { MESH_REVERSE_ENGINEERED: 'cad.mesh.reverse_engineered' },
}));

vi.mock('@/lib/error-capture', () => ({ captureServerError: vi.fn() }));

vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '127.0.0.1' }));

// Geometry parse + classifier mocks — keep the route layer focused on
// gating + payload shape, not on the full mesh inspection pipeline.
const parseStlMock = vi.fn(async () => ({
  attributes: { position: { count: 36 } },
}));
vi.mock('@/lib/ai/scad-agent/renderToGeometry', () => ({
  parseStlBufferToGeometry: (...args: unknown[]) => parseStlMock(...args as []),
}));

const classifierMock = vi.fn(async () => ({
  candidates: [
    {
      intent: { shapeId: 'box', params: { width: 20, height: 20, depth: 20 }, features: [] },
      confidence: 92,
      summary: 'box 20 × 20 × 20 mm',
      evidence: ['bbox aspect 1.0/1.0 ≤ 1.5', 'fullness 0.99 ≥ 0.85'],
      counterEvidence: [],
    },
  ],
  observedStats: {
    bbox: { wMm: 20, hMm: 20, dMm: 20 },
    volumeMm3: 8000,
    surfaceAreaMm2: 2400,
    genus: 0,
    componentCount: 1,
    holeCount: 0,
    sharpEdgeCount: 12,
    chamferEdgeCount: 0,
    curvedEdgeCount: 0,
    minWallMm: null,
  },
}));
vi.mock('@/lib/ai/scad-agent/reverseEngineer', () => ({
  reverseEngineerWithWallThickness: (...args: unknown[]) => classifierMock(...args as []),
}));

// intentToScad returns a short canned string — the route should pass it
// through into the response.
vi.mock('@/lib/openscad-render/intentToScad', () => ({
  intentToScad: vi.fn(() => ({ ok: true, scad: 'cube([20,20,20], center=true);', warnings: [] })),
}));

type RoutePOST = (typeof import('@/app/api/nexyfab/reverse-engineer/route'))['POST'];
let POST: RoutePOST;

// Tiny base64 stand-in for an STL file. The parser is mocked so contents don't matter.
const STL_BASE64 = Buffer.from('solid mock').toString('base64');

beforeEach(async () => {
  vi.resetModules();
  planMock.mockReset();
  planMock.mockResolvedValue({ ok: true, userId: 'u-test', plan: 'pro' });
  slotMock.mockReset();
  slotMock.mockResolvedValue({ ok: true, used: 1, limit: 50 });
  classifierMock.mockReset();
  classifierMock.mockResolvedValue({
    candidates: [
      {
        intent: { shapeId: 'box', params: { width: 20, height: 20, depth: 20 }, features: [] },
        confidence: 92,
        summary: 'box 20 × 20 × 20 mm',
        evidence: ['fullness 0.99'],
        counterEvidence: [],
      },
    ],
    observedStats: {
      bbox: { wMm: 20, hMm: 20, dMm: 20 },
      volumeMm3: 8000,
      surfaceAreaMm2: 2400,
      genus: 0,
      componentCount: 1,
      holeCount: 0,
      sharpEdgeCount: 12,
      chamferEdgeCount: 0,
      curvedEdgeCount: 0,
      minWallMm: null,
    },
  });
  ({ POST } = await import('@/app/api/nexyfab/reverse-engineer/route'));
});

function callRoute(body: unknown) {
  const req = new Request('http://test/api/nexyfab/reverse-engineer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<RoutePOST>[0]);
}

describe('POST /api/nexyfab/reverse-engineer', () => {
  it('returns 403 PLAN_LOCKED when the user is on the free plan', async () => {
    planMock.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Plan upgrade required' }), { status: 403 }),
    } as unknown as { ok: true; userId: string; plan: string });
    const res = await callRoute({ stlBase64: STL_BASE64 });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('PLAN_LOCKED');
    expect(String(data.error)).toMatch(/Pro plan/i);
  });

  it('returns 400 STL_REQUIRED when stlBase64 is missing', async () => {
    const res = await callRoute({});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('STL_REQUIRED');
  });

  it('returns 200 with candidates + observedStats + topScad on the happy path', async () => {
    const res = await callRoute({ stlBase64: STL_BASE64 });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.candidates)).toBe(true);
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0].intent.shapeId).toBe('box');
    expect(data.candidates[0].confidence).toBe(92);
    expect(data.observedStats.bbox.wMm).toBe(20);
    expect(data.topScad).toMatch(/cube/);
  });

  it('returns 413 STL_TOO_LARGE when the decoded payload exceeds 8 MB', async () => {
    // Build a base64 string that decodes to > 8 MB. Each base64 char ≈ 3/4 byte.
    // 9 MB needs ~12 MB of base64 — generate via Buffer.alloc to skip the
    // string concat hot loop.
    const oversize = Buffer.alloc(9 * 1024 * 1024, 0).toString('base64');
    const res = await callRoute({ stlBase64: oversize });
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.code).toBe('STL_TOO_LARGE');
  });
});
