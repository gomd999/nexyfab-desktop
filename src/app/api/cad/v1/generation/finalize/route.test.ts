import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { bindGenerationProgram, createGenerationRun, GENERATION_STAGES, recordGenerationStage } from '@/lib/ai/generationRunState';
import { createServerGenerationState, resetGenerationStateStoreForTests } from '@/lib/ai/generationStateStore';
import { serverEvidenceSha256 } from '@/lib/ai/serverEvidence';
import { issueCommercialFinalizationReceipt } from '@/lib/ai/commercialFinalizationReceipt';
import { POST } from './route';

vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => 'test') }));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => null) }));
const animationVerifier = vi.hoisted(() => ({ captured: null as unknown, post: vi.fn(async (request: NextRequest) => {
  animationVerifier.captured = await request.json();
  return NextResponse.json({ ok: true, releaseReady: false });
}) }));
vi.mock('@/app/api/cad/v1/assembly/animation/verify/route', () => ({ POST: animationVerifier.post }));

const request = (body: unknown) => new NextRequest('http://localhost/api/cad/v1/generation/finalize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function state() { let result = createGenerationRun('route'); for (const stage of GENERATION_STAGES.slice(0, 7)) result = recordGenerationStage(result, { stage, input: stage, output: true, status: 'passed' }); return result; }
const program = {
  version: 1 as const, units: 'mm' as const, classification: 'review_required' as const, name: 'part', unresolved: [],
  assembly: { parts: [{ id: 'p1', name: 'p1', partTemplateId: 'p1', fixed: true, position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }], mates: [] },
  parts: [{ instanceId: 'p1', metadata: { partNumber: 'P1', revision: 'A', quantity: 1, source: 'confirmed' as const }, featureTree: { nodes: [{ id: 'e', name: 'e', dependencies: [], payload: { kind: 'extrude' as const, loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], depth: 1, direction: 'one_sided' as const, mode: 'add' as const } }] } }],
};
const preparedState = () => bindGenerationProgram(state(), serverEvidenceSha256(program));

describe('generation finalize route', () => {
  beforeEach(() => resetGenerationStateStoreForTests());
  afterEach(() => { delete process.env.NEXYFAB_REQUIRE_SIGNED_GENERATION_EVIDENCE; delete process.env.GENERATION_EVIDENCE_SIGNING_SECRET; });
  it('rejects client-supplied commercial receipt bytes/trust controls', async () => { const response = await POST(request({ commercialReceipt: { releaseReady: true }, registry: [], rawReceiptBytes: 'fake' })); expect(response.status).toBe(400); await expect(response.json()).resolves.toMatchObject({ code: 'COMMERCIAL_RECEIPT_SERVER_ONLY', status: 'HOLD', releaseReady: false }); });
  it('rejects incomplete request envelopes', async () => { const response = await POST(request({})); expect(response.status).toBe(400); });
  it('returns actionable not_run motion evidence when governed animation is missing', async () => {
    const prepared = preparedState(); await createServerGenerationState('guest:test', prepared);
    const response = await POST(request({ state: prepared, program, motion: { required: true }, parts: [] })); const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ ok: true, stoppedAt: 'motion', canonical: { schema: 'nexyfab.generation-canonical-response.v1', status: 'not_run', stoppedAt: 'motion', releaseReady: false, quoteOrRfqSideEffects: false }, recovery: { action: 'request_input', stage: 'motion' }, quoteOrRfqSideEffects: false }); expect(body.canonical.contractHash).toMatch(/^[a-f0-9]{64}$/); expect(body.state.stages.motion.status).toBe('not_run');
  });
  it('forwards governed joint evidence into server-side continuous motion verification', async () => {
    const prepared = preparedState(); await createServerGenerationState('guest:test', prepared);
    const jointEvidence = { provenance: 'user-confirmed' as const, sourceHash: 'a'.repeat(64), artifactHashes: ['b'.repeat(64)], jointDefinitionHash: 'c'.repeat(64), verificationInputHash: 'd'.repeat(64), revision: 1, jointCount: 0, semanticsComplete: true, reviewerApproved: true };
    const animation = { version: 1 as const, name: 'still', fps: 30, startFrame: 0, endFrame: 1, tracks: [] };
    const response = await POST(request({ state: prepared, program, motion: { required: true, animation, jointEvidence }, parts: [] }));
    expect(response.status).toBe(200);
    expect(animationVerifier.post).toHaveBeenCalledOnce();
    expect((animationVerifier.captured as { jointEvidence: unknown }).jointEvidence).toEqual(jointEvidence);
  });
  it('rejects a program that differs from the server-bound kernel program', async () => {
    const prepared = preparedState(); await createServerGenerationState('guest:test', prepared);
    const changed = { ...program, name: 'silently simplified' };
    const response = await POST(request({ state: prepared, program: changed, motion: { required: false }, parts: [] }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toBe('GENERATION_PROGRAM_BINDING_MISMATCH');
  });
  it('rejects unsigned client-asserted manufacturing measurements in the commercial trust path', async () => {
    process.env.NEXYFAB_REQUIRE_SIGNED_GENERATION_EVIDENCE = '1';
    process.env.GENERATION_EVIDENCE_SIGNING_SECRET = 'commercial-generation-evidence-secret-32-bytes';
    const prepared = preparedState(); await createServerGenerationState('guest:test', prepared);
    const part = { partId: 'p1', manufacturing: { kernel: { built: true, analytic: true, errors: [] } } };
    const response = await POST(request({ state: prepared, program, motion: { required: false }, parts: [part] }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.code).toContain('COMMERCIAL_SERVER_EVIDENCE_REQUIRED');
  });
  it('accepts only evidence bound to the server run, revision, part and program', async () => {
    process.env.NEXYFAB_REQUIRE_SIGNED_GENERATION_EVIDENCE = '1';
    const secret = 'commercial-generation-evidence-secret-32-bytes'; process.env.GENERATION_EVIDENCE_SIGNING_SECRET = secret;
    const prepared = preparedState(); await createServerGenerationState('guest:test', prepared);
    const part = { partId: 'p1', manufacturing: { kernel: { built: true, analytic: true, errors: [] } } };
    const receipt = issueCommercialFinalizationReceipt({ runId: prepared.runId, revision: prepared.revision, partId: 'p1', programSha256: serverEvidenceSha256(program), kernelCheckpointHash: prepared.stages.kernel.checkpointHash!, topologyCheckpointHash: prepared.stages.topology.checkpointHash!, partEvidence: part }, secret);
    const response = await POST(request({ state: prepared, program, motion: { required: false }, parts: [part], evidenceReceipts: { p1: receipt } }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.stoppedAt).toBe('manufacturing');
  });
});
