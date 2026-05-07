/**
 * GET /api/billing/analytics
 * BI dashboard data — payment trends, revenue, usage metrics
 * Admin only (requires admin role or internal secret)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { verifyAdmin } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  // Accept both admin token and regular auth with admin role
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Only admins can access billing analytics
    const db = getDbAdapter();
    const user = await db.queryOne<{ role: string }>(
      'SELECT COALESCE(plan, ?) as role FROM nf_users WHERE id = ?',
      'free', authUser.userId,
    );
    if (!user || user.role !== 'enterprise') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
  }

  const db = getDbAdapter();
  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10), 1), 365);
  const since = Date.now() - days * 86_400_000;
  const product = req.nextUrl.searchParams.get('product') ?? undefined;
  // Allowlist to prevent SQL injection — only known product slugs are accepted
  const ALLOWED_PRODUCTS = new Set(['nexyfab', 'nexyflow', 'nexywise']);
  const safeProduct = product && ALLOWED_PRODUCTS.has(product) ? product : undefined;
  const productFilter = safeProduct ? 'AND product = ?' : '';

  const pf = safeProduct ? ' AND product = ?' : '';

  const [
    revenueByDay,
    revenueByProduct,
    planDistribution,
    paymentSuccessRate,
    topUsageMetrics,
    recentEvents,
    mrr,
  ] = await Promise.all([
    // Daily revenue (paid invoices)
    db.queryAll<{ day: string; revenue_krw: number; count: number }>(
      `SELECT
         strftime('%Y-%m-%d', datetime(paid_at/1000, 'unixepoch')) as day,
         SUM(total_amount_krw) as revenue_krw,
         COUNT(*) as count
       FROM nf_aw_invoices
       WHERE status = 'paid' AND paid_at > ?${pf}
       GROUP BY day
       ORDER BY day`,
      ...(safeProduct ? [since, safeProduct] : [since]),
    ),

    // Revenue by product
    db.queryAll<{ product: string; revenue_krw: number; invoice_count: number }>(
      `SELECT product, SUM(total_amount_krw) as revenue_krw, COUNT(*) as invoice_count
       FROM nf_aw_invoices
       WHERE status = 'paid' AND paid_at > ?
       GROUP BY product
       ORDER BY revenue_krw DESC`,
      since,
    ),

    // Plan distribution
    db.queryAll<{ plan: string; count: number }>(
      `SELECT plan, COUNT(*) as count
       FROM nf_users
       GROUP BY plan
       ORDER BY count DESC`,
    ),

    // Payment success rate
    db.queryAll<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count
       FROM nf_aw_payment_attempts
       WHERE attempted_at > ?
       GROUP BY status`,
      since,
    ),

    // Top usage metrics across all users
    db.queryAll<{ metric: string; product: string; total: number; user_count: number }>(
      `SELECT metric, product, SUM(quantity) as total, COUNT(DISTINCT user_id) as user_count
       FROM nf_usage_events
       WHERE created_at > ?${pf}
       GROUP BY metric, product
       ORDER BY total DESC
       LIMIT 20`,
      ...(safeProduct ? [since, safeProduct] : [since]),
    ),

    // Recent billing events from analytics table
    db.queryAll<{ event_type: string; product: string; recorded_at: number }>(
      `SELECT event_type, product, recorded_at
       FROM nf_billing_analytics
       WHERE recorded_at > ?${pf}
       ORDER BY recorded_at DESC
       LIMIT 50`,
      ...(safeProduct ? [since, safeProduct] : [since]),
    ),

    // Monthly Recurring Revenue estimate
    db.queryOne<{ mrr_krw: number }>(
      `SELECT SUM(base_amount_krw) as mrr_krw
       FROM nf_aw_subscriptions s
       INNER JOIN nf_aw_invoices i ON i.user_id = s.user_id AND i.product = s.product
       WHERE s.status = 'active'`,
    ),
  ]);

  const totalRevenue = revenueByDay.reduce((sum, r) => sum + r.revenue_krw, 0);
  const successCount = paymentSuccessRate.find(r => r.status === 'succeeded')?.count ?? 0;
  const totalAttempts = paymentSuccessRate.reduce((sum, r) => sum + r.count, 0);
  const successRate  = totalAttempts > 0 ? Math.round((successCount / totalAttempts) * 100) : 0;

  return NextResponse.json({
    summary: {
      periodDays:    days,
      totalRevenueKrw: totalRevenue,
      mrrKrw:        mrr?.mrr_krw ?? 0,
      paymentSuccessRate: successRate,
      totalAttempts,
    },
    revenueByDay,
    revenueByProduct,
    planDistribution,
    paymentSuccessRate,
    topUsageMetrics,
    recentEvents,
  });
}
