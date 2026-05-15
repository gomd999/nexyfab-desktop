/**
 * lib/billing-beta-gate.ts — Closed-beta payment allowlist.
 *
 * During the closed beta, only pre-approved emails can complete payment.
 * All Dodo / Stripe / Airwallex checkout endpoints route through this gate.
 *
 * Env:
 *   BILLING_BETA_ENABLED=true                       # gate on (default off)
 *   BILLING_BETA_ALLOWED_EMAILS=a@x.com,b@y.com
 *   BILLING_BETA_CONTACT=nexyfab@nexysys.com
 *
 * To leave beta: set BILLING_BETA_ENABLED=false (or unset).
 */

import { NextResponse } from 'next/server';

function parseAllowedEmails(): string[] {
  return (process.env.BILLING_BETA_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isBetaEnabled(): boolean {
  return process.env.BILLING_BETA_ENABLED === 'true';
}

export function isAllowed(email: string | null | undefined): boolean {
  if (!isBetaEnabled()) return true;
  if (!email) return false;
  return parseAllowedEmails().includes(String(email).trim().toLowerCase());
}

export function getContact(): string {
  return process.env.BILLING_BETA_CONTACT || 'nexyfab@nexysys.com';
}

/**
 * Returns a 403 NextResponse when the user is denied; otherwise null.
 *
 *   const denied = denyIfBeta(user?.email);
 *   if (denied) return denied;
 */
export function denyIfBeta(email: string | null | undefined): NextResponse | null {
  if (isAllowed(email)) return null;
  return NextResponse.json(
    {
      error: 'billing_beta_only',
      message: 'Payment is currently restricted to pre-approved beta users.',
      contact: getContact(),
    },
    { status: 403 },
  );
}
