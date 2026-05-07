/**
 * POST /api/admin/email-logs/resend
 * Resend a previously failed email using the stored body from nf_email_logs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendEmail } from '@/lib/nexyfab-email';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

interface EmailLogRow {
  id: string;
  to_email: string;
  subject: string;
  body: string | null;
  status: string;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null) as { logId?: string } | null;
  if (!body?.logId) {
    return NextResponse.json({ error: 'logId is required' }, { status: 400 });
  }

  const db = getDbAdapter();
  const log = await db.queryOne<EmailLogRow>(
    'SELECT id, to_email, subject, body, status FROM nf_email_logs WHERE id = ?',
    body.logId,
  );

  if (!log) return NextResponse.json({ error: 'Log entry not found' }, { status: 404 });
  if (!log.body) {
    return NextResponse.json({ error: 'Email body not stored — cannot resend' }, { status: 422 });
  }

  try {
    await sendEmail(log.to_email, log.subject, log.body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resend failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
