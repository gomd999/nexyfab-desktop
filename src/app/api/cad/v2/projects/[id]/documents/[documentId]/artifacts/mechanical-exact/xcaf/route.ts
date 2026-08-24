import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getTrustedClientIp } from '@/lib/client-ip';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { loadXcafHttpInspectorFromEnvironment } from '@/lib/occt/xcafHttpInspectionClient';
import { readCurrentCanonicalMechanicalXcaf } from '@/app/[lang]/shape-generator/drawing/currentCanonicalMechanicalXcafService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RATE_LIMIT_MAXIMUM = 5;
type RouteContext = { params: Promise<{ id: string; documentId: string }> };

function response(payload: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}

/**
 * Authenticated current-head-only inspection. Request data cannot supply a
 * revision, STEP file, bundle, native receipt, worker URL, or credential.
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return response({ ok: false, status: 'HOLD', code: 'UNAUTHORIZED', release: 'HOLD' }, 401);
    const { id, documentId } = await params;
    if (!SAFE_ID.test(id) || !SAFE_ID.test(documentId)) {
      return response({ ok: false, status: 'HOLD', code: 'INVALID_PATH', release: 'HOLD' }, 400);
    }
    const rate = await rateLimitAsync(
      `cad-v2-mechanical-xcaf:${auth.userId}:${getTrustedClientIp(request.headers)}`,
      RATE_LIMIT_MAXIMUM,
      60_000,
      { failClosed: process.env.NODE_ENV === 'production' },
    );
    if (!rate.allowed) {
      return response({
        ok: false, status: 'HOLD',
        code: rate.unavailable ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMIT',
        release: 'HOLD',
      }, rate.unavailable ? 503 : 429, rateLimitHeaders(rate, RATE_LIMIT_MAXIMUM));
    }
    const db = getDbAdapter();
    const access = await resolveProjectAccess(db, id, auth);
    if (!access) return response({ ok: false, status: 'HOLD', code: 'NOT_FOUND', release: 'HOLD' }, 404);
    const configured = loadXcafHttpInspectorFromEnvironment();
    if (!configured.ok) {
      return response({ ok: false, status: 'HOLD', code: 'XCAF_SERVICE_UNAVAILABLE', release: 'HOLD' }, 503);
    }
    const result = await readCurrentCanonicalMechanicalXcaf({
      db, projectId: id, documentId, inspector: configured.inspector,
    });
    if (result.status !== 'PASS_NATIVE_INVOCATION_BOUND') {
      return response({ ok: false, status: 'HOLD', code: 'CURRENT_CANONICAL_XCAF_HOLD', release: 'HOLD' }, 422);
    }
    return response({
      ok: true,
      status: result.status,
      authority: result.authority,
      verification: result.verification,
      geometryIdentity: result.geometryIdentity,
      release: result.release,
      releaseReady: false,
      envelope: result,
    });
  } catch {
    return response({ ok: false, status: 'HOLD', code: 'INTERNAL_ERROR', release: 'HOLD' }, 500);
  }
}
