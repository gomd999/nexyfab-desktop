import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = authUser.userId;
  const db = getDbAdapter();

  try {
    // 활성 프로젝트: nf_projects (all projects count as "active")
    const projectsRow = await db.queryOne<{ c: number }>(
      'SELECT COUNT(*) as c FROM nf_projects WHERE user_id = ?',
      userId,
    ).catch(() => undefined);
    const activeProjects = projectsRow?.c ?? 0;

    // 대기 중 RFQ: pending status
    const rfqRow = await db.queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM nf_rfqs WHERE user_id = ? AND status = 'pending'",
      userId,
    ).catch(() => undefined);
    const pendingRfqs = rfqRow?.c ?? 0;

    // 진행 중 주문: production / qc / shipped statuses
    const ordersRow = await db.queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM nf_orders WHERE user_id = ? AND status IN ('production','qc','shipped')",
      userId,
    ).catch(() => undefined);
    const activeOrders = ordersRow?.c ?? 0;

    // 이번달 지출: sum of paid orders this month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const spendRow = await db.queryOne<{ s: number }>(
      "SELECT COALESCE(SUM(total_price_krw), 0) as s FROM nf_orders WHERE user_id = ? AND created_at >= ? AND status IN ('placed','production','qc','shipped','completed')",
      userId,
      monthStart,
    ).catch(() => undefined);
    const monthlySpend = spendRow?.s ?? 0;

    return NextResponse.json({
      activeProjects,
      pendingRfqs,
      activeOrders,
      monthlySpend,
    });
  } catch (err) {
    console.error('[dashboard/summary] DB error:', err);
    return NextResponse.json({
      activeProjects: 0,
      pendingRfqs: 0,
      activeOrders: 0,
      monthlySpend: 0,
      partial: true,
    });
  }
}
