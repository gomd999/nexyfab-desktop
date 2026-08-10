/**
 * POST /api/nexyfab/design-brief — WA-D3 API surface tests.
 *
 * The design driver runs FOR REAL here (deterministic fixturePlanner) — only
 * the auth/plan/budget guards are mocked, so the 200-package and 422-refusal
 * assertions exercise the true gate chain (실행형 판정).
 *
 * Matrix: 200 + verified package · 422 explicit refusal (unknown brief) ·
 *         401 unauthenticated · 429 monthly plan gate · 400 bad body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// ── auth / plan / budget guards (mocked; driver itself is real) ──────────────
const planState: { mode: 'ok' | 'unauth' } = { mode: 'ok' };
const slotState: { ok: boolean; used: number; limit: number } = { ok: true, used: 1, limit: 20 };
const budgetState: { ok: boolean } = { ok: true };
const featureState: { enabled: boolean } = { enabled: true };

vi.mock('@/lib/plan-guard', () => ({
  checkPlan: vi.fn(async () => (planState.mode === 'ok'
    ? { ok: true, userId: 'u-test', plan: 'free' }
    : { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) })),
  consumeMonthlyMetricSlot: vi.fn(async () => (slotState.ok
    ? { ok: true, used: slotState.used, limit: slotState.limit }
    : { ok: false, used: slotState.used, limit: slotState.limit })),
}));
vi.mock('@/lib/ai/userBudget', () => ({
  checkUserBudget: vi.fn(async () => ({ ok: budgetState.ok, usedCents: 0, limitUsd: budgetState.ok ? null : 5, resetAtMs: null, fraction: 0, approaching: false, source: 'no-limit' })),
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/error-capture', () => ({ captureServerError: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async () => featureState.enabled),
}));

import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/nexyfab/design-brief', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  planState.mode = 'ok';
  slotState.ok = true; slotState.used = 1; slotState.limit = 20;
  budgetState.ok = true;
  featureState.enabled = true;
});

describe('POST /api/nexyfab/design-brief', () => {
  it('valid brief → 200 with a verified package (all gates passed)', async () => {
    const r = await POST(makeReq({ brief: { text: 'L-Bracket', params: { fixture: 'l-bracket' } } }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.planId).toBe('fixture-l-bracket');
    expect(data.package.parts).toHaveLength(1);
    // Real measured volume from the deterministic fixture (exact L-prism).
    expect(data.package.parts[0].volumeMm3).toBeCloseTo(14720, 6);
    expect(data.package.parts[0].dxf.length).toBeGreaterThan(0);
    expect(data.package.report.allPassed).toBe(true);
    expect(data.package.report.gates.every((g: { pass: boolean }) => g.pass)).toBe(true);
    expect(data.package.parts[0].exactCad.bodies[0].step).toMatch(/^ISO-10303-21;/);
    expect(data.package.parts[0].exactCad.bodies[0].roundTripVolumeRelError).toBeLessThanOrEqual(1e-9);
    expect(data.package.parts[0].exactDrawing.views).toHaveLength(3);
    expect(data.package.parts[0].exactDrawing.views.every((view: { method: string }) => view.method === 'replicad-hlr')).toBe(true);
    expect(data.package.parts[0].exactDrawing.views.every((view: { visiblePathCount: number }) => view.visiblePathCount > 0)).toBe(true);
    expect(data.package.parts[0].exactDrawing.views[0].svg).toMatch(/^<\?xml/);
    expect(data.package.parts[0].exactDrawing.views.every((view: { curveCount: number }) => view.curveCount > 0)).toBe(true);
    expect(data.package.parts[0].exactDrawing.views.every((view: { exactDxf: string }) => view.exactDxf.includes('\nENTITIES\n'))).toBe(true);
    expect(data.package.parts[0].manufacturingDrawing).toMatchObject({
      releaseEligible: false,
      plannedDimensionCount: expect.any(Number),
      includedDimensionCount: expect.any(Number),
    });
    expect(data.package.parts[0].manufacturingDrawing.sheets).toHaveLength(1);
    expect(data.package.parts[0].manufacturingDrawing.sheets[0]).toMatchObject({
      exactViewCount: 3,
      releaseStatus: 'engineering-review-required',
    });
    expect(data.package.parts[0].manufacturingDrawing.sheets[0].svg).toContain('ENGINEERING REVIEW REQUIRED · NOT RELEASED');
    // Honesty disclosures present.
    expect(data.package.report.limitations.length).toBeGreaterThan(0);
    expect(data.execution).toMatchObject({
      mode: 'reference-fixture',
      assuranceLevel: 'deterministic-reference',
      manufacturingReleaseReady: false,
      workspaceApplied: false,
      humanReviewRequired: true,
    });
    expect(data.workspaceCandidate).toMatchObject({
      supported: true,
      target: 'modeler-feature-tree',
      reverificationRequired: true,
      inheritedVerification: false,
      manufacturingReleaseReady: false,
    });
    expect(data.usage).toMatchObject({ limit: 20 });
  });

  it('free-text AI brief is fail-closed when the operator beta flag is disabled', async () => {
    featureState.enabled = false;
    const r = await POST(makeReq({ brief: { text: 'Design a six-axis robot arm' } }) as never);
    expect(r.status).toBe(503);
    const data = await r.json();
    expect(data.code).toBe('FEATURE_DISABLED');
    expect(data.execution).toMatchObject({
      mode: 'ai-generated',
      manufacturingReleaseReady: false,
      workspaceApplied: false,
      humanReviewRequired: true,
    });
  });

  it('assembly brief → 200 package with BOM + converged assembly', async () => {
    const r = await POST(makeReq({ brief: { text: 'pin block', params: { fixture: 'pin-block-assembly' } } }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.package.bom.length).toBeGreaterThanOrEqual(2);
    expect(data.package.assembly.converged).toBe(true);
    expect(data.workspaceCandidate).toMatchObject({
      supported: true,
      target: 'assembly-browser',
      inheritedVerification: false,
      manufacturingReleaseReady: false,
      assembly: {
        sourceSolve: { converged: true },
      },
    });
    expect(data.workspaceCandidate.assembly.state.mates).toHaveLength(2);
    expect(data.workspaceCandidate.assembly.state.parts.find((part: { id: string }) => part.id === 'block').refs.boss_axis.kind).toBe('axis');
    expect(Object.keys(data.workspaceCandidate.assembly.sourcePartExactCad)).toEqual(['block', 'pin']);
    expect(data.workspaceCandidate.assembly.sourcePartExactCad.pin.analyticCylinderBodyCount).toBe(1);
  });

  it('unknown brief → 422 explicit plan-stage refusal (no package, reason present)', async () => {
    const r = await POST(makeReq({ brief: { text: 'a spaceship', params: { fixture: 'nope' } } }) as never);
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.ok).toBe(false);
    expect(data.refusal.stage).toBe('plan');
    expect(data.refusal.reason).toMatch(/unknown brief/i);
    expect(data.package).toBeUndefined();
  });

  it('unauthenticated → 401', async () => {
    planState.mode = 'unauth';
    const r = await POST(makeReq({ brief: { text: 'L-Bracket', params: { fixture: 'l-bracket' } } }) as never);
    expect(r.status).toBe(401);
  });

  it('monthly plan slot exhausted → 429 MONTHLY_LIMIT', async () => {
    slotState.ok = false; slotState.limit = 5;
    const r = await POST(makeReq({ brief: { text: 'L-Bracket', params: { fixture: 'l-bracket' } } }) as never);
    expect(r.status).toBe(429);
    const data = await r.json();
    expect(data.code).toBe('MONTHLY_LIMIT');
  });

  it('missing brief text → 400', async () => {
    const r = await POST(makeReq({ brief: { params: { fixture: 'l-bracket' } } }) as never);
    expect(r.status).toBe(400);
  });

  it('malformed JSON body → 400', async () => {
    const r = await POST(makeReq('not json') as never);
    expect(r.status).toBe(400);
  });
});
