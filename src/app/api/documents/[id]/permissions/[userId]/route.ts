/**
 * /api/documents/[id]/permissions/[userId] — revoke a single permission.
 *
 * DELETE — owner-only. Removes the per-document override row. Workspace-
 *          level access (if any) is unaffected. The owner row itself is
 *          NOT deletable through this endpoint (owners use ownership
 *          transfer; see POST §self-grant guard).
 *
 * 404-not-403 rule (per `docs/wave-2-cloud-document-migration.md` §8):
 *   - Caller has no access to the doc → 404 (no existence leak).
 *   - Caller has access but isn't owner → 403 (existence already implied).
 *   - Target permission row doesn't exist → 200 with `changed: false`
 *     (idempotent revoke).
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { ensureCloudDocTables, resolveDocAccess } from '@/lib/cloudDoc/access';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }

  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, userId } = await params;
  const db = getDbAdapter();
  await ensureCloudDocTables();

  const access = await resolveDocAccess(db, id, authUser.userId);
  if (!access) {
    return NextResponse.json(
      { error: 'Not found', code: 'document.not_found' },
      { status: 404 },
    );
  }

  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the document owner can revoke permissions', code: 'document.permission_denied' },
      { status: 403 },
    );
  }

  // Owner row protection — owners cannot self-revoke via this endpoint.
  // Ownership transfer is the only path; see Phase 6+.
  if (userId === access.row.owner_id) {
    return NextResponse.json(
      { error: 'Use ownership transfer to remove the owner', code: 'permission.owner_protected' },
      { status: 400 },
    );
  }

  const result = await db.execute(
    'DELETE FROM nf_document_permissions WHERE document_id = ? AND user_id = ?',
    id, userId,
  );

  const changed = typeof result?.changes === 'number' ? result.changes > 0 : true;

  if (changed) {
    logAudit({
      userId: authUser.userId,
      action: 'document.permission_revoke',
      resourceId: id,
      ip: getTrustedClientIpOrUndefined(req.headers),
      metadata: { targetUserId: userId },
    });
  }

  return NextResponse.json({ ok: true, changed });
}
