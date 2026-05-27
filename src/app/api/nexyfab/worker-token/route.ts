/**
 * GET /api/nexyfab/worker-token
 *
 * W17 (ADR-007). Browsers can't read the httpOnly `nf_access_token`
 * cookie, but the OCCT worker (cross-origin Railway service) needs an
 * Authorization: Bearer header. This endpoint mints a fresh, short-
 * lived JWT signed with the same JWT_SECRET so the worker's existing
 * auth middleware accepts it without changes.
 *
 * Lifetime: 15 minutes — matches the main app's access token, short
 * enough that a leaked worker token isn't a long-term problem.
 *
 * Service claim:
 *   The minted token carries `service: 'occt-worker'`. The worker
 *   doesn't enforce this today (W17 scope), but the claim is in the
 *   payload so a later "main-app routes reject service-scoped tokens"
 *   tightening is one verifyJWT check away.
 *
 * Response:
 *   200 { token: string, expiresInSeconds: 900 }
 *   401 unauthenticated
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { signJWT } from '@/lib/jwt';

export const dynamic = 'force-dynamic';

const TOKEN_TTL_SECONDS = 15 * 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const token = await signJWT(
      {
        sub: auth.userId,
        email: auth.email,
        plan: auth.plan,
        emailVerified: auth.emailVerified,
        service: 'occt-worker',
      },
      TOKEN_TTL_SECONDS,
    );
    return NextResponse.json({
      token,
      expiresInSeconds: TOKEN_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[worker-token] signJWT failed:', err);
    return NextResponse.json({ error: 'sign failed' }, { status: 500 });
  }
}
