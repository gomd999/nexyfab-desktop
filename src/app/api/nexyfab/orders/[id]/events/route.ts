/**
 * GET /api/nexyfab/orders/[id]/events  — customer-side timeline view.
 *
 * Returns the same nf_order_events rows as the partner endpoint, but only
 * for the order's owner (or a manufacturer assigned to it). No write access
 * here — customers can't post timeline events; for that, they use the
 * existing review or refund-request endpoints.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { listOrderEvents } from '@/lib/order-events';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const db = getDbAdapter();
  const row = await db.queryOne<{ user_id: string; manufacturer_id: string | null }>(
    'SELECT user_id, manufacturer_id FROM nf_orders WHERE id = ?',
    id,
  );
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.user_id !== authUser.userId && row.manufacturer_id !== authUser.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const events = await listOrderEvents(id);
  return NextResponse.json({ ok: true, events });
}
