/**
 * GET    /api/admin/email-logs  — List email delivery logs (paginated)
 * DELETE /api/admin/email-logs  — Clear logs older than 30 days
 *
 * Table: nf_email_logs (id, to_email, subject, status, error, created_at)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

interface EmailLogRow {
  id: string;
  to_email: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: number;
}

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const { searchParams } = req.nextUrl;

  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  try {
    const [totalRow, logs] = await Promise.all([
      db.queryOne<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM nf_email_logs`,
      ),
      db.queryAll<EmailLogRow>(
        `SELECT id, to_email, subject, status, error, created_at
         FROM nf_email_logs
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        limit,
        offset,
      ),
    ]);

    return NextResponse.json({
      logs,
      total: totalRow?.cnt ?? 0,
      page,
      limit,
    });
  } catch (err) {
    console.error('[email-logs GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;

  try {
    const result = await db.execute(
      `DELETE FROM nf_email_logs WHERE created_at < ?`,
      thirtyDaysAgo,
    );

    return NextResponse.json({ deleted: result.changes });
  } catch (err) {
    console.error('[email-logs DELETE] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
