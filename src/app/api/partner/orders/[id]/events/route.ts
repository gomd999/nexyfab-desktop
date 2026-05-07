/**
 * GET  /api/partner/orders/[id]/events  — list timeline events (partner view)
 * POST /api/partner/orders/[id]/events  — partner adds note / photo / shipment / delay
 *
 * Authorization: order.partner_email must match the calling partner.
 * Photo URLs are passed in (uploaded separately via /api/partner/upload).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerAuth } from '@/lib/partner-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { listOrderEvents, recordOrderEvent, type OrderEventKind } from '@/lib/order-events';
import { createNotification } from '@/app/lib/notify';
import { normPartnerEmail } from '@/lib/partner-factory-access';

export const dynamic = 'force-dynamic';

const ALLOWED_KINDS: OrderEventKind[] = ['note', 'photo', 'shipment', 'delay'];

async function authorizeOrder(req: NextRequest, orderId: string) {
  const partner = await getPartnerAuth(req);
  if (!partner) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const db = getDbAdapter();
  const row = await db.queryOne<{
    id: string; partner_email: string | null; manufacturer_name: string;
    user_id: string; part_name: string;
  }>(
    'SELECT id, partner_email, manufacturer_name, user_id, part_name FROM nf_orders WHERE id = ?',
    orderId,
  );
  if (!row) return { error: NextResponse.json({ error: 'Order not found' }, { status: 404 }) };
  const co = (partner.company ?? '').trim().toLowerCase();
  const emailOk = normPartnerEmail(row.partner_email) === normPartnerEmail(partner.email);
  const nameOk = co.length > 0 && row.manufacturer_name.trim().toLowerCase() === co;
  if (!emailOk && !nameOk) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { partner, order: row };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeOrder(req, id);
  if ('error' in auth) return auth.error;

  const events = await listOrderEvents(id);
  return NextResponse.json({ ok: true, events });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  const auth = await authorizeOrder(req, id);
  if ('error' in auth) return auth.error;
  const { partner, order } = auth;

  const body = await req.json().catch(() => null) as {
    kind?: string; body?: string; photoUrl?: string; metadata?: Record<string, unknown>;
  } | null;
  if (!body || !body.kind || !ALLOWED_KINDS.includes(body.kind as OrderEventKind)) {
    return NextResponse.json({ error: `kind must be one of: ${ALLOWED_KINDS.join(', ')}` }, { status: 400 });
  }
  if (body.kind === 'photo' && !body.photoUrl) {
    return NextResponse.json({ error: 'photo 이벤트는 photoUrl이 필요합니다.' }, { status: 400 });
  }
  if ((body.kind === 'note' || body.kind === 'delay' || body.kind === 'shipment') && !body.body) {
    return NextResponse.json({ error: 'body 텍스트가 필요합니다.' }, { status: 400 });
  }

  const eventId = await recordOrderEvent({
    orderId: id,
    kind: body.kind as OrderEventKind,
    authorEmail: partner.email,
    authorRole: 'partner',
    body: body.body,
    photoUrl: body.photoUrl,
    metadata: body.metadata,
  });

  // 고객 알림 — 사진/지연 보고는 즉시 알리고, 단순 메모는 in-app만
  if (order.user_id) {
    const titleByKind: Record<string, string> = {
      note: '📝 새 메모가 등록되었습니다',
      photo: '📷 새 진행 사진이 도착했습니다',
      shipment: '🚚 운송장 정보가 등록되었습니다',
      delay: '⚠ 납기 지연 안내가 등록되었습니다',
    };
    createNotification(
      order.user_id,
      'order_event',
      titleByKind[body.kind] ?? '주문에 새 업데이트가 있습니다',
      `${order.part_name}: ${body.body?.slice(0, 80) ?? '진행 사진이 도착했습니다.'}`,
      { contractId: id },
    );
  }

  return NextResponse.json({ ok: true, eventId });
}
