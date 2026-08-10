import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getTrustedClientIp } from '@/lib/client-ip';
import { getOpenScadJobAsync } from '@/lib/openscad-render/jobQueue';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser(req);
  // POST permits a tightly rate-limited guest render. External workers force
  // that path to async, so the poll route must derive the exact same owner.
  // The random job id alone is never sufficient: ownership remains bound to
  // the authenticated account or the trusted request IP.
  const ownerId = user?.userId ?? `guest:${getTrustedClientIp(req.headers)}`;
  const { id } = await ctx.params;
  const job = await getOpenScadJobAsync(id, ownerId);
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
