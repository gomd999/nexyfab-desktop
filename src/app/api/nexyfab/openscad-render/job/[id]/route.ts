import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getOpenScadJobAsync } from '@/lib/openscad-render/jobQueue';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const job = await getOpenScadJobAsync(id, user.userId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    format: job.format,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === 'complete'
      ? {
          ...(job.resultBase64 ? { dataBase64: job.resultBase64 } : {}),
          ...(job.artifactUrl ? { artifactUrl: job.artifactUrl, artifactKey: job.artifactKey } : {}),
        }
      : {}),
    ...(job.status === 'failed' ? { error: job.errorMessage } : {}),
  });
}
