import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getBrepStepJobAsync } from '@/lib/brep-bridge/jobQueue';

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
  const job = await getBrepStepJobAsync(id, user.userId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    filename: job.filename,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.status === 'complete'
      ? {
          ...(job.previewMeshBase64 ? { previewMeshBase64: job.previewMeshBase64 } : {}),
          ...(job.artifactUrl ? { artifactUrl: job.artifactUrl, artifactKey: job.artifactKey } : {}),
          ...(job.brepSessionToken ? { brepSessionToken: job.brepSessionToken } : {}),
          ...(job.errorMessage ? { warning: job.errorMessage } : {}),
        }
      : {}),
    ...(job.status === 'failed' ? { error: job.errorMessage } : {}),
  });
}
