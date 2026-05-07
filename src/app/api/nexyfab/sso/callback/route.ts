import { NextRequest, NextResponse } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SSOUser {
  id: string;
  email: string;
  name: string;
  plan: 'enterprise';
}

interface SSOCallbackResult {
  user: SSOUser;
  token: string;
  demo?: boolean;
}

// ─── Demo fallback ────────────────────────────────────────────────────────────

const DEMO_RESULT: SSOCallbackResult = {
  user: {
    id: 'sso-demo',
    email: 'demo@company.com',
    name: 'SSO User',
    plan: 'enterprise',
  },
  token: 'sso-demo-token',
  demo: true,
};

// ─── OIDC token exchange (production) ─────────────────────────────────────────

async function exchangeOIDCCode(code: string, state: string): Promise<SSOCallbackResult> {
  const clientId = process.env.OIDC_CLIENT_ID!;
  const clientSecret = process.env.OIDC_CLIENT_SECRET!;
  const issuer = process.env.OIDC_ISSUER!;

  // Discover token endpoint
  const discoveryRes = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!discoveryRes.ok) throw new Error('OIDC discovery failed');
  const discovery = await discoveryRes.json() as { token_endpoint: string; userinfo_endpoint: string };

  // Exchange code for tokens
  const tokenRes = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      state,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/nexyfab/sso/callback`,
    }),
  });
  if (!tokenRes.ok) throw new Error('OIDC token exchange failed');
  const tokens = await tokenRes.json() as { access_token: string; id_token: string };

  // Fetch userinfo
  const userRes = await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) throw new Error('OIDC userinfo failed');
  const userInfo = await userRes.json() as { sub: string; email: string; name?: string };

  return {
    user: {
      id: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name ?? userInfo.email,
      plan: 'enterprise',
    },
    token: tokens.id_token ?? tokens.access_token,
  };
}

// ─── SAML assertion — NOT IMPLEMENTED ────────────────────────────────────────
// XML 서명 검증(samlify 등 라이브러리) 없이는 계정 위조가 가능하므로
// 이 함수는 항상 오류를 던집니다. SAML을 활성화하려면:
//   1. npm install samlify node-rsa
//   2. IDP 메타데이터/인증서로 서명 검증 구현
//   3. 이 함수를 교체한 후 SAML_ENTITY_ID 설정

async function processSAMLAssertion(_samlResponse: string): Promise<SSOCallbackResult> {
  throw new Error('SAML SSO is not yet implemented. XML signature validation required.');
}

// ─── GET /api/nexyfab/sso/callback?code=&state= (OIDC) ───────────────────────

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state') ?? '';

  // OIDC 환경변수 미설정 시 접근 차단 (데모 모드 비활성화)
  if (!process.env.OIDC_CLIENT_ID) {
    return NextResponse.json({ error: 'SSO가 설정되지 않았습니다.' }, { status: 503 });
  }

  if (!code) {
    return NextResponse.json({ error: 'code parameter is required' }, { status: 400 });
  }

  try {
    const result = await exchangeOIDCCode(code, state);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OIDC callback failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// ─── POST /api/nexyfab/sso/callback (SAML) ───────────────────────────────────

export async function POST(req: NextRequest) {
  // SAML 환경변수 미설정 시 접근 차단 (데모 모드 비활성화)
  if (!process.env.SAML_ENTITY_ID) {
    return NextResponse.json({ error: 'SAML SSO가 설정되지 않았습니다.' }, { status: 503 });
  }

  let samlResponse: string | null = null;

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    samlResponse = params.get('SAMLResponse');
  } else {
    const body = await req.json() as { SAMLResponse?: string };
    samlResponse = body.SAMLResponse ?? null;
  }

  if (!samlResponse) {
    return NextResponse.json({ error: 'SAMLResponse is required' }, { status: 400 });
  }

  try {
    const result = await processSAMLAssertion(samlResponse);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SAML assertion failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
