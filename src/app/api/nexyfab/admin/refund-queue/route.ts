/**
 * GET    /api/nexyfab/admin/refund-queue — list invoices with status='refund_pending'
 * POST   /api/nexyfab/admin/refund-queue — body { invoiceId, action: 'approve'|'reject', reason? }
 *                                            approve → call existing /api/billing/refund logic
 *                                            reject  → flip invoice back to 'paid' + audit
 *
 * Sits next to /api/billing/refund (admin direct execution) but adds the
 * "queue + decide" layer that the self-serve refund flow (Round 28) puts
 * invoices into. Keeps a single endpoint for the admin dashboard so the
 * UI doesn't have to know about provider plumbing.
 *
 * Auth: super_admin / org_admin (same gate as the rest of the admin AI/billing endpoints).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { createRefund } from '@/lib/airwallex-client';
import { cancelPayment } from '@/lib/toss-client';
import { recordBillingAnalytics } from '@/lib/billing-engine';

export const dynamic = 'force-dynamic';

interface InvoiceRow {
  id: string;
  user_id: string;
  product: string;
  aw_invoice_id: string;
  total_amount_krw: number;
  currency: string;
  country: string;
  status: string;
  paid_at: number | null;
  created_at: number;
  description: string | null;
}

interface AdminOk { kind: 'ok'; userId: string }
interface AdminFail { kind: 'fail'; response: NextResponse }

async function requireAdmin(req: NextRequest): Promise<AdminOk | AdminFail> {
  const authUser = await getAuthUser(req);
  if (!authUser) return { kind: 'fail', response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const isAdmin = authUser.globalRole === 'super_admin'
    || (authUser.roles?.some(r => r.role === 'org_admin' as string) ?? false);
  if (!isAdmin) return { kind: 'fail', response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { kind: 'ok', userId: authUser.userId };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'fail') return auth.response;

  const limit = Math.max(1, Math.min(200, parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10)));
  const db = getDbAdapter();

  // Pull pending invoices + the user email so the operator has enough context
  // without a second round-trip per row.
  const rows = await db.queryAll<InvoiceRow & { user_email: string | null }>(
    `SELECT i.id, i.user_id, i.product, i.aw_invoice_id, i.total_amount_krw,
            i.currency, i.country, i.status, i.paid_at, i.created_at, i.description,
            u.email AS user_email
       FROM nf_aw_invoices i
       LEFT JOIN nf_users u ON u.id = i.user_id
      WHERE i.status = 'refund_pending'
      ORDER BY i.paid_at DESC NULLS LAST, i.created_at DESC
      LIMIT ?`,
    limit,
  ).catch(() => [] as Array<InvoiceRow & { user_email: string | null }>);

  return NextResponse.json({
    invoices: rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email,
      product: r.product,
      amount: r.total_amount_krw,
      currency: r.currency,
      country: r.country,
      paidAt: r.paid_at,
      createdAt: r.created_at,
      description: r.description,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth.kind === 'fail') return auth.response;

  const body = await req.json().catch(() => ({})) as {
    invoiceId?: string;
    action?: string;
    reason?: string;
  };
  if (!body.invoiceId || (body.action !== 'approve' && body.action !== 'reject')) {
    return NextResponse.json({ error: 'invoiceId + action(approve|reject) required' }, { status: 400 });
  }
  const reason = (body.reason ?? '').slice(0, 500);
  const db = getDbAdapter();

  const invoice = await db.queryOne<InvoiceRow>(
    `SELECT id, user_id, product, aw_invoice_id, total_amount_krw, currency, country, status, paid_at, created_at, description
       FROM nf_aw_invoices WHERE id = ?`,
    body.invoiceId,
  );
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  if (invoice.status !== 'refund_pending') {
    return NextResponse.json(
      { error: `Invoice is not in refund_pending state (current: ${invoice.status})` },
      { status: 400 },
    );
  }

  if (body.action === 'reject') {
    // Operator declined — flip back to 'paid' so the user keeps the service
    // they've paid for. Audit-style record via billing-analytics.
    await db.execute("UPDATE nf_aw_invoices SET status = 'paid' WHERE id = ?", invoice.id);
    await recordBillingAnalytics({
      eventType: 'refund.rejected',
      userId: invoice.user_id,
      product: invoice.product as 'nexyfab' | 'nexyflow' | 'nexywise',
      invoiceId: invoice.id,
      payload: { reason, decidedBy: auth.userId },
    });
    return NextResponse.json({ ok: true, verdict: 'rejected', invoiceId: invoice.id });
  }

  // approve — actually call the provider. Mirrors /api/billing/refund logic
  // but with the queue gate.
  const isKorea = invoice.country === 'KR';
  try {
    let providerRefundId: string;
    let providerStatus: string;
    if (isKorea && invoice.aw_invoice_id.startsWith('nf-')) {
      const sk = process.env.TOSS_SECRET_KEY ?? '';
      const authHeader = 'Basic ' + Buffer.from(sk + ':').toString('base64');
      const lookupRes = await fetch(`https://api.tosspayments.com/v1/payments/orders/${invoice.aw_invoice_id}`, {
        headers: { Authorization: authHeader },
      });
      if (!lookupRes.ok) throw new Error(`Toss payment lookup failed: ${lookupRes.status}`);
      const tossPayment = await lookupRes.json() as { paymentKey: string };
      const cancelled = await cancelPayment(tossPayment.paymentKey, reason || '관리자 환불 처리', undefined);
      providerRefundId = tossPayment.paymentKey;
      providerStatus = cancelled.status;
    } else {
      const refund = await createRefund({
        paymentIntentId: invoice.aw_invoice_id,
        reason: reason || 'requested_by_customer',
      });
      providerRefundId = refund.id;
      providerStatus = refund.status;
    }

    await db.execute("UPDATE nf_aw_invoices SET status = 'refunded' WHERE id = ?", invoice.id);
    // Cancel active sub + flip user to free (full refund only — partials would
    // be handled via the older /api/billing/refund admin path).
    await db.execute(
      "UPDATE nf_aw_subscriptions SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE user_id = ? AND product = ? AND status IN ('active', 'past_due', 'cancel_pending')",
      Date.now(), Date.now(), invoice.user_id, invoice.product,
    );
    await db.execute("UPDATE nf_users SET plan = 'free' WHERE id = ?", invoice.user_id);

    await recordBillingAnalytics({
      eventType: 'refund.approved',
      userId: invoice.user_id,
      product: invoice.product as 'nexyfab' | 'nexyflow' | 'nexywise',
      invoiceId: invoice.id,
      payload: { providerRefundId, providerStatus, reason, decidedBy: auth.userId, provider: isKorea ? 'toss' : 'airwallex' },
    });

    return NextResponse.json({
      ok: true,
      verdict: 'approved',
      invoiceId: invoice.id,
      providerRefundId,
      providerStatus,
    });
  } catch (err) {
    // Provider call failed — leave invoice in refund_pending so the operator
    // can retry rather than ending up in a half-refunded state.
    console.error('[admin/refund-queue] provider refund failed:', err);
    return NextResponse.json(
      { error: `Provider refund failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
