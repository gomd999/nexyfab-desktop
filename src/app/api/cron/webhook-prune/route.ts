/**
 * GET /api/cron/webhook-prune
 * nf_webhook_events 테이블에서 90일 이상 된 레코드를 삭제한다.
 *
 * nf_webhook_events 는 Stripe/Airwallex/Toss webhook 멱등성을 위해 stripe_event_id를
 * 저장하는 테이블인데, 별도 TTL 정리가 없어 무한 증가한다.
 * 90일 이후 이벤트는 재처리 대상이 아니므로 삭제해도 안전하다.
 *
 * Auth: Bearer ${CRON_SECRET} — 다른 cron 엔드포인트와 동일 패턴.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  let deleted = 0;
  try {
    const result = await db.execute(
      `DELETE FROM nf_webhook_events WHERE processed_at < ?`,
      cutoff,
    );
    deleted = (result as { changes?: number }).changes ?? 0;
  } catch (err) {
    console.error('[webhook-prune] delete failed:', err);
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }

  // 감사 로그 (선택적 — nf_audit_log 가 없는 환경에서도 동작해야 하므로 try 안에)
  try {
    await db.execute(
      `INSERT INTO nf_audit_log (id, user_id, action, resource_type, metadata, created_at)
       VALUES (?, 'cron', 'webhook_prune', 'nf_webhook_events', ?, ?)`,
      `wh-prune-${Date.now()}`,
      JSON.stringify({ deleted, cutoff_ms: cutoff, retention_days: RETENTION_DAYS }),
      Date.now(),
    );
  } catch { /* audit log 실패는 무시 */ }

  return NextResponse.json({
    deleted,
    retention_days: RETENTION_DAYS,
    cutoff: new Date(cutoff).toISOString(),
    timestamp: new Date().toISOString(),
  });
}
