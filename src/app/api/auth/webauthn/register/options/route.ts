import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { getRpConfig, signChallenge, CHALLENGE_COOKIE, challengeCookieOptions } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

/** POST /api/auth/webauthn/register/options — options for navigator.credentials.create()
 *  (logged-in user adds a passkey to their account). */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { rpID, rpName } = getRpConfig(req);
  const db = getDbAdapter();
  const existing = await db.queryAll<{ credential_id: string; transports: string | null }>(
    'SELECT credential_id, transports FROM nf_webauthn_credentials WHERE user_id = ?', authUser.userId,
  );

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: authUser.email,
    userID: new TextEncoder().encode(authUser.userId),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
  });

  const res = NextResponse.json(options);
  res.cookies.set(CHALLENGE_COOKIE, signChallenge(options.challenge, 'reg', authUser.userId), challengeCookieOptions());
  return res;
}
