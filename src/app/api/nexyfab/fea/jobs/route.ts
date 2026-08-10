import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { enqueueFeaJob } from '@/lib/fea-jobs/redisFeaJobs';
import { publicFeaJob } from '@/lib/fea-jobs/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function statusForCode(code: string): number {
  if (code === 'FEA_PENDING_LIMIT' || code === 'FEA_IDEMPOTENCY_PAYLOAD_CONFLICT') return 409;
  if (code === 'FEA_REDIS_URL_MISSING') return 503;
  return 400;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.apiKey && !user.apiKey.scopes.includes('write:projects')) {
    return NextResponse.json({ error: 'Insufficient API key scope', requiredScope: 'write:projects' }, { status: 403 });
  }

  const limited = await rateLimitAsync(`fea-submit:${user.userId}`, 10, 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'FEA submission rate limit exceeded' },
      { status: 429, headers: rateLimitHeaders(limited, 10) },
    );
  }
  const body = await req.json().catch(() => null) as (Record<string, unknown> & { projectId?: unknown }) | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  let projectId: string | undefined;
  let scopeId = `user:${user.userId}`;
  if (body.projectId !== undefined) {
    if (typeof body.projectId !== 'string' || body.projectId.length < 1 || body.projectId.length > 200) {
      return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
    }
    projectId = body.projectId;
    const access = await resolveProjectAccess(getDbAdapter(), projectId, user.userId);
    // Do not disclose whether another tenant's project exists.
    if (!access) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!access.canEdit) return NextResponse.json({ error: 'Project edit permission required' }, { status: 403 });
    scopeId = `project:${projectId}`;
  }

  try {
    const submitted = await enqueueFeaJob({
      ownerUserId: user.userId,
      scopeId,
      ...(projectId ? { projectId } : {}),
      idempotencyKey: req.headers.get('idempotency-key') ?? undefined,
      request: body,
    });
    if (!submitted.ok) {
      return NextResponse.json(
        { error: submitted.message, code: submitted.code },
        { status: statusForCode(submitted.code) },
      );
    }
    const location = `/api/nexyfab/fea/jobs/${submitted.job.id}`;
    return NextResponse.json(
      { ok: true, reused: submitted.reused, job: publicFeaJob(submitted.job), pollUrl: location },
      { status: submitted.reused ? 200 : 202, headers: { Location: location, 'Retry-After': '2' } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : 'FEA_QUEUE_UNAVAILABLE';
    return NextResponse.json(
      { error: 'FEA queue is unavailable', code: code.slice(0, 100) },
      { status: statusForCode(code) },
    );
  }
}
