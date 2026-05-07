/**
 * POST/GET /api/jobs/quarterly-stage-roll
 *
 * 캘린더 분기(서울) 확정 스냅샷: `quarterly_order_krw` → `rollQuarterlyOrderKrwHistoryJson` →
 * `last_quarterly_history_roll_period` 갱신 → `evaluateStage(..., 'quarterly_volume')`.
 *
 * 크론 예시 (분기 첫날 03:05 KST, 월 1회만 의미 있음):
 *   `5 3 1 Jan,Apr,Jul,Oct *`  (Vercel/Railway에서 TZ=UTC로 두면 오프셋 조정 필요)
 *
 * 인증: `x-cron-secret: $CRON_SECRET` 또는 `verifyAdmin`.
 *
 * 쿼리:
 *   `?period=2026-Q1` — 특정 완료 분기만 롤(수동 재처리; 이미 해당 period면 스킵).
 *   `?limit=500` — 배치 크기(기본 2000, 최대 50000).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { runQuarterlyStageHistoryRoll } from '@/lib/quarterly-stage-job';

export const dynamic = 'force-dynamic';

function cronOk(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const secret = req.headers.get('x-cron-secret');
  return !!expected && secret === expected;
}

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin && !cronOk(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const period = sp.get('period') ?? undefined;
  const limitRaw = sp.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  const result = await runQuarterlyStageHistoryRoll({ periodKey: period, limit });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const expected = process.env.CRON_SECRET;
  if (!expected || bearer !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const period = sp.get('period') ?? undefined;
  const limitRaw = sp.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  const result = await runQuarterlyStageHistoryRoll({ periodKey: period, limit });
  return NextResponse.json({ ok: true, ...result });
}
