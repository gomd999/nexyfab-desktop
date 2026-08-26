import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimit } from '@/lib/rate-limit';
import {
  createAiDesignConceptProposalV1,
  isAiDesignConceptPreviewRequestV1,
} from '@/lib/ai/aiDesignConceptProposalStore';
import { createAiDesignPreviewDecisionCardV10 } from '@/lib/ai/aiDesignWorkspaceIntegrationV10';
import { loadAiDesignUnifiedWorkspaceServerV10 } from '@/lib/ai/aiDesignUnifiedWorkspaceServer';

export const runtime = 'nodejs';
const MAX_BYTES = 16 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-concept-preview:${authUser.userId}`, 60, 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });

  let raw: unknown;
  try { raw = await readBoundedJson(req, MAX_BYTES); }
  catch (error) {
    return NextResponse.json({ error: boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_CONCEPT_PREVIEW_REQUEST' }, { status: boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400 });
  }
  if (!record(raw) || !Object.keys(raw).every(key => key === 'request') || !isAiDesignConceptPreviewRequestV1(raw.request)) {
    return NextResponse.json({ error: 'INVALID_CONCEPT_PREVIEW_REQUEST' }, { status: 400 });
  }
  const request = raw.request;
  const access = await resolveProjectAccess(getDbAdapter(), request.projectId, authUser);
  if (!access) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });

  const ownerKey = `${authUser.userId}:${request.projectId}`;
  try {
    const payload = await loadAiDesignUnifiedWorkspaceServerV10(ownerKey, request.projectId, request.sessionId, req.nextUrl.searchParams.get('locale') ?? 'en');
    if (payload.model.runtimeRevision !== request.expectedRuntimeRevision || payload.model.staleAgainstRuntime) {
      return NextResponse.json({ error: 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT' }, { status: 409 });
    }
    const gaugeExists = payload.model.workspace.assemblyGauges.some(item => item.gaugeId === request.gaugeId)
      || payload.model.workspace.base.gauges.some(item => item.gaugeId === request.gaugeId);
    if (!gaugeExists) return NextResponse.json({ error: 'AI_DESIGN_GAUGE_NOT_FOUND' }, { status: 400 });
    const { evidence } = createAiDesignConceptProposalV1({ ownerKey, request, complexRevision: payload.model.complexRevision });
    const decisionCard = createAiDesignPreviewDecisionCardV10({
      projectId: request.projectId,
      sessionId: request.sessionId,
      runtimeRevision: request.expectedRuntimeRevision,
      evidence,
      locale: req.nextUrl.searchParams.get('locale') ?? 'en',
    });
    return NextResponse.json({ evidence, decisionCard }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_DESIGN_CONCEPT_PREVIEW_FAILED';
    if (code.includes('NOT_FOUND')) return NextResponse.json({ error: code }, { status: 404 });
    if (code.includes('POSTGRES')) return NextResponse.json({ error: code }, { status: 503 });
    return NextResponse.json({ error: 'AI_DESIGN_CONCEPT_PREVIEW_FAILED' }, { status: 400 });
  }
}
