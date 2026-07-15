import { NextRequest, NextResponse } from 'next/server';

/**
 * Expert CAD 게이트 (엣지).
 *
 * 전문가 3D 설계 스튜디오(/{lang}/shape-generator/**)는 "공개/캐주얼 사람"에게
 * 직접 노출하지 않는다 — 그들은 채팅(/{lang}#nf-chat)으로 유도하고, 실제 형상·연산은
 * AI가 /api/* 오케스트레이션으로 수행한다. 진입 허용 조건은 둘 중 하나:
 *   ① 로그인한 프로(세션 쿠키 nf_access_token 보유) — "프로에게만 직접 허용" 결정.
 *   ② `?expert=1`(또는 true) 플래그 — AI 핸드오프/내부 진입용.
 * 둘 다 아니면 엣지에서 진짜 307 리다이렉트(앱 셸/JS 미유출).
 *
 * 쿠키 존재만으로 통과시키는 건 "하드 인증"이 아니라 "퍼널 게이트"다 — 실제 권한은
 * 페이지·API 가 재검증한다. 여기 목적은 캐주얼 유입을 채팅으로 보내는 것.
 *
 * 주의: 이 앱은 src/ 디렉터리를 쓰므로 Next 는 이 파일(src/middleware.ts)만
 * 미들웨어로 인식한다. 프로젝트 루트의 middleware.ts(레이트리밋·CORS·JWT)는
 * src/ 사용 시 Next 가 로드하지 않아 원래부터 dormant 상태다. 그 잠재 미들웨어를
 * 의도치 않게 활성화하지 않도록, 이 게이트는 독립적인 최소 미들웨어로 둔다.
 * (루트 미들웨어를 켜려면 별도 검토 필요: CORS_ALLOWED_ORIGINS·JWT_SECRET env,
 *  보호/크로스오리진 라우트 회귀 테스트.)
 */

const EXPERT_GATE_RE = /^\/(kr|en|ja|cn|es|ar)\/shape-generator(?:\/|$)/;

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const gateMatch = EXPERT_GATE_RE.exec(pathname);
  if (gateMatch) {
    const flag = req.nextUrl.searchParams.get('expert');
    const authed = !!req.cookies.get('nf_access_token')?.value; // 로그인 프로 = 직접 허용
    if (flag !== '1' && flag !== 'true' && !authed) {
      const url = req.nextUrl.clone();
      url.pathname = `/${gateMatch[1]}`;
      url.search = '';
      url.hash = 'nf-chat';
      return NextResponse.redirect(url, 307);
    }
  }
  return NextResponse.next();
}

export const config = {
  // shape-generator 기본 경로(트레일링 슬래시 유무) + 모든 하위 경로.
  matcher: [
    '/:lang(kr|en|ja|cn|es|ar)/shape-generator',
    '/:lang(kr|en|ja|cn|es|ar)/shape-generator/',
    '/:lang(kr|en|ja|cn|es|ar)/shape-generator/:path*',
  ],
};
