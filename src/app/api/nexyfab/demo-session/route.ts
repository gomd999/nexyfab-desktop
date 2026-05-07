/**
 * /api/nexyfab/demo-session
 *
 *   POST  → 데모 세션 진입(create-or-reuse). httpOnly 쿠키 발급.
 *   GET   → 기존 데모 세션 정보 조회(읽기 전용). 없으면 200 + { active:false }.
 *
 * 광고 첫 클릭 → ID/PW drop-off 차단 (project_nexyfab_demo_mode.md).
 * 페이지가 마운트 시 GET 으로 상태 조회, 사용자가 명시적 버튼 클릭 시 POST.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ensureDemoSession, getDemoSession } from '@/lib/demo-session';
import { checkOrigin } from '@/lib/csrf';
import { rateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { getTrustedClientIp } from '@/lib/client-ip';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getDemoSession(req);
  if (!session) {
    return NextResponse.json({ active: false });
  }
  return NextResponse.json({
    active:    true,
    sessionId: session.id,
    isDemo:    session.isDemo,
    createdAt: session.createdAt,
  });
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 세션 생성 레이트 리밋: IP 당 시간 10건. 기존 쿠키가 있으면 reuse 이므로
  // 이미 세션 가진 사용자는 영향 없음 — 이 제한은 쿠키 없이 반복 진입하는
  // 스크립트·스크레이퍼를 막기 위함.
  const hasCookie = Boolean(req.cookies.get('nf_demo_session')?.value);
  if (!hasCookie) {
    const ip = getTrustedClientIp(req.headers);
    const rl = rateLimit(`demo-session:${ip}`, 10, 60 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many demo sessions created. Try again later.' },
        { status: 429, headers: rateLimitHeaders(rl, 10) },
      );
    }
  }

  // ensureDemoSession 이 res.cookies.set 으로 Set-Cookie 헤더를 추가한다.
  // 그래서 res 객체를 먼저 만들고 그 위에 ensure → 같은 res 의 헤더를 가져와
  // 새 본문과 함께 응답한다.
  const carrier = NextResponse.json({ ok: true });
  const session = await ensureDemoSession(req, carrier);

  return NextResponse.json(
    {
      ok:        true,
      active:    true,
      sessionId: session.id,
      isDemo:    session.isDemo,
      createdAt: session.createdAt,
    },
    { status: 200, headers: carrier.headers },
  );
}
