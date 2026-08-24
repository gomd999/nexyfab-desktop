import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimit } from '@/lib/rate-limit';
import type { AiDesignConceptApplyRequestV1 } from '@/lib/ai/aiDesignChatActionCommandAdapterV1';
import { consumeAiDesignConceptProposalV1, getAiDesignConceptProposalV1 } from '@/lib/ai/aiDesignConceptProposalStore';
import { aiDesignServerRuntimeArtifacts } from '@/lib/ai/aiDesignServerRuntimeArtifacts';
import { executeAiDesignWorkspaceClientCommand } from '@/lib/ai/aiDesignWorkspaceActionService';
import { parseAiDesignWorkspaceClientCommandV2 } from '@/lib/ai/aiDesignWorkspaceCommandV2';
import { loadAiDesignUnifiedWorkspaceServerV10 } from '@/lib/ai/aiDesignUnifiedWorkspaceServer';

export const runtime = 'nodejs';
const MAX_BYTES = 16 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validApply(value: unknown): value is AiDesignConceptApplyRequestV1 {
  if (!record(value)) return false;
  return value.schema === 'nexyfab.ai-design-concept-apply-request.v1'
    && value.kind === 'concept-apply-request'
    && [value.requestId, value.projectId, value.sessionId, value.proposalId].every(item => typeof item === 'string' && SAFE_ID.test(item))
    && Number.isSafeInteger(value.expectedRuntimeRevision) && Number(value.expectedRuntimeRevision) >= 0
    && value.explicitConfirmationRequired === true && value.mutation === 'concept-session-only'
    && value.exactExecution === false && value.verificationPass === false && value.manufacturingReleaseReady === false
    && Object.keys(value).every(key => ['schema', 'kind', 'requestId', 'projectId', 'sessionId', 'expectedRuntimeRevision', 'proposalId', 'explicitConfirmationRequired', 'mutation', 'exactExecution', 'verificationPass', 'manufacturingReleaseReady'].includes(key));
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-concept-apply:${authUser.userId}`, 30, 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  let raw: unknown;
  try { raw = await readBoundedJson(req, MAX_BYTES); }
  catch (error) {
    return NextResponse.json({ error: boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_CONCEPT_APPLY_REQUEST' }, { status: boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400 });
  }
  if (!record(raw) || raw.explicitConfirmation !== true || !validApply(raw.request) || !Object.keys(raw).every(key => ['request', 'explicitConfirmation'].includes(key))) {
    return NextResponse.json({ error: 'EXPLICIT_CONCEPT_CONFIRMATION_REQUIRED' }, { status: 400 });
  }
  const request = raw.request;
  const access = await resolveProjectAccess(getDbAdapter(), request.projectId, authUser);
  if (!access) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  const ownerKey = `${authUser.userId}:${request.projectId}`;
  const proposal = getAiDesignConceptProposalV1(ownerKey, request.proposalId);
  if (!proposal || proposal.projectId !== request.projectId || proposal.sessionId !== request.sessionId
    || proposal.runtimeRevision !== request.expectedRuntimeRevision) {
    return NextResponse.json({ error: 'AI_DESIGN_CONCEPT_PROPOSAL_MISMATCH' }, { status: 409 });
  }
  const parsed = parseAiDesignWorkspaceClientCommandV2({
    schema: 'nexyfab.ai-design-workspace-command.v2',
    commandId: request.requestId,
    projectId: request.projectId,
    sessionId: request.sessionId,
    expectedRuntimeRevision: request.expectedRuntimeRevision,
    issuedAt: new Date().toISOString(),
    type: 'ADJUST_GAUGE',
    payload: { gaugeId: proposal.gaugeId, ...proposal.adjustment },
  });
  if (!parsed.ok) return NextResponse.json({ error: 'AI_DESIGN_CONCEPT_APPLY_COMMAND_INVALID', issues: parsed.issues }, { status: 400 });
  try {
    const current = await loadAiDesignUnifiedWorkspaceServerV10(ownerKey, request.projectId, request.sessionId, req.nextUrl.searchParams.get('locale') ?? 'en');
    if (current.model.runtimeRevision !== proposal.runtimeRevision || current.model.complexRevision !== proposal.complexRevision
      || current.model.staleAgainstRuntime) {
      return NextResponse.json({ error: 'AI_DESIGN_CONCEPT_PROPOSAL_STALE' }, { status: 409 });
    }
    const result = await executeAiDesignWorkspaceClientCommand(ownerKey, authUser.plan, parsed.command, {
      receiptSink: aiDesignServerRuntimeArtifacts,
      signingSecret: process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '',
    });
    if (!result.ok) return NextResponse.json({ error: result.code, issues: result.issues }, { status: result.code === 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT' ? 409 : 400 });
    const payload = await loadAiDesignUnifiedWorkspaceServerV10(ownerKey, request.projectId, request.sessionId, req.nextUrl.searchParams.get('locale') ?? 'en');
    if (payload.model.runtimeRevision <= request.expectedRuntimeRevision) return NextResponse.json({ error: 'AI_DESIGN_CONCEPT_APPLY_REFRESH_STALE' }, { status: 409 });
    consumeAiDesignConceptProposalV1(proposal.proposalId);
    return NextResponse.json({ completedRequestId: request.requestId, ...payload }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_DESIGN_CONCEPT_APPLY_FAILED';
    if (code.includes('POSTGRES') || code.includes('SIGNING_SECRET')) return NextResponse.json({ error: code }, { status: 503 });
    return NextResponse.json({ error: 'AI_DESIGN_CONCEPT_APPLY_FAILED' }, { status: 400 });
  }
}
