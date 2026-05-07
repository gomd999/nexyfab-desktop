/**
 * POST /api/nexyfab/demo-session/claim
 *
 * 데모 세션의 모든 데이터(DFM check, RFQ, funnel events)를 본 user_id 로
 * 일괄 이관. 가입/로그인 직후 클라이언트가 호출.
 *
 * 본인 인증 + 데모 쿠키 둘 다 있어야 동작. 둘 중 하나라도 없으면 noop.
 *
 * 참고: signup/login 라우트가 인라인으로 tryClaimDemoOnAuth 를 호출하므로
 * 일반적으로는 사용자가 이 엔드포인트를 직접 호출할 필요가 없다.
 * 단, OAuth 콜백 / SSO 흐름에서 클라이언트가 명시적으로 부르고 싶을 때
 * 동일 결과를 보장하기 위해 별도 엔드포인트로 노출.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { claimDemoSession, clearDemoCookie, DEMO_COOKIE } from '@/lib/demo-session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const auth = await getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sid = req.cookies.get(DEMO_COOKIE)?.value;
  if (!sid) {
    return NextResponse.json({ ok: true, claimed: false, reason: 'no_demo_cookie' });
  }

  try {
    const result = await claimDemoSession(sid, auth.userId);
    const res = NextResponse.json({
      ok:        true,
      claimed:   !result.alreadyClaimed,
      sessionId: result.sessionId,
      moved: {
        dfm:    result.dfmRows,
        rfq:    result.rfqRows,
        funnel: result.funnelRows,
      },
    });
    clearDemoCookie(res);
    return res;
  } catch (err) {
    console.error('[demo-session/claim]', err);
    return NextResponse.json({ error: 'Claim failed' }, { status: 500 });
  }
}
