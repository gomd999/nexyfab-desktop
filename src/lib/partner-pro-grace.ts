/**
 * Partner Pro grace window — temporary Pro tier while a deal is in flight.
 *
 * Trigger sequence:
 *   - First quote submission → +30 days from now
 *   - RFQ accepted by buyer  → ensure ≥ +60 days from acceptance
 *   - Escrow released        → ensure ≥ +30 days from release
 *
 * Always extends with MAX(existing, candidate) so the window never shrinks
 * mid-deal. Never downgrades — expiration handling is implicit at auth time
 * (resolveEffectivePlan returns the stored plan if grace has lapsed).
 *
 * Stored plan in nf_users.plan is the source of truth for paid subs;
 * pro_grace_until only elevates 'free' users to 'pro' temporarily.
 */
import { getDbAdapter } from './db-adapter';

const QUOTE_GRACE_MS    = 30 * 24 * 60 * 60 * 1000;
const ACCEPTED_GRACE_MS = 60 * 24 * 60 * 60 * 1000;
const RELEASED_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export type GraceReason =
  | 'quote_submitted'
  | 'rfq_accepted'
  | 'escrow_released';

const REASON_DELTAS: Record<GraceReason, number> = {
  quote_submitted:  QUOTE_GRACE_MS,
  rfq_accepted:     ACCEPTED_GRACE_MS,
  escrow_released:  RELEASED_GRACE_MS,
};

/**
 * Extend a partner's Pro grace window if the candidate expiry exceeds the
 * existing one. Idempotent — safe to call from any deal state transition.
 */
export async function extendPartnerProGrace(
  userId: string,
  reason: GraceReason,
  fromTs: number = Date.now(),
): Promise<{ updated: boolean; expiresAt: number | null }> {
  if (!userId) return { updated: false, expiresAt: null };
  const candidate = fromTs + REASON_DELTAS[reason];
  const db = getDbAdapter();
  const row = await db.queryOne<{ pro_grace_until: number | null; plan: string }>(
    'SELECT pro_grace_until, plan FROM nf_users WHERE id = ?',
    userId,
  ).catch(() => null);
  if (!row) return { updated: false, expiresAt: null };

  // Paid Pro+ subscribers don't need grace; skip to avoid hiding billing
  // signal (a downgraded paid user shouldn't silently get rescued).
  if (row.plan && row.plan !== 'free') {
    return { updated: false, expiresAt: row.pro_grace_until };
  }

  const current = row.pro_grace_until ?? 0;
  if (candidate <= current) return { updated: false, expiresAt: current };

  await db.execute(
    'UPDATE nf_users SET pro_grace_until = ? WHERE id = ?',
    candidate, userId,
  ).catch(() => {});
  return { updated: true, expiresAt: candidate };
}

/**
 * Returns the user's effective plan, applying grace elevation if active.
 * Used by auth-middleware enrichment so all downstream tier checks see
 * the same value.
 */
export function resolveEffectivePlan(
  storedPlan: string,
  proGraceUntil: number | null | undefined,
): string {
  if (storedPlan && storedPlan !== 'free') return storedPlan;
  if (proGraceUntil && proGraceUntil > Date.now()) return 'pro';
  return storedPlan || 'free';
}
