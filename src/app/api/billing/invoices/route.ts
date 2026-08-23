/**
 * GET  /api/billing/invoices         — list invoices
 * POST /api/billing/invoices/generate — generate cycle invoice (admin/cron)
 * POST /api/billing/invoices/charge   — charge an open invoice
 */
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import {
  generateCycleInvoice,
  chargeInvoice,
  type Product,
  type Plan,
} from '@/lib/billing-engine';
import { resolveRequestOrgContext } from '@/lib/org-context';
import { denyIfPaymentCollectionDisabled } from '@/lib/payment-gate';

function orgContextError(code: 'ORG_CONTEXT_REQUIRED' | 'ORG_CONTEXT_INVALID') {
  return NextResponse.json({ error: 'Select a valid billing context', code }, { status: 409 });
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return orgContextError(context.code);

  const db = getDbAdapter();
  const product = req.nextUrl.searchParams.get('product') ?? undefined;
  const page    = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));
  const limit   = Math.min(50, parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10));
  const offset  = (page - 1) * limit;

  const orgId = context.orgId;
  const scope = orgId ? 'org_id = ?' : 'user_id = ? AND org_id IS NULL';
  const scopeArgs: (string | number)[] = orgId ? [orgId] : [authUser.userId];
  const whereProduct = product ? 'AND product = ?' : '';
  const productArgs = product ? [product] : [];

  const [invoices, totalRow] = await Promise.all([
    db.queryAll<{
      id: string; product: string; plan: string;
      base_amount_krw: number; usage_amount_krw: number; total_amount_krw: number;
      status: string; description: string; paid_at: number | null; created_at: number;
    }>(
      `SELECT id, product, plan, base_amount_krw, usage_amount_krw, total_amount_krw,
              status, description, paid_at, created_at
       FROM nf_aw_invoices
       WHERE ${scope} ${whereProduct}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      ...scopeArgs, ...productArgs, limit, offset,
    ),
    db.queryOne<{ c: number }>(
      `SELECT COUNT(*) as c FROM nf_aw_invoices WHERE ${scope} ${whereProduct}`,
      ...scopeArgs, ...productArgs,
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

const BILLING_INVOICE_JSON_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const context = resolveRequestOrgContext(authUser);
  if (!context.ok) return orgContextError(context.code);

  let body: {
    action?: 'generate' | 'charge';
    product?: Product;
    invoiceId?: string;
    paymentMethodId?: string;
  } = {};
  try { body = await readBoundedJson(req, BILLING_INVOICE_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
  }

  const db = getDbAdapter();

  if (body.action === 'generate') {
    // Admin or cron-triggered only
    const { verifyAdmin } = await import('@/lib/admin-auth');
    if (!(await verifyAdmin(req))) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    const plan    = (authUser.plan ?? 'free') as Plan;
    const product = body.product ?? 'nexyfab';

    const result = await generateCycleInvoice(authUser.userId, product, plan, undefined, context.orgId);
    if (result.skipped) {
      return NextResponse.json({ message: '청구할 금액이 없습니다.', skipped: true });
    }
    return NextResponse.json(result, { status: 201 });
  }

  if (body.action === 'charge') {
    const paymentDenied = denyIfPaymentCollectionDisabled();
    if (paymentDenied) return paymentDenied;
    if (!body.invoiceId || !body.paymentMethodId) {
      return NextResponse.json({ error: 'invoiceId and paymentMethodId required' }, { status: 400 });
    }

    const invoice = await db.queryOne<{ user_id: string | null; org_id: string | null }>(
      'SELECT user_id, org_id FROM nf_aw_invoices WHERE id = ?', body.invoiceId,
    );
    const belongsToContext = context.orgId
      ? invoice?.org_id === context.orgId
      : invoice?.org_id === null && invoice?.user_id === authUser.userId;
    if (!invoice || !belongsToContext) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const result = await chargeInvoice(body.invoiceId, body.paymentMethodId);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
