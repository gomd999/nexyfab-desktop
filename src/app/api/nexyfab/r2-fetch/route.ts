/**
 * GET /api/nexyfab/r2-fetch?key=<r2-key>
 *
 * Wave 1 W10 D5 (ADR-007). Signed-URL proxy for R2 objects written by
 * the occt-worker. The worker writes outputs with internal R2 creds
 * (R2_ACCESS_KEY_ID etc.) but browsers can't read R2 directly, so
 * this endpoint:
 *
 *   1. Auth-gates via the existing main-app JWT (same JWT_SECRET as
 *      the worker, so a client that talked to the worker can talk
 *      here without re-auth).
 *   2. Path-scope-gates: only `occt-ops/<userId>/...` is allowed
 *      through. Prevents one user from reading another's op outputs
 *      via key guessing.
 *   3. Returns a short-lived (300 s) signed URL — the client `fetch`
 *      follows the redirect directly from R2, no proxy bandwidth on
 *      the main app dyno.
 *
 * Response:
 *   200 { signedUrl: string, expiresInSeconds: number }
 *   400 missing or malformed key
 *   401 unauthenticated
 *   403 key not owned by caller
 *   500 storage backend not configured (local dev without R2)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getStorage } from '@/lib/storage';
import { reportError } from '@/app/[lang]/shape-generator/lib/telemetry';

export const dynamic = 'force-dynamic';

const SIGNED_URL_TTL_SECONDS = 300;
const ALLOWED_KEY_PREFIX = 'occt-ops/';

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1. Auth — same JWT the worker accepts.
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Key validation.
  const key = req.nextUrl.searchParams.get('key');
  if (!key || typeof key !== 'string' || key.length === 0 || key.length > 512) {
    return NextResponse.json({ error: 'key required (≤ 512 chars)' }, { status: 400 });
  }
  if (key.includes('..') || key.startsWith('/')) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 });
  }
  if (!key.startsWith(ALLOWED_KEY_PREFIX)) {
    return NextResponse.json({ error: 'key prefix not allowed' }, { status: 400 });
  }

  // 3. Path-scope check: occt-ops/{userId}/...
  // We split on '/' and require the userId segment to match the caller.
  // This means key = `occt-ops/abc-123/boolean/t-x.stl` requires the
  // caller to be user abc-123.
  const segments = key.split('/');
  if (segments.length < 3) {
    return NextResponse.json({ error: 'invalid key path' }, { status: 400 });
  }
  const keyUserId = segments[1];
  if (keyUserId !== authUser.userId) {
    // Super-admins can read any op output (debugging / support).
    if (authUser.globalRole !== 'super_admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  // 4. Sign the URL.
  try {
    const storage = getStorage();
    const signedUrl = await storage.getSignedUrl(key, SIGNED_URL_TTL_SECONDS);
    return NextResponse.json({
      signedUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
  } catch (err) {
    reportError('project_io', err instanceof Error ? err : new Error(String(err)), {
      phase: 'r2_fetch_sign',
      key,
    });
    return NextResponse.json({ error: 'sign failed' }, { status: 500 });
  }
}
