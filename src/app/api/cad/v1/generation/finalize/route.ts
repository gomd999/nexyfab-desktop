import { NextRequest, NextResponse } from 'next/server';
import { POST as verifyAnimationPost } from '@/app/api/cad/v1/assembly/animation/verify/route';
import { collisionGeometryFromFeatureTree } from '@/lib/assembly/featureTreePreciseInterference';
import { validateAiAssemblyProgram, type AiAssemblyProgram } from '@/lib/ai/aiAssemblyProgram';
import { finalizeGenerationRun, type PartFinalizationEvidence } from '@/lib/ai/finalizeGenerationRun';
import type { AgenticCommercialQualificationReceipt, AgenticCommercialQualificationVerificationContext } from '@/lib/ai/agenticCommercialQualificationReceipt';
import { buildGenerationCanonicalResponse } from '@/lib/ai/generationCanonicalResponse';
import { bindAdaptiveComplexProductExecutionPlan, buildAdaptiveComplexProductExecutionPlan } from '@/lib/ai/adaptiveComplexProductExecution';
import type { GenerationRunState } from '@/lib/ai/generationRunState';
import type { AssemblyAnimation } from '@/lib/assembly/assemblyAnimation';
import type { JointEvidenceClaim } from '@/lib/reference/jointEvidenceReleaseGate';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import { loadServerGenerationState, saveServerGenerationState } from '@/lib/ai/generationStateStore';
import { generationRequestOwner } from '@/lib/ai/generationRequestOwner';
import { serverEvidenceSha256 } from '@/lib/ai/serverEvidence';
import { verifyCommercialFinalizationReceipt, type CommercialFinalizationReceipt } from '@/lib/ai/commercialFinalizationReceipt';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { getAuthUser } from '@/lib/auth-middleware';
import { createDbVerifiedAgenticCommercialReceiptStore } from '@/lib/ai/verifiedAgenticCommercialReceiptStore';
import { loadVerifiedAgenticCommercialReceiptForGeneration } from '@/lib/ai/loadVerifiedAgenticCommercialReceiptForGeneration';
import { loadServerAgenticCommercialTrust } from '@/lib/ai/serverAgenticCommercialTrust';
import { loadCommercialGenerationRouteRun, saveCommercialGenerationRouteRun, type LoadedCommercialGenerationRun } from '@/lib/ai/commercialGenerationRouteState';
import { commercialPostgresMigrationAtLeast } from '@/lib/commercial-readiness';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
type Body = {
  projectId?: string;
  state?: GenerationRunState; program?: AiAssemblyProgram;
  motion?: { required: boolean; animation?: AssemblyAnimation; frameStep?: number; jointEvidence?: JointEvidenceClaim };
  parts?: PartFinalizationEvidence[];
  evidenceReceipts?: Record<string, CommercialFinalizationReceipt>;
  commercialReceiptId?: string; commercialReceiptSha256?: string;
  commercialReceipt?: unknown; registry?: unknown; clock?: unknown; mode?: unknown; rawReceiptBytes?: unknown;
};

export async function POST(req: NextRequest) {
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`cad-v1-generation-finalize:${ip}`, 20, 60_000).allowed) return NextResponse.json({ ok: false, code: 'RATE_LIMIT' }, { status: 429 });
  let body: Body | null;
  try { body = await readBoundedJson<Body>(req, 32 * 1024 * 1024); }
  catch (error) { const bounded = boundedJsonError(error); if (bounded) return NextResponse.json({ ok: false, code: bounded.code }, { status: bounded.status }); throw error; }
  if (body && (body.commercialReceipt !== undefined || body.registry !== undefined || body.clock !== undefined || body.mode !== undefined || body.rawReceiptBytes !== undefined)) return NextResponse.json({ ok: false, code: 'COMMERCIAL_RECEIPT_SERVER_ONLY', status: 'HOLD', releaseReady: false }, { status: 400 });
  if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && !commercialPostgresMigrationAtLeast(process.env, 2026082208)) return NextResponse.json({ ok: false, code: 'COMMERCIAL_GENERATION_MIGRATION_REQUIRED', status: 'HOLD', releaseReady: false }, { status: 503 });
  if (!body?.state || body.state.schema !== 'nexyfab.generation-run.v1' || !body.program || !body.motion || !Array.isArray(body.parts)) {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'state, program, motion and parts are required' }, { status: 400 });
  }
  const issues = validateAiAssemblyProgram(body.program);
  if (issues.length) return NextResponse.json({ ok: false, code: 'INVALID_PROGRAM', issues }, { status: 422 });
  if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') { const expectedPartIds = body.program.parts.map(part => part.instanceId).sort(); const actualPartIds = body.parts.map(part => part.partId).sort(); if (expectedPartIds.length !== actualPartIds.length || expectedPartIds.some((id, index) => id !== actualPartIds[index])) return NextResponse.json({ ok: false, code: 'FINALIZE_PART_EXACT_SET_MISMATCH', status: 'HOLD', releaseReady: false }, { status: 409 }); }
  try {
    const commercial = process.env.NEXYFAB_COMMERCIAL_MODE === '1';
    const owner = commercial ? '' : await generationRequestOwner(req, ip);
    const commercialCurrent: LoadedCommercialGenerationRun | undefined = commercial ? await loadCommercialGenerationRouteRun(req, body.projectId ?? '', body.state.runId, body.state.revision) : undefined;
    const stored = commercialCurrent?.state ?? await loadServerGenerationState(owner, body.state.runId);
    if (stored.revision !== body.state.revision) throw new Error('GENERATION_REVISION_CONFLICT');
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && !stored.evidenceBindings?.intentSnapshotSha256) throw new Error('GENERATION_INTENT_BINDING_MISSING');
    const programSha256 = serverEvidenceSha256(body.program);
    if (!stored.evidenceBindings?.programSha256) throw new Error('GENERATION_PROGRAM_BINDING_MISSING');
    if (stored.evidenceBindings.programSha256 !== programSha256) throw new Error('GENERATION_PROGRAM_BINDING_MISMATCH');
    let verifiedCommercialReceipt: AgenticCommercialQualificationReceipt | undefined;
    let verifiedCommercialContext: AgenticCommercialQualificationVerificationContext | undefined;
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') {
      if (!body.commercialReceiptId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.commercialReceiptId) || !body.commercialReceiptSha256 || !/^[a-f0-9]{64}$/.test(body.commercialReceiptSha256)) throw new Error('COMMERCIAL_VERIFIED_RECEIPT_REQUIRED');
      const db = getDbAdapter();
      const auth = await getAuthUser(req); if (!auth || !commercialCurrent) throw new Error('AUTHENTICATED_EDITOR_REQUIRED');
      const row = await db.queryOne<Record<string, unknown>>('SELECT tenant_id, project_id, execution_id, generation_run_id, revision, model_content_hash, target_sha256 FROM nf_agentic_commercial_verified_receipts WHERE receipt_id = ?', body.commercialReceiptId);
      if (!row || String(row.generation_run_id) !== stored.runId || Number(row.revision) !== commercialCurrent?.workspaceRevision) throw new Error('COMMERCIAL_VERIFIED_RECEIPT_BINDING_MISSING');
      if (String(row.project_id) !== commercialCurrent.projectId) throw new Error('PROJECT_EDITOR_REQUIRED');
      const tenantId = commercialCurrent.tenantId; if (tenantId !== String(row.tenant_id)) throw new Error('COMMERCIAL_RECEIPT_TENANT_BINDING_MISMATCH');
      const trust = loadServerAgenticCommercialTrust(); if (!trust.ok) throw new Error('SERVER_TRUST_NOT_CONFIGURED');
      const loaded = await loadVerifiedAgenticCommercialReceiptForGeneration(createDbVerifiedAgenticCommercialReceiptStore(db, getStorage()), { tenantId, projectId: String(row.project_id), receiptId: body.commercialReceiptId, executionId: String(row.execution_id), generationRunId: stored.runId, generationStateRevision: stored.revision, generationProgramSha256: programSha256, revision: Number(row.revision), modelContentHash: String(row.model_content_hash), targetSha256: String(row.target_sha256) }, trust.context);
      if (!loaded.ok || loaded.finalEnvelopeSha256 !== body.commercialReceiptSha256 || !loaded.receipt) throw new Error('COMMERCIAL_VERIFIED_RECEIPT_RUNTIME_RECHECK_FAILED');
      verifiedCommercialReceipt = loaded.receipt;
      verifiedCommercialContext = trust.context;
    }
    if (body.motion.required && !body.motion.animation) {
      const result = finalizeGenerationRun(stored, { motion: { required: true }, parts: body.parts, expectedPartIds: process.env.NEXYFAB_COMMERCIAL_MODE === '1' ? body.program.parts.map(part => part.instanceId) : undefined, commercialReceiptRef: body.commercialReceiptId && body.commercialReceiptSha256 ? { receiptId: body.commercialReceiptId, receiptSha256: body.commercialReceiptSha256 } : undefined, commercialReceipt: verifiedCommercialReceipt, commercialReceiptContext: verifiedCommercialContext });
      if (commercialCurrent) await saveCommercialGenerationRouteRun(commercialCurrent, result.state); else await saveServerGenerationState(owner, result.state, stored.revision);
      return NextResponse.json({ ok: true, ...result, canonical: buildGenerationCanonicalResponse(result), executionPlan: bindAdaptiveComplexProductExecutionPlan(buildAdaptiveComplexProductExecutionPlan(result.state), result.state, body.projectId ?? result.state.projectId), recovery: { action: 'request_input', stage: 'motion', reason: 'A governed animation is required.' }, quoteOrRfqSideEffects: false });
    }
    let motionVerification: { ok?: boolean; releaseReady?: boolean; precise?: unknown; broad?: unknown; code?: string; message?: string } | undefined;
    if (body.motion.required && body.motion.animation) {
      const built = await Promise.all(body.program.parts.map(async part => [part.instanceId, await collisionGeometryFromFeatureTree(part.instanceId, part.featureTree, { requireExact: true })] as const));
      const unavailable = built.filter(([, geometry]) => !geometry.available);
      if (unavailable.length) motionVerification = { ok: false, releaseReady: false, code: 'MOTION_GEOMETRY_UNAVAILABLE', message: unavailable.map(([, geometry]) => geometry.reason).join('; ') };
      else {
        const localBoxes = Object.fromEntries(built.map(([id, geometry]) => {
          const bbox = geometry.geometry.bbox!; return [id, { min: { x: bbox.min[0], y: bbox.min[1], z: bbox.min[2] }, max: { x: bbox.max[0], y: bbox.max[1], z: bbox.max[2] } }];
        }));
        const animationRequest = new NextRequest(new URL('/api/cad/v1/assembly/animation/verify', req.url), {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ state: body.program.assembly, animation: body.motion.animation, localBoxes, featureTrees: Object.fromEntries(body.program.parts.map(part => [part.instanceId, part.featureTree])), frameStep: body.motion.frameStep, jointEvidence: body.motion.jointEvidence }),
        });
        const response = await verifyAnimationPost(animationRequest); motionVerification = await response.json();
      }
    }
    const signedEvidenceRequired = process.env.NEXYFAB_COMMERCIAL_MODE === '1' || process.env.NEXYFAB_REQUIRE_SIGNED_GENERATION_EVIDENCE === '1';
    if (signedEvidenceRequired) {
      const secret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '';
      const kernelCheckpointHash = stored.stages.kernel.checkpointHash;
      const topologyCheckpointHash = stored.stages.topology.checkpointHash;
      if (!kernelCheckpointHash || !topologyCheckpointHash) throw new Error('GENERATION_EXACT_CAD_CHECKPOINT_MISSING');
      const receiptErrors = body.parts.flatMap(part => verifyCommercialFinalizationReceipt(body.evidenceReceipts?.[part.partId], {
        runId: stored.runId, revision: stored.revision, partId: part.partId, programSha256, kernelCheckpointHash, topologyCheckpointHash, partEvidence: part,
      }, secret).map(code => `${part.partId}:${code}`));
      if (receiptErrors.length) throw new Error(`GENERATION_COMMERCIAL_EVIDENCE_INVALID:${receiptErrors.join(',')}`);
      const expectedReceiptKeys = body.program.parts.map(part => part.instanceId).sort();
      const actualReceiptKeys = Object.keys(body.evidenceReceipts ?? {}).sort();
      if (expectedReceiptKeys.length !== actualReceiptKeys.length || expectedReceiptKeys.some((id, index) => id !== actualReceiptKeys[index])) throw new Error('GENERATION_EVIDENCE_RECEIPT_EXACT_SET_MISMATCH');
    }
    const result = finalizeGenerationRun(stored, { motion: { required: body.motion.required, verification: motionVerification }, parts: body.parts, expectedPartIds: process.env.NEXYFAB_COMMERCIAL_MODE === '1' ? body.program.parts.map(part => part.instanceId) : undefined, commercialReceiptRef: body.commercialReceiptId && body.commercialReceiptSha256 ? { receiptId: body.commercialReceiptId, receiptSha256: body.commercialReceiptSha256 } : undefined, commercialReceipt: verifiedCommercialReceipt, commercialReceiptContext: verifiedCommercialContext });
    if (commercialCurrent) await saveCommercialGenerationRouteRun(commercialCurrent, result.state); else await saveServerGenerationState(owner, result.state, stored.revision);
    const stopped = result.stoppedAt;
    const recovery = stopped === 'complete' ? undefined : {
      action: stopped === 'motion' ? 'retry_stage' : stopped === 'release' ? 'request_input' : 'retry_affected_parts',
      stage: stopped,
      affectedPartIds: result.state.stages[stopped].affectedPartIds,
      reason: result.state.stages[stopped].unresolved.join(' '),
    };
    return NextResponse.json({ ok: true, ...result, canonical: buildGenerationCanonicalResponse(result), executionPlan: bindAdaptiveComplexProductExecutionPlan(buildAdaptiveComplexProductExecutionPlan(result.state), result.state, body.projectId ?? result.state.projectId), recovery, quoteOrRfqSideEffects: false });
  } catch (error) { return transitionError(error); }
}

function transitionError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Generation finalization failed';
    const status = message === 'GENERATION_RUN_NOT_FOUND' ? 404 : message === 'GENERATION_STATE_REDIS_REQUIRED' || message === 'GENERATION_STATE_POSTGRES_AUTHORITATIVE_REQUIRED' ? 503 : 409;
  return NextResponse.json({ ok: false, code: message.startsWith('GENERATION_') ? message : 'FINALIZE_FAILED', message }, { status });
}
