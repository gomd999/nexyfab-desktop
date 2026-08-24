import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getTrustedClientIp } from '@/lib/client-ip';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { buildCurrentCanonicalMechanicalArtifactBundle } from '@/app/[lang]/shape-generator/drawing/currentCanonicalMechanicalBundle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RATE_LIMIT_MAXIMUM = 10;
type RouteContext = { params: Promise<{ id: string; documentId: string }> };

function response(payload: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}

/** Authenticated read/compute endpoint. It creates no revision and never releases manufacturing. */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) {
      return response({ ok: false, status: 'HOLD', code: 'UNAUTHORIZED', release: 'HOLD', releaseReady: false }, 401);
    }
    const { id, documentId } = await params;
    if (!SAFE_ID.test(id) || !SAFE_ID.test(documentId)) {
      return response({ ok: false, status: 'HOLD', code: 'INVALID_PATH', release: 'HOLD', releaseReady: false }, 400);
    }
    const rate = await rateLimitAsync(
      `cad-v2-mechanical-exact:${auth.userId}:${getTrustedClientIp(request.headers)}`,
      RATE_LIMIT_MAXIMUM,
      60_000,
      { failClosed: process.env.NODE_ENV === 'production' },
    );
    if (!rate.allowed) {
      return response({
        ok: false, status: 'HOLD',
        code: rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMIT',
        release: 'HOLD', releaseReady: false,
      }, rate.unavailable ? 503 : 429, rateLimitHeaders(rate, RATE_LIMIT_MAXIMUM));
    }
    const db = getDbAdapter();
    const access = await resolveProjectAccess(db, id, auth);
    if (!access) {
      return response({ ok: false, status: 'HOLD', code: 'NOT_FOUND', release: 'HOLD', releaseReady: false }, 404);
    }
    const result = await buildCurrentCanonicalMechanicalArtifactBundle({
      db, projectId: id, documentId,
    });
    if (result.status !== 'EXACT_BUNDLE_PASS') {
      const status = result.blockers.includes('CURRENT_HEAD_NOT_FOUND') ? 404
        : result.blockers.includes('CURRENT_HEAD_MIGRATION_REQUIRED') ? 503
          : result.blockers.some(code => code === 'CURRENT_HEAD_CORRUPT_SERVER_STATE'
            || code === 'CURRENT_HEAD_SERVER_READ_FAILED') ? 500
            : result.blockers.includes('CURRENT_HEAD_INVALID_REQUEST') ? 400
              : 422;
      return response({
        ok: false, status: 'HOLD', code: 'MECHANICAL_ARTIFACT_BUNDLE_HOLD',
        release: 'HOLD', releaseReady: false,
      }, status);
    }
    return response({
      ok: true,
      status: result.status,
      authority: result.authority,
      verification: result.verification,
      release: result.release,
      releaseReady: false,
      manufacturingRelease: result.manufacturingRelease,
      bundle: result,
    });
  } catch {
    return response({
      ok: false, status: 'HOLD', code: 'INTERNAL_ERROR',
      release: 'HOLD', releaseReady: false,
    }, 500);
  }
}
