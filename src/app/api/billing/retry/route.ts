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
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { processSmartRetries } from '@/lib/billing-engine';
import { verifyAdmin } from '@/lib/admin-auth';
import { denyIfPaymentCollectionDisabled } from '@/lib/payment-gate';

const BILLING_RETRY_JSON_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const paymentDenied = denyIfPaymentCollectionDisabled();
  if (paymentDenied) return paymentDenied;
  // Only allow internal cron / admin calls
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedCron = process.env.CRON_SECRET;

  const isAdmin  = await verifyAdmin(req);
  const isCron   = expectedCron && cronSecret === expectedCron;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { paymentMethodId?: string } = {};
  try { body = await readBoundedJson(req, BILLING_RETRY_JSON_BYTES); }
  catch (error) {
    const bodyError = boundedJsonError(error);
    if (bodyError?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request body too large' }, { status: bodyError.status });
  }
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
  const paymentDenied = denyIfPaymentCollectionDisabled();
  if (paymentDenied) return paymentDenied;
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
