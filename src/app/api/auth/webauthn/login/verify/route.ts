import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { getRpConfig, readChallenge, CHALLENGE_COOKIE, challengeCookieOptions, issueNexyfabSession, type SessionUserRow } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

/** POST /api/auth/webauthn/login/verify — verify the assertion and start a session. */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { email?: string; response?: AuthenticationResponseJSON };
  const email = (body.email ?? '').trim().toLowerCase();
  const response = body.response;
  if (!email || !response?.id) return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });

  const chal = readChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value, 'login');
  if (!chal) return NextResponse.json({ error: '챌린지가 만료되었습니다. 다시 시도하세요.' }, { status: 400 });

  const { rpID, origin } = getRpConfig(req);
  const db = getDbAdapter();

  const user = await db.queryOne<SessionUserRow>(
    'SELECT id, email, name, plan, project_count, email_verified, stage FROM nf_users WHERE LOWER(email) = ?', email,
  );
  if (!user || user.id !== chal.userId) return NextResponse.json({ error: '인증에 실패했습니다.' }, { status: 401 });

  const cred = await db.queryOne<{ credential_id: string; public_key: string; counter: number; transports: string | null }>(
    'SELECT credential_id, public_key, counter, transports FROM nf_webauthn_credentials WHERE user_id = ? AND credential_id = ?',
    user.id, response.id,
  );
  if (!cred) return NextResponse.json({ error: '등록되지 않은 패스키입니다.' }, { status: 401 });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: { ...response, clientExtensionResults: response.clientExtensionResults ?? {} },
      expectedChallenge: chal.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64url')),
        counter: Number(cred.counter) || 0,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '패스키 검증 실패' }, { status: 401 });
  }

  if (!verification.verified) return NextResponse.json({ error: '패스키 검증 실패' }, { status: 401 });

  await db.execute(
    'UPDATE nf_webauthn_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?',
    verification.authenticationInfo.newCounter, Date.now(), cred.credential_id,
  );

  const { user: publicUser, cookies } = await issueNexyfabSession(user);
  const res = NextResponse.json({ ok: true, user: publicUser });
  for (const c of cookies) res.cookies.set(c.name, c.value, c.options);
  // Clear the one-shot challenge cookie.
  res.cookies.set(CHALLENGE_COOKIE, '', { ...challengeCookieOptions(), maxAge: 0 });
  return res;
}
