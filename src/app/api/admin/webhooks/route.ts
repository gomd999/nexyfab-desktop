/**
 * GET  /api/admin/webhooks  — Airwallex webhook 이벤트 목록
 * DELETE /api/admin/webhooks?id=xxx  — 이벤트 삭제 (optional cleanup)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface WebhookEventRow {
  id: string;
  stripe_event_id: string;
  event_type: string;
  processed_at: number;
  payload: string | null;
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;
  const eventType = searchParams.get('type');
  const search = searchParams.get('q');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '50', 10));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const vals: unknown[] = [];

  if (eventType) {
    conditions.push('event_type = ?');
    vals.push(eventType);
  }
  if (search) {
    conditions.push('(event_type LIKE ? OR stripe_event_id LIKE ?)');
    vals.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM nf_webhook_events ${where}`, ...vals,
  );
  const total = countRow?.cnt ?? 0;

  const events = await db.queryAll<WebhookEventRow>(
    `SELECT id, stripe_event_id, event_type, processed_at, payload
     FROM nf_webhook_events
     ${where}
     ORDER BY processed_at DESC
     LIMIT ? OFFSET ?`,
    ...vals, limit, offset,
  );

  // Distinct event types for filter dropdown
  const types = await db.queryAll<{ event_type: string }>(
    'SELECT DISTINCT event_type FROM nf_webhook_events ORDER BY event_type',
  );

  return NextResponse.json({
    events: events.map(e => ({
      id: e.id,
      eventId: e.stripe_event_id,
      type: e.event_type,
      processedAt: e.processed_at,
      hasPayload: !!e.payload,
    })),
    types: types.map(t => t.event_type),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function DELETE(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });

  const db = getDbAdapter();
  const result = await db.execute('DELETE FROM nf_webhook_events WHERE stripe_event_id = ?', id);
  if (result.changes === 0) {
    return NextResponse.json({ error: '이벤트를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
