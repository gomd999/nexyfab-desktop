/**
 * GET /api/admin/admin-actions
 *
 * Read-only audit trail for admin console mutations (setting rotation,
 * feature flag toggles, etc.). Distinct from /api/admin/audit which is
 * the older general-purpose audit log — this one is specifically for
 * admin-action audit (nf_admin_audit table introduced in v86).
 *
 * Query:
 *   ?windowH=168     hours (default 7d, max 720)
 *   ?action=…        filter by dotted action name
 *   ?target=…        filter by target id
 *   ?adminUserId=…   filter by who performed
 *   ?limit=100
 *
 * Both admin and super_admin can read; only super_admin sees IP/UA fields
 * (those count as PII per our internal policy).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin, verifySuperAdmin } from '@/lib/admin-auth';
import { queryAdminAudit } from '@/lib/admin-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const isSuper = await verifySuperAdmin(req);

  const url = new URL(req.url);
  const rows = await queryAdminAudit({
    windowH: Number(url.searchParams.get('windowH') ?? 168) || 168,
    action: url.searchParams.get('action') ?? undefined,
    target: url.searchParams.get('target') ?? undefined,
    adminUserId: url.searchParams.get('adminUserId') ?? undefined,
    limit: Number(url.searchParams.get('limit') ?? 100) || 100,
  });

  return NextResponse.json({
    ok: true,
    rows: rows.map(r => ({
      id: r.id,
      adminUserId: r.adminUserId,
      action: r.action,
      target: r.target,
      oldValueHash: r.oldValueHash,
      newValueHash: r.newValueHash,
      metadata: r.metadata,
      // Only expose IP/UA to super_admin — admins see masked.
      ipAddress: isSuper ? r.ipAddress : (r.ipAddress ? '***' : null),
      userAgent: isSuper ? r.userAgent : null,
      createdAt: r.createdAt,
    })),
  });
}
