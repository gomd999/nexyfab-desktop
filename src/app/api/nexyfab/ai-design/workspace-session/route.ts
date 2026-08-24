import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimit } from '@/lib/rate-limit';
import type { AiDesignWorkspaceRuntimeV1 } from '@/lib/ai/aiDesignWorkspaceRuntime';
import {
  createServerAiDesignWorkspaceRuntime,
  loadServerAiDesignWorkspaceRuntime,
  saveServerAiDesignWorkspaceRuntime,
} from '@/lib/ai/aiDesignWorkspaceRuntimeStore';

export const runtime = 'nodejs';
const MAX_BODY_BYTES = 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const requestSchema = z.object({
  operation: z.enum(['create', 'save']),
  projectId: z.string().regex(SAFE_ID),
  sessionId: z.string().regex(SAFE_ID),
  expectedRevision: z.number().int().nonnegative().optional(),
  state: z.unknown(),
}).strict();

function errorResponse(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : 'AI_DESIGN_WORKSPACE_STORE_FAILED';
  if (code === 'AI_DESIGN_WORKSPACE_ALREADY_EXISTS' || code === 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT') return NextResponse.json({ error: code }, { status: 409 });
  if (code === 'AI_DESIGN_WORKSPACE_NOT_FOUND') return NextResponse.json({ error: code }, { status: 404 });
  if (code === 'AI_DESIGN_WORKSPACE_POSTGRES_AUTHORITATIVE_REQUIRED') return NextResponse.json({ error: code }, { status: 503 });
  if (code === 'AI_DESIGN_WORKSPACE_TOO_LARGE') return NextResponse.json({ error: code }, { status: 413 });
  return NextResponse.json({ error: 'INVALID_AI_DESIGN_WORKSPACE_STATE' }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-workspace:get:${authUser.userId}`, 120, 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const projectId = req.nextUrl.searchParams.get('projectId') ?? '';
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? '';
  if (!SAFE_ID.test(projectId) || !SAFE_ID.test(sessionId)) return NextResponse.json({ error: 'INVALID_WORKSPACE_IDENTITY' }, { status: 400 });
  if (!await resolveProjectAccess(getDbAdapter(), projectId, authUser)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  try {
    const state = await loadServerAiDesignWorkspaceRuntime(`${authUser.userId}:${projectId}`, projectId, sessionId);
    return NextResponse.json({ state });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-workspace:post:${authUser.userId}`, 60, 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  let raw: unknown;
  try { raw = await readBoundedJson(req, MAX_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    raw = null;
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_WORKSPACE_SESSION_REQUEST' }, { status: 400 });
  if (!await resolveProjectAccess(getDbAdapter(), parsed.data.projectId, authUser)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const state = parsed.data.state as AiDesignWorkspaceRuntimeV1;
  if (state?.projectId !== parsed.data.projectId || state?.session?.sessionId !== parsed.data.sessionId) return NextResponse.json({ error: 'WORKSPACE_SESSION_BINDING_MISMATCH' }, { status: 409 });
  const ownerKey = `${authUser.userId}:${parsed.data.projectId}`;
  try {
    const saved = parsed.data.operation === 'create'
      ? await createServerAiDesignWorkspaceRuntime(ownerKey, state)
      : await saveServerAiDesignWorkspaceRuntime(ownerKey, state, parsed.data.expectedRevision ?? -1);
    return NextResponse.json({ state: saved }, { status: parsed.data.operation === 'create' ? 201 : 200 });
  } catch (error) { return errorResponse(error); }
}
