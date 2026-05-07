/**
 * GET /api/cron/demo-session-prune
 * 고아 데모 세션 정리 cron — 하루 한 번 실행 권장.
 * Secured via Authorization: Bearer ${CRON_SECRET}
 *
 * 규칙:
 *   - nf_sessions WHERE claimed_at IS NULL AND created_at < NOW() - 7d 인 세션 삭제
 *   - 해당 세션의 고아 데모 데이터(nf_dfm_check, nf_rfqs, nf_funnel_event)도 정리
 *     (user_id = 'demo-user' 이면서 session_id 가 삭제된 세션을 참조하던 행)
 *
 * 안전장치:
 *   - claim 된 세션(user_id ≠ 'demo-user')은 절대 손대지 않음
 *   - 데이터 삭제는 session 삭제 전에 실행(FK 무결성)
 *   - 한 번에 최대 5,000 세션만 처리(대량 쌓여도 OOM 방지)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { DEMO_USER_ID } from '@/lib/demo-session';

export const dynamic = 'force-dynamic';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 5_000;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const cutoff = Date.now() - TTL_MS;

  // 고아 세션 id 목록 수집 — claim 안 된 채 만료된 것들
  const orphans = await db.queryAll<{ id: string }>(
    `SELECT id FROM nf_sessions
      WHERE claimed_at IS NULL
        AND created_at < ?
      LIMIT ${BATCH_LIMIT}`,
    cutoff,
  );

  if (orphans.length === 0) {
    return NextResponse.json({
      pruned: 0,
      dfmDeleted: 0,
      rfqDeleted: 0,
      funnelDeleted: 0,
      timestamp: new Date().toISOString(),
    });
  }

  // Postgres 와 SQLite 양쪽에서 IN (?, ?, ?, ...) 작동하도록 placeholder 동적 생성
  const placeholders = orphans.map(() => '?').join(', ');
  const ids = orphans.map((o) => o.id);

  let dfmDeleted = 0;
  let rfqDeleted = 0;
  let funnelDeleted = 0;
  let pruned = 0;

  try {
    const dfmRes = await db.execute(
      `DELETE FROM nf_dfm_check
        WHERE user_id = ? AND session_id IN (${placeholders})`,
      DEMO_USER_ID, ...ids,
    );
    dfmDeleted = dfmRes.changes ?? 0;

    const rfqRes = await db.execute(
      `DELETE FROM nf_rfqs
        WHERE user_id = ? AND session_id IN (${placeholders})`,
      DEMO_USER_ID, ...ids,
    );
    rfqDeleted = rfqRes.changes ?? 0;

    const fnlRes = await db.execute(
      `DELETE FROM nf_funnel_event
        WHERE user_id = ? AND session_id IN (${placeholders})`,
      DEMO_USER_ID, ...ids,
    );
    funnelDeleted = fnlRes.changes ?? 0;

    const sessRes = await db.execute(
      `DELETE FROM nf_sessions
        WHERE claimed_at IS NULL
          AND id IN (${placeholders})`,
      ...ids,
    );
    pruned = sessRes.changes ?? 0;
  } catch (err) {
    console.error('[demo-session-prune] batch delete failed:', err);
    return NextResponse.json(
      { error: 'Prune failed', detail: String(err) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    pruned,
    dfmDeleted,
    rfqDeleted,
    funnelDeleted,
    truncated: orphans.length === BATCH_LIMIT,
    timestamp: new Date().toISOString(),
  });
}
