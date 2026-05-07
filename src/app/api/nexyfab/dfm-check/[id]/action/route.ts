/**
 * POST /api/nexyfab/dfm-check/[id]/action
 *
 * DFM 결과 페이지의 "다음 액션" 버튼 핸들러. 두 가지를 원자적으로 수행:
 *   1) nf_dfm_check.next_action 갱신 (해당 검증 1건의 의도 영속화)
 *   2) nf_funnel_event 추가 (코호트 분석용 append-only 로그)
 *
 * Stage 는 절대 만지지 않는다 — Funnel ≠ Stage 원칙.
 *
 * Body: { action: 'proceed_to_match' | 'request_expert' | 'revise' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { logFunnelEvent, type FunnelEventType } from '@/lib/funnel-logger';

export const dynamic = 'force-dynamic';

const ACTIONS = ['proceed_to_match', 'request_expert', 'revise'] as const;
type DfmAction = typeof ACTIONS[number];

const ACTION_TO_FUNNEL: Record<DfmAction, FunnelEventType> = {
  proceed_to_match: 'dfm_pass_to_match',
  request_expert:   'dfm_request_expert',
  revise:           'dfm_revise',
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const auth = await getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { action?: string };
  if (!body.action || !ACTIONS.includes(body.action as DfmAction)) {
    return NextResponse.json(
      { error: `action must be one of: ${ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }
  const action = body.action as DfmAction;

  const db = getDbAdapter();

  const row = await db.queryOne<{ id: string; user_id: string; issues: number; warnings: number }>(
    'SELECT id, user_id, issues, warnings FROM nf_dfm_check WHERE id = ?',
    id,
  );
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.user_id !== auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.execute(
    'UPDATE nf_dfm_check SET next_action = ? WHERE id = ?',
    action, id,
  );

  // Funnel 기록은 best-effort — 사용자 흐름을 막지 않는다.
  await logFunnelEvent(auth.userId, {
    eventType:   ACTION_TO_FUNNEL[action],
    contextType: 'dfm_check',
    contextId:   id,
    metadata: {
      issues:   row.issues,
      warnings: row.warnings,
    },
  });

  return NextResponse.json({ ok: true, action });
}
