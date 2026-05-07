import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { logAudit } from '@/lib/audit';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: number;
}

function rowToEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    action: row.action as string,
    resourceId: (row.resource_id as string) || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    ip: (row.ip as string) || undefined,
    createdAt: row.created_at as number,
  };
}

// ─── GET /api/nexyfab/audit ───────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { PLAN_AUDIT_DAYS } = await import('@/lib/plan-guard');
  const auditDays = PLAN_AUDIT_DAYS[authUser.plan] ?? -1;
  if (auditDays === -1) {
    return NextResponse.json({ error: 'Pro plan or higher required for audit logs.' }, { status: 403 });
  }

  const cutoff = Date.now() - auditDays * 86_400_000;

  const userId = req.nextUrl.searchParams.get('userId');
  const action = req.nextUrl.searchParams.get('action');
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(500, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10)));
  const offset = (page - 1) * limit;

  const db = getDbAdapter();
  let countSql = 'SELECT COUNT(*) as c FROM nf_audit_log WHERE user_id = ? AND created_at > ?';
  let dataSql = 'SELECT * FROM nf_audit_log WHERE user_id = ? AND created_at > ?';
  const filterArgs: (string | number)[] = [authUser.userId, cutoff];

  // userId 필터 제거: base WHERE에서 이미 authUser.userId로 필터링됨
  if (action) {
    countSql += ' AND action LIKE ?';
    dataSql += ' AND action LIKE ?';
    filterArgs.push(`${action}%`);
  }

  const totalRow = await db.queryOne<{ c: number }>(countSql, ...filterArgs);
  const total = totalRow?.c ?? 0;

  dataSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const rows = await db.queryAll<Record<string, unknown>>(dataSql, ...filterArgs, limit, offset);

  return NextResponse.json({
    logs: rows.map(rowToEntry),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
}

// ─── POST /api/nexyfab/audit ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { checkOrigin } = await import('@/lib/csrf');
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (authUser.plan !== 'enterprise') {
    return NextResponse.json(
      { error: 'Enterprise plan required to write audit logs' },
      { status: 403 },
    );
  }

  const body = await req.json() as {
    userId: string;
    action: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  };

  if (!body.action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  const ip = getTrustedClientIpOrUndefined(req.headers);

  // userId는 항상 인증된 사용자의 것을 사용 (클라이언트 제공값 무시 — audit log 위변조 방지)
  const db = getDbAdapter();
  const auditId = `al-${crypto.randomUUID()}`;
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_audit_log (id, user_id, action, resource_id, metadata, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    auditId, authUser.userId, body.action, body.resourceId ?? null,
    body.metadata ? JSON.stringify(body.metadata) : null, ip ?? null, now,
  );

  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_audit_log WHERE id = ?', auditId,
  );
  if (!row) {
    return NextResponse.json({ error: 'Audit log 저장 후 조회에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ entry: rowToEntry(row) }, { status: 201 });
}
