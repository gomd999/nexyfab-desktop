import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { cancelFeaJob, getFeaJobForOwner } from '@/lib/fea-jobs/redisFeaJobs';
import { publicFeaJob } from '@/lib/fea-jobs/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorize(req: NextRequest, scope: 'read:projects' | 'write:projects') {
  const user = await getAuthUser(req);
  if (!user) return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (user.apiKey && !user.apiKey.scopes.includes(scope)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Insufficient API key scope', requiredScope: scope }, { status: 403 }),
    };
  }
  return { ok: true as const, user };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await authorize(req, 'read:projects');
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    const job = await getFeaJobForOwner(id, auth.user.userId);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json(
      { ok: true, job: publicFeaJob(job) },
      { headers: job.status === 'queued' || job.status === 'processing' || job.status === 'retrying' || job.status === 'cancel_requested'
        ? { 'Retry-After': '2', 'Cache-Control': 'no-store' }
        : { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'FEA queue is unavailable', code: 'FEA_QUEUE_UNAVAILABLE' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const auth = await authorize(req, 'write:projects');
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  try {
    const status = await cancelFeaJob(id, auth.user.userId);
    if (status === 'not_found') return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    if (status === 'terminal') return NextResponse.json({ error: 'Job is already terminal' }, { status: 409 });
    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json({ error: 'FEA queue is unavailable', code: 'FEA_QUEUE_UNAVAILABLE' }, { status: 503 });
  }
}
