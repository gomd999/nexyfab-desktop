import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// Plan limits
const PLAN_LIMITS = {
  free:       { rfqPerDay: 3,   projectsTotal: 5,  aiAnalysisPerDay: 5,  teamMembers: 0,  apiKeys: 0  },
  pro:        { rfqPerDay: 50,  projectsTotal: -1, aiAnalysisPerDay: 30, teamMembers: 0,  apiKeys: 3  },
  team:       { rfqPerDay: 200, projectsTotal: -1, aiAnalysisPerDay: 100,teamMembers: 10, apiKeys: 10 },
  enterprise: { rfqPerDay: -1,  projectsTotal: -1, aiAnalysisPerDay: -1, teamMembers: -1, apiKeys: -1 },
} as const;

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const plan = authUser.plan as keyof typeof PLAN_LIMITS;
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  const dayStart = Date.now() - 86_400_000;
  const monthStart = Date.now() - 30 * 86_400_000;

  // RFQ today
  const rfqToday = await db.queryOne<{ c: number }>(
    'SELECT COUNT(*) as c FROM nf_rfqs WHERE user_id = ? AND created_at > ?',
    authUser.userId, dayStart,
  );

  // RFQ this month
  const rfqMonth = await db.queryOne<{ c: number }>(
    'SELECT COUNT(*) as c FROM nf_rfqs WHERE user_id = ? AND created_at > ?',
    authUser.userId, monthStart,
  );

  // Projects total
  const projects = await db.queryOne<{ c: number }>(
    'SELECT COUNT(*) as c FROM nf_projects WHERE user_id = ?',
    authUser.userId,
  );

  // Team members (if team plan)
  let teamMembers = 0;
  if (['team', 'enterprise'].includes(plan)) {
    const tm = await db.queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM nf_team_members tm
       JOIN nf_teams t ON t.id = tm.team_id
       WHERE t.owner_id = ?`,
      authUser.userId,
    );
    teamMembers = tm?.c ?? 0;
  }

  // API keys count
  let apiKeyCount = 0;
  try {
    const ak = await db.queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM nf_api_keys WHERE user_id = ? AND status = 'active'",
      authUser.userId,
    );
    apiKeyCount = ak?.c ?? 0;
  } catch { /* table may not exist yet */ }

  function usagePct(used: number, limit: number): number {
    if (limit === -1) return 0; // unlimited
    return Math.min(100, Math.round((used / limit) * 100));
  }

  return NextResponse.json({
    plan,
    usage: {
      rfqToday: {
        used: rfqToday?.c ?? 0,
        limit: limits.rfqPerDay,
        pct: usagePct(rfqToday?.c ?? 0, limits.rfqPerDay),
        unlimited: limits.rfqPerDay === -1,
      },
      rfqThisMonth: {
        used: rfqMonth?.c ?? 0,
        limit: limits.rfqPerDay === -1 ? -1 : limits.rfqPerDay * 30,
        unlimited: limits.rfqPerDay === -1,
      },
      projects: {
        used: projects?.c ?? 0,
        limit: limits.projectsTotal,
        pct: usagePct(projects?.c ?? 0, limits.projectsTotal),
        unlimited: limits.projectsTotal === -1,
      },
      teamMembers: {
        used: teamMembers,
        limit: limits.teamMembers,
        pct: usagePct(teamMembers, limits.teamMembers),
        unlimited: limits.teamMembers === -1,
      },
      apiKeys: {
        used: apiKeyCount,
        limit: limits.apiKeys,
        pct: usagePct(apiKeyCount, limits.apiKeys),
        unlimited: limits.apiKeys === -1,
      },
    },
    upgradeUrl: '/en/pricing',
  });
}
