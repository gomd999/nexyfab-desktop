/**
 * GET /api/nexyfab/admin/funnel
 *
 * Onboarding funnel snapshot for admin dashboard. Returns each step's unique
 * user count + conversion-from-previous ratio.
 *
 * Query params:
 *   sinceDays — window length (default 30, max 180)
 *
 * Auth: super_admin / org_admin only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getOnboardingFunnel, getTopUtmSources, getOnboardingFunnelBySource } from '@/lib/funnel-logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = authUser.globalRole === 'super_admin'
    || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sinceDays = Math.max(1, Math.min(180,
    parseInt(req.nextUrl.searchParams.get('sinceDays') ?? '30', 10),
  ));
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const cohortSource = req.nextUrl.searchParams.get('source')?.trim();

  const [steps, sources, cohortSteps] = await Promise.all([
    getOnboardingFunnel({ sinceMs }),
    getTopUtmSources({ sinceMs, limit: 10 }),
    cohortSource ? getOnboardingFunnelBySource(cohortSource, { sinceMs }) : Promise.resolve(null),
  ]);
  return NextResponse.json({
    sinceDays,
    sinceMs,
    untilMs: Date.now(),
    steps,
    sources,
    ...(cohortSource ? { cohortSource, cohortSteps } : {}),
  });
}
