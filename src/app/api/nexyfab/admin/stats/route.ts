import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Admin 권한 검증
  const isAdmin = authUser.globalRole === 'super_admin' || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const now = Date.now();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const weekStart  = now - 7 * 86400000;

  async function q<T>(sql: string, ...args: unknown[]) {
    return db.queryOne<T>(sql, ...args).catch(() => undefined);
  }
  async function qa<T>(sql: string, ...args: unknown[]) {
    return db.queryAll<T>(sql, ...args).catch((): T[] => []);
  }

  const [
    totalRfqs, pendingRfqs, quotedRfqs, acceptedRfqs,
    totalOrders, placedOrders, activeOrders, deliveredOrders,
    monthRevenue, weekRevenue,
    totalPartners, activePartners, pendingApplications,
    totalUsers, weekUsers,
    recentRfqs, recentOrders, rfqsByStatus, ordersByStatus,
  ] = await Promise.all([
    q<{c:number}>('SELECT COUNT(*) as c FROM nf_rfqs'),
    q<{c:number}>("SELECT COUNT(*) as c FROM nf_rfqs WHERE status='pending'"),
    q<{c:number}>("SELECT COUNT(*) as c FROM nf_rfqs WHERE status='quoted'"),
    q<{c:number}>("SELECT COUNT(*) as c FROM nf_rfqs WHERE status='accepted'"),

    q<{c:number}>('SELECT COUNT(*) as c FROM nf_orders'),
    q<{c:number}>("SELECT COUNT(*) as c FROM nf_orders WHERE status='placed'"),
    q<{c:number}>("SELECT COUNT(*) as c FROM nf_orders WHERE status IN ('production','qc','shipped')"),
    q<{c:number}>("SELECT COUNT(*) as c FROM nf_orders WHERE status='delivered'"),

    q<{s:number}>('SELECT COALESCE(SUM(total_price_krw),0) as s FROM nf_orders WHERE created_at >= ? AND status != ?', monthStart, 'placed'),
    q<{s:number}>('SELECT COALESCE(SUM(total_price_krw),0) as s FROM nf_orders WHERE created_at >= ? AND status != ?', weekStart, 'placed'),

    q<{c:number}>("SELECT COUNT(*) as c FROM nf_factories WHERE status='active'"),
    q<{c:number}>("SELECT COUNT(*) as c FROM nf_factories WHERE status='active' AND partner_email IS NOT NULL"),
    q<{c:number}>("SELECT COUNT(*) as c FROM partner_applications WHERE status='pending'").catch(() => q<{c:number}>("SELECT 0 as c")),

    q<{c:number}>('SELECT COUNT(*) as c FROM nf_users'),
    q<{c:number}>('SELECT COUNT(*) as c FROM nf_users WHERE created_at >= ?', weekStart),

    qa<{id:string; user_email:string|null; shape_name:string|null; status:string; created_at:number}>(
      'SELECT id, user_email, shape_name, status, created_at FROM nf_rfqs ORDER BY created_at DESC LIMIT 8',
    ),
    qa<{id:string; part_name:string; manufacturer_name:string; status:string; total_price_krw:number; created_at:number}>(
      'SELECT id, part_name, manufacturer_name, status, total_price_krw, created_at FROM nf_orders ORDER BY created_at DESC LIMIT 8',
    ),
    qa<{status:string; c:number}>('SELECT status, COUNT(*) as c FROM nf_rfqs GROUP BY status'),
    qa<{status:string; c:number}>('SELECT status, COUNT(*) as c FROM nf_orders GROUP BY status'),
  ]);

  return NextResponse.json({
    rfq: {
      total: totalRfqs?.c ?? 0,
      pending: pendingRfqs?.c ?? 0,
      quoted: quotedRfqs?.c ?? 0,
      accepted: acceptedRfqs?.c ?? 0,
      byStatus: rfqsByStatus,
    },
    orders: {
      total: totalOrders?.c ?? 0,
      placed: placedOrders?.c ?? 0,
      active: activeOrders?.c ?? 0,
      delivered: deliveredOrders?.c ?? 0,
      byStatus: ordersByStatus,
    },
    revenue: {
      month: monthRevenue?.s ?? 0,
      week: weekRevenue?.s ?? 0,
    },
    partners: {
      total: totalPartners?.c ?? 0,
      active: activePartners?.c ?? 0,
      pendingApplications: pendingApplications?.c ?? 0,
    },
    users: {
      total: totalUsers?.c ?? 0,
      newThisWeek: weekUsers?.c ?? 0,
    },
    recentRfqs,
    recentOrders,
  });
}
