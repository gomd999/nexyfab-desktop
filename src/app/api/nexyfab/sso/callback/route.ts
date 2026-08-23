import { NextRequest, NextResponse } from 'next/server';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';
import {
  isSamlVerifierUnavailable,
  SamlVerifierUnavailableError,
  verifySamlResponse,
} from '@/lib/saml-sso-verifier';
import { oidcSsoReadiness } from '@/lib/oidc-sso-readiness';

const MAX_SAML_CALLBACK_BODY_BYTES = 2 * 1024 * 1024;

// ─── Types ────────────────────────────────────────────────────────────────────

// ─── SAML assertion — commercial verifier boundary ───────────────────────────
// XMLDSig, request correlation, replay protection, and local session issuance
// must be implemented and reviewed as one unit. Until then every assertion is
// rejected before decoding or consuming claims.

async function processSAMLAssertion(samlResponse: string): Promise<never> {
  await verifySamlResponse(samlResponse, {
    trustedIdpCertificates: (process.env.SAML_IDP_CERTIFICATES ?? '')
      .split('||')
      .map(value => value.trim())
      .filter(Boolean),
    expectedIssuer: process.env.SAML_IDP_ISSUER ?? '',
    expectedAudience: process.env.SAML_ENTITY_ID ?? '',
    expectedDestination: `${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/nexyfab/sso/callback`,
    expectedInResponseTo: null,
  });

  // Session issuance remains unreachable until the verifier and request
  // correlation/replay stores are implemented together.
  throw new SamlVerifierUnavailableError();
}

// ─── GET /api/nexyfab/sso/callback?code=&state= (OIDC) ───────────────────────

export async function GET(req: NextRequest) {
  // Deliberately do not consume `code` or contact the IdP until a login-start
  // transaction has bound state, nonce, and PKCE and can be consumed once.
  void req;
  const readiness = oidcSsoReadiness();
  return NextResponse.json(
    {
      error: 'OIDC callback is disabled until the complete commercial login flow is available.',
      code: readiness.code,
      blockers: readiness.blockers,
    },
    { status: 503 },
  );
}

// ─── POST /api/nexyfab/sso/callback (SAML) ───────────────────────────────────

export async function POST(req: NextRequest) {
  // SAML 환경변수 미설정 시 접근 차단 (데모 모드 비활성화)
  if (!process.env.SAML_ENTITY_ID) {
    return NextResponse.json({ error: 'SAML SSO가 설정되지 않았습니다.' }, { status: 503 });
  }

  let samlResponse: string | null = null;

  let raw: string;
  try {
    const bytes = await readBoundedRawBody(req, MAX_SAML_CALLBACK_BODY_BYTES);
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    const bounded = boundedRawBodyError(error);
    if (bounded?.code === 'PAYLOAD_TOO_LARGE') {
      return NextResponse.json({ error: 'Request too large', code: bounded.code }, { status: bounded.status });
    }
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    samlResponse = params.get('SAMLResponse');
  } else {
    try {
      const body = JSON.parse(raw) as { SAMLResponse?: string };
      samlResponse = body.SAMLResponse ?? null;
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
  }

  if (!samlResponse) {
    return NextResponse.json({ error: 'SAMLResponse is required' }, { status: 400 });
  }

  try {
    const result = await processSAMLAssertion(samlResponse);
    return NextResponse.json(result);
  } catch (err) {
    if (isSamlVerifierUnavailable(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code, blockers: err.blockers },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : 'SAML assertion failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
