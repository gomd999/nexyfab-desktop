import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimit } from '@/lib/rate-limit';
import type { AiDesignPrecisionCadHandoffV1 } from '@/lib/ai/aiDesignChatActionCommandAdapterV1';
import { enqueueAiDesignPrecisionHandoff } from '@/lib/ai/aiDesignPrecisionHandoffCoordinator';
import { loadAiDesignUnifiedWorkspaceServerV10 } from '@/lib/ai/aiDesignUnifiedWorkspaceServer';

export const runtime = 'nodejs';
const MAX_BYTES = 16 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validHandoff(value: unknown): value is AiDesignPrecisionCadHandoffV1 {
  if (!record(value)) return false;
  return value.schema === 'nexyfab.ai-design-precision-cad-handoff.v1'
    && value.kind === 'precision-cad-handoff'
    && [value.requestId, value.projectId, value.sessionId, value.candidateId].every(item => typeof item === 'string' && SAFE_ID.test(item))
    && Number.isSafeInteger(value.expectedRuntimeRevision) && Number(value.expectedRuntimeRevision) >= 0
    && Number.isSafeInteger(value.expectedComplexRevision) && Number(value.expectedComplexRevision) >= 0
    && value.explicitCommitRequired === true && value.exactExecution === false
    && value.verificationPass === false && value.manufacturingReleaseReady === false
    && Object.keys(value).every(key => ['schema', 'kind', 'requestId', 'projectId', 'sessionId', 'expectedRuntimeRevision', 'expectedComplexRevision', 'candidateId', 'explicitCommitRequired', 'exactExecution', 'verificationPass', 'manufacturingReleaseReady'].includes(key));
}

function coordinatorStatus(code: string): number {
  if (code.includes('REVISION_CONFLICT') || code.includes('HANDOFF_MISMATCH')
    || code.includes('REPLAY_CONFLICT') || code.endsWith('_CONFLICT')) return 409;
  if (code.startsWith('AI_PRECISION_') || code.startsWith('AI_DESIGN_COMPLEX_STRUCTURE')) return 422;
  return 400;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-precision-handoff:${authUser.userId}`, 20, 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  let raw: unknown;
  try { raw = await readBoundedJson(req, MAX_BYTES); }
  catch (error) {
    return NextResponse.json({ error: boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_PRECISION_HANDOFF' }, { status: boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400 });
  }
  if (!record(raw) || raw.explicitConfirmation !== true || !validHandoff(raw.handoff) || !Object.keys(raw).every(key => ['handoff', 'explicitConfirmation'].includes(key))) {
    return NextResponse.json({ error: 'EXPLICIT_PRECISION_CONFIRMATION_REQUIRED' }, { status: 400 });
  }
  const handoff = raw.handoff;
  const access = await resolveProjectAccess(getDbAdapter(), handoff.projectId, authUser);
  if (!access) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  const ownerKey = `${authUser.userId}:${handoff.projectId}`;
  try {
    const db = getDbAdapter();
    const result = await enqueueAiDesignPrecisionHandoff({
      ownerKey,
      authenticatedPlan: authUser.plan,
      handoff,
      signingSecret: process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '',
    }, { db });
    if (!result.ok) return NextResponse.json(
      { error: result.code, issues: result.issues },
      { status: coordinatorStatus(result.code) },
    );
    const payload = await loadAiDesignUnifiedWorkspaceServerV10(ownerKey, handoff.projectId, handoff.sessionId, req.nextUrl.searchParams.get('locale') ?? 'en');
    return NextResponse.json({
      completedRequestId: handoff.requestId,
      precisionRequestAccepted: true,
      precisionBridgeJobId: result.record.job.jobId,
      precisionBridgeStatus: result.record.status,
      precisionRequestId: result.precisionRequestId,
      replayed: result.replayed,
      exactExecution: false,
      verificationPass: false,
      manufacturingReleaseReady: false,
      ...payload,
    }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_DESIGN_PRECISION_HANDOFF_FAILED';
    if (code.includes('POSTGRES') || code.includes('SIGNING_SECRET')) return NextResponse.json({ error: code }, { status: 503 });
    return NextResponse.json({ error: 'AI_DESIGN_PRECISION_HANDOFF_FAILED' }, { status: 400 });
  }
}
