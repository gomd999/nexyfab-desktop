import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { checkSLADeadlines } from '@/lib/sla-checker';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 });
  }
  const alerts = await checkSLADeadlines();
  return NextResponse.json({
    alerts,
    summary: {
      total: alerts.length,
      overdue: alerts.filter(a => a.status === 'overdue').length,
      warning: alerts.filter(a => a.status === 'warning').length,
    },
  });
}

export async function POST(req: NextRequest) {
  // Trigger SLA check manually (can also be called from a cron job)
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 });
  }
  const alerts = await checkSLADeadlines();
  return NextResponse.json({ triggered: true, alertsFound: alerts.length, alerts });
}
