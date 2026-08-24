import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimit } from '@/lib/rate-limit';
import {
  AI_DESIGN_WORKSPACE_COMMAND_V3_MAX_BYTES,
  parseAiDesignWorkspaceClientCommandV3,
} from '@/lib/ai/aiDesignWorkspaceCommandV3';
import {
  executeAiDesignComplexWorkspaceCommand,
  type AiDesignComplexWorkspaceServiceResult,
} from '@/lib/ai/aiDesignComplexWorkspaceService';

export const runtime = 'nodejs';

function response(result: AiDesignComplexWorkspaceServiceResult): NextResponse {
  if (result.ok) return NextResponse.json({
    aggregate: result.aggregate,
    replayed: result.replayed,
    createdArtifactIds: result.createdArtifactIds,
  }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  const conflict = result.code.includes('REVISION_CONFLICT') || result.code.includes('REPLAY_CONFLICT');
  const unavailable = result.code.includes('POSTGRES') || result.code.includes('SIGNING_SECRET');
  return NextResponse.json({ error: result.code, issues: result.issues, aggregate: conflict ? result.aggregate : undefined }, {
    status: conflict ? 409 : unavailable ? 503 : 400,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function errorResponse(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : 'AI_DESIGN_COMPLEX_ACTION_FAILED';
  if (code.includes('NOT_FOUND')) return NextResponse.json({ error: code }, { status: 404 });
  if (code.includes('REVISION_CONFLICT')) return NextResponse.json({ error: code }, { status: 409 });
  if (code.includes('POSTGRES') || code.includes('SIGNING_SECRET')) return NextResponse.json({ error: code }, { status: 503 });
  if (code.includes('TOO_LARGE')) return NextResponse.json({ error: code }, { status: 413 });
  return NextResponse.json({ error: 'AI_DESIGN_COMPLEX_ACTION_FAILED' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-complex-action:${authUser.userId}`, 20, 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  let raw: unknown;
  try { raw = await readBoundedJson(req, AI_DESIGN_WORKSPACE_COMMAND_V3_MAX_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    raw = null;
  }
  const parsed = parseAiDesignWorkspaceClientCommandV3(raw);
  if (!parsed.ok) return NextResponse.json({ error: 'INVALID_AI_DESIGN_WORKSPACE_COMMAND_V3', issues: parsed.issues }, { status: 400 });
  const access = await resolveProjectAccess(getDbAdapter(), parsed.command.projectId, authUser);
  if (!access) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  const signingSecret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '';
  if (parsed.command.type === 'RUN_COMPLEX_CRITICS' && Buffer.byteLength(signingSecret, 'utf8') < 32) return NextResponse.json({ error: 'AI_DESIGN_EVIDENCE_SIGNING_SECRET_REQUIRED' }, { status: 503 });
  try {
    return response(await executeAiDesignComplexWorkspaceCommand(
      `${authUser.userId}:${parsed.command.projectId}`,
      parsed.command,
      { signingSecret },
    ));
  } catch (error) { return errorResponse(error); }
}
