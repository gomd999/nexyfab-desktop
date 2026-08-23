import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { getRpConfig, readChallenge, CHALLENGE_COOKIE, challengeCookieOptions } from '@/lib/webauthn';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

// Attestation objects may contain certificate chains; keep a finite 1 MiB envelope.
const MAX_WEBAUTHN_REGISTRATION_BODY_BYTES = 1024 * 1024;

export const dynamic = 'force-dynamic';

/** POST /api/auth/webauthn/register/verify — verify the attestation and store the credential. */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  let body: { response?: RegistrationResponseJSON; label?: string } = {};
  try { body = await readBoundedJson(req, MAX_WEBAUTHN_REGISTRATION_BODY_BYTES); }
  catch (error) { if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 }); }
  const response = body.response;
  if (!response?.id) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });

  const chal = readChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value, 'reg');
  if (!chal || chal.userId !== authUser.userId) {
    return NextResponse.json({ error: '챌린지가 만료되었습니다. 다시 시도하세요.' }, { status: 400 });
  }

  const { rpID, origin } = getRpConfig(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: { ...response, clientExtensionResults: response.clientExtensionResults ?? {} },
      expectedChallenge: chal.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '패스키 등록 검증 실패' }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: '패스키 등록 검증 실패' }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const transports = response.response?.transports;
  const db = getDbAdapter();
  try {
    await db.execute(
      `INSERT INTO nf_webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, device_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      `wa-${crypto.randomUUID()}`,
      authUser.userId,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64url'),
      credential.counter,
      transports ? JSON.stringify(transports) : null,
      (body.label ?? '').trim().slice(0, 60) || null,
      Date.now(),
    );
  } catch (e) {
    // UNIQUE violation → this passkey is already registered.
    return NextResponse.json({ error: '이미 등록된 패스키입니다.', detail: e instanceof Error ? e.message.slice(0, 120) : undefined }, { status: 409 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(CHALLENGE_COOKIE, '', { ...challengeCookieOptions(), maxAge: 0 });
  return res;
}
