// Customer payment methods — list, set default, delete. Wraps the
// gateway's PM endpoints so the billing UI can show a "Saved cards" panel
// matching Stripe Customer Portal capability.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { awFetch } from '@/lib/airwallex-client';
import { ensureAwCustomer } from '@/lib/billing-engine';

interface AwPaymentMethod {
  id: string;
  type: 'card' | 'bank_transfer' | string;
  card?: { brand: string; last4: string; exp_month: number; exp_year: number };
  is_default?: boolean;
}

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const awCustomerId = await ensureAwCustomer(authUser.userId);
    const list = await awFetch<{ items: AwPaymentMethod[] }>(
      'GET',
      `/payment_methods?customer_id=${encodeURIComponent(awCustomerId)}`,
    );
    return NextResponse.json({
      paymentMethods: list.items.map(pm => ({
        id: pm.id,
        type: pm.type,
        brand: pm.card?.brand,
        last4: pm.card?.last4,
        expMonth: pm.card?.exp_month,
        expYear: pm.card?.exp_year,
        isDefault: pm.is_default ?? false,
      })),
    });
  } catch (err) {
    console.error('[payment-methods] list error:', err);
    return NextResponse.json({ paymentMethods: [] });
  }
}

const setDefaultSchema = z.object({
  paymentMethodId: z.string().min(1).max(120),
});

export async function PUT(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const parsed = setDefaultSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  try {
    const awCustomerId = await ensureAwCustomer(authUser.userId);
    await awFetch('POST', `/customers/${awCustomerId}/default_payment_method`, {
      payment_method_id: parsed.data.paymentMethodId,
    });
    // Mirror the default in our DB so PM-aware retries know which card to use.
    const db = getDbAdapter();
    await db.execute(
      'UPDATE nf_aw_customers SET default_payment_method_id = ?, updated_at = ? WHERE id = ?',
      parsed.data.paymentMethodId, Date.now(), awCustomerId,
    ).catch(() => { /* column may not exist yet — non-fatal */ });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[payment-methods] set default error:', err);
    return NextResponse.json({ error: 'Failed to update default' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  try {
    await awFetch('DELETE', `/payment_methods/${id}`, {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[payment-methods] delete error:', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 502 });
  }
}
