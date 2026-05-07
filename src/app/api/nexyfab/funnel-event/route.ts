/**
 * POST /api/nexyfab/funnel-event
 *
 * 클라이언트에서 직접 fire 하는 funnel 이벤트 단일 진입점.
 * Stage 와 무관 — 절대 nf_users.stage 를 건드리지 않는다.
 *
 * 보안:
 *   - CSRF: checkOrigin
 *   - Auth: 로그인 필수 (익명은 풋프린트 의미 없음)
 *   - 이벤트 타입: 명시적 allowlist — 자유 텍스트 금지
 *
 * Body: { eventType, contextType?, contextId?, metadata? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { logFunnelEvent, type FunnelEventType } from '@/lib/funnel-logger';
import { getDemoSession, DEMO_USER_ID } from '@/lib/demo-session';

export const dynamic = 'force-dynamic';

// 클라이언트에서 직접 쏠 수 있는 이벤트만 노출.
// 서버에서만 발생해야 하는 이벤트(rfq_submitted 등)는 의도적으로 제외.
const CLIENT_ALLOWED: ReadonlySet<FunnelEventType> = new Set<FunnelEventType>([
  'match_view',
  'match_partner_select',
  'bundle_create_intent',
]);

const MAX_METADATA_BYTES = 2_000;

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 인증 우선순위: 본 계정 → 데모 세션. 둘 다 없으면 401.
  const auth = await getAuthUser(req);
  const demo = auth ? null : await getDemoSession(req);
  if (!auth && !demo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as {
    eventType?:   string;
    contextType?: string;
    contextId?:   string;
    metadata?:    Record<string, unknown>;
  } | null;
  if (!body || typeof body.eventType !== 'string') {
    return NextResponse.json({ error: 'eventType required' }, { status: 400 });
  }
  if (!CLIENT_ALLOWED.has(body.eventType as FunnelEventType)) {
    return NextResponse.json({ error: 'eventType not allowed' }, { status: 400 });
  }

  // metadata 크기 제한 — 클라이언트가 폭주해도 DB 가 안전.
  if (body.metadata) {
    const size = JSON.stringify(body.metadata).length;
    if (size > MAX_METADATA_BYTES) {
      return NextResponse.json({ error: 'metadata too large' }, { status: 413 });
    }
  }

  await logFunnelEvent(auth?.userId ?? DEMO_USER_ID, {
    eventType:   body.eventType as FunnelEventType,
    contextType: body.contextType,
    contextId:   body.contextId,
    metadata:    body.metadata,
    sessionId:   demo?.id ?? null,
  });

  return NextResponse.json({ ok: true });
}
