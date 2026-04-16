/**
 * GET  /api/admin/billing  — 인보이스 목록 (필터: status, product, country, q)
 * POST /api/admin/billing  — 수동 재시도 트리거 { invoiceId, paymentMethodId? }
 * DELETE /api/admin/billing — 인보이스 void 처리 { invoiceId }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { processSmartRetries } from '@/lib/billing-engine';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const sp      = req.nextUrl.searchParams;
  const status  = sp.get('status') ?? '';
  const product = sp.get('product') ?? '';
  const country = sp.get('country') ?? '';
  const q       = sp.get('q') ?? '';
  const page    = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit   = 50;
  const offset  = (page - 1) * limit;

  const db = getDbAdapter();

  const conditions: string[] = [];
  const params: unknown[]    = [];

  if (status)  { conditions.push("inv.status = ?");  params.push(status); }
  if (product) { conditions.push("inv.product = ?"); params.push(product); }
  if (country) { conditions.push("inv.country = ?"); params.push(country); }
  if (q) {
    conditions.push("(u.email LIKE ? OR u.name LIKE ? OR inv.id LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [invoices, countRow] = await Promise.all([
    db.queryAll<{
      id: string; user_id: string; email: string; name: string;
      product: string; plan: string; status: string;
      display_amount: number; currency: string; country: string;
      total_amount_krw: number; description: string;
      created_at: number; paid_at: number | null;
      attempt_count: number; last_error: string | null; last_attempt_at: number | null;
    }>(
      `SELECT inv.id, inv.user_id, u.email, u.name,
              inv.product, inv.plan, inv.status,
              inv.display_amount, inv.currency, inv.country,
              inv.total_amount_krw, inv.description,
              inv.created_at, inv.paid_at,
              COUNT(pa.id)          AS attempt_count,
              MAX(pa.error_message) AS last_error,
              MAX(pa.attempted_at)  AS last_attempt_at
       FROM nf_aw_invoices inv
       LEFT JOIN nf_users u       ON u.id  = inv.user_id
       LEFT JOIN nf_aw_payment_attempts pa ON pa.invoice_id = inv.id
       ${where}
       GROUP BY inv.id
       ORDER BY inv.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    ),
    db.queryOne<{ total: number }>(
      `SELECT COUNT(DISTINCT inv.id) AS total
       FROM nf_aw_invoices inv
       LEFT JOIN nf_users u ON u.id = inv.user_id
       ${where}`,
      ...params,
    ),
  ]);

  // Retry queue summary
  const retryQueue = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM nf_aw_payment_attempts
     WHERE status = 'failed' AND next_retry_at IS NOT NULL`,
  );

  return NextResponse.json({
    invoices,
    total:      countRow?.total ?? 0,
    page,
    limit,
    retryQueue: retryQueue?.count ?? 0,
  });
}

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const body = await req.json() as { invoiceId?: string; paymentMethodId?: string; action?: string };

  // Run all pending smart retries (cron-style manual trigger)
  if (body.action === 'run-retries') {
    const result = await processSmartRetries(body.paymentMethodId ?? '');
    return NextResponse.json({ ok: true, ...result });
  }

  // Retry single invoice
  if (!body.invoiceId) {
    return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });
  }

  const db = getDbAdapter();
  const invoice = await db.queryOne<{ status: string }>(
    'SELECT status FROM nf_aw_invoices WHERE id = ?',
    body.invoiceId,
  );
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  if (!['past_due', 'open'].includes(invoice.status)) {
    return NextResponse.json({ error: `Cannot retry invoice with status: ${invoice.status}` }, { status: 400 });
  }

  // Reset next_retry_at to now so the next cron run picks it up immediately
  await db.execute(
    `UPDATE nf_aw_payment_attempts
     SET next_retry_at = ?
     WHERE invoice_id = ? AND status = 'failed'
       AND next_retry_at IS NOT NULL`,
    Date.now(), body.invoiceId,
  );

  return NextResponse.json({ ok: true, message: '재시도가 예약되었습니다. 다음 retry 실행 시 처리됩니다.' });
}

export async function DELETE(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const { invoiceId } = await req.json() as { invoiceId?: string };
  if (!invoiceId) return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });

  const db = getDbAdapter();
  await db.execute(
    "UPDATE nf_aw_invoices SET status = 'void' WHERE id = ? AND status != 'paid'",
    invoiceId,
  );
  // Cancel pending retries
  await db.execute(
    "UPDATE nf_aw_payment_attempts SET next_retry_at = NULL WHERE invoice_id = ?",
    invoiceId,
  );

  return NextResponse.json({ ok: true });
}
