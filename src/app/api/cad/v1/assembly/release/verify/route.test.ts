import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/app/api/cad/v1/assembly/verify/route', () => ({ POST: vi.fn() }));
vi.mock('@/app/api/cad/v1/assembly/animation/verify/route', () => ({ POST: vi.fn() }));
vi.mock('@/lib/reference/jointEvidenceReleaseGate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/reference/jointEvidenceReleaseGate')>();
  return { ...actual, evaluateJointEvidenceRelease: vi.fn(actual.evaluateJointEvidenceRelease) };
});

import { POST as staticVerifyPost } from '@/app/api/cad/v1/assembly/verify/route';
import { POST as continuousVerifyPost } from '@/app/api/cad/v1/assembly/animation/verify/route';
import { evaluateJointEvidenceRelease } from '@/lib/reference/jointEvidenceReleaseGate';
import { POST } from './route';

const state = {
  version: 1 as const,
  parts: [{ id: 'part-1', name: 'Part 1', position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }],
  mates: [],
};
const featureTrees = { 'part-1': { nodes: [] } };
const animation = {
  version: 1 as const,
  name: 'Governed motion',
  fps: 30,
  startFrame: 0,
  endFrame: 30,
  loop: false,
  tracks: [{
    id: 'pose:part-1',
    targetPartId: 'part-1',
    keyframes: [
      { frame: 0, position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, interpolation: 'linear' as const },
      { frame: 30, position: { x: 10, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, interpolation: 'linear' as const },
    ],
  }],
};
const exactEvidence = {
  'part-1': { solidCount: 1, stepSha256: 'a'.repeat(64), stepRoundTripVolumeRelError: 0 },
};

function staticPayload() {
  return {
    ok: true,
    state,
    exactCadEvidence: exactEvidence,
    flaggedInterferences: [],
    verificationUnavailable: [],
    assemblyCertificate: {
      solver: 'pass',
      converged: true,
      finalMaxResidual: 0,
      tolerance: 1e-4,
      unsupportedResiduals: 0,
      dofAccepted: true,
      interference: 'precise',
      intendedContactsDocumented: true,
      exactCad: 'pass',
    },
  };
}

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/cad/v1/assembly/release/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cad/v1/assembly/release/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(staticVerifyPost).mockImplementation(async () => NextResponse.json(staticPayload()) as never);
    vi.mocked(continuousVerifyPost).mockImplementation(async () => NextResponse.json({
      ok: true,
      precise: { status: 'completed', collisionFree: true, failureCodes: [], geometryErrors: [], exactCadEvidence: exactEvidence },
    }) as never);
  });

  it('issues one hashed release certificate for a fixed exact assembly', async () => {
    const response = await POST(request({ state, featureTrees, allowedDoF: 0 }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(continuousVerifyPost).not.toHaveBeenCalled();
    expect(json).toMatchObject({
      ok: true,
      releaseReady: true,
      releaseExecuted: false,
      quoteOrRfqSideEffects: false,
      assemblyCertificate: { motion: 'not_required', jointEvidence: 'not_required', exactEvidenceConsistent: true },
      releaseCertificate: {
        schema: 'nexyfab.assembly-release-certificate.v1',
        releaseReady: true,
        checks: { solverAndResidual: true, continuousMotion: 'not_required', nativeJointEvidence: 'not_required' },
      },
    });
    expect(json.verificationInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(json.releaseCertificate.certificateSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires a governed non-empty animation for a movable release', async () => {
    const response = await POST(request({ state, featureTrees, allowedDoF: 1 }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, code: 'GOVERNED_ANIMATION_REQUIRED', releaseExecuted: false });
    expect(staticVerifyPost).not.toHaveBeenCalled();
  });

  it('returns the unified review target and blocks movable release while signed joint evidence is missing', async () => {
    const response = await POST(request({ state, featureTrees, animation, allowedDoF: 1 }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.releaseReady).toBe(false);
    expect(json.assemblyCertificate).toMatchObject({ motion: 'pass', jointEvidence: 'fail', exactEvidenceConsistent: true });
    expect(json.jointEvidenceGate).toMatchObject({ status: 'not_run', errors: ['joint_evidence_missing'] });
    expect(json.releaseCertificate.blockers).toEqual(expect.arrayContaining([expect.stringContaining('joint evidence')]));
    expect(json.verificationInputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('passes only when continuous exact evidence matches and the unified joint review passes', async () => {
    vi.mocked(evaluateJointEvidenceRelease).mockReturnValue({
      status: 'pass',
      nativeKpiEligible: true,
      manufacturingReleaseEligible: true,
      usage: 'native-verified',
      errors: [],
    });
    const jointEvidence = {
      provenance: 'native-cad', sourceHash: 'b'.repeat(64), artifactHashes: ['c'.repeat(64)],
      jointDefinitionHash: 'd'.repeat(64), verificationInputHash: 'e'.repeat(64), revision: 1, jointCount: 1, semanticsComplete: true,
    };
    const response = await POST(request({ state, featureTrees, animation, allowedDoF: 1, jointEvidence }));
    const json = await response.json();
    expect(json.releaseReady).toBe(true);
    expect(json.releaseCertificate).toMatchObject({
      releaseReady: true,
      checks: { continuousMotion: true, nativeJointEvidence: true, exactEvidenceConsistent: true },
      blockers: [],
    });
    expect(evaluateJointEvidenceRelease).toHaveBeenCalledWith(jointEvidence, undefined, json.verificationInputHash);

    vi.mocked(continuousVerifyPost).mockImplementationOnce(async () => NextResponse.json({
      ok: true,
      precise: {
        status: 'completed', collisionFree: true, failureCodes: [],
        exactCadEvidence: { 'part-1': { ...exactEvidence['part-1'], stepSha256: 'f'.repeat(64) } },
      },
    }) as never);
    const mismatchResponse = await POST(request({ state, featureTrees, animation, allowedDoF: 1, jointEvidence }));
    const mismatch = await mismatchResponse.json();
    expect(mismatch.releaseReady).toBe(false);
    expect(mismatch.releaseCertificate.checks.exactEvidenceConsistent).toBe(false);
    expect(mismatch.releaseCertificate.blockers).toEqual(expect.arrayContaining([expect.stringContaining('different exact CAD evidence')]));
  });
});
