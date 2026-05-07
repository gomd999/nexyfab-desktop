/**
 * GET /api/admin/audit — Audit log viewer (admin only)
 * Query params: ?action=&userId=&limit=&offset=&from=&to=
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

interface AuditRow {
  id: string;
  user_id: string;
  action: string;
  resource_id: string | null;
  metadata: string | null;
  ip: string | null;
  created_at: number;
  // joined
  user_email: string | null;
  user_name: string | null;
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const action   = searchParams.get('action') ?? '';
  const userId   = searchParams.get('userId') ?? '';
  const search   = searchParams.get('search') ?? '';
  const limit    = Math.min(200, parseInt(searchParams.get('limit') ?? '100', 10));
  const offset   = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10));
  const fromMs   = searchParams.get('from') ? new Date(searchParams.get('from')!).getTime() : 0;
  const toMs     = searchParams.get('to') ? new Date(searchParams.get('to')!).getTime() : Date.now() + 86_400_000;

  const db = getDbAdapter();

  const conditions: string[] = ['a.created_at BETWEEN ? AND ?'];
  const vals: unknown[] = [fromMs || 0, toMs];

  if (action) { conditions.push('a.action = ?'); vals.push(action); }
  if (userId) { conditions.push('a.user_id = ?'); vals.push(userId); }
  if (search) { conditions.push("(a.action LIKE ? OR a.resource_id LIKE ? OR a.user_id LIKE ? OR a.metadata LIKE ?)"); vals.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [rows, countRow] = await Promise.all([
    db.queryAll<AuditRow>(
      `SELECT a.*, u.email AS user_email, u.name AS user_name
       FROM nf_audit_log a
       LEFT JOIN nf_users u ON u.id = a.user_id
       ${where}
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      ...vals, limit, offset,
    ).catch((): AuditRow[] => []),
    db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM nf_audit_log a ${where}`,
      ...vals,
    ).catch(() => ({ cnt: 0 })),
  ]);

  // Distinct action types for filter dropdown
  const actions = await db.queryAll<{ action: string }>(
    'SELECT DISTINCT action FROM nf_audit_log ORDER BY action',
  ).catch(() => [] as { action: string }[]);

  return NextResponse.json({
    entries: rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email,
      userName: r.user_name,
      action: r.action,
      resourceId: r.resource_id,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      ip: r.ip,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    total: countRow?.cnt ?? 0,
    actions: actions.map(a => a.action),
  });
}
