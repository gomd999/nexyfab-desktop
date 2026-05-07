import { NextRequest, NextResponse } from 'next/server';
import { processJobQueue } from '@/lib/job-queue';
import { checkSLADeadlines } from '@/lib/sla-checker';
import { verifyAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/process
 * Processes pending jobs from nf_job_queue (send_email, stripe_reprocess, etc.)
 *
 * Call from Vercel/Railway cron every minute:
 *   vercel.json: { "crons": [{ "path": "/api/jobs/process", "schedule": "* * * * *" }] }
 *   Railway: set CRON_SECRET and call POST /api/jobs/process with x-cron-secret header
 *
 * Auth: CRON_SECRET header OR admin session
 */
export async function POST(req: NextRequest) {
  const cronSecret  = req.headers.get('x-cron-secret');
  const expected    = process.env.CRON_SECRET;
  const isAdmin     = await verifyAdmin(req);
  const isCron      = !!expected && cronSecret === expected;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await runFullCronCycle();
  return NextResponse.json({ ok: true, processedAt: new Date().toISOString(), ...result });
}

// Vercel Cron calls GET with Authorization header
export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '');
  const expected   = process.env.CRON_SECRET;

  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await runFullCronCycle();
  return NextResponse.json({ ok: true, processedAt: new Date().toISOString(), ...result });
}

/**
 * Full cron cycle:
 * 1. Process pending job queue (emails, retries)
 * 2. Check SLA deadlines (enqueues notifications + alerts)
 * 3. Trigger quote expiry remind (if cron endpoint available)
 */
async function runFullCronCycle() {
  await processJobQueue();

  let slaAlerts = 0;
  try {
    const alerts = await checkSLADeadlines();
    slaAlerts = alerts.length;
  } catch { /* non-blocking */ }

  let quoteRemindOk = false;
  try {
    const secret = process.env.CRON_SECRET ?? '';
    const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.NODE_ENV === 'production' ? (console.error('[jobs/process] NEXT_PUBLIC_SITE_URL is not set'), 'http://localhost:3000') : 'http://localhost:3000');
    const res = await fetch(`${baseUrl}/api/jobs/quote-expiry-remind`, {
      method: 'POST',
      headers: { 'x-cron-secret': secret },
    });
    quoteRemindOk = res.ok;
  } catch { /* non-blocking */ }

  return { slaAlerts, quoteRemindOk };
}
