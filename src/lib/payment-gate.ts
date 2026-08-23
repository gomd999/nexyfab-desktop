/**
 * Global collection gate for every operation that can create or confirm a
 * charge. This is deliberately fail-closed: payments only become available
 * after production explicitly sets NEXYFAB_PAYMENTS_ENABLED=true.
 *
 * Refunds, cancellations and provider webhooks must not use this gate. They
 * are needed to reconcile or reverse payments that were already in flight.
 */
import { NextResponse } from 'next/server';

export const PAYMENTS_DISABLED_CODE = 'PAYMENTS_DISABLED' as const;

export function isPaymentCollectionEnabled(
  env?: { NEXYFAB_PAYMENTS_ENABLED?: string },
): boolean {
  const value = env
    ? env.NEXYFAB_PAYMENTS_ENABLED
    : process.env.NEXYFAB_PAYMENTS_ENABLED;
  return value?.trim().toLowerCase() === 'true';
}

export function denyIfPaymentCollectionDisabled(): NextResponse | null {
  if (isPaymentCollectionEnabled()) return null;

  return NextResponse.json(
    {
      ok: false,
      error: 'payments_disabled',
      code: PAYMENTS_DISABLED_CODE,
      paymentStatus: 'disabled',
      message: 'Payment collection is currently disabled. No charge has been made.',
    },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': '86400',
      },
    },
  );
}
