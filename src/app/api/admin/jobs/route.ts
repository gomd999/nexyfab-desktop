/**
 * GET /api/admin/jobs          — list recent job queue entries
 * POST /api/admin/jobs/trigger — manually trigger a cron job
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { processJobQueue } from '@/lib/job-queue';

export const dynamic = 'force-dynamic';

// GET — list job queue (most recent 100)
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status'); // pending | processing | done | failed
  const type = searchParams.get('type');     // e.g. send_email
  const limit = Math.min(200, parseInt(searchParams.get('limit') ?? '100', 10));

  const db = getDbAdapter();

  const conditions: string[] = [];
  const vals: unknown[] = [];
  if (status) { conditions.push('status = ?'); vals.push(status); }
  if (type) { conditions.push('type = ?'); vals.push(type); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  vals.push(limit);

  type JobRow = {
    id: string; type: string; payload: string; status: string; attempts: number; max_attempts: number;
    scheduled_at: number; created_at: number; processed_at: number | null;
    error: string | null;
  };

  const jobs = await db.queryAll<JobRow>(
    `SELECT id, type, payload, status, attempts, max_attempts, scheduled_at, created_at, processed_at, error
     FROM nf_job_queue
     ${where}
     ORDER BY created_at DESC LIMIT ?`,
    ...vals,
  ).catch((): JobRow[] => []);

  // Summary counts
  const summary = await db.queryAll<{ status: string; cnt: number }>(
    'SELECT status, COUNT(*) as cnt FROM nf_job_queue GROUP BY status',
  ).catch(() => [] as { status: string; cnt: number }[]);

  const summaryMap = Object.fromEntries(summary.map(s => [s.status, s.cnt]));

  return NextResponse.json({
    jobs: jobs.map(j => {
      let parsedPayload: Record<string, string> = {};
      try { parsedPayload = JSON.parse(j.payload) as Record<string, string>; } catch { /* ignore */ }
      return {
        id: j.id,
        type: j.type,
        status: j.status,
        attempts: j.attempts,
        maxAttempts: j.max_attempts,
        scheduledAt: new Date(j.scheduled_at).toISOString(),
        createdAt: new Date(j.created_at).toISOString(),
        processedAt: j.processed_at ? new Date(j.processed_at).toISOString() : null,
        errorMessage: j.error,
        // Parsed payload fields for email jobs
        to: parsedPayload.to,
        subject: parsedPayload.subject,
      };
    }),
    summary: summaryMap,
    total: jobs.length,
  });
}

// POST — trigger job processing or manual cron
export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { action?: string };
  const action = body.action ?? 'process_queue';

  if (action === 'process_queue') {
    await processJobQueue();
    return NextResponse.json({ ok: true, action: 'process_queue' });
  }

  if (action === 'quote_expiry_remind') {
    const secret = process.env.CRON_SECRET ?? '';
    const origin = req.headers.get('origin') ?? (process.env.NEXTAUTH_URL ?? 'http://localhost:3000');
    const res = await fetch(`${origin}/api/jobs/quote-expiry-remind`, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    return NextResponse.json({ ok: true, action, result: data });
  }

  if (action === 'sla_check') {
    const res = await fetch('/api/admin/sla', {
      method: 'POST',
      headers: req.headers,
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    return NextResponse.json({ ok: true, action, result: data });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

// DELETE — clear done/failed jobs older than N days
export async function DELETE(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10);
  const cutoff = Date.now() - days * 86_400_000;

  const db = getDbAdapter();
  const result = await db.execute(
    `DELETE FROM nf_job_queue WHERE status IN ('done', 'failed') AND created_at < ?`,
    cutoff,
  ).catch(() => ({ changes: 0 }));

  return NextResponse.json({ ok: true, deleted: result.changes });
}
