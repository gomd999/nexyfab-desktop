/**
 * GET  /api/billing/invoices         — list invoices
 * POST /api/billing/invoices/generate — generate cycle invoice (admin/cron)
 * POST /api/billing/invoices/charge   — charge an open invoice
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import {
  generateCycleInvoice,
  chargeInvoice,
  type Product,
  type Plan,
} from '@/lib/billing-engine';

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const product = req.nextUrl.searchParams.get('product') ?? undefined;
  const page    = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));
  const limit   = Math.min(50, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10));
  const offset  = (page - 1) * limit;

  const whereProduct = product ? 'AND product = ?' : '';
  const params = product
    ? [authUser.userId, product, limit, offset]
    : [authUser.userId, limit, offset];

  const [invoices, totalRow] = await Promise.all([
    db.queryAll<{
      id: string; product: string; plan: string;
      base_amount_krw: number; usage_amount_krw: number; total_amount_krw: number;
      status: string; description: string; paid_at: number | null; created_at: number;
    }>(
      `SELECT id, product, plan, base_amount_krw, usage_amount_krw, total_amount_krw,
              status, description, paid_at, created_at
       FROM nf_aw_invoices
       WHERE user_id = ? ${whereProduct}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
    ),
    db.queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM nf_aw_invoices WHERE user_id = ? ${whereProduct}`,
      ...(product ? [authUser.userId, product] : [authUser.userId]),
    ),
  ]);

  // Attach payment attempts for each invoice
  const invoiceIds = invoices.map(i => i.id);
  const attempts = invoiceIds.length > 0
    ? await db.queryAll<{ invoice_id: string; status: string; attempt_number: number; attempted_at: number; error_message: string | null }>(
        `SELECT invoice_id, status, attempt_number, attempted_at, error_message
         FROM nf_aw_payment_attempts
         WHERE invoice_id IN (${invoiceIds.map(() => '?').join(',')})
         ORDER BY attempted_at DESC`,
        ...invoiceIds,
      )
    : [];

  const attemptsByInvoice = attempts.reduce<Record<string, typeof attempts>>((acc, a) => {
    (acc[a.invoice_id] ??= []).push(a);
    return acc;
  }, {});

  return NextResponse.json({
    invoices: invoices.map(inv => ({
      ...inv,
      attempts: attemptsByInvoice[inv.id] ?? [],
    })),
    pagination: {
      page,
      limit,
      total: totalRow?.c ?? 0,
      totalPages: Math.ceil((totalRow?.c ?? 0) / limit),
    },
  });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    action: 'generate' | 'charge';
    product?: Product;
    invoiceId?: string;
    paymentMethodId?: string;
  };

  const db = getDbAdapter();

  if (body.action === 'generate') {
    // Admin or cron-triggered only
    const { verifyAdmin } = await import('@/lib/admin-auth');
    if (!(await verifyAdmin(req))) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    const user = await db.queryOne<{ plan: string }>(
      'SELECT plan FROM nf_users WHERE id = ?', authUser.userId,
    );
    const plan    = (user?.plan ?? 'free') as Plan;
    const product = body.product ?? 'nexyfab';

    const result = await generateCycleInvoice(authUser.userId, product, plan);
    if (result.skipped) {
      return NextResponse.json({ message: '청구할 금액이 없습니다.', skipped: true });
    }
    return NextResponse.json(result, { status: 201 });
  }

  if (body.action === 'charge') {
    if (!body.invoiceId || !body.paymentMethodId) {
      return NextResponse.json({ error: 'invoiceId and paymentMethodId required' }, { status: 400 });
    }

    // Verify invoice belongs to this user
    const invoice = await db.queryOne<{ user_id: string }>(
      'SELECT user_id FROM nf_aw_invoices WHERE id = ?', body.invoiceId,
    );
    if (!invoice || invoice.user_id !== authUser.userId) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const result = await chargeInvoice(body.invoiceId, body.paymentMethodId);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
