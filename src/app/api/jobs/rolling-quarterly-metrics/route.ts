/**
 * POST/GET /api/jobs/rolling-quarterly-metrics
 *
 * `nf_orders` 납품·완료 건을 직전 N일(기본 90) 합산해 `nf_users.quarterly_order_krw` 갱신.
 * 이후 최근 활동 유저에 `evaluateStaleUsers` 호출(옵션, 기본 on).
 *
 * 인증: `x-cron-secret: $CRON_SECRET` 또는 `verifyAdmin`.
 *
 * 쿼리: `?days=90` `?noStale=1` — 재평가 생략.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { updateRollingQuarterlyOrderKrw } from '@/lib/rolling-quarterly-metrics';

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
  const days = sp.get('days') ? parseInt(sp.get('days')!, 10) : undefined;
  const noStale = sp.get('noStale') === '1' || sp.get('noStale') === 'true';
  const result = await updateRollingQuarterlyOrderKrw({
    windowDays: days,
    reevaluateStale: !noStale,
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const expected = process.env.CRON_SECRET;
  if (!expected || bearer !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const days = sp.get('days') ? parseInt(sp.get('days')!, 10) : undefined;
  const noStale = sp.get('noStale') === '1' || sp.get('noStale') === 'true';
  const result = await updateRollingQuarterlyOrderKrw({
    windowDays: days,
    reevaluateStale: !noStale,
  });
  return NextResponse.json({ ok: true, ...result });
}
