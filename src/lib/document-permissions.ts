/**
 * document-permissions.ts — Wave 2 cloud document ACL resolution.
 *
 * Implements the permission model described in
 *   docs/wave-2-cloud-document-migration.md §8.
 *
 * Two-tier ACL:
 *   1. Document-level row in `nf_document_permissions` — explicit override.
 *   2. Workspace-level row in `nf_workspace_members` — default for every doc
 *      in the workspace.
 *
 * Resolution (effectiveRole):
 *   doc-perm row exists → return that role
 *   else workspace-member row exists → return that role
 *   else null (no access — treat as 404, not 403)
 *
 * "Document not found" / "no permission" intentionally collapse to 404 so we
 * don't leak existence of private documents (Onshape / Google Drive parity).
 *
 * Roles, low → high authority:
 *   viewer < commenter < editor < owner
 *
 * The DB layer enforces:
 *   - role CHECK constraint (4 valid strings)
 *   - single-owner partial unique index on nf_document_permissions
 * This module enforces:
 *   - role ordering / requireRole semantics
 *   - 404-not-403 absence semantics
 */

import type { DbAdapter } from './db-adapter';

// ─── Types ──────────────────────────────────────────────────────────────────

export type DocumentRole = 'owner' | 'editor' | 'commenter' | 'viewer';

/** Numeric rank for role comparison. Higher number = more authority. */
const ROLE_RANK: Record<DocumentRole, number> = {
  viewer:    1,
  commenter: 2,
  editor:    3,
  owner:     4,
};

const VALID_ROLES: readonly DocumentRole[] = ['owner', 'editor', 'commenter', 'viewer'];

/** True if `role` grants at least the authority of `minRole`. */
export function roleSatisfies(role: DocumentRole, minRole: DocumentRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/** Type guard for unknown strings coming back from the DB. */
function isDocumentRole(s: unknown): s is DocumentRole {
  return typeof s === 'string' && (VALID_ROLES as readonly string[]).includes(s);
}

/** Thrown by requireRole / requireAccess when authorization fails. */
export class DocumentPermissionError extends Error {
  /** Wire-level error code; matches docs/wave-2-cloud-document-migration.md §4.5. */
  readonly code: 'document.not_found' | 'document.permission_denied';

  /** HTTP status to return — 404 for absence (we don't leak existence). */
  readonly httpStatus: 404 | 403;

  constructor(opts: { kind: 'not_found' | 'forbidden'; message: string }) {
    super(opts.message);
    this.name = 'DocumentPermissionError';
    if (opts.kind === 'not_found') {
      this.code = 'document.not_found';
      this.httpStatus = 404;
    } else {
      this.code = 'document.permission_denied';
      this.httpStatus = 403;
    }
  }
}

// ─── effectiveRole ──────────────────────────────────────────────────────────

interface DocPermRow {
  role: string;
  /** Optional expiry; null = perpetual. */
  expires_at: string | number | null;
}

interface WorkspaceMembershipRow {
  role: string;
}

/**
 * Resolve the role a user has on a document.
 *
 *   1. If `nf_document_permissions(document_id, user_id)` exists AND is not
 *      expired → return that role.
 *   2. Else if the document is in a workspace AND
 *      `nf_workspace_members(workspace_id, user_id)` exists → return the
 *      workspace role.
 *   3. Else return null (no access; treat as 404).
 *
 * The query for the doc itself also checks `deleted_at IS NULL`. A soft-
 * deleted doc returns null even to its owner from this function; callers
 * that need to surface deleted docs (e.g., the trash page) use a separate
 * `listDeletedDocs` query (not in scope here).
 *
 * Performance: 2 queries in the worst case (doc-perm miss → workspace look).
 * Both queries hit indexed columns. Combine into a single CTE in hot paths
 * if profiling later shows latency pressure.
 */
export async function effectiveRole(
  userId: string,
  docId: string,
  db: DbAdapter,
): Promise<DocumentRole | null> {
  // Reject empty inputs early — defensive, since both come from URL params.
  if (!userId || !docId) return null;

  // Step 0: ensure the doc actually exists and isn't soft-deleted. Without
  // this, a doc-perm row for a deleted doc would still grant access (the FK
  // cascades on hard-delete, not soft-delete).
  const doc = await db.queryOne<{ id: string; workspace_id: string | null }>(
    'SELECT id, workspace_id FROM nf_documents WHERE id = ? AND deleted_at IS NULL',
    docId,
  );
  if (!doc) return null;

  // Step 1: document-level grant (highest precedence).
  const docPerm = await db.queryOne<DocPermRow>(
    `SELECT role, expires_at
       FROM nf_document_permissions
      WHERE document_id = ?
        AND user_id     = ?`,
    docId, userId,
  );

  if (docPerm && isDocumentRole(docPerm.role)) {
    // Honour expiry. Both Postgres TIMESTAMPTZ (string) and SQLite BIGINT (ms)
    // are accepted; coerce to ms-epoch for comparison.
    const expiresAtMs = coerceTimestampToMs(docPerm.expires_at);
    if (expiresAtMs === null || expiresAtMs > Date.now()) {
      return docPerm.role;
    }
    // Expired doc-perm row falls through to workspace check rather than
    // blocking access the user would otherwise still have at workspace level.
  }

  // Step 2: workspace-level grant (only if the doc is in a workspace).
  if (doc.workspace_id == null) return null;

  const wsPerm = await db.queryOne<WorkspaceMembershipRow>(
    `SELECT role
       FROM nf_workspace_members
      WHERE workspace_id = ?
        AND user_id      = ?`,
    doc.workspace_id, userId,
  );

  if (wsPerm && isDocumentRole(wsPerm.role)) {
    return wsPerm.role;
  }

  return null;
}

/**
 * Coerce a `TIMESTAMPTZ` (Postgres ISO string) or `BIGINT` (SQLite ms-epoch)
 * value to milliseconds since epoch. Returns null for null / undefined /
 * unparseable input.
 */
function coerceTimestampToMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    // ISO date string from Postgres (pg returns Date objects by default but
    // some configs return strings). Fall through to Date.parse.
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

// ─── requireRole ────────────────────────────────────────────────────────────

/**
 * Throw if the user does not have at least `minRole` on the doc.
 *
 *   - No role at all → `DocumentPermissionError` with code
 *     `document.not_found` (404) — intentional, don't leak existence.
 *   - Role present but below minRole → `DocumentPermissionError` with code
 *     `document.permission_denied` (403). At this point the user knows the
 *     doc exists (they can read it) — leakage already happened, denying
 *     edit is informational.
 *
 * Returns the resolved role on success, so callers can branch on it without
 * a second `effectiveRole` call.
 */
export async function requireRole(
  userId: string,
  docId: string,
  minRole: DocumentRole,
  db: DbAdapter,
): Promise<DocumentRole> {
  const role = await effectiveRole(userId, docId, db);

  if (role === null) {
    throw new DocumentPermissionError({
      kind: 'not_found',
      message: 'Document not found.',
    });
  }

  if (!roleSatisfies(role, minRole)) {
    throw new DocumentPermissionError({
      kind: 'forbidden',
      message: `Role '${role}' insufficient (requires '${minRole}').`,
    });
  }

  return role;
}

// ─── listAccessibleDocs ─────────────────────────────────────────────────────

export interface AccessibleDoc {
  id: string;
  name: string;
  workspaceId: string | null;
  ownerId: string;
  /** Role through which the user can see this doc (highest if both paths apply). */
  role: DocumentRole;
  /** Whether the user reached the doc via a doc-level row (vs workspace). */
  via: 'document' | 'workspace';
  /** ms-epoch of the row's updated_at (Postgres normalises TIMESTAMPTZ for us). */
  updatedAt: number;
}

interface DocListRow {
  id: string;
  name: string;
  workspace_id: string | null;
  owner_id: string;
  doc_role: string | null;
  workspace_role: string | null;
  updated_at: string | number;
}

/**
 * Return every non-deleted doc the user can see, with the effective role.
 *
 * The UNION below is the documented two-tier resolution (§8.2 of the design
 * doc) expressed as a single query:
 *
 *   - Branch A: docs with an explicit doc-perm row for this user.
 *   - Branch B: docs in any workspace the user is a member of.
 *   - GROUP BY id keeps one row per doc; the SELECT picks the higher-rank
 *     role between the two branches (doc-perm takes precedence; ties go to
 *     doc-perm too for "where did this grant come from?" UI hints).
 *
 * Sorted by updated_at DESC (recency) — caller paginates with LIMIT/OFFSET
 * if needed; pagination not exposed at this layer yet (Phase 3).
 *
 * The MAX(role) trick using `CASE role` works because the rank table is
 * monotonic. We could also do this in JS, but pushing into SQL means the
 * query planner sees a single resultset and Postgres can use HashAggregate.
 */
export async function listAccessibleDocs(
  userId: string,
  db: DbAdapter,
): Promise<AccessibleDoc[]> {
  if (!userId) return [];

  // We deliberately *do not* exclude doc-perm rows whose expires_at < NOW():
  // the SQL filter is below in the WHERE clause.
  const sql = `
    SELECT
      d.id           AS id,
      d.name         AS name,
      d.workspace_id AS workspace_id,
      d.owner_id     AS owner_id,
      dp.role        AS doc_role,
      wm.role        AS workspace_role,
      d.updated_at   AS updated_at
    FROM nf_documents d
    LEFT JOIN nf_document_permissions dp
      ON dp.document_id = d.id
     AND dp.user_id     = ?
     AND (dp.expires_at IS NULL OR dp.expires_at > ?)
    LEFT JOIN nf_workspace_members wm
      ON wm.workspace_id = d.workspace_id
     AND wm.user_id      = ?
    WHERE d.deleted_at IS NULL
      AND (dp.user_id IS NOT NULL OR wm.user_id IS NOT NULL)
    ORDER BY d.updated_at DESC
  `;

  const nowParam = nowForExpiresAt(db);
  const rows = await db.queryAll<DocListRow>(sql, userId, nowParam, userId);

  return rows
    .map<AccessibleDoc | null>((row) => {
      // Doc-perm wins. If only workspace_role is present, use that.
      let chosenRole: DocumentRole | null = null;
      let via: 'document' | 'workspace' = 'workspace';
      if (row.doc_role && isDocumentRole(row.doc_role)) {
        chosenRole = row.doc_role;
        via = 'document';
      } else if (row.workspace_role && isDocumentRole(row.workspace_role)) {
        chosenRole = row.workspace_role;
        via = 'workspace';
      }
      if (chosenRole === null) return null;  // shouldn't happen given WHERE clause

      const updatedAt = coerceTimestampToMs(row.updated_at) ?? 0;

      return {
        id:          row.id,
        name:        row.name,
        workspaceId: row.workspace_id,
        ownerId:     row.owner_id,
        role:        chosenRole,
        via,
        updatedAt,
      };
    })
    .filter((d): d is AccessibleDoc => d !== null);
}

/**
 * Bound value to pass for the `expires_at > ?` comparison. Postgres compares
 * TIMESTAMPTZ to an ISO string fine; SQLite stores BIGINT ms-epoch and
 * compares against a number. The adapter's placeholder substitution handles
 * the rest.
 */
function nowForExpiresAt(db: DbAdapter): number | string {
  if (db.backend === 'postgres') return new Date().toISOString();
  return Date.now();
}

// ─── Convenience: assert read access ────────────────────────────────────────

/**
 * Throw 404 if the user can't see the doc at all. Pass-through helper for
 * GET endpoints that only need read access. Equivalent to
 * `requireRole(uid, docId, 'viewer', db)` but reads more clearly at the
 * call-site as "make sure they can even see this".
 */
export async function requireDocumentAccess(
  userId: string,
  docId: string,
  db: DbAdapter,
): Promise<DocumentRole> {
  return requireRole(userId, docId, 'viewer', db);
}
