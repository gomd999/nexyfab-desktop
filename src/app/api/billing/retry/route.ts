/**
 * POST /api/billing/retry
 * Smart retry processor — call from cron job or Vercel Cron
 *
 * Retry schedule: day 1 → day 3 → day 7 → permanently failed
 *
 * Set up as a Vercel Cron:
 *   vercel.json: { "crons": [{ "path": "/api/billing/retry", "schedule": "0 9 * * *" }] }
 *
 * Internal-secret auth prevents public triggering.
 */
import { NextRequest, NextResponse } from 'next/server';
import { processSmartRetries } from '@/lib/billing-engine';
import { verifyAdmin } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  // Only allow internal cron / admin calls
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedCron = process.env.CRON_SECRET;

  const isAdmin  = await verifyAdmin(req);
  const isCron   = expectedCron && cronSecret === expectedCron;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}) as { paymentMethodId?: string });
  const paymentMethodId = body.paymentMethodId ?? process.env.AIRWALLEX_DEFAULT_PM ?? '';

  if (!paymentMethodId) {
    return NextResponse.json({ error: 'No paymentMethodId provided' }, { status: 400 });
  }

  const result = await processSmartRetries(paymentMethodId);

  return NextResponse.json({
    ...result,
    message: `Retry run complete: ${result.succeeded} succeeded, ${result.failed} failed of ${result.processed} processed`,
    runAt: new Date().toISOString(),
  });
}

// Vercel Cron also calls GET
export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '');
  const expectedCron = process.env.CRON_SECRET;

  if (!expectedCron || cronSecret !== expectedCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const paymentMethodId = process.env.AIRWALLEX_DEFAULT_PM ?? '';
  if (!paymentMethodId) {
    return NextResponse.json({ skipped: true, reason: 'No default payment method configured' });
  }

  const result = await processSmartRetries(paymentMethodId);

  return NextResponse.json({
    ...result,
    runAt: new Date().toISOString(),
  });
}
