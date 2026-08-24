import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { canonicalCadConsumerDraftJson, type CanonicalCadCommandV2ConsumerDraft, type CanonicalCadLockEvidence } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import {
  assertCanonicalCadRevisionMigration,
  commitCanonicalCadRevision,
  readCanonicalCadRevisionHead,
  type CanonicalCadRevisionAuditEvent,
  type CommitCanonicalCadRevisionResult,
} from '@/lib/cad/canonicalCadRevisionStore';
import { getTrustedClientIp } from '@/lib/client-ip';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimitAsync, rateLimitHeaders, type RateLimitResult } from '@/lib/rate-limit';
import { checkOrigin } from '@/lib/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type RouteContext = { params: Promise<{ id: string; documentId: string }> };
type LockRow = {
  lock_id: unknown;
  scope: unknown;
  object_id: unknown;
  field_path: unknown;
  owner_actor_id: unknown;
  source: unknown;
};

class InvalidCanonicalLockStateError extends Error {}

function response(
  payload: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json({
    ...payload,
    status: 'HOLD',
    verification: 'NOT_RUN',
    release: 'HOLD',
    releaseReady: false,
  }, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPathIds(projectId: string, documentId: string): boolean {
  return ID.test(projectId) && ID.test(documentId);
}

function limitedResponse(result: RateLimitResult, maximum: number) {
  if (result.unavailable) {
    return response({ ok: false, code: 'RATE_LIMIT_UNAVAILABLE' }, 503, rateLimitHeaders(result, maximum));
  }
  return response({ ok: false, code: 'RATE_LIMIT' }, 429, rateLimitHeaders(result, maximum));
}

async function applyRateLimit(
  request: NextRequest,
  method: 'GET' | 'POST',
  actorId: string,
): Promise<{ result: RateLimitResult; maximum: number }> {
  const maximum = method === 'POST' ? 30 : 120;
  const result = await rateLimitAsync(
    // Keep limiter key cardinality bounded even if an authenticated client
    // sprays syntactically valid but nonexistent project/document IDs.
    `cad-v2-revisions:${method.toLowerCase()}:${actorId}:${getTrustedClientIp(request.headers)}`,
    maximum,
    60_000,
    { failClosed: process.env.NODE_ENV === 'production' },
  );
  return { result, maximum };
}

function canonicalLockEvidence(rows: LockRow[]): CanonicalCadLockEvidence[] {
  if (rows.length > 10_000) throw new InvalidCanonicalLockStateError('canonical_lock_limit_exceeded');
  const lockIds = new Set<string>();
  const locks = rows.map((row): CanonicalCadLockEvidence => {
    const scope = row.scope;
    const source = row.source;
    const validField = scope === 'field'
      ? typeof row.field_path === 'string' && row.field_path.length > 0 && row.field_path.length <= 256
      : row.field_path === null;
    if (typeof row.lock_id !== 'string' || !ID.test(row.lock_id) || lockIds.has(row.lock_id)
      || (scope !== 'workspace' && scope !== 'object' && scope !== 'field')
      || typeof row.object_id !== 'string' || !ID.test(row.object_id)
      || typeof row.owner_actor_id !== 'string' || !ID.test(row.owner_actor_id)
      || (source !== 'human' && source !== 'authority') || !validField) {
      throw new InvalidCanonicalLockStateError('canonical_lock_state_invalid');
    }
    lockIds.add(row.lock_id);
    return {
      lockId: row.lock_id,
      scope,
      objectId: row.object_id,
      fieldPath: row.field_path as string | null,
      ownerActorId: row.owner_actor_id,
      source,
    };
  });
  return locks.sort((left, right) => left.lockId.localeCompare(right.lockId));
}

async function readCurrentLocks(db: DbAdapter, projectId: string, documentId: string) {
  const rows = await db.queryAll<LockRow>(
    `SELECT lock_id, scope, object_id, field_path, owner_actor_id, source
       FROM nf_cad_canonical_v2_locks
      WHERE project_id = ? AND document_id = ?
      ORDER BY lock_id ASC`,
    projectId, documentId,
  );
  return canonicalLockEvidence(rows);
}

async function appendAudit(tx: DbAdapter, event: CanonicalCadRevisionAuditEvent): Promise<void> {
  const inserted = await tx.execute(
    `INSERT INTO nf_cad_canonical_v2_audit
      (receipt_sha256, project_id, document_id, revision_id, event_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    event.receiptSha256,
    event.projectId,
    event.documentId,
    event.revision.revisionId,
    canonicalCadConsumerDraftJson(event),
    Date.parse(event.at),
  );
  if (inserted.changes !== 1) throw new Error('canonical_revision_audit_insert_failed');
}

function commitFailure(result: Exclude<CommitCanonicalCadRevisionResult, { ok: true }>) {
  if (result.code === 'MIGRATION_REQUIRED') return response(result, 503);
  if (result.code === 'REVISION_CONFLICT' || result.code === 'IDEMPOTENCY_CONFLICT') return response(result, 409);
  if (result.code === 'INVALID_COMMAND') return response(result, 422);
  if (result.code === 'CORRUPT_SERVER_STATE') return response(result, 500);
  return response(result, 400);
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const auth = await getAuthUser(request);
    if (!auth) return response({ ok: false, code: 'UNAUTHORIZED' }, 401);

    const { id, documentId } = await params;
    if (!validPathIds(id, documentId)) return response({ ok: false, code: 'INVALID_PATH' }, 400);

    const rate = await applyRateLimit(request, 'GET', auth.userId);
    if (!rate.result.allowed) return limitedResponse(rate.result, rate.maximum);

    const db = getDbAdapter();
    const access = await resolveProjectAccess(db, id, auth);
    if (!access) return response({ ok: false, code: 'NOT_FOUND' }, 404);

    const result = await readCanonicalCadRevisionHead(db, id, documentId);
    if (!result.ok) {
      if (result.code === 'MIGRATION_REQUIRED') return response(result, 503);
      if (result.code === 'NOT_FOUND') return response(result, 404);
      return response(result, 500);
    }
    return response({ ok: true, head: result.head });
  } catch {
    return response({ ok: false, code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    if (!checkOrigin(request)) return response({ ok: false, code: 'INVALID_ORIGIN' }, 403);
    const auth = await getAuthUser(request);
    if (!auth) return response({ ok: false, code: 'UNAUTHORIZED' }, 401);

    const { id, documentId } = await params;
    if (!validPathIds(id, documentId)) return response({ ok: false, code: 'INVALID_PATH' }, 400);

    const rate = await applyRateLimit(request, 'POST', auth.userId);
    if (!rate.result.allowed) return limitedResponse(rate.result, rate.maximum);

    const db = getDbAdapter();
    const access = await resolveProjectAccess(db, id, auth);
    if (!access) return response({ ok: false, code: 'NOT_FOUND' }, 404);
    if (!access.canEdit) return response({ ok: false, code: 'PROJECT_EDITOR_REQUIRED' }, 403);

    let body: unknown;
    try {
      body = await readBoundedJson(request, MAX_BODY_BYTES);
    } catch (error) {
      const bounded = boundedJsonError(error);
      if (bounded?.code === 'PAYLOAD_TOO_LARGE') return response({ ok: false, code: bounded.code }, 413);
      return response({ ok: false, code: 'BAD_REQUEST' }, 400);
    }
    if (!isRecord(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'command') || !isRecord(body.command)) {
      return response({ ok: false, code: 'BODY_KEYS_INVALID' }, 400);
    }

    const command = body.command as unknown as CanonicalCadCommandV2ConsumerDraft;
    if (command.projectId !== id || command.documentId !== documentId) {
      return response({ ok: false, code: 'PATH_COMMAND_IDENTITY_MISMATCH' }, 400);
    }
    if (!isRecord(command.actor) || command.actor.kind !== 'human') {
      return response({ ok: false, code: 'HUMAN_ACTOR_REQUIRED' }, 400);
    }
    if (command.actor.actorId !== auth.userId) {
      return response({ ok: false, code: 'AUTHENTICATED_ACTOR_MISMATCH' }, 400);
    }

    try {
      await assertCanonicalCadRevisionMigration(db);
    } catch {
      return response({ ok: false, code: 'MIGRATION_REQUIRED', issues: ['canonical_cad_revision_migration_required'] }, 503);
    }
    const currentLocks = await readCurrentLocks(db, id, documentId);
    const result = await commitCanonicalCadRevision(db, {
      projectId: id,
      documentId,
      authenticatedActorId: auth.userId,
      command,
      execution: { currentLocks, evaluatedAt: new Date().toISOString() },
      hooks: {
        // The base store's seven durable invalidation rows are the outbox.
        async invalidateDerived() { /* durable base-store outbox; no duplicate write */ },
        appendAudit,
      },
    });
    if (!result.ok) return commitFailure(result);
    return response({
      ok: true,
      replayed: result.replayed,
      receipt: result.receipt,
      document: result.document,
    }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof InvalidCanonicalLockStateError) {
      return response({ ok: false, code: 'CORRUPT_SERVER_STATE', issues: [error.message] }, 500);
    }
    return response({ ok: false, code: 'INTERNAL_ERROR' }, 500);
  }
}
