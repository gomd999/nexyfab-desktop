/**
 * POST /api/admin/stage-worker
 * 수동/cron 트리거로 nf_stage_event 아웃박스를 N건 처리.
 * Railway cron 도입 전까지의 임시 진입점.
 *
 * Header: X-Admin-Secret 또는 super_admin JWT.
 * Body (선택): { limit?: number, baseUrl?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { processStageEvents } from '@/lib/stage-worker';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { limit?: number; baseUrl?: string };
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 500);

  const result = await processStageEvents({ limit, baseUrl: body.baseUrl });
  return NextResponse.json(result);
}
