import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getRpConfig, signChallenge, CHALLENGE_COOKIE, challengeCookieOptions } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

/** GET /api/auth/webauthn/login/options?email= — challenge + the user's allowed
 *  credentials for navigator.credentials.get(). */
export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get('email') ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: '이메일이 필요합니다.' }, { status: 400 });

  const { rpID } = getRpConfig(req);
  const db = getDbAdapter();

  const user = await db.queryOne<{ id: string }>('SELECT id FROM nf_users WHERE LOWER(email) = ?', email);
  // Don't reveal whether the account exists; just say no passkey.
  const creds = user
    ? await db.queryAll<{ credential_id: string; transports: string | null }>(
        'SELECT credential_id, transports FROM nf_webauthn_credentials WHERE user_id = ?', user.id)
    : [];
  if (!user || creds.length === 0) {
    return NextResponse.json({ error: '이 계정에 등록된 패스키가 없습니다.' }, { status: 404 });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
  });

  const res = NextResponse.json(options);
  res.cookies.set(CHALLENGE_COOKIE, signChallenge(options.challenge, 'login', user.id), challengeCookieOptions());
  return res;
}
