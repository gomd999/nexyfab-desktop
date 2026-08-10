import { NextRequest, NextResponse } from 'next/server';
import { ELEV_COOKIE, verifyElevToken, elevMatchesSession } from '@/lib/admin-elev-token';
import { getTrustedClientIp } from '@/lib/client-ip';
import { enforceCadApiBoundary } from '@/lib/cad-api-proxy-boundary';
import { checkOrigin } from '@/lib/csrf';

/**
 * Expert CAD 게이트 (proxy).
 *
 * 전문가 3D 설계 스튜디오(/{lang}/shape-generator/**)는 "공개/캐주얼 사람"에게
 * 직접 노출하지 않는다 — 그들은 채팅(/{lang}#nf-chat)으로 유도하고, 실제 형상·연산은
 * AI가 /api/* 오케스트레이션으로 수행한다. 진입 허용 조건은 둘 중 하나:
 *   ① 로그인한 프로(세션 쿠키 nf_access_token 보유) — "프로에게만 직접 허용" 결정.
 *   ② `?expert=1`(또는 true) 플래그 — AI 핸드오프/내부 진입용.
 * 둘 다 아니면 라우팅 계층에서 진짜 307 리다이렉트(앱 셸/JS 미유출).
 *
 * 쿠키 존재만으로 통과시키는 건 "하드 인증"이 아니라 "퍼널 게이트"다 — 실제 권한은
 * 페이지·API 가 재검증한다. 여기 목적은 캐주얼 유입을 채팅으로 보내는 것.
 *
 * 주의: 이 앱은 src/ 디렉터리를 쓰므로 Next 는 이 파일(src/proxy.ts)만
 * 라우팅 훅으로 인식한다. 프로젝트 루트의 middleware.ts(레이트리밋·CORS·JWT)는
 * src/ 사용 시 Next 가 로드하지 않아 원래부터 dormant 상태다. 그 잠재 미들웨어를
 * 의도치 않게 활성화하지 않도록, 이 게이트는 독립적인 최소 훅으로 둔다.
 * (루트 미들웨어를 켜려면 별도 검토 필요: CORS_ALLOWED_ORIGINS·JWT_SECRET env,
 *  보호/크로스오리진 라우트 회귀 테스트.)
 *
 * 260808 middleware→proxy 전환(Next 16 컨벤션):
 *  - `middleware.ts`/`middleware()` 는 deprecated (build:651 warnOnce). proxy 로 개명.
 *  - Proxy 는 **항상 Node.js 런타임**이다 (edge sandbox 아님; `runtime` segment
 *    config 는 proxy 파일에서 빌드 에러 E1031). 이 파일은 Web Crypto
 *    (`crypto.subtle`)만 쓰므로 Node 18+ 전역으로 그대로 동작한다.
 *  - `process.env` 는 이제 빌드타임 인라인이 아니라 런타임 조회다 —
 *    ADMIN_OTP_REQUIRED/JWT_SECRET 을 재빌드 없이 배포 환경에서 바꿀 수 있다.
 */

const EXPERT_GATE_RE = /^\/(kr|en|ja|cn|es|ar)\/shape-generator(?:\/|$)/;
const ALWAYS_BLOCKED_LEGACY_SCRIPT_RE = /^\/(?:send-mail\.php|search\.php)$/i;
const OBSERVED_LEGACY_UPLOAD_RE = /^\/uploads(?:\/|$)/i;

/**
 * 관리자 전용 API — **step-up 상승 없이는 지나가지 못한다** (260802).
 *
 * ## 왜 미들웨어인가
 * 관리자 API 가 62개인데 권한 검사가 파일마다 흩어져 있었다(로컬 requireAdmin 5벌 +
 * 인라인 16곳). 62곳에 따로 붙이면 **반드시 빠뜨리고, 새로 만드는 라우트는 더 확실히
 * 빠진다.** 초크포인트를 하나 두면 잊을 수가 없다.
 *
 * ## ⚠ 이것이 권한 검사를 **대체하지 않는다**
 * 여기서는 「상승했는가」만 본다. 「관리자인가」는 각 라우트가 여전히 확인한다
 * — 상승 쿠키가 있어도 관리자가 아니면 라우트가 403 을 준다.
 *
 * ## OTP 라우트 자신은 제외한다
 * 코드를 받으려면 이 경로들을 지나야 하는데 막으면 **영영 상승할 수 없다**(닭과 달걀).
 */
const ADMIN_API_RE = /^\/api\/(admin|nexyfab\/admin)(?:\/|$)/;

type SecurityGateMode = 'shadow' | 'enforce' | 'off';
type SecurityDecision = {
  reason: 'blocked_public_asset' | 'cross_site_cookie_mutation' | 'rate_limit' | 'request_too_large' | 'unsafe_method';
  response: NextResponse;
};

function securityGateMode(): SecurityGateMode {
  const configured = process.env.SECURITY_GATE_MODE?.trim().toLowerCase();
  if (configured === 'enforce' || configured === 'off' || configured === 'shadow') return configured;
  // Local/CI remains observation-only. A production deployment is secure by
  // default even when an operator forgets to set the rollout flag.
  return process.env.NODE_ENV === 'production' ? 'enforce' : 'shadow';
}

const shadowLogStore = new Map<string, number>();
const SHADOW_LOG_INTERVAL_MS = 5 * 60_000;

function privacySafePathname(pathname: string): string {
  if (pathname === '/send-mail.php' || pathname === '/search.php') return pathname;
  if (pathname.startsWith('/uploads/')) return '/uploads/:path*';
  return pathname
    .split('/')
    .map((segment) => (
      segment.length > 24 || /^[0-9a-f]{16,}$/i.test(segment) ? ':id' : segment
    ))
    .join('/');
}

function logShadowDecision(req: NextRequest, decision: SecurityDecision): void {
  const pathname = privacySafePathname(req.nextUrl.pathname);
  const key = `${decision.reason}:${req.method}:${pathname}`;
  const now = Date.now();
  const lastLoggedAt = shadowLogStore.get(key) ?? 0;
  if (now - lastLoggedAt < SHADOW_LOG_INTERVAL_MS) return;
  shadowLogStore.set(key, now);
  console.warn('[security-event]', JSON.stringify({
    event: 'security_gate_decision',
    mode: 'shadow',
    decision: 'would_block',
    reason: decision.reason,
    method: req.method,
    pathname,
    status: decision.response.status,
    occurredAt: new Date(now).toISOString(),
  }));
}

type RateLimitEntry = { count: number; resetAt: number };
const apiRateLimitStore = new Map<string, RateLimitEntry>();
const API_RATE_LIMIT_WINDOW_MS = 60_000;
const API_RATE_LIMIT_DEFAULT = 100;
const API_RATE_LIMIT_MAX_KEYS = 20_000;

function apiRateLimitFor(pathname: string): number {
  if (/^\/api\/auth\/(login|signup|forgot-password|reset-password|cross-login|cross-signup)(?:\/|$)/.test(pathname)) return 10;
  if (/^\/api\/(send-mail|auth\/send-verification)(?:\/|$)/.test(pathname)) return 5;
  if (/^\/api\/(partner\/upload|quick-quote\/upload|nexyfab\/files)(?:\/|$)/.test(pathname)) return 15;
  if (/^\/api\/(billing|stripe)(?:\/|$)/.test(pathname)) return 20;
  if (ADMIN_API_RE.test(pathname)) return 60;
  return API_RATE_LIMIT_DEFAULT;
}

function evaluateApiRateLimit(req: NextRequest): SecurityDecision | null {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/api/')) return null;
  if (
    pathname === '/api/billing/webhook'
    || pathname === '/api/stripe/webhook'
    || pathname === '/api/webhooks/dodo'
  ) return null;

  const now = Date.now();
  const limit = apiRateLimitFor(pathname);
  const routeBucket = pathname.split('/').slice(0, 4).join('/');
  const key = `${getTrustedClientIp(req.headers)}:${routeBucket}`;
  const current = apiRateLimitStore.get(key);

  if (!current || now >= current.resetAt) {
    if (!current && apiRateLimitStore.size >= API_RATE_LIMIT_MAX_KEYS) {
      const oldest = [...apiRateLimitStore.entries()]
        .sort((a, b) => a[1].resetAt - b[1].resetAt)
        .slice(0, Math.ceil(API_RATE_LIMIT_MAX_KEYS * 0.1));
      for (const [entryKey] of oldest) apiRateLimitStore.delete(entryKey);
    }
    apiRateLimitStore.set(key, { count: 1, resetAt: now + API_RATE_LIMIT_WINDOW_MS });
    return null;
  }

  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return {
      reason: 'rate_limit',
      response: NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(current.resetAt),
          },
        },
      ),
    };
  }

  current.count += 1;
  return null;
}

function requestSizeLimit(pathname: string): number {
  if (/^\/api\/(partner\/upload|quick-quote\/upload|nexyfab\/files)(?:\/|$)/.test(pathname)) {
    return 64 * 1024 * 1024;
  }
  // The legacy inquiry form may carry several attachments. This remains a
  // deliberately generous observation threshold until beta traffic is known.
  if (pathname === '/api/send-mail') return 256 * 1024 * 1024;
  return 16 * 1024 * 1024;
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const COOKIE_CSRF_EXEMPT_RE = /^(?:\/api\/billing\/webhook|\/api\/stripe\/webhook|\/api\/webhooks\/(?:dodo|inbound-email)|\/api\/nexyfab\/ses-notifications)$/;

function evaluateCookieOrigin(req: NextRequest): SecurityDecision | null {
  if (!MUTATION_METHODS.has(req.method)) return null;
  const hasAuthCookie = ['nf_access_token', 'nf_refresh_token', 'nf_admin_token']
    .some(name => Boolean(req.cookies.get(name)?.value));
  if (!hasAuthCookie) return null;
  if (COOKIE_CSRF_EXEMPT_RE.test(req.nextUrl.pathname)) return null;
  if (checkOrigin(req)) return null;
  return {
    reason: 'cross_site_cookie_mutation',
    response: NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 }),
  };
}

function evaluateRequestPolicy(req: NextRequest): SecurityDecision | null {
  const { pathname } = req.nextUrl;
  if (OBSERVED_LEGACY_UPLOAD_RE.test(pathname)) {
    return {
      reason: 'blocked_public_asset',
      response: new NextResponse('Not Found', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      }),
    };
  }

  if (req.method === 'TRACE' || req.method === 'CONNECT') {
    return {
      reason: 'unsafe_method',
      response: NextResponse.json({ error: 'Method not allowed' }, { status: 405 }),
    };
  }

  if (pathname.startsWith('/api/')) {
    const originDecision = evaluateCookieOrigin(req);
    if (originDecision) return originDecision;
    const rawLength = req.headers.get('content-length');
    const contentLength = rawLength == null ? null : Number(rawLength);
    if (contentLength != null && Number.isFinite(contentLength) && contentLength > requestSizeLimit(pathname)) {
      return {
        reason: 'request_too_large',
        response: NextResponse.json({ error: 'Request body too large' }, { status: 413 }),
      };
    }
  }

  return evaluateApiRateLimit(req);
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // PHP is not executed by Next.js. Serving these files would disclose their
  // source (including a legacy secret), so this boundary is unconditional and
  // does not affect account or customer-artifact compatibility.
  if (ALWAYS_BLOCKED_LEGACY_SCRIPT_RE.test(pathname)) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Closed-beta compatibility: new controls observe by default. They never
  // mutate accounts/files, and only block when SECURITY_GATE_MODE=enforce.
  const mode = securityGateMode();
  if (mode !== 'off') {
    const decision = evaluateRequestPolicy(req);
    if (decision) {
      if (mode === 'enforce') {
        console.warn('[security-event]', JSON.stringify({
          event: 'security_gate_decision',
          mode: 'enforce',
          decision: 'blocked',
          reason: decision.reason,
          method: req.method,
          pathname: privacySafePathname(req.nextUrl.pathname),
          status: decision.response.status,
          occurredAt: new Date().toISOString(),
        }));
        return decision.response;
      }
      logShadowDecision(req, decision);
    }
  }

  // Next 16 executes this proxy, not the deprecated root middleware. Keep the
  // CAD compute boundary here so route handlers cannot be reached anonymously.
  const cadBoundary = await enforceCadApiBoundary(req);
  if (cadBoundary) return cadBoundary;

  if (ADMIN_API_RE.test(pathname)) {
    // 강제가 꺼져 있으면 통과 — 인프라에서 명시적으로 꺼야만 꺼진다.
    if (process.env.ADMIN_OTP_REQUIRED === 'false') return NextResponse.next();

    /**
     * ⚠ 260802 2차 — **step-up 을 요구할 수 없는 호출자가 둘 있다.** 실측으로 확인했다:
     *
     *  ① `x-admin-secret`(= `ADMIN_SECRET`) 서비스 호출
     *     `admin/backup`·`cleanup-files`·`cohort`·`intent-log` 가 이 방식으로 불린다.
     *     **사람이 없어 이메일 코드를 받을 수 없다.** 여기에 OTP 를 요구하면 자동화가 죽는다.
     *     이 비밀은 배포 환경 변수라, 가진 사람은 이미 인프라 접근이 있다 — 면제한다.
     *
     *  ② `nf_admin_token` 레거시 콘솔(`/admin`)
     *     **공유 비밀번호(`ADMIN_PASSWORD`) 하나로 들어가는 별도 콘솔**이다.
     *     계정이 아니라 코드를 보낼 주소가 없다. 지금 막으면 그 콘솔이 통째로 죽는다.
     *     ⚠ **이건 면제가 아니라 부채다.** 계정 기반으로 통합하고 폐지해야 한다 —
     *        그때까지 지나가되, 헤더로 표시해 사용 여부를 측정할 수 있게 한다.
     *
     * 두 경우 모두 **자격 자체는 라우트가 다시 검증**한다(`verifyAdmin`/`requireAdmin`).
     * 여기서 보는 것은 「상승이 필요한 호출인가」뿐이다.
     */
    if (req.headers.get('x-admin-secret')) return NextResponse.next();
    if (req.cookies.get('nf_admin_token')?.value) {
      const res = NextResponse.next();
      res.headers.set('x-nf-admin-legacy-console', '1');
      return res;
    }

    const access = req.cookies.get('nf_access_token')?.value ?? null;
    const v = await verifyElevToken(req.cookies.get(ELEV_COOKIE)?.value, process.env.JWT_SECRET);
    const ok = v.ok && await elevMatchesSession(v.payload, access);
    if (!ok) {
      /**
       * 428(Precondition Required) — 403(권한 없음)과 구별한다.
       * 섞으면 화면이 「권한이 없다」고 잘못 안내하고, 사용자는 코드를 받을 생각을 못 한다.
       */
      return NextResponse.json(
        {
          error: 'Elevation required',
          reason: v.ok ? 'session_mismatch' : v.reason,
          action: 'POST /api/auth/admin-otp/request → 메일 코드 → POST /api/auth/admin-otp/verify',
        },
        { status: 428 },
      );
    }
    return NextResponse.next();
  }

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
    '/api/:path*',
    '/send-mail.php',
    '/search.php',
    '/uploads/:path*',
    // 관리자 전용 API — OTP 라우트(`/api/auth/admin-otp/*`)는 여기에 걸리지 않는다.
    '/api/admin/:path*',
    '/api/nexyfab/admin/:path*',
    '/:lang(kr|en|ja|cn|es|ar)/shape-generator',
    '/:lang(kr|en|ja|cn|es|ar)/shape-generator/',
    '/:lang(kr|en|ja|cn|es|ar)/shape-generator/:path*',
  ],
};
