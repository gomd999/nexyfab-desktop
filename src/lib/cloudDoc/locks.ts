/**
 * cloudDoc/locks.ts — W6-B exclusive document locks (check-out / check-in).
 *
 * Model
 * ─────
 * One row per document in `nf_document_locks` (document_id is the PRIMARY
 * KEY, so "at most one lock per document" is a structural invariant, not an
 * application promise). A row is an ACTIVE lock iff `expires_at > now`;
 * otherwise it is stale and the next acquirer silently takes it over
 * (a crashed client must never block a document permanently).
 *
 * TTL policy
 * ──────────
 * Default 30 min (`DEFAULT_LOCK_TTL_MS`), clamped to [1 min, 4 h]. Long edit
 * sessions keep the lock alive via PUT /lock (refresh) rather than a huge
 * TTL, so the worst-case stale-lock block after a client crash is bounded by
 * the TTL.
 *
 * Concurrency
 * ───────────
 * Acquisition is a single atomic guarded upsert (ON CONFLICT … DO UPDATE …
 * WHERE holder = me OR expired) that both better-sqlite3 (3.24+) and
 * Postgres execute atomically; `changes === 0` means someone else holds an
 * active lock. No read-then-write race window.
 *
 * All timestamps are BIGINT ms-epoch per the wave-2 convention; node-postgres
 * returns BIGINT as strings, hence the asNum() coercion at every boundary.
 */

import type { DbAdapter } from '@/lib/db-adapter';
import { asNum } from './access';

export const DEFAULT_LOCK_TTL_MS = 30 * 60 * 1000; // 30 min
export const MIN_LOCK_TTL_MS = 60 * 1000;          // 1 min
export const MAX_LOCK_TTL_MS = 4 * 60 * 60 * 1000; // 4 h

export interface LockRow {
  document_id: string;
  holder_id: string;
  acquired_at: number | string;
  refreshed_at: number | string;
  expires_at: number | string;
}

export interface PublicLock {
  documentId: string;
  holderId: string;
  acquiredAt: number;
  refreshedAt: number;
  expiresAt: number;
}

export function publicLockShape(row: LockRow): PublicLock {
  return {
    documentId:  row.document_id,
    holderId:    row.holder_id,
    acquiredAt:  asNum(row.acquired_at),
    refreshedAt: asNum(row.refreshed_at),
    expiresAt:   asNum(row.expires_at),
  };
}

/**
 * Standard 423 Locked body. 423 (WebDAV, RFC 4918) is the semantically
 * correct status for "the source resource is locked" — distinct from 403
 * (you lack the role) and 409 (state conflict): the caller HAS edit rights
 * and the request is well-formed; only the check-out blocks it, and the
 * response tells them who holds it and when it expires.
 */
export function lockConflictPayload(heldBy: LockRow) {
  return {
    error: 'Document is checked out by another user',
    code: 'document.locked',
    lock: publicLockShape(heldBy),
  };
}

/**
 * Validate + clamp a client-supplied ttlMs.
 * Returns the effective TTL, or null when the value is present but invalid
 * (caller maps null → 400).
 */
export function clampTtlMs(v: unknown): number | null {
  if (v === undefined || v === null) return DEFAULT_LOCK_TTL_MS;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(MAX_LOCK_TTL_MS, Math.max(MIN_LOCK_TTL_MS, Math.floor(v)));
}

/** True iff the row exists and has not expired. NaN-safe: a malformed / absent expires_at is never "active". */
function isActive(row: LockRow | undefined | null, now: number): row is LockRow {
  return !!row && asNum(row.expires_at) > now;
}

/** The active lock on a document, or null (no row, or row expired). */
export async function getActiveLock(
  db: DbAdapter,
  documentId: string,
  now: number = Date.now(),
): Promise<LockRow | null> {
  const row = await db.queryOne<LockRow>(
    'SELECT * FROM nf_document_locks WHERE document_id = ?',
    documentId,
  );
  return isActive(row, now) ? row : null;
}

/**
 * The active lock held by someone OTHER than `userId`, or null.
 * This is the gate every mutating path (PUT document, POST versions,
 * POST restore) checks before writing — null means "go ahead".
 */
export async function getLockHeldByOther(
  db: DbAdapter,
  documentId: string,
  userId: string,
  now: number = Date.now(),
): Promise<LockRow | null> {
  const row = await getActiveLock(db, documentId, now);
  return row && row.holder_id !== userId ? row : null;
}

export type AcquireLockResult =
  | { ok: true; lock: LockRow; takenOver: boolean }
  | { ok: false; heldBy: LockRow };

/**
 * Acquire (or re-acquire / take over) the exclusive lock on a document.
 *
 * Single-statement guarded upsert — succeeds iff:
 *   - no row exists (fresh acquire), or
 *   - the caller already holds it (refresh; original acquired_at preserved), or
 *   - the existing row is expired (takeover — stale locks never block).
 *
 * `changes === 0` ⇒ another user holds an active lock ⇒ conflict, with the
 * holder row returned for the 423 payload.
 */
export async function acquireLock(
  db: DbAdapter,
  documentId: string,
  userId: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
  now: number = Date.now(),
): Promise<AcquireLockResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Pre-read only to report `takenOver` (informational); correctness rests
    // on the atomic upsert below, not on this read.
    const existing = await db.queryOne<LockRow>(
      'SELECT * FROM nf_document_locks WHERE document_id = ?',
      documentId,
    );
    const takenOver = !!existing && existing.holder_id !== userId && !isActive(existing, now);

    const res = await db.execute(
      `INSERT INTO nf_document_locks (document_id, holder_id, acquired_at, refreshed_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (document_id) DO UPDATE SET
         holder_id    = excluded.holder_id,
         acquired_at  = CASE
                          WHEN nf_document_locks.holder_id = excluded.holder_id
                           AND nf_document_locks.expires_at > ?
                          THEN nf_document_locks.acquired_at
                          ELSE excluded.acquired_at
                        END,
         refreshed_at = excluded.refreshed_at,
         expires_at   = excluded.expires_at
       WHERE nf_document_locks.holder_id = excluded.holder_id
          OR nf_document_locks.expires_at <= ?`,
      documentId, userId, now, now, now + ttlMs, now, now,
    );

    if (res.changes > 0) {
      const lock = await db.queryOne<LockRow>(
        'SELECT * FROM nf_document_locks WHERE document_id = ?',
        documentId,
      );
      if (lock && lock.holder_id === userId) return { ok: true, lock, takenOver };
      continue; // row changed under us between write and read-back — retry
    }

    const heldBy = await db.queryOne<LockRow>(
      'SELECT * FROM nf_document_locks WHERE document_id = ?',
      documentId,
    );
    if (isActive(heldBy, now) && heldBy.holder_id !== userId) {
      return { ok: false, heldBy };
    }
    // The blocking row was released/expired between the two statements — retry.
  }
  throw new Error(`acquireLock: raced out after 3 attempts (document ${documentId})`);
}

/**
 * Refresh (extend) a lock the caller currently holds.
 * Returns the refreshed row, or null when the caller holds no ACTIVE lock
 * (expired locks cannot be refreshed — re-acquire instead, which also
 * handles takeover fairness).
 */
export async function refreshLock(
  db: DbAdapter,
  documentId: string,
  userId: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
  now: number = Date.now(),
): Promise<LockRow | null> {
  const res = await db.execute(
    `UPDATE nf_document_locks
        SET refreshed_at = ?, expires_at = ?
      WHERE document_id = ? AND holder_id = ? AND expires_at > ?`,
    now, now + ttlMs, documentId, userId, now,
  );
  if (res.changes === 0) return null;
  const row = await db.queryOne<LockRow>(
    'SELECT * FROM nf_document_locks WHERE document_id = ?',
    documentId,
  );
  return row ?? null;
}

/**
 * Delete the lock row for a document (check-in). AUTHORIZATION IS THE
 * CALLER'S JOB — the route verifies holder-or-owner before calling this.
 * Deleting a stale row (expired, or none) is fine; `released` reports
 * whether a row was actually removed.
 */
export async function releaseLock(
  db: DbAdapter,
  documentId: string,
): Promise<{ released: boolean }> {
  const res = await db.execute(
    'DELETE FROM nf_document_locks WHERE document_id = ?',
    documentId,
  );
  return { released: res.changes > 0 };
}
