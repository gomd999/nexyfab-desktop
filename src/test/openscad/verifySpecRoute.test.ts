// @vitest-environment node
/**
 * POST /api/nexyfab/verify-spec — route contract.
 *
 * Mocks the OpenSCAD CLI and the heavy STL verification so the route can
 * be exercised in unit tests without a real binary. Confirms input
 * validation, success path, and render-failure propagation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Plan check — always pass as 'pro' so we don't need DB.
vi.mock('@/lib/plan-guard', () => ({
  checkPlan: vi.fn(async () => ({ ok: true, userId: 'test-user', plan: 'pro' })),
}));

// Rate limiter — never block in tests.
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(() => ({ allowed: true, remaining: 99, resetAt: Date.now() + 3_600_000 })),
}));

// Default render mock — happy path. Individual tests override via .mockImplementationOnce.
const runOpenScadCli = vi.fn();
vi.mock('@/lib/openscad-render/runOpenScadCli', () => ({
  runOpenScadCli: (opts: unknown) => runOpenScadCli(opts),
}));

// Stub out the STL parse + topology so we don't pull three / mesh-bvh into
// the node-environment test. Return only the fields verifyAgainstSpec needs
// (bbox + optional measurements).
const verifyStlBuffer = vi.fn();
vi.mock('@/lib/ai/scad-agent/serverAdapters', () => ({
  verifyStlBuffer: (buf: Buffer) => verifyStlBuffer(buf),
}));

type RoutePOST = (typeof import('@/app/api/nexyfab/verify-spec/route'))['POST'];

let POST: RoutePOST;

beforeEach(async () => {
  vi.resetModules();
  runOpenScadCli.mockReset();
  verifyStlBuffer.mockReset();
  // Default happy implementations — individual tests override via .mockImplementationOnce.
  runOpenScadCli.mockImplementation(async () => ({
    ok: true,
    buffer: Buffer.from('STL_BYTES'),
    stderr: '',
  }));
  verifyStlBuffer.mockImplementation(async () => ({
    triangleCount: 12,
    volume_mm3: 125_000,
    surfaceArea_mm2: 15_000,
    manifold: true,
    watertight: true,
    componentCount: 1,
    genus: 0,
    detectedHoles: [] as Array<{ axis: 'x' | 'y' | 'z'; cx: number; cy: number; diameter: number }>,
    dihedralStats: { sharpEdgeCount: 0, maxDihedralDeg: 90 },
    bbox: { min: [-25, -25, -25] as [number, number, number], max: [25, 25, 25] as [number, number, number] },
  }));
  ({ POST } = await import('@/app/api/nexyfab/verify-spec/route'));
});

function callRoute(body: unknown) {
  const req = new Request('http://test/api/nexyfab/verify-spec', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<RoutePOST>[0]);
}

describe('POST /api/nexyfab/verify-spec', () => {
  it('returns 400 when scad is missing', async () => {
    const res = await callRoute({ intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('SCAD_REQUIRED');
  });

  it('returns 400 when intent is not an object with shapeId', async () => {
    const res = await callRoute({ scad: 'cube([10,10,10]);', intent: { params: { x: 1 } } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INTENT_INVALID');
  });

  it('returns 200 with a verifiable SpecVerificationResult on happy path', async () => {
    const res = await callRoute({
      scad: 'cube([50,50,50], center=true);',
      intent: {
        shapeId: 'box',
        params: { width: 50, height: 50, depth: 50 },
        features: [],
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.verifiable).toBe(true);
    // bbox 50³ matches intent → expect ok=true and no mismatches.
    expect(body.result.mismatches).toEqual([]);
    expect(body.result.measured).toEqual({ wMm: 50, hMm: 50, dMm: 50 });
  });

  it('returns 502 with stderr propagation when the renderer fails', async () => {
    runOpenScadCli.mockImplementationOnce(async () => ({
      ok: false,
      code: 'EXIT',
      message: 'OpenSCAD exited with code 1',
      stderr: 'ERROR: Parser error in file model.scad, line 1: syntax error',
    }));
    const res = await callRoute({
      scad: 'cubz([10]);',
      intent: { shapeId: 'box', params: { width: 10, height: 10, depth: 10 } },
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('OpenSCAD render failed');
    expect(body.error).toContain('Parser error');
    expect(body.code).toBe('EXIT');
  });
});
