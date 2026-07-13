import { NextRequest, NextResponse } from 'next/server';

/**
 * Expert CAD 게이트 (엣지).
 *
 * 전문가 3D 설계 스튜디오(/{lang}/shape-generator/**)는 사람에게 직접 노출하지
 * 않는다. `?expert=1`(또는 true) 플래그가 있어야만 진입하며, 그 외에는 채팅 랜딩
 * (/{lang}#nf-chat)으로 엣지에서 진짜 307 리다이렉트한다 — 앱 셸/JS가 유출되지
 * 않는다. 실제 형상·연산은 AI가 /api/* 오케스트레이션으로 수행한다.
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
    if (flag !== '1' && flag !== 'true') {
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
