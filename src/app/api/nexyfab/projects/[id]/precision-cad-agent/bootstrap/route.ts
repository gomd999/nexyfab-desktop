import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import {
  bootstrapPrecisionCadSession,
  type PrecisionCadBootstrapResult,
} from '@/lib/ai/scad-agent/precisionCadSessionBootstrap';
import { hasPrecisionCadProjectScope } from '@/lib/precision-cad-agent/apiKeyScope';
import { readAuthoritativeWorkspaceHead } from '@/lib/cad/workspaceRevisionStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_BOOTSTRAP_FIELDS = new Set([
  'revision', 'workspaceRevision', 'contentHash', 'workspaceContentHash',
  // The browser may ask the server to select the current head. The server
  // still performs the head/CAS/hash/mapping checks; the client never authors
  // a revision or trust token.
  'useCurrentHead',
]);
const CLIENT_OWNERSHIP_FIELDS = new Set([
  'cadOwnership', 'ownership', 'partId', 'partIds', 'brepHandle', 'brepHandles',
  'featureId', 'featureIds', 'sketchId', 'sketchIds', 'entityId', 'entityIds',
  'faceId', 'faceIds', 'edgeId', 'edgeIds', 'mateId', 'mateIds', 'session',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function holdStatus(result: Extract<PrecisionCadBootstrapResult, { ok: false }>): number {
  return result.code === 'WORKSPACE_STORE_UNAVAILABLE'
    || result.code === 'CANONICAL_BREP_MAPPING_STORE_UNAVAILABLE'
    || result.code === 'CANONICAL_BREP_HYDRATION_FAILED'
    || result.code === 'SESSION_SIGNING_UNAVAILABLE' ? 503 : 409;
}

/**
 * POST /api/nexyfab/projects/:id/precision-cad-agent/bootstrap
 *
 * Starts a fresh precision-CAD SCAD session from an authenticated project
 * editor's explicit workspace revision/hash.  Ownership is read from the
 * server-side canonical geometry adapter and signed into `session`; no part,
 * handle, or ownership field from the request is ever used.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'INVALID_ORIGIN' } }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  if (!hasPrecisionCadProjectScope(auth, 'write:projects')) return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'INSUFFICIENT_API_KEY_SCOPE', requiredScope: 'write:projects' } }, { status: 403 });
  const { id: projectId } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'PROJECT_NOT_FOUND' } }, { status: 404 });
  if (!access.canEdit || (access.role !== 'owner' && access.role !== 'editor')) {
    return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'EDITOR_REQUIRED' } }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error);
    return NextResponse.json(
      { ok: false, status: 'HOLD', error: { code: bounded?.code === 'PAYLOAD_TOO_LARGE' ? 'ARGUMENTS_TOO_LARGE' : 'INVALID_REQUEST' } },
      { status: bounded?.status ?? 400 },
    );
  }
  if (!isRecord(body)) return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'INVALID_REQUEST' } }, { status: 400 });
  const forbidden = [...CLIENT_OWNERSHIP_FIELDS].find(key => Object.prototype.hasOwnProperty.call(body, key));
  if (forbidden) {
    return NextResponse.json({
      ok: false,
      status: 'HOLD',
      error: { code: 'CLIENT_OWNERSHIP_FORBIDDEN', field: forbidden },
    }, { status: 400 });
  }

  const unknown = Object.keys(body).find(key => !ALLOWED_BOOTSTRAP_FIELDS.has(key));
  if (unknown) {
    return NextResponse.json({
      ok: false,
      status: 'HOLD',
      error: { code: 'UNKNOWN_REQUEST_FIELD', field: unknown },
    }, { status: 400 });
  }
  const hasRevision = Object.prototype.hasOwnProperty.call(body, 'revision');
  const hasWorkspaceRevision = Object.prototype.hasOwnProperty.call(body, 'workspaceRevision');
  const hasContentHash = Object.prototype.hasOwnProperty.call(body, 'contentHash');
  const hasWorkspaceContentHash = Object.prototype.hasOwnProperty.call(body, 'workspaceContentHash');
  if ((hasRevision && hasWorkspaceRevision) || (hasContentHash && hasWorkspaceContentHash)) {
    return NextResponse.json({
      ok: false,
      status: 'HOLD',
      error: { code: 'DUPLICATE_BOOTSTRAP_ALIAS' },
    }, { status: 400 });
  }

  const useCurrentHead = body.useCurrentHead === true;
  if (body.useCurrentHead !== undefined && typeof body.useCurrentHead !== 'boolean') {
    return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'INVALID_BOOTSTRAP_BINDING' } }, { status: 400 });
  }
  if (useCurrentHead && (hasRevision || hasWorkspaceRevision || hasContentHash || hasWorkspaceContentHash)) {
    return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'DUPLICATE_BOOTSTRAP_BINDING' } }, { status: 400 });
  }

  let rawRevision = body.revision ?? body.workspaceRevision;
  let rawHash = body.contentHash ?? body.workspaceContentHash;
  if (useCurrentHead) {
    const head = await readAuthoritativeWorkspaceHead(db, projectId).catch(() => null);
    if (!head) return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'WORKSPACE_HEAD_NOT_FOUND' } }, { status: 409 });
    rawRevision = head.revision;
    rawHash = head.contentHash;
  }
  if (!Number.isSafeInteger(rawRevision) || typeof rawHash !== 'string') {
    return NextResponse.json({ ok: false, status: 'HOLD', error: { code: 'INVALID_BOOTSTRAP_BINDING' } }, { status: 400 });
  }
  const result = await bootstrapPrecisionCadSession({
    db,
    userId: auth.userId,
    projectId,
    revision: rawRevision as number,
    contentHash: rawHash,
  });
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      status: 'HOLD',
      releaseReady: false,
      // Keep internal mapping/store details private; clients branch on the
      // stable machine code and render their localized copy.
      error: { code: result.code },
      ...(result.current ? { current: result.current } : {}),
    }, { status: holdStatus(result), headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.json({
    ok: true,
    status: 'READY',
    contractVersion: CAD_SESSION_BOOTSTRAP_CONTRACT_VERSION,
    binding: result.binding,
    // The session is the only authorization carrier. The repeated ownership
    // value is intentionally omitted so callers cannot mistake an unsigned
    // top-level field for authority.
    session: result.session,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

const CAD_SESSION_BOOTSTRAP_CONTRACT_VERSION = 'nexyfab.precision-cad-session-bootstrap.v1' as const;
