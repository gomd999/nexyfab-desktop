/**
 * POST /api/billing/refund/request
 *
 * User-facing self-serve refund request. Per refund-policy KR/EN:
 *   - 구독 결제일로부터 7일 이내
 *   - 그 사이 서비스 미사용 (AI 호출 0회 + 프로젝트 저장 0회)
 *   → 자동 승인 + 즉시 환불 처리
 *
 * Outside that window OR with usage detected → admin queue (202).
 *
 * Why split from /api/billing/refund:
 *   - That endpoint is admin-only and assumes the operator has decided to
 *     refund. This endpoint enforces *eligibility* before invoking the same
 *     refund execution path.
 *   - Self-serve must never silently approve when the user has actually used
 *     the service — the refund-policy contract is unambiguous on that.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimit } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';
import { sendOpsAlert } from '@/lib/notify/opsAlert';

export const dynamic = 'force-dynamic';

const REFUND_WINDOW_DAYS = 7;
const REFUND_WINDOW_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

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
}

interface UsageRow {
  c: number;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limit — at most 3 refund requests per user per hour. Prevents
  // someone from spamming refund attempts to find an eligibility loophole.
  const ip = getTrustedClientIp(req.headers);
  if (!rateLimit(`refund-req:${auth.userId}:${ip}`, 3, 60 * 60 * 1000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({})) as { invoiceId?: string; reason?: string };
  if (!body.invoiceId || typeof body.invoiceId !== 'string') {
    return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });
  }

  const db = getDbAdapter();
  const invoice = await db.queryOne<InvoiceRow>(
    `SELECT id, user_id, product, aw_invoice_id, total_amount_krw, currency, country,
            status, paid_at, created_at
       FROM nf_aw_invoices
      WHERE id = ? AND user_id = ?`,
    body.invoiceId, auth.userId,
  );
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (invoice.status !== 'paid') {
    return NextResponse.json(
      { error: `Cannot refund invoice with status: ${invoice.status}` },
      { status: 400 },
    );
  }

  const paidAt = Number(invoice.paid_at ?? invoice.created_at);
  const ageMs = Date.now() - paidAt;
  const withinWindow = ageMs <= REFUND_WINDOW_MS;

  // "미사용" definition: no AI calls AND no project create/update events
  // since the invoice paid_at. nf_usage_events covers AI metering;
  // nf_audit_log captures project creates/updates.
  const aiUsage = await db.queryOne<UsageRow>(
    `SELECT COUNT(*) as c FROM nf_usage_events
      WHERE user_id = ? AND created_at >= ?`,
    auth.userId, paidAt,
  ).catch(() => null);

  const projectUsage = await db.queryOne<UsageRow>(
    `SELECT COUNT(*) as c FROM nf_audit_log
      WHERE user_id = ? AND created_at >= ?
        AND action IN ('project.create', 'project.update', 'project.save')`,
    auth.userId, paidAt,
  ).catch(() => null);

  const aiCalls = Number(aiUsage?.c ?? 0);
  const projectActions = Number(projectUsage?.c ?? 0);
  const unused = aiCalls === 0 && projectActions === 0;

  // Auto-eligible? Both windows must be satisfied. If the invoice is from a
  // grace-period downgrade (rare) we still require both — operator can
  // override via the admin endpoint if a special case warrants it.
  const autoEligible = withinWindow && unused;

  if (autoEligible) {
    // Mark the invoice as refund_pending and let an admin/cron complete the
    // actual provider refund call. We *do not* invoke the refund provider
    // synchronously here — it's a destructive irreversible action that
    // benefits from a human gate, especially while volume is low. The
    // ops alert below makes sure operators see the queue.
    await db.execute(
      "UPDATE nf_aw_invoices SET status = 'refund_pending' WHERE id = ?",
      invoice.id,
    );
    void sendOpsAlert({
      severity: 'info',
      title: 'Auto-eligible refund — admin approval needed',
      bodyLines: [
        `User self-requested refund within ${REFUND_WINDOW_DAYS}-day window with zero usage.`,
        `Invoice: ${invoice.id}`,
        `Amount: ${invoice.total_amount_krw} ${invoice.currency}`,
        `Reason: ${(body.reason ?? '(none)').slice(0, 200)}`,
        '',
        'Approve via /api/billing/refund (admin) — eligibility already verified.',
      ],
      context: { userId: auth.userId, invoiceId: invoice.id, ageDays: Math.floor(ageMs / 86_400_000) },
      source: 'self-serve:billing.refund.request',
    }).catch(() => { /* swallow */ });
    return NextResponse.json({
      ok: true,
      verdict: 'auto_eligible_pending_admin',
      invoiceId: invoice.id,
      message: 'Refund eligibility confirmed. An operator will process the refund within 1 business day.',
    });
  }

  // Not auto-eligible — record the request for admin review. We don't
  // change invoice status (still 'paid') so the user keeps service access
  // until the operator decides.
  void sendOpsAlert({
    severity: 'info',
    title: 'Refund request — manual review',
    bodyLines: [
      `User-requested refund did NOT auto-qualify.`,
      `Invoice: ${invoice.id}`,
      `Within ${REFUND_WINDOW_DAYS}-day window: ${withinWindow}`,
      `AI calls since paid: ${aiCalls}`,
      `Project actions since paid: ${projectActions}`,
      `Reason: ${(body.reason ?? '(none)').slice(0, 200)}`,
    ],
    context: { userId: auth.userId, invoiceId: invoice.id },
    source: 'self-serve:billing.refund.request',
  }).catch(() => { /* swallow */ });

  return NextResponse.json(
    {
      ok: true,
      verdict: 'manual_review',
      invoiceId: invoice.id,
      reasons: {
        withinWindow,
        aiCalls,
        projectActions,
        windowDays: REFUND_WINDOW_DAYS,
      },
      message: 'Your request is queued for admin review.',
    },
    { status: 202 },
  );
}
