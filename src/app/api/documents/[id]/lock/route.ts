/**
 * /api/documents/[id]/lock — W6-B exclusive check-out endpoints.
 *
 *   POST   — acquire (or re-acquire / take over an EXPIRED lock).
 *            201 with the lock on success; 423 Locked + holder/expiry info
 *            when another user holds an active lock. Editor role required.
 *            Body: { ttlMs? } clamped to [1 min, 4 h], default 30 min.
 *   PUT    — refresh (extend) a lock the caller holds. 200 with the new
 *            expiry; 423 if another user holds it; 404 `lock.not_found`
 *            when the caller holds no active lock (client should POST).
 *   DELETE — release (check-in). Holder may always release; the document
 *            OWNER may force-release anyone's lock (admin escape hatch);
 *            anyone else → 403. Idempotent: releasing a non-existent /
 *            expired lock is 200 with released:false.
 *
 * Semantics of the guard on edit paths (PUT document, POST versions,
 * POST restore) live in cloudDoc/locks.ts (`getLockHeldByOther`); this file
 * only manages the lock's own lifecycle.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { resolveDocAccess, type DocAccess } from '@/lib/cloudDoc/access';
import {
  acquireLock,
  refreshLock,
  releaseLock,
  getActiveLock,
  getLockHeldByOther,
  publicLockShape,
  lockConflictPayload,
  clampTtlMs,
} from '@/lib/cloudDoc/locks';
import { readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_JSON_BODY_BYTES = 16 * 1024;

/** Shared auth + access resolution (mirrors the [id]/route.ts wrapper). */
async function loadAccess(
  req: NextRequest,
  documentId: string,
): Promise<{ ok: true; access: DocAccess; userId: string } | { ok: false; response: NextResponse }> {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const db = getDbAdapter();
  const access = await resolveDocAccess(db, documentId, authUser.userId);
  if (!access) {
    return { ok: false, response: NextResponse.json({ error: 'Not found', code: 'document.not_found' }, { status: 404 }) };
  }
  return { ok: true, access, userId: authUser.userId };
}

async function readTtlMs(req: NextRequest): Promise<number | null> {
  if (!req.body) return clampTtlMs(undefined);
  let body: { ttlMs?: unknown } = {};
  try { body = await readBoundedJson<{ ttlMs?: unknown }>(req, MAX_JSON_BODY_BYTES); } catch { return null; }
  return clampTtlMs(body.ttlMs);
}

// ─── POST /api/documents/[id]/lock — acquire ────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });

  const { id } = await params;
  const result = await loadAccess(req, id);
  if (!result.ok) return result.response;
  const { access, userId } = result;

  if (!access.canEdit) {
    return NextResponse.json(
      { error: 'Editor role required to check out', code: 'document.permission_denied' },
      { status: 403 },
    );
  }

  const ttlMs = await readTtlMs(req);
  if (ttlMs === null) {
    return NextResponse.json({ error: 'ttlMs must be a finite number (ms)', code: 'validation.ttlMs' }, { status: 400 });
  }

  const db = getDbAdapter();
  const acquired = await acquireLock(db, id, userId, ttlMs);
  if (!acquired.ok) {
    return NextResponse.json(lockConflictPayload(acquired.heldBy), { status: 423 });
  }

  logAudit({
    userId, action: 'document.lock', resourceId: id,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: { ttlMs, takenOver: acquired.takenOver },
  });

  return NextResponse.json(
    { ok: true, lock: publicLockShape(acquired.lock), takenOver: acquired.takenOver },
    { status: 201 },
  );
}

// ─── PUT /api/documents/[id]/lock — refresh / extend ────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });

  const { id } = await params;
  const result = await loadAccess(req, id);
  if (!result.ok) return result.response;
  const { access, userId } = result;

  if (!access.canEdit) {
    return NextResponse.json(
      { error: 'Editor role required', code: 'document.permission_denied' },
      { status: 403 },
    );
  }

  const ttlMs = await readTtlMs(req);
  if (ttlMs === null) {
    return NextResponse.json({ error: 'ttlMs must be a finite number (ms)', code: 'validation.ttlMs' }, { status: 400 });
  }

  const db = getDbAdapter();
  const other = await getLockHeldByOther(db, id, userId);
  if (other) {
    return NextResponse.json(lockConflictPayload(other), { status: 423 });
  }

  const lock = await refreshLock(db, id, userId, ttlMs);
  if (!lock) {
    // No active lock held by the caller (never had one, or it expired).
    // Refresh cannot resurrect an expired lock — POST re-acquires instead,
    // which routes takeover through the single fairness path.
    return NextResponse.json(
      { error: 'No active lock held by you — acquire via POST', code: 'lock.not_found' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, lock: publicLockShape(lock) });
}

// ─── DELETE /api/documents/[id]/lock — release (check-in) ───────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });

  const { id } = await params;
  const result = await loadAccess(req, id);
  if (!result.ok) return result.response;
  const { access, userId } = result;

  const db = getDbAdapter();
  const active = await getActiveLock(db, id);

  if (active && active.holder_id !== userId && !access.canManage) {
    return NextResponse.json(
      { error: 'Only the lock holder or the document owner can release', code: 'lock.not_holder' },
      { status: 403 },
    );
  }

  // Authorized (holder, owner force-release, or no active lock — deleting a
  // stale row is harmless cleanup). Idempotent.
  const forced = !!active && active.holder_id !== userId;
  const { released } = await releaseLock(db, id);

  if (released) {
    logAudit({
      userId, action: 'document.unlock', resourceId: id,
      ip: getTrustedClientIpOrUndefined(req.headers),
      metadata: { forced, previousHolder: active?.holder_id ?? null },
    });
  }

  return NextResponse.json({ ok: true, released, forced });
}
