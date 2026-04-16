import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/csrf';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { handleBillingEvent, type AwWebhookEvent } from '@/lib/billing-webhook-handler';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Use session-based admin auth (avoids exposing ADMIN_SECRET in request body/logs)
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { eventId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { eventId } = body;
  if (!eventId) {
    return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
  }

  const db = getDbAdapter();

  // Look up the event + payload from nf_webhook_events
  const event = await db.queryOne<{ id: string; event_type: string; stripe_event_id: string; payload: string | null }>(
    'SELECT id, event_type, stripe_event_id, payload FROM nf_webhook_events WHERE stripe_event_id = ?',
    eventId,
  );

  if (!event) {
    return NextResponse.json({ error: '이벤트를 찾을 수 없습니다.' }, { status: 404 });
  }

  if (!event.payload) {
    return NextResponse.json({
      error: '저장된 페이로드가 없습니다. 이 이벤트는 페이로드 저장 기능 추가 전에 수신된 것입니다.',
    }, { status: 422 });
  }

  let parsedEvent: AwWebhookEvent;
  try {
    parsedEvent = JSON.parse(event.payload) as AwWebhookEvent;
  } catch {
    return NextResponse.json({ error: '저장된 페이로드 파싱에 실패했습니다.' }, { status: 500 });
  }

  try {
    const handled = await handleBillingEvent(parsedEvent);
    return NextResponse.json({ ok: true, eventId, eventType: event.event_type, handled });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}
