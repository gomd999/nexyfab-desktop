/**
 * _selftest route — SECURITY CONTRACT + FEA response SHAPE.
 *
 * These tests deliberately require NEITHER Redis, gmsh, OpenSCAD, NOR an LLM:
 * the STL fixture render and durable FEA worker queue are mocked. We assert:
 *   1) the endpoint is invisible (404) whenever SELFTEST_TOKEN is unset or the
 *      supplied token is wrong — the token IS the auth;
 *   2) the `?what=fea` handler shapes the (mocked) production FEA output into the
 *      exact ops-probe JSON we depend on (meshMode/grade/gmshUsed/kt/err/...).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FeaJobResult } from '@/lib/fea-jobs/contracts';

// Mock the fixture generator so no OpenSCAD binary is needed.
vi.mock('./fixtures', () => ({
  renderFixtureStl: vi.fn(async () => new Uint8Array(84)),
  PLATE_HOLE_A5: {
    widthMm: 120,
    thicknessMm: 8,
    holeRadiusMm: 10,
    lengthMm: 200,
    totalLoadN: 100_000,
    grossNominalMPa: () => 100,
    netNominalMPa: () => 125,
    howlandKtNet: () => 2.5,
  },
}));

// Mock the durable worker queue so no Redis, gmsh, or solver process is needed.
const enqueueMock = vi.fn();
const getJobMock = vi.fn();
vi.mock('@/lib/fea-jobs/redisFeaJobs', () => ({
  enqueueFeaJob: (...args: unknown[]) => enqueueMock(...args),
  getFeaJobForOwner: (...args: unknown[]) => getJobMock(...args),
}));

import { GET } from './route';

function makeReq(query: string, headers?: Record<string, string>): Request {
  return new Request(`http://localhost/api/nexyfab/_selftest${query}`, { method: 'GET', headers });
}

const SAVED = process.env.SELFTEST_TOKEN;
beforeEach(() => {
  enqueueMock.mockReset();
  getJobMock.mockReset();
  delete process.env.SELFTEST_TOKEN;
});
afterEach(() => {
  if (SAVED === undefined) delete process.env.SELFTEST_TOKEN;
  else process.env.SELFTEST_TOKEN = SAVED;
});

describe('_selftest route — security contract', () => {
  it('returns 404 when SELFTEST_TOKEN is unset (endpoint hidden, even with a token)', async () => {
    const res = await GET(makeReq('?token=anything&what=fea') as never);
    expect(res.status).toBe(404);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the token is wrong', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    const res = await GET(makeReq('?token=nope&what=fea') as never);
    expect(res.status).toBe(404);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('returns 404 when no token is supplied at all', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    const res = await GET(makeReq('?what=fea') as never);
    expect(res.status).toBe(404);
  });
});

describe('_selftest route — fea response shape (mocked FEA, no gmsh)', () => {
  const cannedGmsh: FeaJobResult = {
    method: 'linear-fem-tet' as const,
    grade: 'certification-candidate' as const,
    maxStressMPa: 300, // / gross nominal 100 => Kirsch Kt 3.0 exactly
    minStressMPa: 0,
    maxDisplacementMm: 0.42,
    safetyFactor: 235 / 375,
    elementCount: 41000,
    dofCount: 68000,
    converged: true,
    material: { key: 'steel', label: '일반구조강(SS275급)', yieldMPa: 235 },
    mesh: { triangles: 1234, fixedTris: 40, loadTris: 40 },
    refined: null,
    raiser: {
      detected: true,
      applied: true,
      grade: 'certification-candidate' as const,
      meshMode: 'gmsh-conforming' as const,
      dofCount: 68000,
      converged: true,
      wallMs: 24000,
      note: 'gmsh boundary-conforming mesh',
    },
    reportHtml: '<html></html>', expertApproval: null, manufacturingReady: false as const, completedAt: 2,
  };

  const queued = {
    id: 'fea-0123456789abcdef01234567', ownerUserId: 'ops:selftest:fea', scopeId: 'ops:selftest',
    status: 'queued' as const, progress: { percent: 0, stage: 'queued' as const }, createdAt: 1, updatedAt: 1,
    attempts: 0, maxAttempts: 3, requestHash: 'r', idempotencyHash: 'i',
  };

  function mockCompleted(result = cannedGmsh) {
    enqueueMock.mockResolvedValueOnce({ ok: true, reused: false, job: queued });
    getJobMock.mockResolvedValueOnce({ ...queued, status: 'complete', result });
  }

  it('accepts a valid token and shapes the gmsh cert-grade result correctly', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    mockCompleted();
    const res = await GET(makeReq('?token=secret-value&what=fea') as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    // the production precise path was invoked with precise:true
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock.mock.calls[0]![0]).toMatchObject({ request: { precise: true, materialKey: 'steel', loadN: 100_000 } });

    // exact ops-probe shape
    expect(body.what).toBe('fea');
    expect(body.meshMode).toBe('gmsh-conforming');
    expect(body.grade).toBe('certification-candidate');
    expect(body.gmshUsed).toBe(true);
    expect(body.kt).toBe(3);
    expect(body.ktBasis).toBe('gross-section');
    expect(body.ktRefKirsch).toBe(3.0);
    expect(body.errPctVsKirsch).toBe(0);
    expect(body.ktNet).toBe(2.4);
    expect(body.ktRefHowlandNet).toBe(2.5);
    expect(body.errPctVsHowlandNet).toBe(4);
    expect(body.dofCount).toBe(68000);
    expect(body.wallMs).toBe(24000);
    expect(body.converged).toBe(true);
    expect(body.raiserDetected).toBe(true);
    expect(body.raiserApplied).toBe(true);
    expect(body.maxStressMPa).toBe(300);
    expect(body.nominalMPa).toBe(100);
    expect(body.grossNominalMPa).toBe(100);
    expect(body.netNominalMPa).toBe(125);
    expect(typeof body.totalWallMs).toBe('number');
  });

  it('reports gmshUsed=false when the octree fallback (engineering grade) ran', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    mockCompleted({ ...cannedGmsh, grade: 'engineering', raiser: { ...cannedGmsh.raiser!, grade: 'engineering', meshMode: 'refined' } });
    const res = await GET(makeReq('?token=secret-value&what=fea') as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.meshMode).toBe('refined');
    expect(body.grade).toBe('engineering');
    expect(body.gmshUsed).toBe(false);
    expect(body.kt).toBe(3);
  });

  it('returns 400 for an unknown what', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    const res = await GET(makeReq('?token=secret-value&what=bogus') as never);
    expect(res.status).toBe(400);
  });
});
