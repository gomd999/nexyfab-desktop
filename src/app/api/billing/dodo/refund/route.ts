/**
 * POST /api/billing/dodo/refund — Admin-only Dodo refund (partial or full).
 *
 * Body: { paymentId: string, amount?: number, reason?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRefund } from '@/lib/dodo';
import { getAuthUser } from '@/lib/auth-middleware';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.globalRole !== 'super_admin') {
    return NextResponse.json({ error: 'admin_only' }, { status: 403 });
  }

  let body: { paymentId?: string; amount?: number; reason?: string };
  try { body = (await req.json()) as typeof body; }
  catch { return NextResponse.json({ error: 'invalid_payload' }, { status: 400 }); }

  if (!body.paymentId) return NextResponse.json({ error: 'paymentId_required' }, { status: 400 });

  try {
    const result = await createRefund({ paymentId: body.paymentId, amount: body.amount, reason: body.reason });
    return NextResponse.json({ ok: true, refund: result });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: 'refund_failed', message: e.message }, { status: e.status ?? 500 });
  }
}
