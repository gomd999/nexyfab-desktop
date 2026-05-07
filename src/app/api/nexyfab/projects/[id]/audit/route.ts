import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';

interface ProjectAuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: number;
}

function rowToEntry(row: Record<string, unknown>): ProjectAuditEntry {
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

function csvEscapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * 프로젝트 `resource_id`가 일치하는 감사 행만 반환 (소유자 + 플랜별 보관 기간).
 * `GET /api/nexyfab/audit`와 동일한 `PLAN_AUDIT_DAYS` 정책.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { PLAN_AUDIT_DAYS } = await import('@/lib/plan-guard');
  const auditDays = PLAN_AUDIT_DAYS[authUser.plan] ?? -1;
  if (auditDays === -1) {
    return NextResponse.json(
      { error: 'Pro plan or higher required for project audit logs.', code: 'AUDIT_PLAN_REQUIRED' },
      { status: 403 },
    );
  }

  const { id: projectId } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the project owner can view audit logs.', code: 'PROJECT_OWNER_ONLY' },
      { status: 403 },
    );
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '80', 10)));
  const cutoff = Date.now() - auditDays * 86_400_000;

  const rows = await db.queryAll<Record<string, unknown>>(
    `SELECT id, user_id, action, resource_id, metadata, ip, created_at
     FROM nf_audit_log
     WHERE resource_id = ? AND created_at > ?
     ORDER BY created_at DESC
     LIMIT ?`,
    projectId,
    cutoff,
    limit,
  );

  const wantCsv = (req.nextUrl.searchParams.get('format') ?? '').toLowerCase() === 'csv';
  if (wantCsv) {
    const entries = rows.map(rowToEntry);
    const header = ['id', 'userId', 'action', 'resourceId', 'createdAt', 'ip', 'metadata'].join(',');
    const lines = entries.map(e => {
      const meta = e.metadata ? JSON.stringify(e.metadata) : '';
      return [
        csvEscapeCell(e.id),
        csvEscapeCell(e.userId),
        csvEscapeCell(e.action),
        csvEscapeCell(e.resourceId ?? ''),
        csvEscapeCell(String(e.createdAt)),
        csvEscapeCell(e.ip ?? ''),
        csvEscapeCell(meta),
      ].join(',');
    });
    const body = [header, ...lines].join('\r\n');
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="project-${projectId}-audit.csv"`,
      },
    });
  }

  return NextResponse.json({
    logs: rows.map(rowToEntry),
    retentionDays: auditDays,
  });
}
