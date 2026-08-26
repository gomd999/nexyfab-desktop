import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { ensureCadWorkspaceRevisionTables, readCadWorkspaceRevision } from '@/lib/cad/workspaceRevisionStore';
import { ensureDirectArtifactUploadTables, resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { assertRemotePendingToolCall, assertRemoteProjectRevision, claimRemotePendingToolCall, executeRemoteAgentCall, hashRemoteArguments, loadInstallerCoreCatalog, makeRemoteApprovalToken, releaseRemotePendingToolCall, validateRemoteBinding } from '@/lib/precision-cad-agent/remoteAgentApi';
import { REMOTE_PRECISION_CAD_CONTRACT_VERSION, validateRemotePrecisionCadToolCall, type RemotePrecisionCadToolCall } from '@/lib/precision-cad-agent/remoteCadContract';
import { executePrecisionCadToolInIsolatedWorker, hasPrecisionCadWorkerCadReference, type PrecisionCadWorkerJob } from '@/lib/precision-cad-agent/isolatedWorkerQueue';
import { persistPrecisionCadResult, summarizePrecisionCadToolResult } from '@/lib/precision-cad-agent/precisionCadResultPersistence';
import { dispatchCadJob } from '@/lib/platform/jobOrchestratorClient';
import { JOB_CONTRACT_VERSION } from '@/lib/platform/contracts';
import { consumeDbApprovalChallenge, ensureApprovalChallengeTable, hashBoundaryArguments, issueDbApprovalChallenge, type BoundaryRole } from '@/lib/precision-cad-agent/commercialAgentExecutionBoundary';
import { enqueueCommercialExecutionTransaction } from '@/lib/precision-cad-agent/commercialExecutionOutboxStore';
import { stageCommercialExecutionInput } from '@/lib/precision-cad-agent/commercialWorkerIo';
import { DurableExecutionJournal, canonicalJson, hashReceipt } from '@/lib/precision-cad-agent/executionJournal';
import { serverEvidenceSha256 } from '@/lib/ai/serverEvidence';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import type { CommercialExecutionJob } from '../../../../../../../../packages/job-contracts/src/commercialPrecisionExecution';
import { hasPrecisionCadProjectScope } from '@/lib/precision-cad-agent/apiKeyScope';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 320 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ ok: false, error: { code: 'INVALID_ORIGIN' } }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  if (!hasPrecisionCadProjectScope(auth, 'write:projects')) return NextResponse.json({ ok: false, error: { code: 'INSUFFICIENT_API_KEY_SCOPE', requiredScope: 'write:projects' } }, { status: 403 });
  const { id: projectId } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return NextResponse.json({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error);
    if (bounded) return NextResponse.json({ ok: false, error: { code: bounded.code === 'PAYLOAD_TOO_LARGE' ? 'ARGUMENTS_TOO_LARGE' : 'INVALID_REQUEST' } }, { status: bounded.status });
    throw error;
  }
  const binding = body.binding;
  const call = body.call ?? (typeof body.tool === 'string' ? { callId: 'remote-call', name: body.tool, arguments: body.arguments, scope: body.scope } : null);
  const continuationId = typeof body.continuationId === 'string' ? body.continuationId : '';
  if (body.contractVersion !== REMOTE_PRECISION_CAD_CONTRACT_VERSION || !validateRemoteBinding(binding) || (binding as { projectId: string }).projectId !== projectId || !call || typeof call !== 'object' || validateRemotePrecisionCadToolCall(call).length > 0 || !continuationId) return NextResponse.json({ ok: false, error: { code: 'INVALID_REQUEST' } }, { status: 400 });
  const revision = (binding as { revision: number }).revision;
  const commercialMode = process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE === '1';
  if (!commercialMode && db.backend === 'sqlite') await ensureCadWorkspaceRevisionTables(db);
  const revisionError = await assertRemoteProjectRevision(db, projectId, revision, (binding as { updatedAt: number }).updatedAt);
  if (revisionError) return NextResponse.json(revisionError, { status: revisionError.error.code === 'REVISION_NOT_FOUND' ? 404 : revisionError.error.code === 'REVISION_CONFLICT' ? 409 : 400 });
  const workspaceEnvelope = await readCadWorkspaceRevision(db, projectId, revision).catch(() => null);
  const workspaceContentHash = workspaceEnvelope?.contentHash ?? '';
  if (!workspaceContentHash) return NextResponse.json({ ok: false, error: { code: 'REVISION_NOT_FOUND' } }, { status: 404 });
  const pendingError = await assertRemotePendingToolCall({
    db,
    handle: continuationId,
    userId: auth.userId,
    projectId,
    revision,
    callId: (call as RemotePrecisionCadToolCall).callId,
    tool: (call as RemotePrecisionCadToolCall).name,
    arguments: (call as RemotePrecisionCadToolCall).arguments,
  });
  if (pendingError) return NextResponse.json(pendingError, { status: pendingError.error.code === 'STATE_NOT_FOUND' ? 404 : 409 });
  let catalog;
  try { catalog = await loadInstallerCoreCatalog(); } catch { return NextResponse.json({ ok: false, error: { code: 'CATALOG_UNAVAILABLE' } }, { status: 503 }); }
  const typedCall = call as RemotePrecisionCadToolCall;
  // The isolated installer-core child has no server-side CAD-session
  // hydration adapter. Hold ownership/runtime references before approvals,
  // claims, or child-process dispatch; never pass client handles across the
  // boundary and report the missing adapter honestly.
  if (hasPrecisionCadWorkerCadReference(typedCall.arguments)) {
    return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, error: { code: 'CAD_RUNTIME_HYDRATION_REQUIRED' } }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const needsApproval = typedCall.scope === 'apply' || typedCall.scope === 'export';
  await ensureApprovalChallengeTable(db);
  const approvalSecret = (process.env.NEXYFAB_AGENT_APPROVAL_SECRET ?? process.env.NEXYFAB_SERVER_SECRET ?? '').trim();
  const suppliedChallenge = body.approvalChallenge;
  if (commercialMode && needsApproval) {
    if (access.role !== 'owner' && access.role !== 'editor') return NextResponse.json({ ok: false, error: { code: 'EDITOR_REQUIRED' } }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    const generationRunId = typeof body.generationRunId === 'string' ? body.generationRunId : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(generationRunId)) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, error: { code: 'VERIFIED_GENERATION_BINDING_REQUIRED' } }, { status: 409 });
    const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
    const generation = await db.queryOne<Record<string, unknown>>('SELECT r.workspace_id, r.workspace_revision, r.head_revision, r.head_sha256, v.generation_program_sha256 FROM nf_commercial_generation_runs r JOIN nf_commercial_generation_revisions v ON v.tenant_id = r.tenant_id AND v.project_id = r.project_id AND v.run_id = r.run_id AND v.revision = r.head_revision WHERE r.tenant_id = ? AND r.project_id = ? AND r.run_id = ? AND r.status = ?', tenantId, projectId, generationRunId, 'ACTIVE');
    const generationProgramSha256 = String(generation?.generation_program_sha256 ?? '');
    if (!generation || generation.workspace_id !== projectId || Number(generation.workspace_revision) !== revision || generation.head_sha256 !== workspaceContentHash || !/^[a-f0-9]{64}$/.test(generationProgramSha256) || generationProgramSha256 === '0'.repeat(64)) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, error: { code: 'VERIFIED_GENERATION_BINDING_REQUIRED' } }, { status: 409 });
    if (!suppliedChallenge || typeof suppliedChallenge !== 'object' || Array.isArray(suppliedChallenge)) {
      const issued = await issueDbApprovalChallenge(db, { actorId: auth.userId, role: access.role as BoundaryRole, projectId, workspaceId: projectId, workspaceRevision: revision, workspaceContentHash, tool: typedCall.name, scope: typedCall.scope as 'apply' | 'export', callId: typedCall.callId, arguments: typedCall.arguments }, approvalSecret);
      if (!issued.ok) return NextResponse.json({ ok: false, error: { code: issued.code === 'SECRET_REQUIRED' ? 'APPROVAL_CONFIG_REQUIRED' : 'INVALID_REQUEST' } }, { status: issued.code === 'SECRET_REQUIRED' ? 503 : 400 });
      return NextResponse.json({ ok: false, error: { code: 'APPROVAL_REQUIRED' }, approvalChallenge: issued.challenge }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const challenge = suppliedChallenge as { challengeId?: unknown; nonce?: unknown; mac?: unknown };
    const approval = { actorId: auth.userId, role: access.role as BoundaryRole, projectId, workspaceId: projectId, workspaceRevision: revision, workspaceContentHash, tool: typedCall.name, scope: typedCall.scope as 'apply' | 'export', callId: typedCall.callId, arguments: typedCall.arguments, challengeId: String(challenge.challengeId ?? ''), nonce: String(challenge.nonce ?? ''), mac: String(challenge.mac ?? '') };
    const generationStateRevision = Number(generation.head_revision);
    const targetHash = serverEvidenceSha256({ tenantId, projectId, workspaceId: projectId, workspaceRevision: revision, workspaceContentHash, generationRunId, generationStateRevision, generationProgramSha256, tool: typedCall.name, scope: typedCall.scope, arguments: typedCall.arguments });
    const command = { domain: 'precision-cad-agent', operation: typedCall.name, arguments: { toolArguments: typedCall.arguments, tenantId, projectId, workspaceId: projectId, workspaceRevision: revision, modelContentHash: workspaceContentHash, generationRunId, generationStateRevision, generationProgramSha256, targetSha256: targetHash } };
    const idempotencyKey = `commercial:${serverEvidenceSha256({ continuationId, callId: typedCall.callId, targetHash })}`;
    const nowIso = new Date().toISOString();
    const journalEngine = new DurableExecutionJournal(undefined, () => nowIso);
    const planned = journalEngine.plan({ idempotencyKey, command, workspace: { workspaceId: projectId, projectId, revision, contentHash: workspaceContentHash } });
    if (!planned.ok) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, error: { code: 'JOURNAL_CONFLICT' } }, { status: 409 });
    const approved = journalEngine.approve(planned.receipt.executionId, { approvalId: `boundary:${approval.challengeId}`, actorId: auth.userId, approved: true, approvedAt: nowIso, commandHash: planned.receipt.commandHash, workspaceBindingHash: planned.receipt.workspaceBindingHash, userInitiated: true });
    if (!approved.ok || !approved.receipt.approvalHash) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, error: { code: 'JOURNAL_CONFLICT' } }, { status: 409 });
    const jobBase: Omit<CommercialExecutionJob, 'inputArtifact'> = { contractVersion: 'nexyfab.precision-cad-commercial-execution.v3', jobId: `job-${serverEvidenceSha256({ executionId: approved.receipt.executionId, targetHash }).slice(0, 48)}`, tenantId, projectId, executionId: approved.receipt.executionId, generationRunId, generationStateRevision, generationProgramSha256, workspaceId: projectId, workspaceRevision: revision, workspaceContentHash, tool: typedCall.name, scope: typedCall.scope as 'apply' | 'export', callId: typedCall.callId, argumentsHash: hashBoundaryArguments(typedCall.arguments), commandHash: approved.receipt.commandHash, targetHash, journalVersion: approved.receipt.version, attempt: 1, leaseGeneration: 1 };
    let job: CommercialExecutionJob;
    try {
      job = (await stageCommercialExecutionInput({ job: jobBase, arguments: typedCall.arguments, storage: getStorage() })).job;
    } catch {
      return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, error: { code: 'IMMUTABLE_INPUT_STAGE_FAILED' } }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const queued = await enqueueCommercialExecutionTransaction({ db, approval, approvalSecret, job, journal: { idempotencyKey, receiptJson: canonicalJson(approved.receipt), receiptHash: hashReceipt(approved.receipt), approvalHash: approved.receipt.approvalHash, createdAt: Date.parse(approved.receipt.createdAt), updatedAt: Date.parse(approved.receipt.updatedAt) } });
    if (!queued.ok) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, error: { code: queued.code } }, { status: queued.code === 'MIGRATION_REQUIRED' ? 503 : 409, headers: { 'Cache-Control': 'private, no-store' } });
    return NextResponse.json({
      ok: true,
      tool: typedCall.name,
      scope: typedCall.scope,
      result: {
        ok: true,
        toolResult: { status: queued.replayed ? 'REPLAY' : 'QUEUED', releaseReady: false },
        execution: {
          mode: 'durable_commercial_queue',
          status: queued.replayed ? 'replay' : 'queued',
          executionId: queued.row.job.executionId,
          workerStarted: false,
          targetSha256: targetHash,
        },
        persistence: {
          ok: false,
          code: 'PENDING',
          releaseReady: false,
          promotionStatus: 'commercial_queue_pending',
          artifacts: [],
        },
        exactPromotion: { status: 'not_requested', releaseReady: false },
      },
      status: queued.replayed ? 'REPLAY' : 'QUEUED',
      executionId: queued.row.job.executionId,
      workerStarted: false,
      releaseReady: false,
      targetSha256: targetHash,
    }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
  }
  let boundaryConsumed = false;
  if (needsApproval) {
    if (access.role !== 'owner' && access.role !== 'editor') return NextResponse.json({ ok: false, error: { code: 'EDITOR_REQUIRED' } }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    if (!suppliedChallenge || typeof suppliedChallenge !== 'object' || Array.isArray(suppliedChallenge)) {
      const issued = await issueDbApprovalChallenge(db, {
        actorId: auth.userId, role: access.role as BoundaryRole, projectId, workspaceId: projectId,
        workspaceRevision: revision, workspaceContentHash, tool: typedCall.name, scope: typedCall.scope as 'apply' | 'export',
        callId: typedCall.callId, arguments: typedCall.arguments,
      }, approvalSecret);
      if (!issued.ok) return NextResponse.json({ ok: false, error: { code: issued.code === 'SECRET_REQUIRED' ? 'APPROVAL_CONFIG_REQUIRED' : 'INVALID_REQUEST' } }, { status: issued.code === 'SECRET_REQUIRED' ? 503 : 400 });
      return NextResponse.json({ ok: false, error: { code: 'APPROVAL_REQUIRED' }, approvalChallenge: issued.challenge }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const challenge = suppliedChallenge as { challengeId?: unknown; nonce?: unknown; mac?: unknown };
    const consumed = await consumeDbApprovalChallenge(db, {
      actorId: auth.userId, role: access.role as BoundaryRole, projectId, workspaceId: projectId,
      workspaceRevision: revision, workspaceContentHash, tool: typedCall.name, scope: typedCall.scope as 'apply' | 'export',
      callId: typedCall.callId, arguments: typedCall.arguments, challengeId: String(challenge.challengeId ?? ''), nonce: String(challenge.nonce ?? ''), mac: String(challenge.mac ?? ''),
    }, approvalSecret);
    if (!consumed.ok) return NextResponse.json({ ok: false, error: { code: consumed.code === 'EXPIRED' ? 'STATE_EXPIRED' : consumed.code === 'REPLAY' ? 'STATE_INVALID' : 'INVALID_APPROVAL_TOKEN' } }, { status: consumed.code === 'EXPIRED' ? 409 : 403, headers: { 'Cache-Control': 'private, no-store' } });
    boundaryConsumed = true;
  }
  const shouldExecute = !needsApproval || boundaryConsumed;
  let claimed = false;
  if (shouldExecute) {
    claimed = await claimRemotePendingToolCall(db, {
      handle: continuationId,
      callId: typedCall.callId,
      arguments: typedCall.arguments,
    });
    if (!claimed) return NextResponse.json({ ok: false, error: { code: 'STATE_INVALID' } }, { status: 409 });
  }
  let workerJob: PrecisionCadWorkerJob | undefined;
  const result = await executeRemoteAgentCall({
    projectId, revision, userId: auth.userId, role: access.role,
    tool: typedCall.name, arguments: typedCall.arguments, requestedScope: typedCall.scope,
    approved: body.approved === true || boundaryConsumed, approvalToken: boundaryConsumed
      ? (makeRemoteApprovalToken({ userId: auth.userId, projectId, revision, tool: typedCall.name, arguments: typedCall.arguments }, process.env) ?? undefined)
      : (typeof body.approvalToken === 'string' ? body.approvalToken : undefined),
    catalog,
    executor: async ({ tool, arguments: toolArguments }) => {
      workerJob = await executePrecisionCadToolInIsolatedWorker({
        idempotencyKey: hashRemoteArguments({
          projectId,
          revision,
          workspaceContentHash,
          continuationId,
          callId: typedCall.callId,
          tool,
          scope: typedCall.scope,
          argumentsHash: hashBoundaryArguments(toolArguments),
          approvalChallengeId: boundaryConsumed && suppliedChallenge && typeof suppliedChallenge === 'object'
            ? String((suppliedChallenge as { challengeId?: unknown }).challengeId ?? '')
            : null,
        }),
        userId: auth.userId,
        binding: binding as { projectId: string; revision: number; updatedAt: number },
        tool,
        arguments: { ...toolArguments },
      });
      if (workerJob.status !== 'succeeded') throw new Error(workerJob.errorCode ?? 'WORKER_FAILED');
      return workerJob.result;
    },
  });
  if (claimed && !result.ok && !workerJob) await releaseRemotePendingToolCall(db, { handle: continuationId, callId: typedCall.callId });
  if (!result.ok) {
    logAudit({ userId: auth.userId, action: 'cad.remote_agent_tool_denied', resourceId: projectId, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { revision, tool: typedCall.name, scope: typedCall.scope, resultCode: result.error.code, workerStatus: workerJob?.status } });
    const status = result.error.code === 'EDITOR_REQUIRED' ? 403 : result.error.code === 'TOOL_NOT_FOUND' || result.error.code === 'REVISION_NOT_FOUND' ? 404 : result.error.code === 'APPROVAL_REQUIRED' ? 409 : 422;
    return NextResponse.json(result, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }

  // A viewer may inspect a project, but immutable artifact creation is a
  // project mutation. Only editors/owners persist browser-agent outputs.
  let persistence: Awaited<ReturnType<typeof persistPrecisionCadResult>> | undefined;
  if (access.canEdit) {
    await ensureDirectArtifactUploadTables(db);
    persistence = await persistPrecisionCadResult({
      db,
      storage: getStorage(),
      userId: auth.userId,
      tenantId: resolveArtifactTenantId(access.row.org_id, access.ownerUserId),
      binding: binding as { projectId: string; revision: number; updatedAt: number },
      runId: continuationId,
      call: typedCall,
      execution: result,
    });
    if (!persistence.ok) {
      logAudit({ userId: auth.userId, action: 'cad.remote_agent_result_persist_failed', resourceId: projectId, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { revision, tool: typedCall.name, scope: typedCall.scope, resultCode: persistence.code, workerStatus: workerJob?.status } });
      return NextResponse.json({ ok: false, error: { code: 'EXECUTED_PERSISTENCE_HOLD', persistenceCode: persistence.code, retryable: false } }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    }
  }
  let exactPromotion: {
    status: 'queued' | 'blocked' | 'not_requested';
    jobId?: string;
    transportState?: string;
    code?: string;
    releaseReady: false;
  } = { status: 'not_requested', releaseReady: false };
  if (persistence?.ok && (typedCall.scope === 'apply' || typedCall.scope === 'export')) {
    const source = persistence.artifacts.find(artifact => artifact.kind === 'report');
    if (source) {
      const jobId = `pcad-${hashRemoteArguments({ projectId, revision, continuationId, callId: typedCall.callId }).slice(0, 48)}`;
      const dispatched = await dispatchCadJob({
        contractVersion: JOB_CONTRACT_VERSION,
        jobId,
        tenantId: resolveArtifactTenantId(access.row.org_id, access.ownerUserId),
        projectId,
        kind: 'EXACT_BREP_BUILD',
        inputArtifacts: [{ artifactId: source.artifactId, objectKey: source.objectKey, contentSha256: source.contentSha256 }],
        requestedAt: new Date().toISOString(),
        requestedBy: auth.userId,
      }, {
        fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(3_000) }),
      });
      exactPromotion = dispatched.ok
        ? { status: 'queued', jobId, transportState: dispatched.receipt.transportState, releaseReady: false }
        : { status: 'blocked', jobId, code: dispatched.code, releaseReady: false };
    }
  }
  const response = {
    ...result,
    result: {
      ok: !(result.result && typeof result.result === 'object' && !Array.isArray(result.result) && (result.result as { ok?: unknown }).ok === false),
      toolResult: summarizePrecisionCadToolResult(result.result),
      execution: {
        mode: 'isolated_child_process' as const,
        status: workerJob?.status ?? 'succeeded',
        jobId: workerJob?.id,
        auditId: workerJob?.auditId ?? result.auditId,
        durableQueue: false,
      },
      persistence: persistence ?? {
        ok: false as const,
        code: 'EDITOR_REQUIRED' as const,
        releaseReady: false,
        promotionStatus: 'not_persisted_viewer' as const,
        artifacts: [],
      },
      exactPromotion,
    },
  };
  logAudit({ userId: auth.userId, action: 'cad.remote_agent_tool_completed', resourceId: projectId, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { revision, tool: typedCall.name, scope: typedCall.scope, resultCode: 'OK', workerStatus: workerJob?.status, artifactCount: persistence?.ok ? persistence.artifacts.length : 0, releaseReady: false, exactPromotionStatus: exactPromotion.status, exactPromotionJobId: exactPromotion.jobId } });
  return NextResponse.json(response, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
}
