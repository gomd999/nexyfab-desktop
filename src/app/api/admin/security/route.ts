/**
 * GET    /api/admin/security         — 보안 알림 + 로그인 이력 조회
 * PATCH  /api/admin/security         — 알림 해결 처리 { alertId }
 * DELETE /api/admin/security         — 계정 잠금 해제 { userId }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const sp   = req.nextUrl.searchParams;
  const tab  = sp.get('tab') ?? 'alerts'; // alerts | history
  const q    = sp.get('q') ?? '';
  const severity = sp.get('severity') ?? '';
  const resolved = sp.get('resolved') ?? '0';
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit  = 50;
  const offset = (page - 1) * limit;

  const db = getDbAdapter();

  if (tab === 'alerts') {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (severity) { conditions.push('a.severity = ?'); params.push(severity); }
    if (resolved !== '') { conditions.push('a.resolved = ?'); params.push(parseInt(resolved)); }
    if (q) {
      conditions.push('(u.email LIKE ? OR u.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [alerts, countRow, summary] = await Promise.all([
      db.queryAll<{
        id: string; user_id: string; email: string; name: string;
        alert_type: string; severity: string; details: string | null;
        resolved: number; resolved_by: string | null; resolved_at: number | null;
        created_at: number;
      }>(
        `SELECT a.id, a.user_id, u.email, u.name,
                a.alert_type, a.severity, a.details,
                a.resolved, a.resolved_by, a.resolved_at, a.created_at
         FROM nf_security_alerts a
         LEFT JOIN nf_users u ON u.id = a.user_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
        ...params, limit, offset,
      ),
      db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM nf_security_alerts a LEFT JOIN nf_users u ON u.id = a.user_id ${where}`,
        ...params,
      ),
      db.queryAll<{ severity: string; resolved: number; count: number }>(
        `SELECT severity, resolved, COUNT(*) AS count FROM nf_security_alerts GROUP BY severity, resolved`,
      ),
    ]);

    return NextResponse.json({ alerts, total: countRow?.total ?? 0, page, limit, summary });
  }

  // tab === 'history'
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (q) {
    conditions.push('(u.email LIKE ? OR u.name LIKE ? OR h.ip LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const riskFilter = sp.get('risk') ?? '';
  if (riskFilter) { conditions.push('h.risk_level = ?'); params.push(riskFilter); }
  const methodFilter = sp.get('method') ?? '';
  if (methodFilter) { conditions.push('h.method = ?'); params.push(methodFilter); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [history, countRow] = await Promise.all([
    db.queryAll<{
      id: string; user_id: string; email: string; name: string;
      ip: string; country: string | null; user_agent: string | null;
      method: string; success: number; risk_level: string; risk_reason: string | null;
      created_at: number;
    }>(
      `SELECT h.id, h.user_id, u.email, u.name,
              h.ip, h.country, h.user_agent, h.method, h.success,
              h.risk_level, h.risk_reason, h.created_at
       FROM nf_login_history h
       LEFT JOIN nf_users u ON u.id = h.user_id
       ${where}
       ORDER BY h.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    ),
    db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM nf_login_history h LEFT JOIN nf_users u ON u.id = h.user_id ${where}`,
      ...params,
    ),
  ]);

  return NextResponse.json({ history, total: countRow?.total ?? 0, page, limit });
}

export async function PATCH(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const { alertId } = await req.json() as { alertId?: string };
  if (!alertId) return NextResponse.json({ error: 'alertId required' }, { status: 400 });

  const db = getDbAdapter();
  await db.execute(
    'UPDATE nf_security_alerts SET resolved = 1, resolved_by = ?, resolved_at = ? WHERE id = ?',
    'admin', Date.now(), alertId,
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await verifyAdmin(req))) return unauthorized();

  const { userId } = await req.json() as { userId?: string };
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const db = getDbAdapter();
  await db.execute(
    'UPDATE nf_users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = ?',
    userId,
  );

  return NextResponse.json({ ok: true });
}
