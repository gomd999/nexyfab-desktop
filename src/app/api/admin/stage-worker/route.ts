/**
 * POST /api/admin/stage-worker
 * 수동/cron 트리거로 nf_stage_event 아웃박스를 N건 처리.
 *
 * 인증: `verifyAdmin` **또는** `x-cron-secret: $CRON_SECRET` (다른 jobs 라우트와 동일).
 * Body (선택): { limit?: number, baseUrl?: string }
 *
 * 운영 순서는 `docs/bm-cron-runbook.md` 참고.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { processStageEvents } from '@/lib/stage-worker';

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

  const body = await req.json().catch(() => ({})) as { limit?: number; baseUrl?: string };
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 500);

  const result = await processStageEvents({ limit, baseUrl: body.baseUrl });
  return NextResponse.json(result);
}
