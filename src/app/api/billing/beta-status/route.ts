/**
 * GET /api/billing/beta-status — Tells the client whether the current user
 * is allowed to complete payment during the closed beta.
 *
 * Response: { enabled: boolean, allowed: boolean, contact: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { isBetaEnabled, isAllowed, getContact } from '@/lib/billing-beta-gate';
import { isPaymentCollectionEnabled } from '@/lib/payment-gate';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getAuthUser(req);
  const paymentsEnabled = isPaymentCollectionEnabled();
  return NextResponse.json({
    paymentsEnabled,
    paymentStatus: paymentsEnabled ? 'enabled' : 'disabled',
    enabled: isBetaEnabled(),
    allowed: isAllowed(user?.email),
    contact: getContact(),
  });
}
