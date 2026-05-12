/**
 * GET /api/nexyfab/admin/prompt-compare-history
 *
 *   ?id=…           — fetch full results for a single run
 *   ?promptId=…     — filter by prompt id
 *   ?createdBy=…    — filter by user id who ran the compare
 *   ?since=…        — ISO date or ms epoch lower bound (inclusive)
 *   ?until=…        — ISO date or ms epoch upper bound (inclusive)
 *   ?limit=N        — list size (default 50, capped at 200)
 *
 * Returns a list of run summaries (or one full detail when `id` given).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { listCompareRuns, getCompareRun } from '@/lib/ai/compareStore';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = authUser.globalRole === 'super_admin'
    || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const run = await getCompareRun(id);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    return NextResponse.json({ run });
  }

  const promptId = req.nextUrl.searchParams.get('promptId') ?? undefined;
  const createdBy = req.nextUrl.searchParams.get('createdBy') ?? undefined;
  const limitRaw = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));

  // Date filters accept either an ISO string or ms-epoch number.
  const parseTs = (raw: string | null): number | undefined => {
    if (!raw) return undefined;
    const asNum = parseInt(raw, 10);
    if (Number.isFinite(asNum) && asNum > 1_000_000_000_000) return asNum;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : undefined;
  };
  const sinceMs = parseTs(req.nextUrl.searchParams.get('since'));
  const untilMs = parseTs(req.nextUrl.searchParams.get('until'));

  const runs = await listCompareRuns({ limit, promptId, createdBy, sinceMs, untilMs });
  return NextResponse.json({ runs });
}
