import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

// GET /api/admin/logs
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  const rows = await db.queryAll<{
    id: string; level: string; message: string; stack: string | null; context: string; created_at: string;
  }>(
    `SELECT id, level, message, stack, context, created_at
     FROM nf_error_logs
     ORDER BY created_at DESC
     LIMIT 1000`,
  ).catch(() => [] as { id: string; level: string; message: string; stack: string | null; context: string; created_at: string }[]);

  const logs = rows.map(r => {
    let ctx: Record<string, unknown> = {};
    try { ctx = JSON.parse(r.context) as Record<string, unknown>; } catch { }
    return {
      id: r.id,
      timestamp: r.created_at,
      level: r.level,
      message: r.message,
      stack: r.stack ?? undefined,
      ...ctx,
    };
  });

  return NextResponse.json({ logs });
}

// DELETE /api/admin/logs — 전체 삭제
export async function DELETE(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDbAdapter();
  await db.execute('DELETE FROM nf_error_logs').catch(() => {});
  return NextResponse.json({ success: true });
}
