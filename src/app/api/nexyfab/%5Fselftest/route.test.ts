/**
 * _selftest route — SECURITY CONTRACT + FEA response SHAPE.
 *
 * These tests deliberately require NEITHER gmsh, OpenSCAD, NOR an LLM: the STL
 * fixture render and `feaFromStlAsync` are both mocked. We assert two things:
 *   1) the endpoint is invisible (404) whenever SELFTEST_TOKEN is unset or the
 *      supplied token is wrong — the token IS the auth;
 *   2) the `?what=fea` handler shapes the (mocked) production FEA output into the
 *      exact ops-probe JSON we depend on (meshMode/grade/gmshUsed/kt/err/...).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the fixture generator so no OpenSCAD binary is needed.
vi.mock('./fixtures', () => ({
  renderFixtureStl: vi.fn(async () => new Uint8Array(84)),
  PLATE_HOLE_A5: {
    widthMm: 120,
    thicknessMm: 8,
    holeRadiusMm: 10,
    lengthMm: 200,
    totalLoadN: 100_000,
    nominalMPa: () => 125, // 100000 / ((120 - 20) * 8)
  },
}));

// Mock the production precise FEA path so no gmsh / solver run is needed.
const feaMock = vi.fn();
vi.mock('@/app/[lang]/shape-generator/analysis/feaPackage', () => ({
  feaFromStlAsync: (...args: unknown[]) => feaMock(...args),
}));

import { GET } from './route';

function makeReq(query: string, headers?: Record<string, string>): Request {
  return new Request(`http://localhost/api/nexyfab/_selftest${query}`, { method: 'GET', headers });
}

const SAVED = process.env.SELFTEST_TOKEN;
beforeEach(() => {
  feaMock.mockReset();
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
    expect(feaMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the token is wrong', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    const res = await GET(makeReq('?token=nope&what=fea') as never);
    expect(res.status).toBe(404);
    expect(feaMock).not.toHaveBeenCalled();
  });

  it('returns 404 when no token is supplied at all', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    const res = await GET(makeReq('?what=fea') as never);
    expect(res.status).toBe(404);
  });
});

describe('_selftest route — fea response shape (mocked FEA, no gmsh)', () => {
  const cannedGmsh = {
    result: {
      maxStress: 375, // / nominal 125 => Kt 3.0 exactly
      minStress: 0,
      maxDisplacement: 0.42,
      safetyFactor: 235 / 375,
      method: 'linear-fem-tet' as const,
      elementCount: 41000,
      dofCount: 68000,
      converged: true,
    },
    material: { label: '일반구조강(SS275급)', yieldStrength: 235 },
    materialKey: 'steel',
    loadN: 100_000,
    loadNote: 'self-test',
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
  };

  it('accepts a valid token and shapes the gmsh cert-grade result correctly', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    feaMock.mockResolvedValueOnce(cannedGmsh);
    const res = await GET(makeReq('?token=secret-value&what=fea') as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    // the production precise path was invoked with precise:true
    expect(feaMock).toHaveBeenCalledTimes(1);
    expect(feaMock.mock.calls[0]![0]).toMatchObject({ precise: true, materialKey: 'steel', loadN: 100_000 });

    // exact ops-probe shape
    expect(body.what).toBe('fea');
    expect(body.meshMode).toBe('gmsh-conforming');
    expect(body.grade).toBe('certification-candidate');
    expect(body.gmshUsed).toBe(true);
    expect(body.kt).toBe(3);
    expect(body.ktRefKirsch).toBe(3.0);
    expect(body.errPctVsKirsch).toBe(0);
    expect(body.dofCount).toBe(68000);
    expect(body.wallMs).toBe(24000);
    expect(body.converged).toBe(true);
    expect(body.raiserDetected).toBe(true);
    expect(body.raiserApplied).toBe(true);
    expect(body.maxStressMPa).toBe(375);
    expect(body.nominalMPa).toBe(125);
    expect(typeof body.totalWallMs).toBe('number');
  });

  it('reports gmshUsed=false when the octree fallback (engineering grade) ran', async () => {
    process.env.SELFTEST_TOKEN = 'secret-value';
    feaMock.mockResolvedValueOnce({
      ...cannedGmsh,
      raiser: { ...cannedGmsh.raiser, grade: 'engineering', meshMode: 'refined' },
    });
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
